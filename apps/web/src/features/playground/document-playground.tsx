'use client';

import { parseDesignDocument, type DesignDocument } from '@smarttag/document-schema';
import {
  computeDocumentHash,
  createBlankDesignDocument,
  type DataRecord,
} from '@smarttag/document-utils';
import {
  SAMPLE_HANG_TAG_RECORD,
  createSampleHangTagDocument,
} from '@smarttag/document-utils/fixtures';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Spinner,
  Textarea,
} from '@smarttag/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { describeError } from '@/lib/api-client';
import { DocumentIssues, DocumentPreview } from '../document-preview/document-preview';
import { useTemplateVersion } from '../templates/api';

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

type ParseState =
  | { readonly kind: 'json-error'; readonly source: string; readonly message: string }
  | {
      readonly kind: 'parsed';
      readonly source: string;
      readonly result: ReturnType<typeof parseDesignDocument>;
    };

export function parsePlaygroundSource(source: string): ParseState {
  try {
    return { kind: 'parsed', source, result: parseDesignDocument(JSON.parse(source)) };
  } catch (error) {
    return {
      kind: 'json-error',
      source,
      message: error instanceof Error ? error.message : 'Invalid JSON',
    };
  }
}

/** Loads an optional template version first, then mounts the playground with it as initial content. */
export function DocumentPlaygroundPage({ versionId }: { versionId: string | null }) {
  const version = useTemplateVersion(versionId);
  const header = (
    <PageHeader
      eyebrow="Developer"
      title="Document playground"
      description="Validate canonical DesignDocument JSON and preview it through rendering-core. This is a test harness, not the design editor."
    />
  );

  if (versionId && version.error) {
    return (
      <>
        {header}
        <Alert tone="danger">{describeError(version.error)}</Alert>
      </>
    );
  }
  if (versionId && !version.data) {
    return (
      <>
        {header}
        <Spinner />
      </>
    );
  }
  return (
    <>
      {header}
      <DocumentPlayground
        key={version.data?.id ?? 'fixture'}
        initialDocument={version.data?.document ?? createSampleHangTagDocument()}
        sourceLabel={
          version.data
            ? `Template version v${version.data.versionNumber} (${version.data.id})`
            : 'Sample hang tag fixture'
        }
      />
    </>
  );
}

/**
 * Internal developer tool: edit canonical JSON as text, validate it with the canonical validator,
 * optionally apply a data record and render it through rendering-core.
 * It edits JSON only — it is intentionally NOT the visual designer.
 */
export function DocumentPlayground({
  initialDocument,
  sourceLabel,
}: {
  initialDocument: unknown;
  sourceLabel: string;
}) {
  const [source, setSource] = useState(() => pretty(initialDocument));
  const [parsed, setParsed] = useState<ParseState>(() =>
    parsePlaygroundSource(pretty(initialDocument)),
  );
  const [recordSource, setRecordSource] = useState(() => pretty(SAMPLE_HANG_TAG_RECORD));
  const [applyRecord, setApplyRecord] = useState(false);

  const document: DesignDocument | null =
    parsed.kind === 'parsed' && parsed.result.valid ? parsed.result.document : null;

  const hash = useQuery({
    queryKey: ['playground-document-hash', parsed.source],
    queryFn: () => computeDocumentHash(document!),
    enabled: document !== null,
    staleTime: Infinity,
  });

  const record = useMemo((): { value: DataRecord | null; error: string | null } => {
    if (!applyRecord) return { value: null, error: null };
    try {
      const value: unknown = JSON.parse(recordSource);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { value: null, error: 'The data record must be a JSON object' };
      }
      return { value: value as DataRecord, error: null };
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : 'Invalid JSON' };
    }
  }, [applyRecord, recordSource]);

  const load = (value: unknown) => {
    const text = pretty(value);
    setSource(text);
    setParsed(parsePlaygroundSource(text));
  };

  return (
    <div className="grid gap-6 2xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Canonical document"
            description={`Initially loaded: ${sourceLabel}`}
            actions={
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => load(createSampleHangTagDocument())}
                >
                  Sample hang tag
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    load(
                      createBlankDesignDocument({
                        name: 'Blank 2 × 3.5 in',
                        documentType: 'HANG_TAG',
                        unit: 'in',
                        width: 2,
                        height: 3.5,
                        bleed: 0.125,
                        safeMargin: 0.125,
                        pageLayout: 'FRONT_ONLY',
                      }),
                    )
                  }
                >
                  Blank 2 × 3.5 in
                </Button>
              </>
            }
          />
          <CardBody className="space-y-3">
            <label htmlFor="document-json" className="sr-only">
              Document JSON
            </label>
            <Textarea
              id="document-json"
              rows={22}
              spellCheck={false}
              className="font-mono text-xs"
              value={source}
              onChange={(event) => setSource(event.target.value)}
            />
            <div className="flex items-center justify-between gap-3">
              <Button onClick={() => setParsed(parsePlaygroundSource(source))}>
                Validate &amp; preview
              </Button>
              {hash.data ? (
                <code
                  className="truncate font-mono text-xs text-slate-500"
                  title="SHA-256 of the RFC 8785 canonical JSON"
                >
                  sha256 {hash.data}
                </code>
              ) : null}
            </div>
            {parsed.kind === 'json-error' ? (
              <Alert tone="danger" title="Not valid JSON">
                {parsed.message}
              </Alert>
            ) : null}
            {parsed.kind === 'parsed' && !parsed.result.valid ? (
              <DocumentIssues title="Validation failed" issues={parsed.result.errors} />
            ) : null}
            {parsed.kind === 'parsed' && parsed.result.valid ? (
              <Alert tone="success" title="Valid canonical document">
                Schema version {parsed.result.document.schemaVersion}
                {parsed.result.warnings.length > 0
                  ? ` · ${parsed.result.warnings.length} warning(s)`
                  : ' · no warnings'}
              </Alert>
            ) : null}
            {parsed.kind === 'parsed' && parsed.result.warnings.length > 0 ? (
              <DocumentIssues title="Warnings" issues={parsed.result.warnings} />
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Data record (VDP preview)"
            description="Replace bound properties with values keyed by data field."
          />
          <CardBody className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={applyRecord}
                onChange={(event) => setApplyRecord(event.target.checked)}
              />
              Apply this record to the preview
            </label>
            <label htmlFor="record-json" className="sr-only">
              Data record JSON
            </label>
            <Textarea
              id="record-json"
              rows={8}
              spellCheck={false}
              className="font-mono text-xs"
              value={recordSource}
              onChange={(event) => setRecordSource(event.target.value)}
            />
            {record.error ? <Alert tone="danger">{record.error}</Alert> : null}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Preview"
          description="Canonical document → scene → SVG. Symbols are placeholders in Phase 1."
        />
        <CardBody>
          {document ? (
            <DocumentPreview document={document} record={record.value} />
          ) : (
            <p className="text-sm text-slate-500">Fix the document to see a preview.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
