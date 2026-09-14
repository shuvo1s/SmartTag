import {
  findTransition,
  type TemplateVersionStatus,
  type TemplateVersionTransition,
} from '@smarttag/shared-types';
import { AppError } from '../../common/errors/app-error';
import type { ActorContext } from '../../common/http/request-context';

export interface StatusChanges {
  readonly status: TemplateVersionStatus;
  readonly submittedAt?: Date | null;
  readonly submittedById?: string | null;
  readonly approvedAt?: Date;
  readonly approvedById?: string;
  readonly retiredAt?: Date;
  readonly retiredById?: string;
}

export interface StatusTransitionPlan {
  readonly transition: TemplateVersionTransition;
  readonly changes: StatusChanges;
}

/**
 * Pure decision logic for a status change: is the transition allowed by the lifecycle, may this
 * actor perform it, and which columns change. Persistence happens elsewhere.
 */
export function planStatusTransition(
  from: TemplateVersionStatus,
  to: TemplateVersionStatus,
  actor: Pick<ActorContext, 'userId' | 'permissions'>,
  now: Date,
): StatusTransitionPlan {
  const transition = findTransition(from, to);
  if (!transition) {
    throw new AppError(
      'INVALID_STATUS_TRANSITION',
      `A ${from} version cannot be changed to ${to}`,
      {
        from,
        to,
      },
    );
  }
  if (!actor.permissions.has(transition.permission)) {
    throw AppError.forbidden(`You do not have permission to ${transition.label.toLowerCase()}`);
  }

  switch (transition.action) {
    case 'SUBMIT_FOR_REVIEW':
      return { transition, changes: { status: to, submittedAt: now, submittedById: actor.userId } };
    case 'RETURN_TO_DRAFT':
      return { transition, changes: { status: to, submittedAt: null, submittedById: null } };
    case 'APPROVE':
      return { transition, changes: { status: to, approvedAt: now, approvedById: actor.userId } };
    case 'RETIRE':
    case 'DISCARD_DRAFT':
      return { transition, changes: { status: to, retiredAt: now, retiredById: actor.userId } };
  }
}
