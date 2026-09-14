import { Injectable, Logger } from '@nestjs/common';
import { hashCanonicalJson } from '@smarttag/document-utils';
import {
  isVersionContentEditable,
  type CreateTemplateVersionRequest,
  type TemplateVersionDetailDto,
  type TemplateVersionSummaryDto,
  type TransitionTemplateVersionRequest,
  type UpdateTemplateVersionRequest,
} from '@smarttag/shared-types';
import { AppError } from '../../common/errors/app-error';
import type { ActorContext } from '../../common/http/request-context';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { prepareDocumentForStorage } from './document-storage';
import { TemplateDocumentService } from './template-document.service';
import {
  toVersionDetailDto,
  toVersionSummaryDto,
  versionDetailSelect,
  versionSummarySelect,
} from './template.mappers';
import { planStatusTransition } from './version-status-policy';

type CreateVersionCommand = Omit<CreateTemplateVersionRequest, 'changeSummary'> & {
  changeSummary: string;
};

@Injectable()
export class TemplateVersionsService {
  private readonly logger = new Logger(TemplateVersionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: TemplateDocumentService,
    private readonly audit: AuditService,
  ) {}

  async listForTemplate(
    actor: ActorContext,
    templateId: string,
  ): Promise<TemplateVersionSummaryDto[]> {
    await this.requireTemplate(actor, templateId);
    const rows = await this.prisma.templateVersion.findMany({
      where: { templateId, organizationId: actor.organizationId },
      orderBy: { versionNumber: 'desc' },
      select: versionSummarySelect,
    });
    return rows.map(toVersionSummaryDto);
  }

  async get(actor: ActorContext, versionId: string): Promise<TemplateVersionDetailDto> {
    const row = await this.prisma.templateVersion.findFirst({
      where: { id: versionId, organizationId: actor.organizationId },
      select: versionDetailSelect,
    });
    if (!row) {
      throw AppError.notFound('Template version');
    }
    return toVersionDetailDto(row);
  }

  /**
   * Creates the next immutable revision of a template. Version numbers are allocated by
   * incrementing Template.latestVersionNumber inside the transaction: the row lock serialises
   * concurrent creators, and the (template_id, version_number) unique constraint backs it up.
   */
  async create(
    actor: ActorContext,
    templateId: string,
    input: CreateVersionCommand,
  ): Promise<TemplateVersionDetailDto> {
    const template = await this.requireTemplate(actor, templateId);
    if (template.status === 'ARCHIVED') {
      throw AppError.conflict('Archived templates cannot receive new versions');
    }

    const { source, basedOnVersionId } = await this.resolveSource(actor, template, input);
    const document = await this.documents.validateForTemplate(this.prisma, template, source);
    const prepared = await prepareDocumentForStorage(document);

    const versionId = await this.prisma.$transaction(async (tx) => {
      const { latestVersionNumber } = await tx.template.update({
        where: { id_organizationId: { id: templateId, organizationId: actor.organizationId } },
        data: { latestVersionNumber: { increment: 1 }, updatedById: actor.userId },
        select: { latestVersionNumber: true },
      });
      const version = await tx.templateVersion.create({
        data: {
          organizationId: actor.organizationId,
          templateId,
          versionNumber: latestVersionNumber,
          ...prepared,
          changeSummary: input.changeSummary,
          basedOnVersionId,
          createdById: actor.userId,
        },
        select: { id: true },
      });
      await tx.template.update({
        where: { id: templateId },
        data: { currentVersionId: version.id },
      });
      await this.audit.recordForActor(tx, actor, {
        action: 'TEMPLATE_VERSION_CREATED',
        resourceType: 'TEMPLATE_VERSION',
        resourceId: version.id,
        metadata: {
          templateId,
          versionNumber: latestVersionNumber,
          documentHash: prepared.documentHash,
          basedOnVersionId,
        },
      });
      return version.id;
    });

    return this.get(actor, versionId);
  }

