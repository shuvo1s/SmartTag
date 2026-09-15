'use client';

import type { DataSchema } from '@smarttag/document-schema';
import {
  BOOLEAN_PRESETS,
  DATE_FORMATS,
  DATE_FORMAT_EXAMPLES,
  DECIMAL_SEPARATORS,
  THOUSANDS_SEPARATORS,
  datesFittingFormats,
  describeThousandsSeparator,
  effectiveRules,
  normalizeSourceCell,
  type BooleanFormat,
  type DateFormat,
  type MappingDefinition,
  type MappingEntry,
  type NumberFormat,
  type ParsingRules,
} from '@smarttag/import-core';
import type { DataImportDto } from '@smarttag/shared-types';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  Table,
  Td,
  Th,
} from '@smarttag/ui';
import { describeError } from '@/lib/api-client';
import { useUpdateMapping } from './api';
import type { MappingDraft } from './mapping-step';

type BooleanPresetId = keyof typeof BOOLEAN_PRESETS;
const BOOLEAN_LABELS: Record<BooleanPresetId, string> = {
  TRUE_FALSE: 'true / false',
  YES_NO: 'yes / no',
  Y_N: 'Y / N',
  ONE_ZERO: '1 / 0',
};

function presetOf(format: BooleanFormat): BooleanPresetId | '' {
  const found = (Object.keys(BOOLEAN_PRESETS) as BooleanPresetId[]).find(
    (id) =>
      JSON.stringify(BOOLEAN_PRESETS[id]) ===
      JSON.stringify({ trueValues: format.trueValues, falseValues: format.falseValues }),
  );
  return found ?? '';
}

function NumberFormatSelects({
  value,
  onChange,
  testId,
  disabled,
}: {
  value: NumberFormat;
  onChange: (value: NumberFormat) => void;
  testId: string;
  disabled: boolean;
}) {
  return (
    <span className="flex gap-2">
      <Select
        className="h-9 w-36"
        data-testid={`${testId}-decimal`}
        aria-label="Decimal separator"
        disabled={disabled}
        value={value.decimalSeparator}
        onChange={(event) =>
          onChange({
            ...value,
            decimalSeparator: event.target.value as NumberFormat['decimalSeparator'],
          })
        }
      >
        {DECIMAL_SEPARATORS.map((separator) => (
          <option key={separator} value={separator}>
            Decimal “{separator}”
          </option>
        ))}
      </Select>
      <Select
        className="h-9 w-56"
        data-testid={`${testId}-thousands`}
        aria-label="Thousands separator"
        disabled={disabled}
        value={value.thousandsSeparator}
        onChange={(event) =>
          onChange({
            ...value,
            thousandsSeparator: event.target.value as NumberFormat['thousandsSeparator'],
          })
        }
      >
        {THOUSANDS_SEPARATORS.filter((separator) => separator !== value.decimalSeparator).map(
          (separator) => (
            <option key={separator} value={separator}>
              {describeThousandsSeparator(separator).replace(/^./, (letter) =>
                letter.toUpperCase(),
              )}
            </option>
          ),
        )}
      </Select>
    </span>
  );
}

