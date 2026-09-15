import type { Metadata } from 'next';
import { DatasetDetailView } from '@/features/data/data-views';

export const metadata: Metadata = { title: 'Dataset' };

export default async function Page({ params }: PageProps<'/datasets/[datasetId]'>) {
  const { datasetId } = await params;
  return <DatasetDetailView datasetId={datasetId} />;
}
