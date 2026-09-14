import { notFound } from 'next/navigation';
import { EditorEntry } from '@/features/editor/editor-entry';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditVersionPage(
  props: PageProps<'/templates/[templateId]/versions/[versionId]/edit'>,
) {
  const { templateId, versionId } = await props.params;
  if (!UUID.test(templateId) || !UUID.test(versionId)) {
    notFound();
  }
  return <EditorEntry templateId={templateId} versionId={versionId} />;
}
