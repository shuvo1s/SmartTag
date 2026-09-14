import type { Metadata } from 'next';
import { TemplatesListView } from '@/features/templates/templates-list-view';

export const metadata: Metadata = { title: 'Templates' };

export default function TemplatesPage() {
  return <TemplatesListView />;
}
