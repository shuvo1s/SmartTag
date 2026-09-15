-- CreateEnum
CREATE TYPE "data_source_format" AS ENUM ('CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "data_source_file_status" AS ENUM ('PENDING', 'STORED', 'DELETED');

-- CreateEnum
CREATE TYPE "data_import_status" AS ENUM ('UPLOADED', 'INSPECTING', 'MAPPING_REQUIRED', 'READY_TO_VALIDATE', 'VALIDATING', 'READY', 'READY_WITH_WARNINGS', 'HAS_ERRORS', 'FAILED', 'CANCELLED', 'FINALIZED');

-- CreateEnum
CREATE TYPE "dataset_version_status" AS ENUM ('DRAFT', 'FINALIZED');

-- CreateEnum
CREATE TYPE "dataset_record_status" AS ENUM ('VALID', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "mapping_profile_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "data_source_files" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" "data_source_file_status" NOT NULL DEFAULT 'PENDING',
    "storage_key" VARCHAR(512) NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "format" "data_source_format" NOT NULL,
    "declared_mime_type" VARCHAR(127),
    "size_bytes" INTEGER NOT NULL,
    "checksum_sha256" CHAR(64) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stored_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "data_source_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_imports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "template_version_id" UUID NOT NULL,
    "template_version_hash" CHAR(64) NOT NULL,
    "data_schema_hash" CHAR(64) NOT NULL,
    "target_dataset_id" UUID,
    "source_file_id" UUID NOT NULL,
    "status" "data_import_status" NOT NULL DEFAULT 'UPLOADED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "source_settings" JSONB NOT NULL,
    "inspection" JSONB,
    "columns" JSONB NOT NULL DEFAULT '[]',
    "mapping" JSONB,
    "mapping_profile_id" UUID,
    "mapping_profile_revision" INTEGER,
    "inspection_run" INTEGER NOT NULL DEFAULT 0,
    "validation_run" INTEGER NOT NULL DEFAULT 0,
    "progress_processed_rows" INTEGER NOT NULL DEFAULT 0,
    "progress_total_rows" INTEGER,
    "progress_updated_at" TIMESTAMPTZ(3),
    "failure" JSONB,
    "processing" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "validated_at" TIMESTAMPTZ(3),
    "finalized_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),

    CONSTRAINT "data_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "datasets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "customer_id" UUID,
    "latest_version_number" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "dataset_id" UUID,
    "version_number" INTEGER,
    "status" "dataset_version_status" NOT NULL DEFAULT 'DRAFT',
    "import_id" UUID NOT NULL,
    "validation_run" INTEGER NOT NULL,
    "template_version_id" UUID NOT NULL,
    "template_version_hash" CHAR(64) NOT NULL,
    "data_schema_hash" CHAR(64) NOT NULL,
    "source_file_id" UUID NOT NULL,
    "source_checksum_sha256" CHAR(64) NOT NULL,
    "mapping_snapshot" JSONB NOT NULL,
    "import_configuration" JSONB NOT NULL,
    "mapping_profile_id" UUID,
    "mapping_profile_revision" INTEGER,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "valid_count" INTEGER NOT NULL DEFAULT 0,
    "warning_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "blank_row_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_row_count" INTEGER NOT NULL DEFAULT 0,
    "records_digest" CHAR(64),
    "dataset_hash" CHAR(64),
    "validation_summary" JSONB NOT NULL DEFAULT '{}',
    "completed_at" TIMESTAMPTZ(3),
    "warnings_acknowledged_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_by_id" UUID,
    "finalized_at" TIMESTAMPTZ(3),

    CONSTRAINT "dataset_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset_records" (
    "dataset_version_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "organization_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "status" "dataset_record_status" NOT NULL,
    "normalized_record" JSONB NOT NULL,
    "record_hash" CHAR(64) NOT NULL,
    "resolved_input_hash" CHAR(64),
    "error_count" INTEGER NOT NULL,
    "warning_count" INTEGER NOT NULL,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "duplicate_of_sequence" INTEGER,
    "search_text" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "dataset_records_pkey" PRIMARY KEY ("dataset_version_id","sequence")
);

-- CreateTable
CREATE TABLE "mapping_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "status" "mapping_profile_status" NOT NULL DEFAULT 'ACTIVE',
    "current_revision" INTEGER NOT NULL DEFAULT 1,
    "data_schema_hash" CHAR(64) NOT NULL,
    "header_signature" CHAR(64) NOT NULL,
    "source_format" "data_source_format",
    "definition" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mapping_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapping_profile_revisions" (
    "profile_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "definition" JSONB NOT NULL,
    "data_schema_hash" CHAR(64) NOT NULL,
    "header_signature" CHAR(64) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mapping_profile_revisions_pkey" PRIMARY KEY ("profile_id","revision")
);

-- CreateIndex
CREATE INDEX "data_source_files_organization_id_created_at_idx" ON "data_source_files"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "data_source_files_status_created_at_idx" ON "data_source_files"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "data_source_files_id_organization_id_key" ON "data_source_files"("id", "organization_id");

-- CreateIndex
CREATE INDEX "data_imports_organization_id_status_updated_at_idx" ON "data_imports"("organization_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "data_imports_organization_id_created_at_idx" ON "data_imports"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "data_imports_status_updated_at_idx" ON "data_imports"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "data_imports_id_organization_id_key" ON "data_imports"("id", "organization_id");

-- CreateIndex
CREATE INDEX "datasets_organization_id_updated_at_idx" ON "datasets"("organization_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "datasets_organization_id_name_key" ON "datasets"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "datasets_id_organization_id_key" ON "datasets"("id", "organization_id");

-- CreateIndex
CREATE INDEX "dataset_versions_organization_id_status_finalized_at_idx" ON "dataset_versions"("organization_id", "status", "finalized_at");

-- CreateIndex
CREATE UNIQUE INDEX "dataset_versions_import_id_validation_run_key" ON "dataset_versions"("import_id", "validation_run");

-- CreateIndex
CREATE UNIQUE INDEX "dataset_versions_dataset_id_version_number_key" ON "dataset_versions"("dataset_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "dataset_versions_id_organization_id_key" ON "dataset_versions"("id", "organization_id");

-- CreateIndex
CREATE INDEX "dataset_records_dataset_version_id_status_sequence_idx" ON "dataset_records"("dataset_version_id", "status", "sequence");

-- CreateIndex
CREATE INDEX "mapping_profiles_organization_id_status_data_schema_hash_idx" ON "mapping_profiles"("organization_id", "status", "data_schema_hash");

-- CreateIndex
CREATE UNIQUE INDEX "mapping_profiles_organization_id_name_key" ON "mapping_profiles"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "mapping_profiles_id_organization_id_key" ON "mapping_profiles"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "template_versions_id_organization_id_key" ON "template_versions"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "data_source_files" ADD CONSTRAINT "data_source_files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "data_source_files" ADD CONSTRAINT "data_source_files_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_template_version_id_organization_id_fkey" FOREIGN KEY ("template_version_id", "organization_id") REFERENCES "template_versions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_target_dataset_id_organization_id_fkey" FOREIGN KEY ("target_dataset_id", "organization_id") REFERENCES "datasets"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_source_file_id_organization_id_fkey" FOREIGN KEY ("source_file_id", "organization_id") REFERENCES "data_source_files"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_mapping_profile_id_organization_id_fkey" FOREIGN KEY ("mapping_profile_id", "organization_id") REFERENCES "mapping_profiles"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_customer_id_organization_id_fkey" FOREIGN KEY ("customer_id", "organization_id") REFERENCES "customers"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_versions" ADD CONSTRAINT "dataset_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dataset_versions" ADD CONSTRAINT "dataset_versions_dataset_id_organization_id_fkey" FOREIGN KEY ("dataset_id", "organization_id") REFERENCES "datasets"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dataset_versions" ADD CONSTRAINT "dataset_versions_import_id_organization_id_fkey" FOREIGN KEY ("import_id", "organization_id") REFERENCES "data_imports"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dataset_versions" ADD CONSTRAINT "dataset_versions_template_version_id_organization_id_fkey" FOREIGN KEY ("template_version_id", "organization_id") REFERENCES "template_versions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dataset_versions" ADD CONSTRAINT "dataset_versions_source_file_id_organization_id_fkey" FOREIGN KEY ("source_file_id", "organization_id") REFERENCES "data_source_files"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dataset_versions" ADD CONSTRAINT "dataset_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_versions" ADD CONSTRAINT "dataset_versions_finalized_by_id_fkey" FOREIGN KEY ("finalized_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_records" ADD CONSTRAINT "dataset_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dataset_records" ADD CONSTRAINT "dataset_records_dataset_version_id_organization_id_fkey" FOREIGN KEY ("dataset_version_id", "organization_id") REFERENCES "dataset_versions"("id", "organization_id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "mapping_profiles" ADD CONSTRAINT "mapping_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "mapping_profiles" ADD CONSTRAINT "mapping_profiles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapping_profiles" ADD CONSTRAINT "mapping_profiles_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapping_profile_revisions" ADD CONSTRAINT "mapping_profile_revisions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "mapping_profile_revisions" ADD CONSTRAINT "mapping_profile_revisions_profile_id_organization_id_fkey" FOREIGN KEY ("profile_id", "organization_id") REFERENCES "mapping_profiles"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "mapping_profile_revisions" ADD CONSTRAINT "mapping_profile_revisions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
