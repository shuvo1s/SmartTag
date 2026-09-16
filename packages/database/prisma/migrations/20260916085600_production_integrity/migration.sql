-- =============================================================================================
-- Phase 5 integrity rules for production jobs, instances, sequences and manifests that cannot be
-- expressed in schema.prisma. Application services enforce the same rules; the database is the
-- last line of defence (docs/production-jobs.md#immutability).
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 1. CHECK constraints
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "sequences"
  ADD CONSTRAINT "sequences_name_chk" CHECK (btrim(name) <> '' AND btrim(code) <> ''),
  ADD CONSTRAINT "sequences_format_chk" CHECK (padding >= 0 AND padding <= 24),
  -- 9007199254740991 is the largest whole number JavaScript represents exactly; serial numbers
  -- must round-trip through the API without losing digits.
  ADD CONSTRAINT "sequences_next_value_chk" CHECK (next_value >= 1 AND next_value <= 9007199254740991),
  ADD CONSTRAINT "sequences_revision_chk" CHECK (revision >= 1);

ALTER TABLE "sequence_reservations"
  ADD CONSTRAINT "sequence_reservations_range_chk" CHECK (
    start_value >= 1 AND end_value >= start_value AND value_count >= 1
    AND end_value <= 9007199254740991
    AND end_value - start_value + 1 = value_count
  );

ALTER TABLE "production_job_counters"
  ADD CONSTRAINT "production_job_counters_day_chk" CHECK (day ~ '^\d{4}-\d{2}-\d{2}$'),
  ADD CONSTRAINT "production_job_counters_next_value_chk" CHECK (next_value >= 1 AND next_value <= 1000000);

ALTER TABLE "production_jobs"
  ADD CONSTRAINT "production_jobs_number_chk" CHECK (job_number ~ '^PJ-\d{8}-\d{6}$'),
  ADD CONSTRAINT "production_jobs_name_chk" CHECK (btrim(name) <> ''),
  ADD CONSTRAINT "production_jobs_hashes_chk" CHECK (
    template_version_hash ~ '^[0-9a-f]{64}$'
    AND data_schema_hash ~ '^[0-9a-f]{64}$'
    AND dataset_hash ~ '^[0-9a-f]{64}$'
    AND (record_selection_hash IS NULL OR record_selection_hash ~ '^[0-9a-f]{64}$')
    AND (instances_digest IS NULL OR instances_digest ~ '^[0-9a-f]{64}$')
    AND (production_job_hash IS NULL OR production_job_hash ~ '^[0-9a-f]{64}$')
  ),
  ADD CONSTRAINT "production_jobs_counters_chk" CHECK (
    revision >= 1 AND expansion_run >= 0 AND release_run >= 0
    AND record_count >= 0 AND instance_count >= 0
    AND valid_count >= 0 AND warning_count >= 0 AND error_count >= 0
    AND source_warning_count >= 0
    AND progress_processed >= 0 AND (progress_total IS NULL OR progress_total >= 0)
    AND valid_count + warning_count + error_count = instance_count
  ),
  ADD CONSTRAINT "production_jobs_json_chk" CHECK (
    jsonb_typeof(configuration) = 'object'
    AND jsonb_typeof(versions) = 'object'
    AND jsonb_typeof(validation_summary) = 'object'
    AND jsonb_typeof(metrics) = 'object'
    AND (failure IS NULL OR jsonb_typeof(failure) = 'object')
  ),
  ADD CONSTRAINT "production_jobs_acknowledgement_chk" CHECK (
    (warnings_acknowledged_at IS NULL) = (warnings_acknowledged_by_id IS NULL)
  ),
  ADD CONSTRAINT "production_jobs_cancelled_chk" CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  ADD CONSTRAINT "production_jobs_failure_chk" CHECK ((status = 'FAILED') = (failure IS NOT NULL)),
  -- A brand always belongs to a customer, so a job with a brand must name that customer.
  ADD CONSTRAINT "production_jobs_brand_chk" CHECK (brand_id IS NULL OR customer_id IS NOT NULL),
  -- Released production is complete production: an exact serial configuration, no error instances,
  -- acknowledged warnings, and a releaser. Releasing a job with errors is impossible at every layer.
  ADD CONSTRAINT "production_jobs_released_chk" CHECK (
    (status NOT IN ('RELEASED', 'READY_FOR_RENDERING'))
    OR (
      released_at IS NOT NULL AND released_by_id IS NOT NULL
      AND error_count = 0 AND instance_count >= 1
      AND expanded_at IS NOT NULL
    )
  ),
  -- Once ready for rendering the job carries its complete identity.
  ADD CONSTRAINT "production_jobs_rendering_chk" CHECK (
    status <> 'READY_FOR_RENDERING'
    OR (
      ready_for_rendering_at IS NOT NULL
      AND instances_digest IS NOT NULL AND production_job_hash IS NOT NULL
    )
  );

ALTER TABLE "production_instances"
  ADD CONSTRAINT "production_instances_numbers_chk" CHECK (
    sequence >= 1 AND dataset_record_sequence >= 1 AND source_row_number >= 1
    AND copy_index >= 1 AND copies >= 1 AND copy_index <= copies
    AND error_count >= 0 AND warning_count >= 0 AND source_warning_count >= 0
    AND (serial_offset IS NULL OR serial_offset >= 0)
  ),
  ADD CONSTRAINT "production_instances_hashes_chk" CHECK (
    (resolved_input_hash IS NULL OR resolved_input_hash ~ '^[0-9a-f]{64}$')
    AND (instance_hash IS NULL OR instance_hash ~ '^[0-9a-f]{64}$')
  ),
  ADD CONSTRAINT "production_instances_status_chk" CHECK (
    (status = 'ERROR' AND error_count > 0 AND resolved_input_hash IS NULL)
    OR (status = 'WARNING' AND error_count = 0 AND warning_count > 0 AND resolved_input_hash IS NOT NULL)
    OR (status = 'VALID' AND error_count = 0 AND warning_count = 0 AND resolved_input_hash IS NOT NULL)
  ),
  ADD CONSTRAINT "production_instances_issues_chk" CHECK (jsonb_typeof(issues) = 'array'),
  -- A serial value exists exactly when the instance has a place in the reserved range.
  ADD CONSTRAINT "production_instances_serial_chk" CHECK ((serial_offset IS NULL) = (serial_value IS NULL));

ALTER TABLE "production_artifacts"
  ADD CONSTRAINT "production_artifacts_checksum_chk" CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "production_artifacts_size_chk" CHECK (size_bytes >= 0),
  ADD CONSTRAINT "production_artifacts_key_chk" CHECK (btrim(storage_key) <> '');

ALTER TABLE "production_job_events"
  ADD CONSTRAINT "production_job_events_type_chk" CHECK (btrim(type) <> ''),
  ADD CONSTRAINT "production_job_events_metadata_chk" CHECK (jsonb_typeof(metadata) = 'object');

-- ---------------------------------------------------------------------------------------------
-- 2. Tenant ownership is immutable.
-- ---------------------------------------------------------------------------------------------

CREATE TRIGGER sequences_tenant_immutable BEFORE UPDATE OF organization_id ON "sequences"
  FOR EACH ROW EXECUTE FUNCTION smarttag_prevent_tenant_change();
CREATE TRIGGER sequence_reservations_tenant_immutable BEFORE UPDATE OF organization_id ON "sequence_reservations"
  FOR EACH ROW EXECUTE FUNCTION smarttag_prevent_tenant_change();
CREATE TRIGGER production_jobs_tenant_immutable BEFORE UPDATE OF organization_id ON "production_jobs"
  FOR EACH ROW EXECUTE FUNCTION smarttag_prevent_tenant_change();
CREATE TRIGGER production_instances_tenant_immutable BEFORE UPDATE OF organization_id ON "production_instances"
  FOR EACH ROW EXECUTE FUNCTION smarttag_prevent_tenant_change();
CREATE TRIGGER production_artifacts_tenant_immutable BEFORE UPDATE OF organization_id ON "production_artifacts"
  FOR EACH ROW EXECUTE FUNCTION smarttag_prevent_tenant_change();

-- ---------------------------------------------------------------------------------------------
-- 3. Sequences hand out numbers forwards only, and are never deleted while reservations exist.
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION smarttag_guard_sequence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "sequence_reservations" r WHERE r.sequence_id = OLD.id) THEN
      RAISE EXCEPTION 'sequence % has reservations and cannot be deleted (archive it instead)', OLD.id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'the code of sequence % cannot be changed: manifests and hashes refer to it', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.next_value < OLD.next_value THEN
    RAISE EXCEPTION 'sequence % cannot go backwards: serial numbers are never reused', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- Changing the format of a sequence that already produced serials would change how earlier
  -- numbers are written; released jobs keep their own formatted values, so the format is frozen
  -- as soon as the first range is reserved.
  IF (NEW.prefix IS DISTINCT FROM OLD.prefix OR NEW.suffix IS DISTINCT FROM OLD.suffix
      OR NEW.padding IS DISTINCT FROM OLD.padding)
     AND EXISTS (SELECT 1 FROM "sequence_reservations" r WHERE r.sequence_id = OLD.id) THEN
    RAISE EXCEPTION 'sequence % has already produced serial numbers; its format cannot be changed', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sequences_guard BEFORE UPDATE OR DELETE ON "sequences"
  FOR EACH ROW EXECUTE FUNCTION smarttag_guard_sequence();