  /** Replaces the content of a DRAFT version, guarded by optimistic concurrency. */
  async updateDraft(
    actor: ActorContext,
    versionId: string,
    input: UpdateTemplateVersionRequest,
  ): Promise<TemplateVersionDetailDto> {
    const version = await this.prisma.templateVersion.findFirst({
      where: { id: versionId, organizationId: actor.organizationId },
      select: {
        id: true,
        status: true,
        revision: true,
        template: { select: { id: true, organizationId: true, documentType: true } },
      },
    });
    if (!version) {
      throw AppError.notFound('Template version');
    }
    this.assertEditable(version.status, version.revision, input.expectedRevision);

    const document = await this.documents.validateForTemplate(
      this.prisma,
      version.template,
      input.document,
    );
    const prepared = await prepareDocumentForStorage(document);

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.templateVersion.updateMany({
        where: {
          id: versionId,
          organizationId: actor.organizationId,
          status: 'DRAFT',
          revision: input.expectedRevision,
        },
        data: {
          ...prepared,
          ...(input.changeSummary !== undefined && { changeSummary: input.changeSummary }),
          revision: { increment: 1 },
        },
      });
      if (result.count === 0) {
        // Lost a race: re-read to report the precise reason.
        const current = await tx.templateVersion.findFirstOrThrow({
          where: { id: versionId },
          select: { status: true, revision: true },
        });
        this.assertEditable(current.status, current.revision, input.expectedRevision);
        throw new AppError(
          'VERSION_CONFLICT',
          'The version was modified concurrently. Reload and try again.',
        );
      }
      await tx.template.update({
        where: { id: version.template.id },
        data: { updatedById: actor.userId },
      });
      await this.audit.recordForActor(tx, actor, {
        action: 'TEMPLATE_VERSION_UPDATED',
        resourceType: 'TEMPLATE_VERSION',
        resourceId: versionId,
        metadata: { revision: input.expectedRevision + 1, documentHash: prepared.documentHash },
      });
    });
    return this.get(actor, versionId);
  }

  async transition(
    actor: ActorContext,
    versionId: string,
    input: TransitionTemplateVersionRequest,
  ): Promise<TemplateVersionDetailDto> {
    const version = await this.prisma.templateVersion.findFirst({
      where: { id: versionId, organizationId: actor.organizationId },
      select: { id: true, status: true, documentJson: true, documentHash: true },
    });
    if (!version) {
      throw AppError.notFound('Template version');
    }

    const plan = planStatusTransition(version.status, input.targetStatus, actor, new Date());

    if (plan.transition.to === 'IN_REVIEW' || plan.transition.to === 'APPROVED') {
      // Never send for review or approve content whose stored bytes no longer match their hash.
      const actualHash = await hashCanonicalJson(version.documentJson);
      if (actualHash !== version.documentHash) {
        this.logger.error(
          { versionId, expected: version.documentHash, actual: actualHash },
          'Template version document hash mismatch',
        );
        throw new AppError('INTERNAL_ERROR', 'Document integrity check failed');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.templateVersion.updateMany({
        where: { id: versionId, organizationId: actor.organizationId, status: version.status },
        data: plan.changes,
      });
      if (result.count === 0) {
        throw new AppError(
          'VERSION_CONFLICT',
          'The version status changed concurrently. Reload and try again.',
        );
      }
      await this.audit.recordForActor(tx, actor, {
        action: 'TEMPLATE_VERSION_STATUS_CHANGED',
        resourceType: 'TEMPLATE_VERSION',
        resourceId: versionId,
        metadata: {
          from: plan.transition.from,
          to: plan.transition.to,
          action: plan.transition.action,
          ...(input.comment ? { comment: input.comment } : {}),
        },
      });
    });
    return this.get(actor, versionId);
  }

  private assertEditable(
    status: TemplateVersionDetailDto['status'],
    revision: number,
    expectedRevision: number,
  ): void {
    if (!isVersionContentEditable(status)) {
      throw new AppError(
        'VERSION_IMMUTABLE',
        `This version is ${status} and cannot be modified. Create a new version instead.`,
      );
    }
    if (revision !== expectedRevision) {
      throw new AppError(
        'VERSION_CONFLICT',
        'The version was modified by someone else. Reload and try again.',
        {
          currentRevision: revision,
        },
      );
    }
  }

  private async requireTemplate(actor: ActorContext, templateId: string) {
    const template = await this.prisma.template.findFirst({
      where: { id: templateId, organizationId: actor.organizationId },
      select: {
        id: true,
        organizationId: true,
        documentType: true,
        status: true,
        currentVersionId: true,
      },
    });
    if (!template) {
      throw AppError.notFound('Template');
    }
    return template;
  }

  private async resolveSource(
    actor: ActorContext,
    template: { id: string; currentVersionId: string | null },
    input: CreateVersionCommand,
  ): Promise<{ source: unknown; basedOnVersionId: string | null }> {
    const baseId = input.basedOnVersionId ?? template.currentVersionId;
    const base = baseId
      ? await this.prisma.templateVersion.findFirst({
          where: { id: baseId, templateId: template.id, organizationId: actor.organizationId },
          select: { id: true, documentJson: true },
        })
      : null;

    if (input.basedOnVersionId && !base) {
      throw AppError.validation('Invalid base version', [
        { path: 'basedOnVersionId', message: 'Version not found for this template' },
      ]);
    }
    if (input.document !== undefined) {
      return { source: input.document, basedOnVersionId: base?.id ?? null };
    }
    if (!base) {
      throw AppError.validation('A document is required', [
        { path: 'document', message: 'Provide a document' },
      ]);
    }
    return { source: base.documentJson, basedOnVersionId: base.id };
  }
}
