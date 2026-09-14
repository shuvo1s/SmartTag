import { z } from 'zod';

export const RECORD_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const BUSINESS_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;

const businessCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(BUSINESS_CODE_PATTERN, { error: 'Use 1–32 letters, digits, "-" or "_"' });

export const CreateCustomerRequestSchema = z.object({
  code: businessCode,
  name: z.string().trim().min(1, { error: 'Name is required' }).max(200),
});
export type CreateCustomerRequest = z.infer<typeof CreateCustomerRequestSchema>;

export const CreateBrandRequestSchema = z.object({
  code: businessCode,
  name: z.string().trim().min(1, { error: 'Name is required' }).max(200),
});
export type CreateBrandRequest = z.infer<typeof CreateBrandRequestSchema>;

export interface BrandDto {
  readonly id: string;
  readonly customerId: string;
  readonly code: string;
  readonly name: string;
  readonly status: RecordStatus;
}

export interface CustomerDto {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: RecordStatus;
  readonly brands: readonly BrandDto[];
  readonly createdAt: string;
  readonly updatedAt: string;
}
