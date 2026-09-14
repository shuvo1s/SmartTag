import {
  availableTransitions,
  type Permission,
  type TemplateVersionStatus,
  type TemplateVersionSummaryDto,
} from '@smarttag/shared-types';
import { Button, EmptyState, Table, Td, Th } from '@smarttag/ui';
import Link from 'next/link';
import { formatDateTime, shortHash } from '@/lib/format';
import { VersionStatusBadge } from './status-badges';

export interface VersionsTableProps {
  versions: readonly TemplateVersionSummaryDto[];
  currentVersionId: string | null;
  permissions: readonly Permission[];
  pendingVersionId?: string | null;
  onTransition: (versionId: string, targetStatus: TemplateVersionStatus) => void;
}

export function VersionsTable({
  versions,
  currentVersionId,
  permissions,
  pendingVersionId,
  onTransition,
}: VersionsTableProps) {
  if (versions.length === 0) {
    return <EmptyState title="No versions yet" />;
  }
  return (
    <Table>
      <thead className="bg-slate-50">
        <tr>
          <Th>Version</Th>
          <Th>Status</Th>
          <Th>Change summary</Th>
          <Th>Document hash</Th>
          <Th>Created</Th>
          <Th>Approved</Th>
          <Th className="text-right">Actions</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {versions.map((version) => {
          const transitions = availableTransitions(version.status, permissions);
          return (
            <tr key={version.id} data-testid={`version-row-${version.versionNumber}`}>
              <Td className="font-medium text-slate-900">
                <Link
                  href={`/templates/${version.templateId}/versions/${version.id}`}
                  className="text-brand-700 hover:underline"
                >
                  v{version.versionNumber}
                </Link>
                {version.id === currentVersionId ? (
                  <span className="ml-2 text-xs text-slate-500">(current)</span>
                ) : null}
              </Td>
              <Td>
                <VersionStatusBadge status={version.status} />
              </Td>
              <Td className="max-w-xs truncate whitespace-normal">
                {version.changeSummary || '—'}
              </Td>
              <Td>
                <code title={version.documentHash} className="font-mono text-xs text-slate-500">
                  {shortHash(version.documentHash)}
                </code>
              </Td>
              <Td className="text-slate-500">
                {formatDateTime(version.createdAt)}
                <div className="text-xs">{version.createdBy.displayName}</div>
              </Td>
              <Td className="text-slate-500">
                {version.approvedAt ? (
                  <>
                    {formatDateTime(version.approvedAt)}
                    <div className="text-xs">{version.approvedBy?.displayName}</div>
                  </>
                ) : (
                  '—'
                )}
              </Td>
              <Td className="text-right">
                <div className="flex justify-end gap-2">
                  {transitions.map((transition) => (
                    <Button
                      key={transition.action}
                      size="sm"
                      variant={
                        transition.to === 'APPROVED'
                          ? 'primary'
                          : transition.to === 'RETIRED'
                            ? 'danger'
                            : 'secondary'
                      }
                      disabled={pendingVersionId === version.id}
                      onClick={() => onTransition(version.id, transition.to)}
                    >
                      {transition.label}
                    </Button>
                  ))}
                </div>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
