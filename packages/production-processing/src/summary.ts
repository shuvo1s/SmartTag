import type { ProductionValidationSummaryDto } from '@smarttag/shared-types';
import { LAYOUT_NOTE, type InstanceIssue } from '@smarttag/production-core';

/**
 * Counts how many instances each issue code affects while they stream past. Issue text is never
 * stored twice: the counts are for the review screen, the issues themselves stay on the instance.
 */
export class ProductionSummaryBuilder {
  private readonly counts = new Map<
    string,
    { layer: string; code: string; severity: 'ERROR' | 'WARNING'; instances: number }
  >();

  add(issues: readonly InstanceIssue[]): void {
    const seen = new Set<string>();
    for (const issue of issues) {
      const key = `${issue.layer}|${issue.code}|${issue.severity}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = this.counts.get(key) ?? {
        layer: issue.layer,
        code: issue.code,
        severity: issue.severity,
        instances: 0,
      };
      entry.instances += 1;
      this.counts.set(key, entry);
    }
  }

  build(): ProductionValidationSummaryDto {
    const issueCounts = [...this.counts.values()].sort(
      (a, b) =>
        b.instances - a.instances ||
        (a.severity === b.severity
          ? a.code.localeCompare(b.code)
          : a.severity === 'ERROR'
            ? -1
            : 1),
    );
    return { issueCounts, layoutChecked: false, layoutNote: LAYOUT_NOTE };
  }
}
