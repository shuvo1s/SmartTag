'use client';

import { listDocumentTypes } from '@smarttag/document-utils';
import { Alert, PageHeader, Spinner } from '@smarttag/ui';
import { useRouter } from 'next/navigation';
import { describeError } from '@/lib/api-client';
import { useCan } from '../auth/session';
import { useCreateTemplate, useCustomers } from './api';
import { CreateTemplateForm } from './create-template-form';

export function CreateTemplateView() {
  const router = useRouter();
  const canCreate = useCan('template:create');
  const customers = useCustomers();
  const createTemplate = useCreateTemplate();

  if (!canCreate) {
    return <Alert tone="warning">Your role does not allow creating templates.</Alert>;
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Templates"
        title="New template"
        description="Creates the template and its first draft version with a blank canonical document."
      />
      {customers.error ? (
        <Alert tone="danger">{describeError(customers.error)}</Alert>
      ) : customers.data ? (
        <CreateTemplateForm
          customers={customers.data}
          documentTypes={listDocumentTypes('AVAILABLE')}
          onCancel={() => router.push('/templates')}
          onSubmit={async (values) => {
            const template = await createTemplate.mutateAsync(values);
            router.push(`/templates/${template.id}`);
          }}
        />
      ) : (
        <Spinner />
      )}
    </div>
  );
}
