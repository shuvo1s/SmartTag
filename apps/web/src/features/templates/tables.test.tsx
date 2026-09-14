import { PERMISSIONS, permissionsForRoles } from '@smarttag/shared-types';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TemplatesTable } from './templates-table';
import { templateDto, versionDto } from './test-data';
import { VersionsTable } from './versions-table';

describe('TemplatesTable', () => {
  it('lists templates with physical size, current version and status', () => {
    render(
      <TemplatesTable
        templates={[
          templateDto(),
          templateDto({ id: 't-2', code: 'HT-ARCHIVED', name: 'Old tag', status: 'ARCHIVED', customer: null, brand: null, currentVersion: null }),
        ]}
      />,
    );
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);

    const first = within(rows[0]!);
    expect(first.getByText('HT-DEMO-50X90')).toBeInTheDocument();
    expect(first.getByRole('link', { name: 'Demo Active hang tag' })).toHaveAttribute('href', '/templates/0192f0a0-5b1e-7c3d-8e4f-1a2b3c4d5e6f');
    expect(first.getByText('Hang tag')).toBeInTheDocument();
    expect(first.getByText('Demo Apparel Co. / Demo Active')).toBeInTheDocument();
    expect(first.getByText('50 × 90 mm')).toBeInTheDocument();
    expect(first.getByText('Draft')).toBeInTheDocument();
    expect(first.getByText('Active')).toBeInTheDocument();

    const second = within(rows[1]!);
    expect(second.getByText('Archived')).toBeInTheDocument();
    expect(second.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('renders an empty state', () => {
    render(<TemplatesTable templates={[]} />);
    expect(screen.getByText('No templates found')).toBeInTheDocument();
  });
});

describe('VersionsTable', () => {
  const versions = [
    versionDto({ id: 'v-3', versionNumber: 3, status: 'IN_REVIEW', changeSummary: 'Bigger price' }),
    versionDto({ id: 'v-2', versionNumber: 2, status: 'DRAFT', changeSummary: 'Work in progress' }),
    versionDto({
      id: 'v-1',
      versionNumber: 1,
      status: 'APPROVED',
      approvedAt: '2026-09-11T09:30:00.000Z',
      approvedBy: { id: 'u-2', displayName: 'Demo Approver' },
    }),
  ];

  it('lists versions with status, short hash and approval', () => {
    render(<VersionsTable versions={versions} currentVersionId="v-3" permissions={permissionsForRoles(['VIEWER'])} onTransition={vi.fn()} />);
    expect(screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0]!.textContent)).toEqual(['v3(current)', 'v2', 'v1']);
    const v1 = within(screen.getByTestId('version-row-1'));
    expect(v1.getByText('Approved')).toBeInTheDocument();
    expect(v1.getByText('0123456789ab')).toHaveAttribute('title', '0123456789abcdef'.repeat(4));
    expect(v1.getByText('Demo Approver')).toBeInTheDocument();
    expect(within(screen.getByTestId('version-row-3')).getByText('In review')).toBeInTheDocument();
  });

  it('offers no lifecycle actions to read-only users', () => {
    render(<VersionsTable versions={versions} currentVersionId="v-3" permissions={permissionsForRoles(['VIEWER'])} onTransition={vi.fn()} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('offers only the transitions the role permits', async () => {
    const onTransition = vi.fn();
    render(<VersionsTable versions={versions} currentVersionId="v-3" permissions={permissionsForRoles(['APPROVER'])} onTransition={onTransition} />);

    const inReview = within(screen.getByTestId('version-row-3'));
    expect(inReview.getAllByRole('button').map((b) => b.textContent)).toEqual(['Return to draft', 'Approve']);
    expect(within(screen.getByTestId('version-row-2')).queryAllByRole('button')).toHaveLength(0);
    expect(within(screen.getByTestId('version-row-1')).queryAllByRole('button')).toHaveLength(0);

    await userEvent.click(inReview.getByRole('button', { name: 'Approve' }));
    expect(onTransition).toHaveBeenCalledWith('v-3', 'APPROVED');
  });

  it('never offers to reopen approved versions, even to administrators', () => {
    render(<VersionsTable versions={versions} currentVersionId="v-3" permissions={[...PERMISSIONS]} onTransition={vi.fn()} />);
    expect(within(screen.getByTestId('version-row-1')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Retire']);
  });
});
