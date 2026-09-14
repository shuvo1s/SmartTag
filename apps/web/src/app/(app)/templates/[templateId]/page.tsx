import type { Metadata } from 'next';
import { TemplateDetailView } from '@/features/templates/template-detail-view';

export const metadata: Metadata = { title: 'Template' };

export default async function TemplateDetailPage({ params }: PageProps<'/templates/[templateId]'>) {
  const { templateId } = await params;
  return <TemplateDetailView templateId={templateId} />;
}
