'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  CreateBrandRequestSchema,
  CreateCustomerRequestSchema,
  type BrandDto,
  type CreateBrandRequest,
  type CreateCustomerRequest,
  type CustomerDto,
} from '@smarttag/shared-types';
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Spinner } from '@smarttag/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { apiRequest, describeError } from '@/lib/api-client';
import { useCan } from '../auth/session';
import { useCustomers } from '../templates/api';

function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomerRequest) => apiRequest<CustomerDto>('/customers', { json: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customers'] }),
  });
}

function useCreateBrand(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBrandRequest) => apiRequest<BrandDto>(`/customers/${customerId}/brands`, { json: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customers'] }),
  });
}

function CustomerForm() {
  const create = useCreateCustomer();
  const { register, handleSubmit, reset, formState } = useForm<CreateCustomerRequest>({
    resolver: zodResolver(CreateCustomerRequestSchema),
    defaultValues: { code: '', name: '' },
  });
  return (
    <form noValidate className="flex flex-wrap items-start gap-3" onSubmit={(event) => void handleSubmit((values) => create.mutateAsync(values).then(() => reset()).catch(() => undefined))(event)}>
      <Field label="Customer code" error={formState.errors.code?.message} className="w-44">
        <Input className="font-mono uppercase" {...register('code')} />
      </Field>
      <Field label="Customer name" error={formState.errors.name?.message} className="min-w-64 flex-1">
        <Input {...register('name')} />
      </Field>
      <Button type="submit" className="mt-6" loading={create.isPending}>
        Add customer
      </Button>
      {create.error ? <Alert tone="danger" className="basis-full">{describeError(create.error)}</Alert> : null}
    </form>
  );
}

function BrandForm({ customerId }: { customerId: string }) {
  const create = useCreateBrand(customerId);
  const { register, handleSubmit, reset, formState } = useForm<CreateBrandRequest>({
    resolver: zodResolver(CreateBrandRequestSchema),
    defaultValues: { code: '', name: '' },
  });
  return (
    <form noValidate className="flex flex-wrap items-start gap-2" onSubmit={(event) => void handleSubmit((values) => create.mutateAsync(values).then(() => reset()).catch(() => undefined))(event)}>
      <Field label="Brand code" error={formState.errors.code?.message} className="w-36">
        <Input className="h-9 font-mono uppercase" {...register('code')} />
      </Field>
      <Field label="Brand name" error={formState.errors.name?.message} className="min-w-48 flex-1">
        <Input className="h-9" {...register('name')} />
      </Field>
      <Button type="submit" size="sm" variant="secondary" className="mt-7" loading={create.isPending}>
        Add brand
      </Button>
      {create.error ? <Alert tone="danger" className="basis-full">{describeError(create.error)}</Alert> : null}
    </form>
  );
}

export function CustomersView() {
  const customers = useCustomers();
  const canManage = useCan('customer:manage');

  return (
    <div className="max-w-5xl">
      <PageHeader eyebrow="Administration" title="Customers & brands" description="Templates can optionally belong to a customer and one of its brands." />
      {canManage ? (
        <Card className="mb-6">
          <CardHeader title="Add customer" />
          <CardBody>
            <CustomerForm />
          </CardBody>
        </Card>
      ) : null}
      {customers.error ? (
        <Alert tone="danger">{describeError(customers.error)}</Alert>
      ) : !customers.data ? (
        <Spinner />
      ) : customers.data.length === 0 ? (
        <Card>
          <EmptyState title="No customers yet" />
        </Card>
      ) : (
        <div className="space-y-4">
          {customers.data.map((customer) => (
            <Card key={customer.id}>
              <CardHeader
                title={
                  <span className="inline-flex items-center gap-2">
                    {customer.name} <code className="font-mono text-xs text-slate-500">{customer.code}</code>
                  </span>
                }
              />
              <CardBody className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {customer.brands.length === 0 ? <span className="text-sm text-slate-500">No brands</span> : null}
                  {customer.brands.map((brand) => (
                    <Badge key={brand.id} tone="info">
                      {brand.name} · {brand.code}
                    </Badge>
                  ))}
                </div>
                {canManage ? <BrandForm customerId={customer.id} /> : null}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
