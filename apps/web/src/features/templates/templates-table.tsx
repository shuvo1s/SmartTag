import { DOCUMENT_TYPE_DEFINITIONS } from '@smarttag/document-utils';
import type { TemplateDto } from '@smarttag/shared-types';
import { EmptyState, Table, Td, Th } from '@smarttag/ui';
import Link from 'next/link';
import { formatDateTime, formatDimensions } from '@/lib/format';
import { TemplateStatusBadge, VersionStatusBadge } from './status-badges';

export function TemplatesTable({ templates }: { templates: readonly TemplateDto[] }) {
  if (templates.length === 0) {
    return (
      <EmptyState
        title="No templates found"
        description="Create a template or adjust the filters."
      />
    );
  }
  return (
    <Table>
      <thead className="bg-slate-50">
        <tr>
          <Th>Code</Th>
          <Th>Name</Th>
          <Th>Type</Th>
          <Th>Customer / brand</Th>
          <Th>Trim size</Th>
          <Th>Current version</Th>
          <Th>Status</Th>
          <Th>Updated</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {templates.map((template) => {
          const summary = template.currentVersion?.summary;
          return (
            <tr key={template.id} className="hover:bg-slate-50">
              <Td className="font-mono text-xs text-slate-900">{template.code}</Td>
              <Td>
                <Link
                  href={`/templates/${template.id}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  {template.name}
                </Link>
              </Td>
              <Td>{DOCUMENT_TYPE_DEFINITIONS[template.documentType].label}</Td>
              <Td>
                {template.customer
                  ? `${template.customer.name}${template.brand ? ` / ${template.brand.name}` : ''}`
                  : '—'}
              </Td>
              <Td>
                {summary
                  ? formatDimensions(summary.widthPt, summary.heightPt, summary.displayUnit)
                  : '—'}
              </Td>
              <Td>
                {template.currentVersion ? (
                  <span className="inline-flex items-center gap-2">
                    v{template.currentVersion.versionNumber}
                    <VersionStatusBadge status={template.currentVersion.status} />
                  </span>
                ) : (
                  '—'
                )}
              </Td>
              <Td>
                <TemplateStatusBadge status={template.status} />
              </Td>
              <Td className="text-slate-500">{formatDateTime(template.updatedAt)}</Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
