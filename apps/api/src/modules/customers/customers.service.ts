import { Injectable } from '@nestjs/common';
import type { BrandDto, CreateBrandRequest, CreateCustomerRequest, CustomerDto } from '@smarttag/shared-types';
import { AppError } from '../../common/errors/app-error';
import type { ActorContext } from '../../common/http/request-context';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

const customerSelect = {
  id: true,
  code: true,
  name: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  brands: {
    orderBy: { name: 'asc' },
    select: { id: true, customerId: true, code: true, name: true, status: true },
  },
} as const;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: ActorContext): Promise<CustomerDto[]> {
    const customers = await this.prisma.customer.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { name: 'asc' },
      select: customerSelect,
    });
    return customers.map(toCustomerDto);
  }

  async get(actor: ActorContext, customerId: string): Promise<CustomerDto> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: actor.organizationId },
      select: customerSelect,
    });
    if (!customer) {
      throw AppError.notFound('Customer');
    }
    return toCustomerDto(customer);
  }

  async create(actor: ActorContext, input: CreateCustomerRequest): Promise<CustomerDto> {
    const existing = await this.prisma.customer.findUnique({
      where: { organizationId_code: { organizationId: actor.organizationId, code: input.code } },
      select: { id: true },
    });
    if (existing) {
      throw AppError.conflict(`A customer with code "${input.code}" already exists`);
    }
    const customer = await this.prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: { organizationId: actor.organizationId, code: input.code, name: input.name, createdById: actor.userId },
        select: customerSelect,
      });
      await this.audit.recordForActor(tx, actor, {
        action: 'CUSTOMER_CREATED',
        resourceType: 'CUSTOMER',
        resourceId: created.id,
        metadata: { code: created.code },
      });
      return created;
    });
    return toCustomerDto(customer);
  }

  async createBrand(actor: ActorContext, customerId: string, input: CreateBrandRequest): Promise<BrandDto> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: actor.organizationId },
      select: { id: true },
    });
    if (!customer) {
      throw AppError.notFound('Customer');
    }
    const existing = await this.prisma.brand.findUnique({
      where: { customerId_code: { customerId, code: input.code } },
      select: { id: true },
    });
    if (existing) {
      throw AppError.conflict(`This customer already has a brand with code "${input.code}"`);
    }
    return this.prisma.$transaction(async (tx) => {
      const brand = await tx.brand.create({
        data: {
          organizationId: actor.organizationId,
          customerId,
          code: input.code,
          name: input.name,
          createdById: actor.userId,
        },
        select: { id: true, customerId: true, code: true, name: true, status: true },
      });
      await this.audit.recordForActor(tx, actor, {
        action: 'BRAND_CREATED',
        resourceType: 'BRAND',
        resourceId: brand.id,
        metadata: { customerId, code: brand.code },
      });
      return brand;
    });
  }
}

type CustomerRow = {
  id: string;
  code: string;
  name: string;
  status: CustomerDto['status'];
  createdAt: Date;
  updatedAt: Date;
  brands: BrandDto[];
};

function toCustomerDto(customer: CustomerRow): CustomerDto {
  return {
    id: customer.id,
    code: customer.code,
    name: customer.name,
    status: customer.status,
    brands: customer.brands,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}
