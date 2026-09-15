'use client';

import type { DataSchema } from '@smarttag/document-schema';
import {
  describeColumn,
  validateMapping,
  type MappingDefinition,
  type ProfileCompatibility,
} from '@smarttag/import-core';
import type { DataImportDto } from '@smarttag/shared-types';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Select,
  Table,
  Td,
  Th,
  type Tone,
} from '@smarttag/ui';
import { useMemo, useState } from 'react';
import { describeError } from '@/lib/api-client';
import { useUpdateMapping } from './api';
import { applySuggestions, assignColumn, fieldsForColumn } from './wizard';

const COMPATIBILITY: Record<ProfileCompatibility, { label: string; tone: Tone }> = {
  COMPATIBLE: { label: 'Compatible', tone: 'success' },
  REQUIRES_REVIEW: { label: 'Requires review', tone: 'warning' },
  INCOMPATIBLE: { label: 'Incompatible', tone: 'danger' },
};

const TYPE_LABELS: Record<string, string> = {
  string: 'Text',
  number: 'Number',
  decimal: 'Decimal',
  boolean: 'True/false',
  date: 'Date',
  url: 'URL',
  image: 'Image (asset ID)',
};

export interface MappingDraft {
  readonly mapping: MappingDefinition;
  readonly profile: { readonly id: string; readonly revision: number } | null;
}

