import type { Permission } from '@smarttag/shared-types';

export interface NavigationItem {
  readonly label: string;
  readonly href: string;
  /** Planned modules are listed (disabled) so the product map is visible, but never faked. */
  readonly availability: 'AVAILABLE' | 'PLANNED';
  readonly plannedFor?: string;
  readonly permission?: Permission;
}

export interface NavigationSection {
  readonly label: string | null;
  readonly items: readonly NavigationItem[];
}

export const NAVIGATION: readonly NavigationSection[] = [
  {
    label: null,
    items: [
      { label: 'Dashboard', href: '/dashboard', availability: 'AVAILABLE' },
      { label: 'Designs', href: '/designs', availability: 'PLANNED', plannedFor: 'Planned' },
      {
        label: 'Templates',
        href: '/templates',
        availability: 'AVAILABLE',
        permission: 'template:read',
      },
      {
        label: 'Data',
        href: '/datasets',
        availability: 'AVAILABLE',
        permission: 'dataset:read',
      },
      { label: 'Assets', href: '/assets', availability: 'PLANNED', plannedFor: 'Planned' },
      { label: 'Jobs', href: '/jobs', availability: 'PLANNED', plannedFor: 'Planned' },
      {
        label: 'Integrations',
        href: '/integrations',
        availability: 'PLANNED',
        plannedFor: 'Planned',
      },
    ],
  },
  {
    label: 'Administration',
    items: [
      {
        label: 'Customers & brands',
        href: '/administration/customers',
        availability: 'AVAILABLE',
        permission: 'customer:read',
      },
    ],
  },
  {
    label: 'Developer',
    items: [
      {
        label: 'Document playground',
        href: '/developer/playground',
        availability: 'AVAILABLE',
        permission: 'template:read',
      },
    ],
  },
];

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
