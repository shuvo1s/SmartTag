import { resolve } from 'node:path';

/** Development seed users (apps/api/prisma/seed.ts). */
export const USERS = {
  admin: 'admin@smarttag.local',
  designer: 'designer@smarttag.local',
  approver: 'approver@smarttag.local',
  viewer: 'viewer@smarttag.local',
  acmeAdmin: 'acme.admin@smarttag.local',
} as const;

export type SeedUser = keyof typeof USERS;

export function storageStatePath(user: SeedUser): string {
  return resolve(import.meta.dirname, '..', '.auth', `${user}.json`);
}
