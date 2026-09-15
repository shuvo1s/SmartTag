import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ImportWizardView } from '@/features/data/import-wizard-view';

export const metadata: Metadata = { title: 'Data import' };

export default async function Page({ params }: PageProps<'/data-imports/[importId]'>) {
  const { importId } = await params;
  return (
    <Suspense>
      <ImportWizardView importId={importId} />
    </Suspense>
  );
}
