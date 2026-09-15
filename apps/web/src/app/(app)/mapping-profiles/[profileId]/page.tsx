import type { Metadata } from 'next';
import { MappingProfileView } from '@/features/data/data-views';

export const metadata: Metadata = { title: 'Mapping profile' };

export default async function Page({ params }: PageProps<'/mapping-profiles/[profileId]'>) {
  const { profileId } = await params;
  return <MappingProfileView profileId={profileId} />;
}
