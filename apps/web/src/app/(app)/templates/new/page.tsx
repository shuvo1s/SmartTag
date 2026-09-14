import type { Metadata } from 'next';
import { CreateTemplateView } from '@/features/templates/create-template-view';

export const metadata: Metadata = { title: 'New template' };

export default function NewTemplatePage() {
  return <CreateTemplateView />;
}
