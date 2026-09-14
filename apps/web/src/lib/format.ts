export { formatDimensions, formatLength } from '@smarttag/document-utils';

const dateTimeFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export function formatDateTime(iso: string | null): string {
  return iso ? dateTimeFormat.format(new Date(iso)) : '—';
}

export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}
