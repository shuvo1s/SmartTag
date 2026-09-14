'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { MEASUREMENT_UNITS } from '@smarttag/document-schema';
import type { DocumentTypeDefinition } from '@smarttag/document-utils';
import { CreateTemplateRequestSchema, type CustomerDto } from '@smarttag/shared-types';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  Textarea,
} from '@smarttag/ui';
import { useForm, useWatch, type FieldPath } from 'react-hook-form';
import type { z } from 'zod';
import { ApiError, describeError } from '@/lib/api-client';

type FormInput = z.input<typeof CreateTemplateRequestSchema>;
type FormOutput = z.output<typeof CreateTemplateRequestSchema>;

const UNIT_LABELS = {
  mm: 'Millimetres (mm)',
  cm: 'Centimetres (cm)',
  in: 'Inches (in)',
  pt: 'Points (pt)',
} as const;

export interface CreateTemplateFormProps {
  customers: readonly CustomerDto[];
  documentTypes: readonly DocumentTypeDefinition[];
  onSubmit: (values: FormOutput) => Promise<void>;
  onCancel?: () => void;
}

const nullableId = (value: unknown) => (value === '' || value === undefined ? null : value);

/**
 * Validates with the SAME Zod contract the API uses. Server-side field errors (e.g. duplicate
 * code, unknown brand) are mapped back onto the matching fields.
 */
export function CreateTemplateForm({
  customers,
  documentTypes,
  onSubmit,
  onCancel,
}: CreateTemplateFormProps) {
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(CreateTemplateRequestSchema),
    defaultValues: {
      name: '',
      code: '',
      description: '',
      customerId: null,
      brandId: null,
      documentType: documentTypes[0]?.type ?? 'HANG_TAG',
      dimensions: { unit: 'mm', width: 50, height: 90, bleed: 3, safeMargin: 3 },
      pageLayout: 'FRONT_AND_BACK',
    },
  });

  const customerId = useWatch({ control, name: 'customerId' });
  const unit = useWatch({ control, name: 'dimensions.unit' });
  const brands = customers.find((customer) => customer.id === customerId)?.brands ?? [];

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(values);
    } catch (error) {
      const fieldErrors = error instanceof ApiError ? error.fieldErrors() : {};
      const paths = Object.keys(fieldErrors);
      for (const path of paths) {
        setError(path as FieldPath<FormInput>, { type: 'server', message: fieldErrors[path] });
      }
      if (paths.length === 0) {
        setError('root.server', { type: 'server', message: describeError(error) });
      }
    }
  });

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="space-y-6">
      {errors.root?.server?.message ? (
        <Alert tone="danger">{errors.root.server.message}</Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Template"
          description="The code is a stable identifier used by integrations and cannot be changed later."
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Template name" error={errors.name?.message} required>
            <Input {...register('name')} />
          </Field>
          <Field
            label="Template code"
            error={errors.code?.message}
            hint="e.g. HT-50X90-BASIC"
            required
          >
            <Input className="font-mono uppercase" {...register('code')} />
          </Field>
          <Field label="Document type" error={errors.documentType?.message} required>
            <Select {...register('documentType')}>
              {documentTypes.map((definition) => (
                <option key={definition.type} value={definition.type}>
                  {definition.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Customer" error={errors.customerId?.message}>
              <Select
                {...register('customerId', {
                  setValueAs: nullableId,
                  onChange: () => setValue('brandId', null),
                })}
              >
                <option value="">No customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Brand" error={errors.brandId?.message}>
              <Select
                disabled={!customerId || brands.length === 0}
                {...register('brandId', { setValueAs: nullableId })}
              >
                <option value="">No brand</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
            <Textarea rows={2} {...register('description')} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Physical format"
          description="Sizes are entered in your preferred unit and stored in PDF points (1/72 in), independent of screen resolution."
        />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="Unit" error={errors.dimensions?.unit?.message} required>
            <Select {...register('dimensions.unit')}>
              {MEASUREMENT_UNITS.map((value) => (
                <option key={value} value={value}>
                  {UNIT_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Trim width (${unit})`} error={errors.dimensions?.width?.message} required>
            <Input
              type="number"
              step="any"
              inputMode="decimal"
              {...register('dimensions.width', { valueAsNumber: true })}
            />
          </Field>
          <Field
            label={`Trim height (${unit})`}
            error={errors.dimensions?.height?.message}
            required
          >
            <Input
              type="number"
              step="any"
              inputMode="decimal"
              {...register('dimensions.height', { valueAsNumber: true })}
            />
          </Field>
          <Field
            label={`Bleed (${unit})`}
            error={errors.dimensions?.bleed?.message}
            hint="Artwork extension beyond the cut line"
            required
          >
            <Input
              type="number"
              step="any"
              inputMode="decimal"
              {...register('dimensions.bleed', { valueAsNumber: true })}
            />
          </Field>
          <Field
            label={`Safe margin (${unit})`}
            error={errors.dimensions?.safeMargin?.message}
            hint="Keep critical content inside"
            required
          >
            <Input
              type="number"
              step="any"
              inputMode="decimal"
              {...register('dimensions.safeMargin', { valueAsNumber: true })}
            />
          </Field>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-slate-800">Sides</legend>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="radio" value="FRONT_ONLY" {...register('pageLayout')} /> Front only
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="radio" value="FRONT_AND_BACK" {...register('pageLayout')} /> Front + back
            </label>
          </fieldset>
        </CardBody>
      </Card>

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" loading={isSubmitting}>
          Create template
        </Button>
      </div>
    </form>
  );
}
