'use client';

import { Badge, Button, Select, cn } from '@smarttag/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useLogout, useSession, useSwitchOrganization } from '../auth/session';
import { NAVIGATION, isActivePath } from './navigation';

export function AppShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const pathname = usePathname();
  const logout = useLogout();
  const switchOrganization = useSwitchOrganization();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
          <span className="flex size-8 items-center justify-center rounded-md bg-brand-700 text-sm font-bold text-white">ST</span>
          <span className="text-sm font-semibold text-slate-900">SmartTag Platform</span>
        </div>
        <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {NAVIGATION.map((section, index) => (
            <div key={section.label ?? index}>
              {section.label ? <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{section.label}</p> : null}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const allowed = !item.permission || session.permissions.includes(item.permission);
                  if (item.availability === 'PLANNED' || !allowed) {
                    return (
                      <li key={item.href}>
                        <span aria-disabled="true" className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-slate-400">
                          {item.label}
                          {item.availability === 'PLANNED' ? <Badge className="text-[10px]">{item.plannedFor}</Badge> : null}
                        </span>
                      </li>
                    );
                  }
                  const active = isActivePath(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'block rounded-md px-2 py-1.5 text-sm font-medium',
                          active ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-100',
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <label htmlFor="active-organization" className="sr-only">
              Active organization
            </label>
            {session.memberships.length > 1 ? (
              <Select
                id="active-organization"
                className="h-9 w-64"
                value={session.activeOrganization.id}
                disabled={switchOrganization.isPending}
                onChange={(event) => switchOrganization.mutate(event.target.value)}
              >
                {session.memberships.map((membership) => (
                  <option key={membership.organization.id} value={membership.organization.id}>
                    {membership.organization.name}
                  </option>
                ))}
              </Select>
            ) : (
              <span className="text-sm font-medium text-slate-800">{session.activeOrganization.name}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-slate-900">{session.user.displayName}</p>
              <p className="text-xs text-slate-500">{session.roles.map((role) => role.replace(/_/g, ' ').toLowerCase()).join(', ')}</p>
            </div>
            <Button variant="secondary" size="sm" loading={logout.isPending} onClick={() => logout.mutate()}>
              Sign out
            </Button>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
