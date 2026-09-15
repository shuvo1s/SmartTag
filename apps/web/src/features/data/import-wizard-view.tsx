'use client';

import { parseDesignDocument } from '@smarttag/document-schema';
import { emptyMapping, isImportTerminal } from '@smarttag/import-core';
import { Alert, Button, PageHeader, Spinner, buttonStyles } from '@smarttag/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { describeError } from '@/lib/api-client';
import { useCan } from '../auth/session';
import { useTemplateVersion } from '../templates/api';
import { versionPath } from '../templates/routes';
import { useDataImport, useImportCommand } from './api';
import { ConfigureStep } from './configure-step';
import { ImportStatusBadge, WizardStepper } from './data-ui';
import { MappingStep, type MappingDraft } from './mapping-step';
import { ReviewStep, SaveStep, ValidateStep } from './result-steps';
import { SourceStep } from './source-step';
import {
  applySuggestions,
  availableSteps,
  completedThrough,
  defaultStep,
  isWizardStep,
  type WizardStepId,
} from './wizard';

const PROCESSING = new Set(['UPLOADED', 'INSPECTING', 'VALIDATING']);

export function ImportWizardView({ importId }: { importId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const query = useDataImport(importId);
  const dto = query.data;
  const version = useTemplateVersion(dto?.templateVersion.id ?? null);
  const canEdit = useCan('dataset:create');
  const cancel = useImportCommand(importId, 'cancel');
  const requested = params.get('step');
  const [view, setView] = useState<{ status: string | null; step: WizardStepId | null }>({
    status: null,
    step: isWizardStep(requested) ? requested : null,
  });
  const [draftState, setDraftState] = useState<{ revision: number; draft: MappingDraft } | null>(
    null,
  );

  const schema = useMemo(() => {
    if (!version.data) return null;
    const parsed = parseDesignDocument(version.data.document);
    return parsed.valid ? parsed.document.dataSchema : null;
  }, [version.data]);

  // Follow the server when background work finishes (inspection or validation), and on first
  // load. Adjusting state while rendering avoids effect cascades.
  if (dto && view.status !== dto.status) {
    const finishedProcessing =
      view.status !== null && PROCESSING.has(view.status) && !PROCESSING.has(dto.status);
    setView({
      status: dto.status,
      step: view.step === null || finishedProcessing ? defaultStep(dto) : view.step,
    });
  }
  const step = view.step;
  const setStep = (next: WizardStepId) => setView({ status: dto?.status ?? null, step: next });

  // The mapping draft starts from the saved mapping, or from exact suggestions (still unsaved),
  // and is replaced whenever the server's revision changes.
  const draft: MappingDraft | null = !dto
    ? null
    : draftState?.revision === dto.revision
      ? draftState.draft
      : {
          mapping:
            dto.mapping ??
            applySuggestions(emptyMapping(), dto.suggestions.suggestions, { exactOnly: true }),
          profile: dto.mappingProfile
            ? { id: dto.mappingProfile.id, revision: dto.mappingProfile.revision }
            : null,
        };
  const setDraft = (next: MappingDraft) => {
    if (dto) setDraftState({ revision: dto.revision, draft: next });
  };

  if (query.error) return <Alert tone="danger">{describeError(query.error)}</Alert>;
  if (!dto || !step) return <Spinner />;

  const available = availableSteps(dto);
  const go = (next: WizardStepId) => {
    setStep(next);
    router.replace(`/data-imports/${importId}?step=${next}`, { scroll: false });
  };
  const current = available.has(step) ? step : defaultStep(dto);
  const editable = canEdit && !isImportTerminal(dto.status);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/datasets?tab=imports" className="hover:underline">
            Data imports
          </Link>
        }
        title={
          <span className="inline-flex items-center gap-3">
            Import {dto.source.filename} <ImportStatusBadge status={dto.status} />
          </span>
        }
        description={
          <>
            Into{' '}
            <Link
              className="underline"
              href={versionPath(dto.templateVersion.templateId, dto.templateVersion.id)}
            >
              {dto.templateVersion.templateName} ({dto.templateVersion.templateCode}) — version{' '}
              {dto.templateVersion.versionNumber}
            </Link>
          </>
        }
        actions={
          editable ? (
            <Button
              variant="secondary"
              data-testid="cancel-import"
              loading={cancel.isPending}
              onClick={() => cancel.mutate({ expectedRevision: dto.revision })}
            >
              Cancel import
            </Button>
          ) : null
        }
      />
      {dto.status === 'CANCELLED' ? (
        <Alert tone="info" className="mb-4">
          This import was cancelled.{' '}
          <Link
            className={buttonStyles({ size: 'sm', variant: 'secondary' })}
            href={`/data-imports/new?versionId=${dto.templateVersion.id}`}
          >
            Start a new import
          </Link>
        </Alert>
      ) : null}
      {cancel.error ? (
        <Alert tone="danger" className="mb-4">
          {describeError(cancel.error)}
        </Alert>
      ) : null}
      <WizardStepper
        current={current}
        available={available}
        completedIndex={completedThrough(dto.status)}
        onSelect={go}
      />
      <div data-testid={`wizard-panel-${current}`}>
        {current === 'upload' || current === 'source' ? (
          <SourceStep
            key={dto.revision}
            dto={dto}
            canEdit={editable}
            onContinue={() => go('map')}
          />
        ) : !schema || !draft ? (
          version.error ? (
            <Alert tone="danger">{describeError(version.error)}</Alert>
          ) : (
            <Spinner />
          )
        ) : current === 'map' ? (
          <MappingStep
            dto={dto}
            schema={schema}
            draft={draft}
            onDraftChange={setDraft}
            canEdit={editable}
            onSaved={() => go('configure')}
          />
        ) : current === 'configure' ? (
          <ConfigureStep
            dto={dto}
            schema={schema}
            draft={draft}
            onDraftChange={setDraft}
            canEdit={editable}
            onSaved={() => go('validate')}
          />
        ) : current === 'validate' ? (
          <ValidateStep dto={dto} canEdit={editable} />
        ) : current === 'review' ? (
          <ReviewStep
            dto={dto}
            schema={schema}
            canEdit={editable}
            onChangeMapping={() => go('map')}
            onContinue={() => go('save')}
          />
        ) : (
          <SaveStep dto={dto} />
        )}
      </div>
    </>
  );
}
