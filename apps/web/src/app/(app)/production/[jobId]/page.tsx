import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProductionJobView } from '@/features/production/job-detail-view';

export const metadata: Metadata = { title: 'Production job' };

export default async function Page({ params }: PageProps<'/production/[jobId]'>) {
  const { jobId } = await params;
  return (
    <Suspense>
      <ProductionJobView jobId={jobId} />
    </Suspense>
  );
}
