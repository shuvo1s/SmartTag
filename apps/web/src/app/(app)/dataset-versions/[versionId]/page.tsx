import type { Metadata } from 'next';
import { DatasetVersionView } from '@/features/data/data-views';

export const metadata: Metadata = { title: 'Dataset version' };

export default async function Page({ params }: PageProps<'/dataset-versions/[versionId]'>) {
  const { versionId } = await params;
  return <DatasetVersionView versionId={versionId} />;
}