-- ---------------------------------------------------------------------------------------------
-- 4. A reserved serial range belongs to its job for good: it can never be changed, moved to
--    another job, or deleted — not even when the job fails. Gaps are safe; duplicates are not.
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION smarttag_guard_sequence_reservation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'serial range % is reserved for job % and cannot be released', OLD.id, OLD.production_job_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RAISE EXCEPTION 'serial reservation % cannot be changed', OLD.id
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER sequence_reservations_guard BEFORE UPDATE OR DELETE ON "sequence_reservations"
  FOR EACH ROW EXECUTE FUNCTION smarttag_guard_sequence_reservation();

-- Overlapping ranges of one sequence are impossible, whatever the application does. The exclusion
-- constraint compares a uuid with "=" and a range with "&&" in one GiST index, which needs the
-- standard contrib extension btree_gist (see docs/sequences.md#requirements).
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "sequence_reservations"
  ADD CONSTRAINT "sequence_reservations_no_overlap"
  EXCLUDE USING gist (
    sequence_id WITH =,
    int8range(start_value, end_value, '[]') WITH &&
  );

-- ---------------------------------------------------------------------------------------------
-- 5. Production jobs follow the lifecycle state machine (production-core lifecycle.ts). Their
--    inputs are fixed from the start, and released jobs never change their production identity.
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION smarttag_guard_production_job() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('RELEASED', 'READY_FOR_RENDERING') THEN
      RAISE EXCEPTION 'released production job % cannot be deleted', OLD.id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.job_number IS DISTINCT FROM OLD.job_number
     OR NEW.template_version_id IS DISTINCT FROM OLD.template_version_id
     OR NEW.template_version_hash IS DISTINCT FROM OLD.template_version_hash
     OR NEW.data_schema_hash IS DISTINCT FROM OLD.data_schema_hash
     OR NEW.dataset_version_id IS DISTINCT FROM OLD.dataset_version_id
     OR NEW.dataset_hash IS DISTINCT FROM OLD.dataset_hash
     OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'the inputs of production job % cannot be changed', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.revision < OLD.revision OR NEW.expansion_run < OLD.expansion_run
     OR NEW.release_run < OLD.release_run THEN
    RAISE EXCEPTION 'counters of production job % cannot decrease', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.status IN ('RELEASED', 'READY_FOR_RENDERING') THEN
    IF NEW.configuration IS DISTINCT FROM OLD.configuration
       OR NEW.record_selection_hash IS DISTINCT FROM OLD.record_selection_hash
       OR NEW.sequence_id IS DISTINCT FROM OLD.sequence_id
       OR NEW.instance_count IS DISTINCT FROM OLD.instance_count
       OR NEW.production_mode IS DISTINCT FROM OLD.production_mode
       OR NEW.released_at IS DISTINCT FROM OLD.released_at
       OR NEW.released_by_id IS DISTINCT FROM OLD.released_by_id THEN
      RAISE EXCEPTION 'production job % is released and its production identity cannot be changed', OLD.id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF OLD.production_job_hash IS NOT NULL
       AND NEW.production_job_hash IS DISTINCT FROM OLD.production_job_hash THEN
      RAISE EXCEPTION 'the hash of released production job % cannot be changed', OLD.id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  IF OLD.status = 'CANCELLED' AND NEW.status <> 'CANCELLED' THEN
    RAISE EXCEPTION 'production job % was cancelled and cannot be reopened', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status IN ('QUEUED', 'CANCELLED'))
    OR (OLD.status = 'QUEUED' AND NEW.status IN ('EXPANDING', 'FAILED', 'CANCELLED'))
    OR (OLD.status = 'EXPANDING' AND NEW.status IN ('VALIDATING', 'READY', 'READY_WITH_WARNINGS', 'HAS_ERRORS', 'FAILED', 'CANCELLED'))
    OR (OLD.status = 'VALIDATING' AND NEW.status IN ('READY', 'READY_WITH_WARNINGS', 'HAS_ERRORS', 'FAILED', 'CANCELLED'))
    OR (OLD.status IN ('READY', 'READY_WITH_WARNINGS') AND NEW.status IN ('DRAFT', 'QUEUED', 'RELEASED', 'CANCELLED'))
    OR (OLD.status = 'HAS_ERRORS' AND NEW.status IN ('DRAFT', 'QUEUED', 'CANCELLED'))
    OR (OLD.status = 'RELEASED' AND NEW.status IN ('READY_FOR_RENDERING', 'FAILED'))
    OR (OLD.status = 'FAILED' AND NEW.status IN ('DRAFT', 'QUEUED', 'RELEASED', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'production job % cannot change from % to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- Releasing requires the serial range to exist already: the release transaction reserves it.
  IF NEW.status = 'RELEASED' AND OLD.status <> 'RELEASED'
     AND (NEW.configuration -> 'serial' ->> 'enabled') = 'true'
     AND NOT EXISTS (SELECT 1 FROM "sequence_reservations" r WHERE r.production_job_id = NEW.id) THEN
    RAISE EXCEPTION 'production job % uses serial numbers but has no reserved range', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER production_jobs_guard BEFORE UPDATE OR DELETE ON "production_jobs"
  FOR EACH ROW EXECUTE FUNCTION smarttag_guard_production_job();

-- ---------------------------------------------------------------------------------------------
-- 6. Instances of a released job are immutable, and instances only ever belong to a job that is
--    being expanded. Statement-level triggers with transition tables keep bulk inserts fast.
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION smarttag_guard_production_instance_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  offending uuid;
BEGIN
  SELECT j.id INTO offending
  FROM new_instances n
  JOIN "production_jobs" j ON j.id = n.production_job_id
  WHERE j.status NOT IN ('QUEUED', 'EXPANDING', 'VALIDATING')
  LIMIT 1;
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'production job % is not being expanded; instances cannot be added', offending
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION smarttag_guard_production_instance_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  offending uuid;
BEGIN
  -- Released instances may still gain their serial number and hash while the release job runs;
  -- everything that identifies the tag is fixed.
  SELECT o.production_job_id INTO offending
  FROM old_instances o
  JOIN new_instances n
    ON n.production_job_id = o.production_job_id AND n.sequence = o.sequence
  JOIN "production_jobs" j ON j.id = o.production_job_id
  WHERE j.status IN ('RELEASED', 'READY_FOR_RENDERING')
    AND (
      n.dataset_record_sequence IS DISTINCT FROM o.dataset_record_sequence
      OR n.source_row_number IS DISTINCT FROM o.source_row_number
      OR n.copy_index IS DISTINCT FROM o.copy_index
      OR n.copies IS DISTINCT FROM o.copies
      OR (o.serial_value IS NOT NULL AND n.serial_value IS DISTINCT FROM o.serial_value)
      OR (o.instance_hash IS NOT NULL AND n.instance_hash IS DISTINCT FROM o.instance_hash)
      OR (j.status = 'READY_FOR_RENDERING' AND (
            n.status IS DISTINCT FROM o.status
            OR n.issues IS DISTINCT FROM o.issues
            OR n.resolved_input_hash IS DISTINCT FROM o.resolved_input_hash))
    )
  LIMIT 1;
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'instances of released production job % cannot be changed', offending
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION smarttag_guard_production_instance_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  offending uuid;
BEGIN
  SELECT j.id INTO offending
  FROM old_instances o
  JOIN "production_jobs" j ON j.id = o.production_job_id
  WHERE j.status IN ('RELEASED', 'READY_FOR_RENDERING')
  LIMIT 1;
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'instances of released production job % cannot be deleted', offending
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER production_instances_insert_guard AFTER INSERT ON "production_instances"
  REFERENCING NEW TABLE AS new_instances
  FOR EACH STATEMENT EXECUTE FUNCTION smarttag_guard_production_instance_insert();

CREATE TRIGGER production_instances_update_guard AFTER UPDATE ON "production_instances"
  REFERENCING OLD TABLE AS old_instances NEW TABLE AS new_instances
  FOR EACH STATEMENT EXECUTE FUNCTION smarttag_guard_production_instance_update();

CREATE TRIGGER production_instances_delete_guard AFTER DELETE ON "production_instances"
  REFERENCING OLD TABLE AS old_instances
  FOR EACH STATEMENT EXECUTE FUNCTION smarttag_guard_production_instance_delete();

-- ---------------------------------------------------------------------------------------------
-- 7. A manifest is written once per job. A retry rewrites the same row (same job, same kind);
--    nothing may point it at another job, and it is never deleted.
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION smarttag_guard_production_artifact() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'production artifact % belongs to a released job and cannot be deleted', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.production_job_id IS DISTINCT FROM OLD.production_job_id
     OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'production artifact % cannot be moved to another job', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "production_jobs" j
    WHERE j.id = OLD.production_job_id AND j.status = 'READY_FOR_RENDERING'
  ) AND NEW.checksum_sha256 IS DISTINCT FROM OLD.checksum_sha256 THEN
    RAISE EXCEPTION 'the manifest of job % is final and cannot change', OLD.production_job_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER production_artifacts_guard BEFORE UPDATE OR DELETE ON "production_artifacts"
  FOR EACH ROW EXECUTE FUNCTION smarttag_guard_production_artifact();

-- ---------------------------------------------------------------------------------------------
-- 8. Job history is append-only.
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION smarttag_guard_production_job_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'production job history is append-only'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER production_job_events_append_only BEFORE UPDATE OR DELETE ON "production_job_events"
  FOR EACH ROW EXECUTE FUNCTION smarttag_guard_production_job_event();