export function MappingStep({
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
  const [search, setSearch] = useState('');
  const save = useUpdateMapping(dto.id);
  const fields = schema.fields;
  const fieldByKey = useMemo(() => new Map(fields.map((field) => [field.key, field])), [fields]);
  const validation = useMemo(
    () => validateMapping(schema, dto.columns, draft.mapping),
    [schema, dto.columns, draft.mapping],
  );
  const suggestionByColumn = new Map(
    dto.suggestions.suggestions.map((suggestion) => [suggestion.column.index, suggestion]),
  );
  const setMapping = (mapping: MappingDefinition, profile = draft.profile) =>
    onDraftChange({ mapping, profile });
  const term = search.trim().toLowerCase();
  const columns = dto.columns.filter((column) => {
    if (!term) return true;
    const mapped = fieldsForColumn(draft.mapping, column.index).map(
      (key) => `${key} ${fieldByKey.get(key)?.displayName ?? ''}`,
    );
    return `${column.header} ${column.letter} ${mapped.join(' ')}`.toLowerCase().includes(term);
  });
  const saved = JSON.stringify(dto.mapping) === JSON.stringify(draft.mapping);

  return (
    <div className="space-y-6">
      {dto.profileEvaluations.length > 0 ? (
        <Card data-testid="profile-suggestions">
          <CardHeader
            title="Mapping profiles"
            description="Saved mappings of this organization, checked against this file's columns and the template's data schema. Nothing is applied without your action."
          />
          <CardBody className="space-y-3">
            {dto.profileEvaluations.map((evaluation) => (
              <div
                key={evaluation.profileId}
                className="rounded border border-slate-200 p-3"
                data-testid={`profile-${evaluation.profileId}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900">{evaluation.name}</span>
                  <Badge
                    tone={COMPATIBILITY[evaluation.compatibility].tone}
                    data-testid="profile-compatibility"
                  >
                    {COMPATIBILITY[evaluation.compatibility].label}
                  </Badge>
                  <span className="text-xs text-slate-500">
                    revision {evaluation.revision} · {evaluation.resolvedEntries} of{' '}
                    {evaluation.totalEntries} fields resolved
                  </span>
                  <Button
                    size="sm"
                    className="ml-auto"
                    variant={evaluation.compatibility === 'COMPATIBLE' ? 'primary' : 'secondary'}
                    data-testid={`apply-profile-${evaluation.profileId}`}
                    disabled={!canEdit || evaluation.compatibility === 'INCOMPATIBLE'}
                    onClick={() =>
                      setMapping(evaluation.mapping, {
                        id: evaluation.profileId,
                        revision: evaluation.revision,
                      })
                    }
                  >
                    {evaluation.compatibility === 'COMPATIBLE'
                      ? 'Apply mapping profile'
                      : 'Apply and review'}
                  </Button>
                </div>
                {evaluation.notes.length > 0 ? (
                  <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
                    {evaluation.notes.map((note, index) => (
                      <li key={index} className={note.blocking ? 'text-amber-900' : undefined}>
                        {note.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-4">
        <Card className="xl:col-span-3">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
            <Input
              type="search"
              data-testid="mapping-search"
              className="h-9 max-w-xs"
              placeholder="Search columns or fields"
              aria-label="Search columns or fields"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button
              size="sm"
              variant="secondary"
              data-testid="accept-exact-suggestions"
              disabled={!canEdit}
              onClick={() =>
                setMapping(
                  applySuggestions(draft.mapping, dto.suggestions.suggestions, { exactOnly: true }),
                )
              }
            >
              Accept exact suggestions
            </Button>
            <Button
              size="sm"
              variant="secondary"
              data-testid="accept-all-suggestions"
              disabled={!canEdit}
              onClick={() =>
                setMapping(
                  applySuggestions(draft.mapping, dto.suggestions.suggestions, {
                    exactOnly: false,
                  }),
                )
              }
            >
              Accept all suggestions
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!canEdit}
              onClick={() => setMapping({ ...draft.mapping, entries: [] }, null)}
            >
              Clear
            </Button>
          </div>
          <Table data-testid="mapping-table">
            <thead>
              <tr>
                <Th>Source column</Th>
                <Th>Sample</Th>
                <Th>SmartTag field</Th>
                <Th>Type</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {columns.map((column) => {
                const mapped = fieldsForColumn(draft.mapping, column.index);
                const current = mapped[0] ?? '';
                const field = current ? fieldByKey.get(current) : undefined;
                const suggestion = suggestionByColumn.get(column.index);
                const takenBy = new Map(
                  draft.mapping.entries
                    .filter((entry) => entry.column.index !== column.index)
                    .map((entry) => [entry.field, entry.column.index]),
                );
                return (
                  <tr key={column.index} data-testid={`mapping-row-${column.letter}`}>
                    <Td className="whitespace-normal">
                      <span className="font-medium text-slate-900">{describeColumn(column)}</span>
                      {column.duplicate ? (
                        <Badge tone="warning" className="ml-2">
                          duplicate header
                        </Badge>
                      ) : null}
                    </Td>
                    <Td
                      className="max-w-56 truncate text-slate-600"
                      title={column.samples.join(' · ')}
                    >
                      {column.samples.join(' · ') || '—'}
                    </Td>
                    <Td>
                      <Select
                        className="h-9 min-w-56"
                        aria-label={`SmartTag field for ${describeColumn(column)}`}
                        data-testid={`mapping-select-${column.letter}`}
                        disabled={!canEdit}
                        value={current}
                        onChange={(event) =>
                          setMapping(
                            assignColumn(draft.mapping, column, event.target.value || null),
                          )
                        }
                      >
                        <option value="">— Ignore —</option>
                        {fields.map((candidate) => {
                          const other = takenBy.get(candidate.key);
                          return (
                            <option
                              key={candidate.key}
                              value={candidate.key}
                              disabled={other !== undefined}
                            >
                              {candidate.displayName} ({candidate.key})
                              {candidate.required && candidate.defaultValue === null ? ' *' : ''}
                              {other !== undefined
                                ? ` — mapped to column ${dto.columns[other]?.letter ?? other + 1}`
                                : ''}
                            </option>
                          );
                        })}
                      </Select>
                      {mapped.length > 1 ? (
                        <p className="mt-1 text-xs text-slate-500">
                          Also feeds {mapped.slice(1).join(', ')}
                        </p>
                      ) : null}
                    </Td>
                    <Td>{field ? TYPE_LABELS[field.type] : '—'}</Td>
                    <Td data-testid={`mapping-status-${column.letter}`}>
                      {field ? (
                        <Badge tone="success">Mapped</Badge>
                      ) : suggestion ? (
                        <span className="flex items-center gap-2">
                          <Badge tone={suggestion.exact ? 'info' : 'warning'}>
                            Suggested: {suggestion.field}
                            {suggestion.exact ? '' : ' (confirm)'}
                          </Badge>
                          <Button
                            size="sm"
                            variant="secondary"
                            data-testid={`accept-suggestion-${column.letter}`}
                            disabled={!canEdit || takenBy.has(suggestion.field)}
                            onClick={() =>
                              setMapping(assignColumn(draft.mapping, column, suggestion.field))
                            }
                          >
                            Accept
                          </Button>
                        </span>
                      ) : (
                        <Badge>Ignored</Badge>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Template fields" description="* required without a default" />
            <CardBody>
              <ul className="space-y-1 text-sm" data-testid="required-fields">
                {fields.map((field) => {
                  const entry = draft.mapping.entries.find(
                    (candidate) => candidate.field === field.key,
                  );
                  const required = field.required && field.defaultValue === null;
                  const state = entry
                    ? 'mapped'
                    : required
                      ? 'missing'
                      : field.defaultValue !== null
                        ? 'default'
                        : 'optional';
                  return (
                    <li
                      key={field.key}
                      data-testid={`field-state-${field.key}`}
                      data-state={state}
                      className="flex items-center justify-between gap-2"
                    >
                      <span title={field.description}>
                        {field.displayName}
                        {required ? <span className="text-red-700"> *</span> : null}
                        <span className="ml-1 text-xs text-slate-500">
                          {TYPE_LABELS[field.type]}
                        </span>
                      </span>
                      <span className={state === 'missing' ? 'text-red-700' : 'text-slate-500'}>
                        {entry
                          ? `Column ${dto.columns[entry.column.index]?.letter ?? '?'}`
                          : state === 'missing'
                            ? 'Not mapped'
                            : state === 'default'
                              ? 'Default'
                              : 'Empty'}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {fields.some((field) => field.type === 'image') ? (
                <p className="mt-3 text-xs text-slate-500">
                  Image fields accept asset IDs of this organization only. Links and file paths are
                  never downloaded.
                </p>
              ) : null}
            </CardBody>
          </Card>
          {validation.issues.length > 0 ? (
            <Alert tone={validation.complete ? 'warning' : 'danger'} title="Mapping check">
              <ul className="list-disc pl-5" data-testid="mapping-issues">
                {validation.issues.map((issue, index) => (
                  <li key={index} data-code={issue.code}>
                    {issue.message}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : (
            <Alert tone="success">Every required field is mapped.</Alert>
          )}
          {save.error ? <Alert tone="danger">{describeError(save.error)}</Alert> : null}
          <Button
            className="w-full"
            data-testid="save-mapping"
            disabled={!canEdit}
            loading={save.isPending}
            onClick={() =>
              save.mutate(
                { expectedRevision: dto.revision, mapping: draft.mapping, profile: draft.profile },
                { onSuccess: onSaved },
              )
            }
          >
            {saved ? 'Continue to configuration' : 'Save mapping'}
          </Button>
        </div>
      </div>
    </div>
  );
}
