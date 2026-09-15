-- =============================================================================================
-- Font registry invariants that cannot be expressed in schema.prisma.
-- =============================================================================================

-- 1. CHECK constraints ------------------------------------------------------------------------

ALTER TABLE "font_faces"
  ADD CONSTRAINT "font_faces_weight_chk" CHECK (weight BETWEEN 100 AND 900 AND weight % 100 = 0),
  ADD CONSTRAINT "font_faces_units_per_em_chk" CHECK (units_per_em BETWEEN 16 AND 16384),
  ADD CONSTRAINT "font_faces_glyph_count_chk" CHECK (glyph_count >= 1),
  ADD CONSTRAINT "font_faces_names_chk" CHECK (
    btrim(family_name) <> '' AND btrim(subfamily_name) <> '' AND btrim(postscript_name) <> ''
  ),
  ADD CONSTRAINT "font_faces_unicode_ranges_chk" CHECK (jsonb_typeof(unicode_ranges) = 'array');

-- 2. Registry rows describe immutable, content-addressed font files: they are never updated,
--    and they may only describe FONT assets of the same organization (the composite foreign key
--    already guarantees the organization).

CREATE FUNCTION smarttag_guard_font_face() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'font_faces rows are immutable (font %)', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "assets" a WHERE a.id = NEW.asset_id AND a.asset_type = 'FONT') THEN
    RAISE EXCEPTION 'font face % must reference a FONT asset', NEW.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER font_faces_guard BEFORE INSERT OR UPDATE ON "font_faces"
  FOR EACH ROW EXECUTE FUNCTION smarttag_guard_font_face();

-- 3. Asset rows that back a font face cannot change type.

CREATE FUNCTION smarttag_guard_font_asset_type() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.asset_type IS DISTINCT FROM OLD.asset_type
     AND EXISTS (SELECT 1 FROM "font_faces" f WHERE f.asset_id = OLD.id) THEN
    RAISE EXCEPTION 'asset % is registered as a font and cannot change type', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assets_font_type_guard BEFORE UPDATE OF asset_type ON "assets"
  FOR EACH ROW EXECUTE FUNCTION smarttag_guard_font_asset_type();
