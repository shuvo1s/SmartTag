import type { TemplateStatus, TemplateVersionStatus } from '@smarttag/shared-types';
import { Badge, type Tone } from '@smarttag/ui';

const VERSION_TONES: Record<TemplateVersionStatus, Tone> = {
  DRAFT: 'neutral',
  IN_REVIEW: 'warning',
  APPROVED: 'success',
  RETIRED: 'danger',
};

const VERSION_LABELS: Record<TemplateVersionStatus, string> = {
  DRAFT: 'Draft',
  IN_REVIEW: 'In review',
  APPROVED: 'Approved',
  RETIRED: 'Retired',
};

export function VersionStatusBadge({ status }: { status: TemplateVersionStatus }) {
  return <Badge tone={VERSION_TONES[status]}>{VERSION_LABELS[status]}</Badge>;
}

export function TemplateStatusBadge({ status }: { status: TemplateStatus }) {
  return <Badge tone={status === 'ACTIVE' ? 'info' : 'neutral'}>{status === 'ACTIVE' ? 'Active' : 'Archived'}</Badge>;
}
