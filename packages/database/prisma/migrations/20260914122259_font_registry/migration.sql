-- CreateEnum
CREATE TYPE "font_style" AS ENUM ('NORMAL', 'ITALIC');

-- CreateEnum
CREATE TYPE "font_format" AS ENUM ('TTF', 'OTF', 'WOFF', 'WOFF2');

-- CreateEnum
CREATE TYPE "font_embedding_permission" AS ENUM ('INSTALLABLE', 'EDITABLE', 'PREVIEW_AND_PRINT', 'RESTRICTED');

-- CreateTable
CREATE TABLE "font_faces" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "family_name" VARCHAR(200) NOT NULL,
    "subfamily_name" VARCHAR(200) NOT NULL,
    "full_name" VARCHAR(300) NOT NULL,
    "postscript_name" VARCHAR(127) NOT NULL,
    "font_version" VARCHAR(100) NOT NULL,
    "weight" INTEGER NOT NULL,
    "style" "font_style" NOT NULL,
    "format" "font_format" NOT NULL,
    "embedding_permission" "font_embedding_permission" NOT NULL,
    "units_per_em" INTEGER NOT NULL,
    "ascender" INTEGER NOT NULL,
    "descender" INTEGER NOT NULL,
    "line_gap" INTEGER NOT NULL,
    "cap_height" INTEGER,
    "x_height" INTEGER,
    "glyph_count" INTEGER NOT NULL,
    "unicode_ranges" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "font_faces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "font_faces_asset_id_key" ON "font_faces"("asset_id");

-- CreateIndex
CREATE INDEX "font_faces_organization_id_family_name_weight_style_idx" ON "font_faces"("organization_id", "family_name", "weight", "style");

-- CreateIndex
CREATE UNIQUE INDEX "font_faces_asset_id_organization_id_key" ON "font_faces"("asset_id", "organization_id");

-- AddForeignKey
ALTER TABLE "font_faces" ADD CONSTRAINT "font_faces_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "font_faces" ADD CONSTRAINT "font_faces_asset_id_organization_id_fkey" FOREIGN KEY ("asset_id", "organization_id") REFERENCES "assets"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
