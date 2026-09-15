'use client';

import { listDocumentTypes } from '@smarttag/document-utils';
import { Alert, PageHeader, Spinner } from '@smarttag/ui';
import { useRouter } from 'next/navigation';
import { describeError } from '@/lib/api-client';
import { useCan, useSession } from '../auth/session';
import { useCreateTemplate, useCustomers } from './api';
import { CreateTemplateForm } from './create-template-form';
import { pathAfterTemplateCreated } from './routes';

export function CreateTemplateView() {
  const router = useRouter();
  const session = useSession();
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
        description="Creates the template and its first draft version with a blank canonical document (no artwork), then opens the draft in the designer."
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
            router.push(pathAfterTemplateCreated(template, session.permissions));
          }}
        />
      ) : (
        <Spinner />
      )}
    </div>
  );
}
