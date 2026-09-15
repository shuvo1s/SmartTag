-- =============================================================================================
-- Integrity constraints and invariants that cannot be expressed in schema.prisma.
--
-- These rules are enforced by application services as well; the database is the last line of
-- defence so that no code path (scripts, future services, manual SQL) can violate them.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 1. CHECK constraints
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "users"
  ADD CONSTRAINT "users_email_normalized_chk" CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1);

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_slug_format_chk" CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,63}$');

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_code_format_chk" CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$');

ALTER TABLE "brands"
  ADD CONSTRAINT "brands_code_format_chk" CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$');

ALTER TABLE "templates"
  ADD CONSTRAINT "templates_code_format_chk" CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'),
  ADD CONSTRAINT "templates_brand_requires_customer_chk" CHECK (brand_id IS NULL OR customer_id IS NOT NULL),
  ADD CONSTRAINT "templates_latest_version_number_chk" CHECK (latest_version_number >= 0);

ALTER TABLE "template_versions"
  ADD CONSTRAINT "template_versions_version_number_chk" CHECK (version_number >= 1),
  ADD CONSTRAINT "template_versions_schema_version_chk" CHECK (schema_version >= 1),
  ADD CONSTRAINT "template_versions_revision_chk" CHECK (revision >= 1),
  ADD CONSTRAINT "template_versions_document_hash_chk" CHECK (document_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "template_versions_document_json_chk" CHECK (
    jsonb_typeof(document_json) = 'object'
    AND jsonb_typeof(document_json -> 'schemaVersion') = 'number'
    AND (document_json ->> 'schemaVersion') = schema_version::text
  ),
  ADD CONSTRAINT "template_versions_summary_json_chk" CHECK (jsonb_typeof(summary_json) = 'object'),
  ADD CONSTRAINT "template_versions_submission_chk" CHECK ((submitted_at IS NULL) = (submitted_by_id IS NULL)),
  ADD CONSTRAINT "template_versions_approval_chk" CHECK (
    (approved_at IS NULL) = (approved_by_id IS NULL)
    AND (status <> 'APPROVED' OR approved_at IS NOT NULL)
  ),
  ADD CONSTRAINT "template_versions_retirement_chk" CHECK (
    (retired_at IS NULL) = (retired_by_id IS NULL)
    AND ((status = 'RETIRED') = (retired_at IS NOT NULL))
  );

ALTER TABLE "assets"
  ADD CONSTRAINT "assets_size_chk" CHECK (size_bytes >= 0),
  ADD CONSTRAINT "assets_checksum_chk" CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "assets_pixel_size_chk" CHECK (
    (width_px IS NULL AND height_px IS NULL) OR (width_px > 0 AND height_px > 0)
  ),
  ADD CONSTRAINT "assets_metadata_object_chk" CHECK (jsonb_typeof(metadata) = 'object');

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_token_hash_chk" CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "sessions_expiry_chk" CHECK (expires_at > created_at);

ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_metadata_object_chk" CHECK (jsonb_typeof(metadata) = 'object');

-- ---------------------------------------------------------------------------------------------
-- 2. Tenant ownership is immutable: a row can never be moved to another organization.
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION smarttag_prevent_tenant_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'organization_id of %.% cannot be changed', TG_TABLE_NAME, OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER memberships_tenant_immutable BEFORE UPDATE OF organization_id ON "memberships"
  FOR EACH ROW EXECUTE FUNCTION smarttag_prevent_tenant_change();
CREATE TRIGGER customers_tenant_immutable BEFORE UPDATE OF organization_id ON "customers"
  FOR EACH ROW EXECUTE FUNCTION smarttag_prevent_tenant_change();
CREATE TRIGGER brands_tenant_immutable BEFORE UPDATE OF organization_id ON "brands"
  FOR EACH ROW EXECUTE FUNCTION smarttag_prevent_tenant_change();
CREATE TRIGGER templates_tenant_immutable BEFORE UPDATE OF organization_id ON "templates"
  FOR EACH ROW EXECUTE FUNCTION smarttag_prevent_tenant_change();
CREATE TRIGGER template_versions_tenant_immutable BEFORE UPDATE OF organization_id ON "template_versions"
  FOR EACH ROW EXECUTE FUNCTION smarttag_prevent_tenant_change();
CREATE TRIGGER assets_tenant_immutable BEFORE UPDATE OF organization_id ON "assets"
  FOR EACH ROW EXECUTE FUNCTION smarttag_prevent_tenant_change();

-- ---------------------------------------------------------------------------------------------
-- 3. Template versions: identity is fixed, content is immutable once it leaves DRAFT,
--    status follows the lifecycle state machine, and approval records cannot be rewritten.
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION smarttag_guard_template_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'template version % is % and cannot be deleted', OLD.id, OLD.status
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.template_id IS DISTINCT FROM OLD.template_id
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.based_on_version_id IS DISTINCT FROM OLD.based_on_version_id
     OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'identity of template version % cannot be changed', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.status <> 'DRAFT' AND (
       NEW.document_json IS DISTINCT FROM OLD.document_json
    OR NEW.document_hash IS DISTINCT FROM OLD.document_hash
    OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
    OR NEW.summary_json IS DISTINCT FROM OLD.summary_json
    OR NEW.change_summary IS DISTINCT FROM OLD.change_summary
    OR NEW.revision IS DISTINCT FROM OLD.revision
  ) THEN
    RAISE EXCEPTION 'template version % is % and its content is immutable', OLD.id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status IN ('IN_REVIEW', 'RETIRED'))
    OR (OLD.status = 'IN_REVIEW' AND NEW.status IN ('DRAFT', 'APPROVED'))
    OR (OLD.status = 'APPROVED' AND NEW.status = 'RETIRED')
  ) THEN
    RAISE EXCEPTION 'invalid template version status transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.approved_at IS NOT NULL AND (
       NEW.approved_at IS DISTINCT FROM OLD.approved_at
    OR NEW.approved_by_id IS DISTINCT FROM OLD.approved_by_id
  ) THEN
    RAISE EXCEPTION 'approval record of template version % cannot be changed', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER template_versions_guard BEFORE UPDATE OR DELETE ON "template_versions"
  FOR EACH ROW EXECUTE FUNCTION smarttag_guard_template_version();

-- ---------------------------------------------------------------------------------------------
-- 4. Audit events are append-only.
--    (In production, the application role should additionally lack TRUNCATE on this table.)
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION smarttag_audit_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION smarttag_audit_events_append_only();
