import type { ProcessedRow, SourceColumn } from '@smarttag/import-core';
import type {
  FieldIssueCountDto,
  ImportValidationSummary,
  IssueCountDto,
  MappingValidationDto,
} from '@smarttag/shared-types';

/** Aggregates row issues while rows stream past (counts rows, never stores issues twice). */
export class ValidationSummaryBuilder {
  private readonly issues = new Map<
    string,
    {
      layer: IssueCountDto['layer'];
      code: string;
      severity: IssueCountDto['severity'];
      rows: number;
    }
  >();
  private readonly fields = new Map<string, { errorRows: number; warningRows: number }>();

  add(row: ProcessedRow): void {
    if (row.issues.length === 0) return;
    const codes = new Set<string>();
    const errorFields = new Set<string>();
    const warningFields = new Set<string>();
    for (const issue of row.issues) {
      const key = `${issue.layer}|${issue.code}|${issue.severity}`;
      if (!codes.has(key)) {
        codes.add(key);
        const entry = this.issues.get(key) ?? {
          layer: issue.layer,
          code: issue.code,
          severity: issue.severity,
          rows: 0,
        };
        entry.rows += 1;
        this.issues.set(key, entry);
      }
      if (issue.field) {
        (issue.severity === 'ERROR' ? errorFields : warningFields).add(issue.field);
      }
    }
    for (const field of errorFields) this.field(field).errorRows += 1;
    for (const field of warningFields)
      if (!errorFields.has(field)) this.field(field).warningRows += 1;
  }

  private field(key: string) {
    let entry = this.fields.get(key);
    if (!entry) {
      entry = { errorRows: 0, warningRows: 0 };
      this.fields.set(key, entry);
    }
    return entry;
  }

  build(mapping: MappingValidationDto, columns: readonly SourceColumn[]): ImportValidationSummary {
    const issueCounts: IssueCountDto[] = [...this.issues.values()].sort(
      (a, b) =>
        b.rows - a.rows ||
        (a.severity === b.severity
          ? a.code.localeCompare(b.code)
          : a.severity === 'ERROR'
            ? -1
            : 1),
    );
    const fieldCounts: FieldIssueCountDto[] = [...this.fields.entries()]
      .map(([field, counts]) => ({ field, ...counts }))
      .sort(
        (a, b) =>
          b.errorRows - a.errorRows ||
          b.warningRows - a.warningRows ||
          a.field.localeCompare(b.field),
      );
    return {
      issueCounts,
      fieldCounts,
      mappedFields: mapping.mappedFields,
      ignoredColumns: mapping.ignoredColumns.flatMap((index) => {
        const column = columns[index];
        return column ? [{ index, letter: column.letter, header: column.header }] : [];
      }),
      unmappedRequiredFields: mapping.unmappedRequiredFields,
      unmappedOptionalFields: mapping.unmappedOptionalFields,
      layoutChecked: false,
    };
  }
}
