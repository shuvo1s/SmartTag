import type { Metadata } from 'next';
import { DocumentPlaygroundPage } from '@/features/playground/document-playground';

export const metadata: Metadata = { title: 'Document playground' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PlaygroundPage({ searchParams }: PageProps<'/developer/playground'>) {
  const { versionId } = await searchParams;
  const id = typeof versionId === 'string' && UUID.test(versionId) ? versionId : null;
  return <DocumentPlaygroundPage versionId={id} />;
}
