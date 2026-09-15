import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NewImportView } from '@/features/data/new-import-view';

export const metadata: Metadata = { title: 'Import data' };

export default function Page() {
  return (
    <Suspense>
      <NewImportView />
    </Suspense>
  );
}
