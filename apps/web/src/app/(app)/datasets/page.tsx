import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DataHomeView } from '@/features/data/data-views';

export const metadata: Metadata = { title: 'Data' };

export default function Page() {
  return (
    <Suspense>
      <DataHomeView />
    </Suspense>
  );
}