export function ConfigureStep({
  dto,
  schema,
  draft,
  onDraftChange,
  canEdit,
  onSaved,
}: {
  dto: DataImportDto;
  schema: DataSchema;
  draft: MappingDraft;
  onDraftChange: (draft: MappingDraft) => void;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const save = useUpdateMapping(dto.id);
  const { mapping } = draft;
  const parsing = mapping.parsing;
  const setMapping = (next: MappingDefinition) => onDraftChange({ ...draft, mapping: next });
  const setParsing = (next: Partial<ParsingRules>) =>
    setMapping({ ...mapping, parsing: { ...parsing, ...next } });
  const setEntry = (field: string, change: Partial<MappingEntry>) =>
    setMapping({
      ...mapping,
      entries: mapping.entries.map((entry) =>
        entry.field === field ? { ...entry, ...change } : entry,
      ),
    });
  const fields = new Map(schema.fields.map((field) => [field.key, field]));
  const parsed = mapping.entries
    .map((entry) => ({
      entry,
      field: fields.get(entry.field),
      column: dto.columns[entry.column.index],
    }))
    .filter(
      (
        item,
      ): item is {
        entry: MappingEntry;
        field: NonNullable<typeof item.field>;
        column: NonNullable<typeof item.column>;
      } =>
        item.field !== undefined &&
        item.column !== undefined &&
        ['number', 'decimal', 'date', 'boolean'].includes(item.field.type),
    );

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card>
        <CardHeader
          title="Import rules"
          description="How text in the file is read. Nothing is guessed from a browser or server locale."
        />
        <CardBody className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="rule-trim"
              disabled={!canEdit}
              checked={parsing.trimWhitespace}
              onChange={(event) => setParsing({ trimWhitespace: event.target.checked })}
            />
            Trim white space around values
          </label>
          <Field
            label="Also treat as empty"
            hint="Comma-separated, e.g. N/A, -. Empty cells always have no value."
          >
            <Input
              data-testid="rule-empty-values"
              disabled={!canEdit}
              value={parsing.emptyValues.join(', ')}
              onChange={(event) =>
                setParsing({
                  emptyValues: event.target.value
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean)
                    .slice(0, 10),
                })
              }
            />
          </Field>
          <Field label="Numbers and decimals">
            <NumberFormatSelects
              testId="rule-number"
              disabled={!canEdit}
              value={parsing.number}
              onChange={(number) => setParsing({ number })}
            />
          </Field>
          <Field
            label="Text dates"
            hint="Spreadsheet date cells are read as dates regardless of this setting."
          >
            <Select
              data-testid="rule-date-format"
              disabled={!canEdit}
              value={parsing.dateFormat}
              onChange={(event) => setParsing({ dateFormat: event.target.value as DateFormat })}
            >
              {DATE_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {format} (e.g. {DATE_FORMAT_EXAMPLES[format]})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="True/false values">
            <Select
              data-testid="rule-boolean"
              disabled={!canEdit}
              value={presetOf(parsing.boolean)}
              onChange={(event) =>
                setParsing({ boolean: BOOLEAN_PRESETS[event.target.value as BooleanPresetId] })
              }
            >
              {(Object.keys(BOOLEAN_PRESETS) as BooleanPresetId[]).map((id) => (
                <option key={id} value={id}>
                  {BOOLEAN_LABELS[id]}
                </option>
              ))}
            </Select>
          </Field>
          {save.error ? <Alert tone="danger">{describeError(save.error)}</Alert> : null}
          <Button
            className="w-full"
            data-testid="save-configuration"
            disabled={!canEdit}
            loading={save.isPending}
            onClick={() =>
              save.mutate(
                { expectedRevision: dto.revision, mapping, profile: draft.profile },
                { onSuccess: onSaved },
              )
            }
          >
            Save and continue
          </Button>
        </CardBody>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader
          title="Parsing preview"
          description="Sample values of mapped number, date and true/false columns read with the current rules. Override the rules for a single field when one column is written differently."
        />
        {parsed.length === 0 ? (
          <CardBody>
            <p className="text-sm text-slate-500">No mapped column needs parsing rules.</p>
          </CardBody>
        ) : (
          <Table data-testid="parsing-preview">
            <thead>
              <tr>
                <Th>Field</Th>
                <Th>Rule for this field</Th>
                <Th>Samples</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {parsed.map(({ entry, field, column }) => {
                const rules = effectiveRules(entry, parsing);
                const fits = field.type === 'date' ? datesFittingFormats(column.samples) : [];
                return (
                  <tr key={entry.field} data-testid={`parse-row-${entry.field}`}>
                    <Td className="whitespace-normal">
                      <p className="font-medium">{field.displayName}</p>
                      <p className="text-xs text-slate-500">
                        {column.header || 'No header'} — Column {column.letter}
                      </p>
                    </Td>
                    <Td className="whitespace-normal">
                      {field.type === 'number' || field.type === 'decimal' ? (
                        <span className="flex flex-col gap-1">
                          <label className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              data-testid={`override-${entry.field}`}
                              disabled={!canEdit}
                              checked={entry.number !== null}
                              onChange={(event) =>
                                setEntry(entry.field, {
                                  number: event.target.checked ? parsing.number : null,
                                })
                              }
                            />
                            Own number format
                          </label>
                          {entry.number ? (
                            <NumberFormatSelects
                              testId={`override-${entry.field}-number`}
                              disabled={!canEdit}
                              value={entry.number}
                              onChange={(number) => setEntry(entry.field, { number })}
                            />
                          ) : null}
                        </span>
                      ) : field.type === 'date' ? (
                        <Select
                          className="h-9"
                          data-testid={`override-${entry.field}-date`}
                          disabled={!canEdit}
                          value={entry.dateFormat ?? ''}
                          onChange={(event) =>
                            setEntry(entry.field, {
                              dateFormat: (event.target.value || null) as DateFormat | null,
                            })
                          }
                        >
                          <option value="">Import rule ({parsing.dateFormat})</option>
                          {DATE_FORMATS.map((format) => (
                            <option key={format} value={format}>
                              {format}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Select
                          className="h-9"
                          data-testid={`override-${entry.field}-boolean`}
                          disabled={!canEdit}
                          value={entry.boolean ? presetOf(entry.boolean) : ''}
                          onChange={(event) =>
                            setEntry(entry.field, {
                              boolean: event.target.value
                                ? BOOLEAN_PRESETS[event.target.value as BooleanPresetId]
                                : null,
                            })
                          }
                        >
                          <option value="">Import rule</option>
                          {(Object.keys(BOOLEAN_PRESETS) as BooleanPresetId[]).map((id) => (
                            <option key={id} value={id}>
                              {BOOLEAN_LABELS[id]}
                            </option>
                          ))}
                        </Select>
                      )}
                      {fits.length > 1 ? (
                        <p
                          className="mt-1 text-xs text-amber-800"
                          data-testid={`date-ambiguity-${entry.field}`}
                        >
                          The samples fit {fits.join(' and ')}: choose the format explicitly.
                        </p>
                      ) : null}
                    </Td>
                    <Td className="whitespace-normal">
                      <ul
                        className="space-y-1 text-xs"
                        data-testid={`parse-preview-${entry.field}`}
                      >
                        {column.samples.length === 0 ? (
                          <li className="text-slate-500">No sample values</li>
                        ) : null}
                        {column.samples.map((sample, index) => {
                          const result = normalizeSourceCell(
                            field,
                            { kind: 'TEXT', text: sample },
                            rules,
                            {
                              column,
                              maxCellChars: dto.limits.maxCellChars,
                            },
                          );
                          return (
                            <li key={index} data-state={result.kind}>
                              <code>{sample}</code> →{' '}
                              {result.kind === 'VALUE' ? (
                                <code className="text-emerald-800">{String(result.value)}</code>
                              ) : result.kind === 'EMPTY' ? (
                                <span className="text-slate-500">no value</span>
                              ) : (
                                <span className="text-red-800">{result.issue.message}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
