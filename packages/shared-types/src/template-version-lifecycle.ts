import type { Permission } from './auth';

export const TEMPLATE_VERSION_STATUSES = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'RETIRED'] as const;
export type TemplateVersionStatus = (typeof TEMPLATE_VERSION_STATUSES)[number];

export type TemplateVersionAction =
  'SUBMIT_FOR_REVIEW' | 'RETURN_TO_DRAFT' | 'APPROVE' | 'RETIRE' | 'DISCARD_DRAFT';

export interface TemplateVersionTransition {
  readonly from: TemplateVersionStatus;
  readonly to: TemplateVersionStatus;
  readonly action: TemplateVersionAction;
  readonly label: string;
  readonly permission: Permission;
}

/**
 * The complete set of allowed status transitions. Anything not listed is rejected — in particular
 * APPROVED and RETIRED versions can never return to DRAFT. The database enforces the same
 * invariants with a trigger (defence in depth).
 *
 *   DRAFT ──submit──▶ IN_REVIEW ──approve──▶ APPROVED ──retire──▶ RETIRED
 *     ▲                  │
 *     └───return─────────┘
 *   DRAFT ──discard──▶ RETIRED
 */
export const TEMPLATE_VERSION_TRANSITIONS: readonly TemplateVersionTransition[] = [
  {
    from: 'DRAFT',
    to: 'IN_REVIEW',
    action: 'SUBMIT_FOR_REVIEW',
    label: 'Submit for review',
    permission: 'template-version:submit',
  },
  {
    from: 'IN_REVIEW',
    to: 'DRAFT',
    action: 'RETURN_TO_DRAFT',
    label: 'Return to draft',
    permission: 'template-version:review',
  },
  {
    from: 'IN_REVIEW',
    to: 'APPROVED',
    action: 'APPROVE',
    label: 'Approve',
    permission: 'template-version:approve',
  },
  {
    from: 'APPROVED',
    to: 'RETIRED',
    action: 'RETIRE',
    label: 'Retire',
    permission: 'template-version:retire',
  },
  {
    from: 'DRAFT',
    to: 'RETIRED',
    action: 'DISCARD_DRAFT',
    label: 'Discard draft',
    permission: 'template-version:retire',
  },
];

export function findTransition(
  from: TemplateVersionStatus,
  to: TemplateVersionStatus,
): TemplateVersionTransition | undefined {
  return TEMPLATE_VERSION_TRANSITIONS.find(
    (transition) => transition.from === from && transition.to === to,
  );
}

export function availableTransitions(
  from: TemplateVersionStatus,
  permissions: readonly Permission[],
): TemplateVersionTransition[] {
  return TEMPLATE_VERSION_TRANSITIONS.filter(
    (transition) => transition.from === from && permissions.includes(transition.permission),
  );
}

/** Only drafts may have their design content changed. Everything else is immutable. */
export function isVersionContentEditable(status: TemplateVersionStatus): boolean {
  return status === 'DRAFT';
}

/**
 * Whether a user with these permissions may change a version's design content — the same two
 * conditions the API enforces on `PATCH /template-versions/:id` (the `template-version:edit-draft`
 * guard and the DRAFT check). The UI uses it only to decide which actions to offer; the API remains
 * the authority and re-checks both, plus the organization and the expected revision.
 */
export function canEditVersionContent(
  status: TemplateVersionStatus,
  permissions: readonly Permission[],
): boolean {
  return isVersionContentEditable(status) && permissions.includes('template-version:edit-draft');
}
