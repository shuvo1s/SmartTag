import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  CreateBrandRequestSchema,
  CreateCustomerRequestSchema,
  type BrandDto,
  type CreateBrandRequest,
  type CreateCustomerRequest,
  type CustomerDto,
} from '@smarttag/shared-types';
import type { ActorContext } from '../../common/http/request-context';
import { UuidParamPipe, ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor, RequirePermissions } from '../authorization/authorization.decorators';
import { CustomersService } from './customers.service';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @RequirePermissions('customer:read')
  @Get()
  list(@CurrentActor() actor: ActorContext): Promise<CustomerDto[]> {
    return this.customers.list(actor);
  }

  @RequirePermissions('customer:manage')
  @Post()
  create(
    @CurrentActor() actor: ActorContext,
    @Body(new ZodValidationPipe(CreateCustomerRequestSchema)) body: CreateCustomerRequest,
  ): Promise<CustomerDto> {
    return this.customers.create(actor, body);
  }

  @RequirePermissions('customer:read')
  @Get(':customerId')
  get(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new UuidParamPipe('Customer')) customerId: string,
  ): Promise<CustomerDto> {
    return this.customers.get(actor, customerId);
  }

  @RequirePermissions('customer:manage')
  @Post(':customerId/brands')
  createBrand(
    @CurrentActor() actor: ActorContext,
    @Param('customerId', new UuidParamPipe('Customer')) customerId: string,
    @Body(new ZodValidationPipe(CreateBrandRequestSchema)) body: CreateBrandRequest,
  ): Promise<BrandDto> {
    return this.customers.createBrand(actor, customerId, body);
  }
}
