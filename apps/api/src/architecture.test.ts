import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { DOCUMENT_TYPES } from '@smarttag/document-schema';
import {
  ASSET_TYPES,
  RECORD_STATUSES,
  ROLES,
  TEMPLATE_STATUSES,
  TEMPLATE_VERSION_STATUSES,
} from '@smarttag/shared-types';
import { describe, expect, it } from 'vitest';
import { AssetType, DocumentType, RecordStatus, Role, TemplateStatus, TemplateVersionStatus } from './generated/prisma/enums';
import { AssetsController } from './modules/assets/assets.controller';
import { AuthController } from './modules/auth/auth.controller';
import {
  ALLOW_AUTHENTICATED_KEY,
  IS_PUBLIC_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from './modules/authorization/authorization.decorators';
import { CustomersController } from './modules/customers/customers.controller';
import { HealthController } from './modules/health/health.controller';
import { TemplateVersionsController } from './modules/templates/template-versions.controller';
import { TemplatesController } from './modules/templates/templates.controller';

describe('database enums mirror the shared contracts', () => {
  it.each([
    ['DocumentType', DocumentType, DOCUMENT_TYPES],
    ['Role', Role, ROLES],
    ['TemplateStatus', TemplateStatus, TEMPLATE_STATUSES],
    ['TemplateVersionStatus', TemplateVersionStatus, TEMPLATE_VERSION_STATUSES],
    ['AssetType', AssetType, ASSET_TYPES],
    ['RecordStatus', RecordStatus, RECORD_STATUSES],
  ])('%s', (_name, prismaEnum, sharedValues) => {
    expect(Object.values(prismaEnum).sort()).toEqual([...sharedValues].sort());
  });
});

describe('authorization coverage', () => {
  const controllers = [
    AuthController,
    HealthController,
    CustomersController,
    TemplatesController,
    TemplateVersionsController,
    AssetsController,
  ];

  const routes = controllers.flatMap((controller) =>
    Object.getOwnPropertyNames(controller.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => ({ name: `${controller.name}.${name}`, handler: (controller.prototype as unknown as Record<string, unknown>)[name] }))
      .filter(({ handler }) => typeof handler === 'function' && Reflect.getMetadata(PATH_METADATA, handler) !== undefined),
  );

  it('discovers the route handlers', () => {
    expect(routes.length).toBeGreaterThanOrEqual(17);
  });

  it.each(routes.map((route) => [route.name, route.handler] as const))('%s declares an authorization policy', (_name, handler) => {
    const policies = [IS_PUBLIC_KEY, ALLOW_AUTHENTICATED_KEY, REQUIRED_PERMISSIONS_KEY].filter(
      (key) => Reflect.getMetadata(key, handler as object) !== undefined,
    );
    expect(policies).toHaveLength(1);
  });

  it('keeps public endpoints to an explicit allow-list', () => {
    const publicRoutes = routes.filter((route) => Reflect.getMetadata(IS_PUBLIC_KEY, route.handler as object) === true).map((route) => route.name);
    expect(publicRoutes.sort()).toEqual(['AuthController.login', 'HealthController.health']);
  });
});
