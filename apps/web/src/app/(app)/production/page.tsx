import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProductionHomeView } from '@/features/production/production-views';

export const metadata: Metadata = { title: 'Production' };

export default function Page() {
  return (
    <Suspense>
      <ProductionHomeView />
    </Suspense>
  );
}
