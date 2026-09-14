import type { Metadata } from 'next';
import { VersionDetailView } from '@/features/templates/version-detail-view';

export const metadata: Metadata = { title: 'Template version' };

export default async function TemplateVersionPage({ params }: PageProps<'/templates/[templateId]/versions/[versionId]'>) {
  const { templateId, versionId } = await params;
  return <VersionDetailView templateId={templateId} versionId={versionId} />;
}
