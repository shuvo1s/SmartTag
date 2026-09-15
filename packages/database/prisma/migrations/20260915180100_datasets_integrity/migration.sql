-- =============================================================================================
-- Phase 4 integrity rules for data imports, datasets and mapping profiles that cannot be
-- expressed in schema.prisma. Application services enforce the same rules; the database is the
-- last line of defence (docs/datasets.md#immutability).
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 1. CHECK constraints
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "data_source_files"
  ADD CONSTRAINT "data_source_files_size_chk" CHECK (size_bytes >= 0),
  ADD CONSTRAINT "data_source_files_checksum_chk" CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "data_source_files_filename_chk" CHECK (btrim(original_filename) <> ''),
  ADD CONSTRAINT "data_source_files_stored_chk" CHECK ((status = 'PENDING') = (stored_at IS NULL) OR status = 'DELETED'),
  ADD CONSTRAINT "data_source_files_deleted_chk" CHECK ((status = 'DELETED') = (deleted_at IS NOT NULL));

ALTER TABLE "data_imports"
  ADD CONSTRAINT "data_imports_hashes_chk" CHECK (
    template_version_hash ~ '^[0-9a-f]{64}$' AND data_schema_hash ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT "data_imports_counters_chk" CHECK (
    revision >= 1 AND inspection_run >= 0 AND validation_run >= 0 AND progress_processed_rows >= 0
    AND (progress_total_rows IS NULL OR progress_total_rows >= 0)
  ),
  ADD CONSTRAINT "data_imports_json_chk" CHECK (
    jsonb_typeof(source_settings) = 'object'
    AND jsonb_typeof(columns) = 'array'
    AND jsonb_typeof(processing) = 'object'
    AND (inspection IS NULL OR jsonb_typeof(inspection) = 'object')
    AND (mapping IS NULL OR jsonb_typeof(mapping) = 'object')
    AND (failure IS NULL OR jsonb_typeof(failure) = 'object')
  ),
  ADD CONSTRAINT "data_imports_profile_chk" CHECK ((mapping_profile_id IS NULL) = (mapping_profile_revision IS NULL)),
  ADD CONSTRAINT "data_imports_finalized_chk" CHECK ((status = 'FINALIZED') = (finalized_at IS NOT NULL)),
  ADD CONSTRAINT "data_imports_cancelled_chk" CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  ADD CONSTRAINT "data_imports_failure_chk" CHECK ((status = 'FAILED') = (failure IS NOT NULL));

ALTER TABLE "datasets"
  ADD CONSTRAINT "datasets_name_chk" CHECK (btrim(name) <> ''),
  ADD CONSTRAINT "datasets_latest_version_number_chk" CHECK (latest_version_number >= 0);

ALTER TABLE "dataset_versions"
  ADD CONSTRAINT "dataset_versions_hashes_chk" CHECK (
    template_version_hash ~ '^[0-9a-f]{64}$'
    AND data_schema_hash ~ '^[0-9a-f]{64}$'
    AND source_checksum_sha256 ~ '^[0-9a-f]{64}$'
    AND (records_digest IS NULL OR records_digest ~ '^[0-9a-f]{64}$')
    AND (dataset_hash IS NULL OR dataset_hash ~ '^[0-9a-f]{64}$')
  ),
  ADD CONSTRAINT "dataset_versions_counts_chk" CHECK (
    validation_run >= 1 AND row_count >= 0 AND valid_count >= 0 AND warning_count >= 0
    AND error_count >= 0 AND blank_row_count >= 0 AND duplicate_row_count >= 0
    AND valid_count + warning_count + error_count = row_count
  ),
  ADD CONSTRAINT "dataset_versions_json_chk" CHECK (
    jsonb_typeof(mapping_snapshot) = 'object'
    AND jsonb_typeof(import_configuration) = 'object'
    AND jsonb_typeof(validation_summary) = 'object'
  ),
  ADD CONSTRAINT "dataset_versions_profile_chk" CHECK ((mapping_profile_id IS NULL) = (mapping_profile_revision IS NULL)),
  ADD CONSTRAINT "dataset_versions_completion_chk" CHECK ((completed_at IS NULL) = (records_digest IS NULL)),
  -- A DRAFT has no dataset, number or dataset hash. A FINALIZED version has all of them, a complete
  -- run, and no rows with errors: finalizing a dataset with errors is impossible at every layer.
  ADD CONSTRAINT "dataset_versions_status_chk" CHECK (
    (
      status = 'DRAFT'
      AND dataset_id IS NULL AND version_number IS NULL AND dataset_hash IS NULL
      AND finalized_at IS NULL AND finalized_by_id IS NULL
    )
    OR (
      status = 'FINALIZED'
      AND dataset_id IS NOT NULL AND version_number >= 1 AND dataset_hash IS NOT NULL
      AND completed_at IS NOT NULL AND finalized_at IS NOT NULL AND finalized_by_id IS NOT NULL
      AND error_count = 0
      AND (warning_count = 0 OR warnings_acknowledged_at IS NOT NULL)
    )
  );

ALTER TABLE "dataset_records"
  ADD CONSTRAINT "dataset_records_numbers_chk" CHECK (
    sequence >= 1 AND row_number >= 1 AND error_count >= 0 AND warning_count >= 0
    AND (duplicate_of_sequence IS NULL OR (duplicate_of_sequence >= 1 AND duplicate_of_sequence < sequence))
  ),
  ADD CONSTRAINT "dataset_records_hashes_chk" CHECK (
    record_hash ~ '^[0-9a-f]{64}$'
    AND (resolved_input_hash IS NULL OR resolved_input_hash ~ '^[0-9a-f]{64}$')
  ),
  ADD CONSTRAINT "dataset_records_status_chk" CHECK (
    (status = 'ERROR' AND error_count > 0 AND resolved_input_hash IS NULL)
    OR (status = 'WARNING' AND error_count = 0 AND warning_count > 0 AND resolved_input_hash IS NOT NULL)
    OR (status = 'VALID' AND error_count = 0 AND warning_count = 0 AND resolved_input_hash IS NOT NULL)
  ),
  ADD CONSTRAINT "dataset_records_json_chk" CHECK (
    jsonb_typeof(normalized_record) = 'object' AND jsonb_typeof(issues) = 'array'
  );

ALTER TABLE "mapping_profiles"
  ADD CONSTRAINT "mapping_profiles_name_chk" CHECK (btrim(name) <> ''),
  ADD CONSTRAINT "mapping_profiles_revision_chk" CHECK (current_revision >= 1),
  ADD CONSTRAINT "mapping_profiles_hashes_chk" CHECK (
    data_schema_hash ~ '^[0-9a-f]{64}$' AND header_signature ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT "mapping_profiles_definition_chk" CHECK (jsonb_typeof(definition) = 'object');

ALTER TABLE "mapping_profile_revisions"
  ADD CONSTRAINT "mapping_profile_revisions_revision_chk" CHECK (revision >= 1),
  ADD CONSTRAINT "mapping_profile_revisions_hashes_chk" CHECK (
    data_schema_hash ~ '^[0-9a-f]{64}$' AND header_signature ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT "mapping_profile_revisions_definition_chk" CHECK (jsonb_typeof(definition) = 'object');

-- ---------------------------------------------------------------------------------------------
-- 2. Tenant ownership is immutable.
-- ---------------------------------------------------------------------------------------------

CREATE TRIGGER data_source_files_tenant_immutable BEFORE UPDATE OF organization_id ON "data_source_files"
  FOR EACH ROW EXECUTE FUNCTION smarttag_prevent_tenant_change();
CREATE TRIGGER data_imports_tenant_immutable BEFORE UPDATE OF organization_id ON "data_imports"
  FOR EACH ROW EXECUTE FUNCTION smarttag_prevent_tenant_change();
CREATE TRIGGER datasets_tenant_immutable BEFORE UPDATE OF organization_id ON "datasets"
  FOR EACH ROW EXECUTE FUNCTION smarttag_prevent_tenant_change();
CREATE TRIGGER dataset_versions_tenant_immutable BEFORE UPDATE OF organization_id ON "dataset_versions"
  FOR EACH ROW EXECUTE FUNCTION smarttag_prevent_tenant_change();
CREATE TRIGGER mapping_profiles_tenant_immutable BEFORE UPDATE OF organization_id ON "mapping_profiles"
  FOR EACH ROW EXECUTE FUNCTION smarttag_prevent_tenant_change();

-- ---------------------------------------------------------------------------------------------
-- 3. Source files: identity and bytes are fixed; a file used by a finalized dataset version is
--    never marked deleted.
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION smarttag_guard_data_source_file() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'data source file % cannot be deleted (mark it DELETED instead)', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.checksum_sha256 IS DISTINCT FROM OLD.checksum_sha256
     OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
     OR NEW.format IS DISTINCT FROM OLD.format
     OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
     OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'identity of data source file % cannot be changed', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'DELETED' AND NEW.status <> 'DELETED' THEN
    RAISE EXCEPTION 'data source file % was deleted and cannot be restored', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status = 'DELETED' AND OLD.status <> 'DELETED' AND EXISTS (
    SELECT 1 FROM "dataset_versions" v WHERE v.source_file_id = OLD.id AND v.status = 'FINALIZED'
  ) THEN
    RAISE EXCEPTION 'data source file % belongs to a finalized dataset version and must be kept', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER data_source_files_guard BEFORE UPDATE OR DELETE ON "data_source_files"
  FOR EACH ROW EXECUTE FUNCTION smarttag_guard_data_source_file();

-- ---------------------------------------------------------------------------------------------
-- 4. Imports follow the lifecycle state machine (import-core lifecycle.ts); identity is fixed and
--    terminal imports never change.
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION smarttag_guard_data_import() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'data import % cannot be deleted', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status IN ('FINALIZED', 'CANCELLED') THEN
    RAISE EXCEPTION 'data import % is % and cannot be changed', OLD.id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.template_version_id IS DISTINCT FROM OLD.template_version_id
     OR NEW.template_version_hash IS DISTINCT FROM OLD.template_version_hash
     OR NEW.data_schema_hash IS DISTINCT FROM OLD.data_schema_hash
     OR NEW.source_file_id IS DISTINCT FROM OLD.source_file_id
     OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'identity of data import % cannot be changed', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.revision < OLD.revision OR NEW.inspection_run < OLD.inspection_run
     OR NEW.validation_run < OLD.validation_run THEN
    RAISE EXCEPTION 'counters of data import % cannot decrease', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'UPLOADED' AND NEW.status IN ('INSPECTING', 'FAILED', 'CANCELLED'))
    OR (OLD.status = 'INSPECTING' AND NEW.status IN ('MAPPING_REQUIRED', 'READY_TO_VALIDATE', 'FAILED', 'CANCELLED'))
    OR (OLD.status = 'MAPPING_REQUIRED' AND NEW.status IN ('READY_TO_VALIDATE', 'INSPECTING', 'CANCELLED'))
    OR (OLD.status = 'READY_TO_VALIDATE' AND NEW.status IN ('MAPPING_REQUIRED', 'VALIDATING', 'INSPECTING', 'CANCELLED'))
    OR (OLD.status = 'VALIDATING' AND NEW.status IN ('READY', 'READY_WITH_WARNINGS', 'HAS_ERRORS', 'FAILED', 'CANCELLED'))
    OR (OLD.status IN ('READY', 'READY_WITH_WARNINGS') AND NEW.status IN ('MAPPING_REQUIRED', 'READY_TO_VALIDATE', 'VALIDATING', 'INSPECTING', 'FINALIZED', 'CANCELLED'))
    OR (OLD.status = 'HAS_ERRORS' AND NEW.status IN ('MAPPING_REQUIRED', 'READY_TO_VALIDATE', 'VALIDATING', 'INSPECTING', 'CANCELLED'))
    OR (OLD.status = 'FAILED' AND NEW.status IN ('INSPECTING', 'VALIDATING', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'invalid data import status transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER data_imports_guard BEFORE UPDATE OR DELETE ON "data_imports"
  FOR EACH ROW EXECUTE FUNCTION smarttag_guard_data_import();

-- ---------------------------------------------------------------------------------------------
-- 5. Dataset versions: drafts may be rebuilt or removed; finalized versions are immutable and can
--    never be deleted. Identity (import run, template version, source, mapping) never changes.
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION smarttag_guard_dataset_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'FINALIZED' THEN
      RAISE EXCEPTION 'dataset version % is finalized and cannot be deleted', OLD.id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'FINALIZED' THEN
    RAISE EXCEPTION 'dataset version % is finalized and immutable', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.import_id IS DISTINCT FROM OLD.import_id
     OR NEW.validation_run IS DISTINCT FROM OLD.validation_run
     OR NEW.template_version_id IS DISTINCT FROM OLD.template_version_id
     OR NEW.template_version_hash IS DISTINCT FROM OLD.template_version_hash
     OR NEW.data_schema_hash IS DISTINCT FROM OLD.data_schema_hash
     OR NEW.source_file_id IS DISTINCT FROM OLD.source_file_id
     OR NEW.source_checksum_sha256 IS DISTINCT FROM OLD.source_checksum_sha256
     OR NEW.mapping_snapshot IS DISTINCT FROM OLD.mapping_snapshot
     OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'identity of dataset version % cannot be changed', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.completed_at IS NOT NULL AND (
       NEW.row_count IS DISTINCT FROM OLD.row_count
    OR NEW.valid_count IS DISTINCT FROM OLD.valid_count
    OR NEW.warning_count IS DISTINCT FROM OLD.warning_count
    OR NEW.error_count IS DISTINCT FROM OLD.error_count
    OR NEW.records_digest IS DISTINCT FROM OLD.records_digest
    OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
  ) THEN
    RAISE EXCEPTION 'results of completed dataset version % cannot be changed', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status = 'FINALIZED' AND OLD.completed_at IS NULL THEN
    RAISE EXCEPTION 'dataset version % has not completed validation and cannot be finalized', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER dataset_versions_guard BEFORE UPDATE OR DELETE ON "dataset_versions"
  FOR EACH ROW EXECUTE FUNCTION smarttag_guard_dataset_version();

-- ---------------------------------------------------------------------------------------------
-- 6. Dataset records of completed or finalized versions never change. Checked per statement over
--    transition tables, so bulk inserts of draft records stay fast.
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION smarttag_guard_dataset_records_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM new_records r JOIN "dataset_versions" v ON v.id = r.dataset_version_id
    WHERE v.status = 'FINALIZED' OR v.completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'records cannot be added to a completed or finalized dataset version'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION smarttag_guard_dataset_records_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM old_records r JOIN "dataset_versions" v ON v.id = r.dataset_version_id
    WHERE v.status = 'FINALIZED' OR (TG_OP = 'UPDATE' AND v.completed_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'records of a completed or finalized dataset version cannot be %',
      CASE TG_OP WHEN 'DELETE' THEN 'deleted' ELSE 'changed' END
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER dataset_records_insert_guard AFTER INSERT ON "dataset_records"
  REFERENCING NEW TABLE AS new_records
  FOR EACH STATEMENT EXECUTE FUNCTION smarttag_guard_dataset_records_insert();
CREATE TRIGGER dataset_records_update_guard AFTER UPDATE ON "dataset_records"
  REFERENCING OLD TABLE AS old_records
  FOR EACH STATEMENT EXECUTE FUNCTION smarttag_guard_dataset_records_change();
CREATE TRIGGER dataset_records_delete_guard AFTER DELETE ON "dataset_records"
  REFERENCING OLD TABLE AS old_records
  FOR EACH STATEMENT EXECUTE FUNCTION smarttag_guard_dataset_records_change();

-- ---------------------------------------------------------------------------------------------
-- 7. Mapping profile revisions are append-only; a profile's current revision only moves forward
--    and must exist.
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION smarttag_mapping_profile_revisions_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'mapping_profile_revisions is append-only (% rejected)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER mapping_profile_revisions_append_only BEFORE UPDATE OR DELETE ON "mapping_profile_revisions"
  FOR EACH ROW EXECUTE FUNCTION smarttag_mapping_profile_revisions_append_only();

CREATE FUNCTION smarttag_guard_mapping_profile() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'mapping profile % cannot be deleted (archive it instead)', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.current_revision < OLD.current_revision THEN
    RAISE EXCEPTION 'revision of mapping profile % cannot decrease', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.created_by_id IS DISTINCT FROM OLD.created_by_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'identity of mapping profile % cannot be changed', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mapping_profiles_guard BEFORE UPDATE OR DELETE ON "mapping_profiles"
  FOR EACH ROW EXECUTE FUNCTION smarttag_guard_mapping_profile();
