import { Injectable } from '@nestjs/common';
import { assertValidDesignDocument } from '@smarttag/document-schema';
import {
  DOCUMENT_TYPE_DEFINITIONS,
  createBlankDesignDocument,
  isDocumentTypeAvailable,
} from '@smarttag/document-utils';
import type {
  ApiFieldError,
  CreateTemplateCommand,
  ListTemplatesQuery,
  PaginatedResponse,
  TemplateDto,
  UpdateTemplateRequest,
} from '@smarttag/shared-types';
import { AppError } from '../../common/errors/app-error';
import type { ActorContext } from '../../common/http/request-context';
import { PrismaService, type DbClient } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { assertPermission } from '../authorization/authorization.decorators';
import { prepareDocumentForStorage } from './document-storage';
import { templateSelect, toTemplateDto } from './template.mappers';

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: ActorContext,
    query: ListTemplatesQuery,
  ): Promise<PaginatedResponse<TemplateDto>> {
    const where: Prisma.TemplateWhereInput = {
      organizationId: actor.organizationId,
      status: query.status,
      documentType: query.documentType,
      customerId: query.customerId,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.template.count({ where }),
      this.prisma.template.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: templateSelect,
      }),
    ]);
    return {
      items: rows.map(toTemplateDto),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async get(actor: ActorContext, templateId: string): Promise<TemplateDto> {
    const row = await this.prisma.template.findFirst({
      where: { id: templateId, organizationId: actor.organizationId },
      select: templateSelect,
    });
    if (!row) {
      throw AppError.notFound('Template');
    }
    return toTemplateDto(row);
  }

  /** Creates the template and its first DRAFT version (a blank canonical document) atomically. */
  async create(actor: ActorContext, input: CreateTemplateCommand): Promise<TemplateDto> {
    if (!isDocumentTypeAvailable(input.documentType)) {
      throw AppError.validation('Document type is not available', [
        {
          path: 'documentType',
          message: `${DOCUMENT_TYPE_DEFINITIONS[input.documentType].label} templates are not available yet`,
        },
      ]);
    }
    await this.assertCustomerAndBrand(
      this.prisma,
      actor.organizationId,
      input.customerId,
      input.brandId,
    );
    await this.assertCodeAvailable(actor.organizationId, input.code);

    const templateId = await this.prisma.$transaction(async (tx) => {
      const template = await tx.template.create({
        data: {
          organizationId: actor.organizationId,
          code: input.code,
          name: input.name,
          description: input.description,
          documentType: input.documentType,
          customerId: input.customerId,
          brandId: input.brandId,
          latestVersionNumber: 1,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
        select: { id: true },
      });

      // The logical design id of the document is the template id: stable across all versions.
      const document = assertValidDesignDocument(
        createBlankDesignDocument({
          documentId: template.id,
          name: input.name,
          description: input.description,
          documentType: input.documentType,
          unit: input.dimensions.unit,
          width: input.dimensions.width,
          height: input.dimensions.height,
          bleed: input.dimensions.bleed,
          safeMargin: input.dimensions.safeMargin,
          pageLayout: input.pageLayout,
        }),
      );
      const prepared = await prepareDocumentForStorage(document);

      const version = await tx.templateVersion.create({
        data: {
          organizationId: actor.organizationId,
          templateId: template.id,
          versionNumber: 1,
          ...prepared,
          changeSummary: 'Initial version',
          createdById: actor.userId,
        },
        select: { id: true },
      });
      await tx.template.update({
        where: { id: template.id },
        data: { currentVersionId: version.id },
      });

      await this.audit.recordForActor(tx, actor, {
        action: 'TEMPLATE_CREATED',
        resourceType: 'TEMPLATE',
        resourceId: template.id,
        metadata: { code: input.code, documentType: input.documentType },
      });
      await this.audit.recordForActor(tx, actor, {
        action: 'TEMPLATE_VERSION_CREATED',
        resourceType: 'TEMPLATE_VERSION',
        resourceId: version.id,
        metadata: {
          templateId: template.id,
          versionNumber: 1,
          documentHash: prepared.documentHash,
        },
      });
      return template.id;
    });

    return this.get(actor, templateId);
  }

  async update(
    actor: ActorContext,
    templateId: string,
    input: UpdateTemplateRequest,
  ): Promise<TemplateDto> {
    if (input.status !== undefined) {
      assertPermission(actor, 'template:archive');
    }
    const existing = await this.prisma.template.findFirst({
      where: { id: templateId, organizationId: actor.organizationId },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        customerId: true,
        brandId: true,
      },
    });
    if (!existing) {
      throw AppError.notFound('Template');
    }

    const customerId = input.customerId !== undefined ? input.customerId : existing.customerId;
    const customerChanged = customerId !== existing.customerId;
    // Changing the customer clears a brand that belonged to the previous customer.
    const brandId =
      input.brandId !== undefined ? input.brandId : customerChanged ? null : existing.brandId;
    await this.assertCustomerAndBrand(this.prisma, actor.organizationId, customerId, brandId);

    const data = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.status !== undefined && { status: input.status }),
      customerId,
      brandId,
    };
    const changedFields = Object.entries(data)
      .filter(([key, value]) => existing[key as keyof typeof existing] !== value)
      .map(([key]) => key);

    await this.prisma.$transaction(async (tx) => {
      await tx.template.update({
        where: { id_organizationId: { id: templateId, organizationId: actor.organizationId } },
        data: { ...data, updatedById: actor.userId },
      });
      await this.audit.recordForActor(tx, actor, {
        action: 'TEMPLATE_UPDATED',
        resourceType: 'TEMPLATE',
        resourceId: templateId,
        metadata: { changedFields },
      });
      if (input.status !== undefined && input.status !== existing.status) {
        await this.audit.recordForActor(tx, actor, {
          action: 'TEMPLATE_STATUS_CHANGED',
          resourceType: 'TEMPLATE',
          resourceId: templateId,
          metadata: { from: existing.status, to: input.status },
        });
      }
    });
    return this.get(actor, templateId);
  }

  private async assertCodeAvailable(organizationId: string, code: string): Promise<void> {
    const existing = await this.prisma.template.findUnique({
      where: { organizationId_code: { organizationId, code } },
      select: { id: true },
    });
    if (existing) {
      throw AppError.conflict(`A template with code "${code}" already exists`);
    }
  }

  /** Customer and brand must exist in the actor's organization and belong together. */
  private async assertCustomerAndBrand(
    db: DbClient,
    organizationId: string,
    customerId: string | null,
    brandId: string | null,
  ): Promise<void> {
    const fieldErrors: ApiFieldError[] = [];
    if (brandId !== null && customerId === null) {
      fieldErrors.push({ path: 'customerId', message: 'Select the customer that owns the brand' });
    }
    if (customerId !== null) {
      const customer = await db.customer.findFirst({
        where: { id: customerId, organizationId },
        select: { id: true },
      });
      if (!customer) {
        fieldErrors.push({ path: 'customerId', message: 'Customer not found' });
      } else if (brandId !== null) {
        const brand = await db.brand.findFirst({
          where: { id: brandId, customerId, organizationId },
          select: { id: true },
        });
        if (!brand) {
          fieldErrors.push({
            path: 'brandId',
            message: 'Brand not found for the selected customer',
          });
        }
      }
    }
    if (fieldErrors.length > 0) {
      throw AppError.validation('Invalid customer or brand', fieldErrors);
    }
  }
}
