import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NewProductionJobView } from '@/features/production/new-job-view';

export const metadata: Metadata = { title: 'New production job' };

export default function Page() {
  return (
    <Suspense>
      <NewProductionJobView />
    </Suspense>
  );
}
