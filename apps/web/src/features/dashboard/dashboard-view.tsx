'use client';

import { Badge, Card, CardBody, CardHeader, PageHeader, buttonStyles } from '@smarttag/ui';
import Link from 'next/link';
import { useSession } from '../auth/session';
import { useCustomers, useTemplates } from '../templates/api';

const PLATFORM_STATUS = [
  { area: 'Canonical document model, validation, hashing', status: 'Available' },
  { area: 'Templates & immutable versions', status: 'Available' },
  { area: 'Customers & brands', status: 'Available' },
  { area: 'Asset storage (API), SVG sanitization', status: 'Available' },
  { area: 'Professional canvas designer (draft versions)', status: 'Available' },
  { area: 'Controlled fonts, CODE128/EAN-13/QR preview rendering', status: 'Available' },
  { area: 'CSV/Excel batch VDP, field mapping, print-ready PDF', status: 'Planned' },
  { area: 'Approval workflow, jobs, ERP/PLM integrations', status: 'Planned' },
] as const;

export function DashboardView() {
  const session = useSession();
  const canReadTemplates = session.permissions.includes('template:read');
  const active = useTemplates({ page: 1, pageSize: 1, status: 'ACTIVE' });
  const customers = useCustomers();

  return (
    <>
      <PageHeader
        title={`Welcome, ${session.user.displayName}`}
        description={`You are working in ${session.activeOrganization.name}.`}
      />
      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-sm text-slate-500">Active templates</p>
            <p className="mt-1 text-3xl font-semibold text-slate-900">
              {active.data?.total ?? '—'}
            </p>
            {canReadTemplates ? (
              <Link
                href="/templates"
                className={`${buttonStyles({ variant: 'ghost', size: 'sm' })} mt-2 -ml-3`}
              >
                View templates →
              </Link>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-slate-500">Customers</p>
            <p className="mt-1 text-3xl font-semibold text-slate-900">
              {customers.data?.length ?? '—'}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-slate-500">Your roles</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {session.roles.map((role) => (
                <Badge key={role} tone="info">
                  {role.replace(/_/g, ' ')}
                </Badge>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader
          title="Platform capabilities"
          description="What is available in this release."
        />
        <CardBody>
          <ul className="divide-y divide-slate-100">
            {PLATFORM_STATUS.map((item) => (
              <li key={item.area} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-700">{item.area}</span>
                <Badge tone={item.status === 'Available' ? 'success' : 'neutral'}>
                  {item.status}
                </Badge>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </>
  );
}
