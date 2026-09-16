-- CreateEnum
CREATE TYPE "production_job_status" AS ENUM ('DRAFT', 'QUEUED', 'EXPANDING', 'VALIDATING', 'READY', 'READY_WITH_WARNINGS', 'HAS_ERRORS', 'RELEASED', 'READY_FOR_RENDERING', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "production_instance_status" AS ENUM ('VALID', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "production_mode" AS ENUM ('PRODUCTION', 'NON_PRODUCTION');

-- CreateEnum
CREATE TYPE "sequence_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "sequence_reset_policy" AS ENUM ('NEVER');

-- CreateEnum
CREATE TYPE "production_artifact_kind" AS ENUM ('MANIFEST');

-- AlterEnum
ALTER TYPE "role" ADD VALUE 'PRODUCTION_MANAGER';

-- CreateTable
CREATE TABLE "sequences" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "prefix" VARCHAR(16) NOT NULL DEFAULT '',
    "suffix" VARCHAR(16) NOT NULL DEFAULT '',
    "padding" INTEGER NOT NULL DEFAULT 0,
    "next_value" BIGINT NOT NULL DEFAULT 1,
    "reset_policy" "sequence_reset_policy" NOT NULL DEFAULT 'NEVER',
    "status" "sequence_status" NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_reservations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "sequence_id" UUID NOT NULL,
    "production_job_id" UUID NOT NULL,
    "start_value" BIGINT NOT NULL,
    "end_value" BIGINT NOT NULL,
    "value_count" INTEGER NOT NULL,
    "reserved_by_id" UUID NOT NULL,
    "reserved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sequence_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_job_counters" (
    "organization_id" UUID NOT NULL,
    "day" CHAR(10) NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "production_job_counters_pkey" PRIMARY KEY ("organization_id","day")
);

-- CreateTable
CREATE TABLE "production_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "job_number" VARCHAR(32) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "customer_id" UUID,
    "brand_id" UUID,
    "template_id" UUID NOT NULL,
    "template_version_id" UUID NOT NULL,
    "template_version_hash" CHAR(64) NOT NULL,
    "template_schema_version" INTEGER NOT NULL,
    "data_schema_hash" CHAR(64) NOT NULL,
    "dataset_id" UUID NOT NULL,
    "dataset_version_id" UUID NOT NULL,
    "dataset_hash" CHAR(64) NOT NULL,
    "status" "production_job_status" NOT NULL DEFAULT 'DRAFT',
    "production_mode" "production_mode" NOT NULL DEFAULT 'PRODUCTION',
    "configuration" JSONB NOT NULL,
    "record_selection_hash" CHAR(64),
    "sequence_id" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "expansion_run" INTEGER NOT NULL DEFAULT 0,
    "release_run" INTEGER NOT NULL DEFAULT 0,
    "record_count" INTEGER NOT NULL DEFAULT 0,
    "instance_count" INTEGER NOT NULL DEFAULT 0,
    "valid_count" INTEGER NOT NULL DEFAULT 0,
    "warning_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "source_warning_count" INTEGER NOT NULL DEFAULT 0,
    "instances_digest" CHAR(64),
    "production_job_hash" CHAR(64),
    "versions" JSONB NOT NULL DEFAULT '{}',
    "validation_summary" JSONB NOT NULL DEFAULT '{}',
    "progress_phase" VARCHAR(32),
    "progress_processed" INTEGER NOT NULL DEFAULT 0,
    "progress_total" INTEGER,
    "progress_updated_at" TIMESTAMPTZ(3),
    "failure" JSONB,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "warnings_acknowledged_by_id" UUID,
    "warnings_acknowledged_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "expanded_at" TIMESTAMPTZ(3),
    "released_by_id" UUID,
    "released_at" TIMESTAMPTZ(3),
    "ready_for_rendering_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),

    CONSTRAINT "production_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_instances" (
    "production_job_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "organization_id" UUID NOT NULL,
    "dataset_record_sequence" INTEGER NOT NULL,
    "source_row_number" INTEGER NOT NULL,
    "copy_index" INTEGER NOT NULL,
    "copies" INTEGER NOT NULL,
    "serial_offset" INTEGER,
    "serial_value" VARCHAR(64),
    "status" "production_instance_status" NOT NULL,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "warning_count" INTEGER NOT NULL DEFAULT 0,
    "source_warning_count" INTEGER NOT NULL DEFAULT 0,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "resolved_input_hash" CHAR(64),
    "instance_hash" CHAR(64),

    CONSTRAINT "production_instances_pkey" PRIMARY KEY ("production_job_id","sequence")
);

-- CreateTable
CREATE TABLE "production_artifacts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "production_job_id" UUID NOT NULL,
    "kind" "production_artifact_kind" NOT NULL,
    "storage_key" VARCHAR(512) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum_sha256" CHAR(64) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_job_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "production_job_id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "message" VARCHAR(500) NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_job_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sequences_organization_id_status_name_idx" ON "sequences"("organization_id", "status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sequences_organization_id_code_key" ON "sequences"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sequences_organization_id_name_key" ON "sequences"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sequences_id_organization_id_key" ON "sequences"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_reservations_production_job_id_key" ON "sequence_reservations"("production_job_id");

-- CreateIndex
CREATE INDEX "sequence_reservations_sequence_id_start_value_idx" ON "sequence_reservations"("sequence_id", "start_value");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_reservations_id_organization_id_key" ON "sequence_reservations"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_reservations_production_job_id_organization_id_key" ON "sequence_reservations"("production_job_id", "organization_id");

-- CreateIndex
CREATE INDEX "production_jobs_organization_id_status_created_at_idx" ON "production_jobs"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "production_jobs_organization_id_created_at_idx" ON "production_jobs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "production_jobs_dataset_version_id_idx" ON "production_jobs"("dataset_version_id");

-- CreateIndex
CREATE INDEX "production_jobs_template_version_id_idx" ON "production_jobs"("template_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_jobs_organization_id_job_number_key" ON "production_jobs"("organization_id", "job_number");

-- CreateIndex
CREATE UNIQUE INDEX "production_jobs_id_organization_id_key" ON "production_jobs"("id", "organization_id");

-- CreateIndex
CREATE INDEX "production_instances_production_job_id_status_sequence_idx" ON "production_instances"("production_job_id", "status", "sequence");

-- CreateIndex
CREATE INDEX "production_instances_production_job_id_dataset_record_seque_idx" ON "production_instances"("production_job_id", "dataset_record_sequence", "copy_index");

-- CreateIndex
CREATE UNIQUE INDEX "production_artifacts_production_job_id_kind_key" ON "production_artifacts"("production_job_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "production_artifacts_id_organization_id_key" ON "production_artifacts"("id", "organization_id");

-- CreateIndex
CREATE INDEX "production_job_events_production_job_id_created_at_idx" ON "production_job_events"("production_job_id", "created_at");

-- AddForeignKey
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_reservations" ADD CONSTRAINT "sequence_reservations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sequence_reservations" ADD CONSTRAINT "sequence_reservations_sequence_id_organization_id_fkey" FOREIGN KEY ("sequence_id", "organization_id") REFERENCES "sequences"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sequence_reservations" ADD CONSTRAINT "sequence_reservations_production_job_id_organization_id_fkey" FOREIGN KEY ("production_job_id", "organization_id") REFERENCES "production_jobs"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sequence_reservations" ADD CONSTRAINT "sequence_reservations_reserved_by_id_fkey" FOREIGN KEY ("reserved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_job_counters" ADD CONSTRAINT "production_job_counters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_customer_id_organization_id_fkey" FOREIGN KEY ("customer_id", "organization_id") REFERENCES "customers"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_brand_id_customer_id_organization_id_fkey" FOREIGN KEY ("brand_id", "customer_id", "organization_id") REFERENCES "brands"("id", "customer_id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_template_id_organization_id_fkey" FOREIGN KEY ("template_id", "organization_id") REFERENCES "templates"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_template_version_id_organization_id_fkey" FOREIGN KEY ("template_version_id", "organization_id") REFERENCES "template_versions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_dataset_id_organization_id_fkey" FOREIGN KEY ("dataset_id", "organization_id") REFERENCES "datasets"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_dataset_version_id_organization_id_fkey" FOREIGN KEY ("dataset_version_id", "organization_id") REFERENCES "dataset_versions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_sequence_id_organization_id_fkey" FOREIGN KEY ("sequence_id", "organization_id") REFERENCES "sequences"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_released_by_id_fkey" FOREIGN KEY ("released_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_warnings_acknowledged_by_id_fkey" FOREIGN KEY ("warnings_acknowledged_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_instances" ADD CONSTRAINT "production_instances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_instances" ADD CONSTRAINT "production_instances_production_job_id_organization_id_fkey" FOREIGN KEY ("production_job_id", "organization_id") REFERENCES "production_jobs"("id", "organization_id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_artifacts" ADD CONSTRAINT "production_artifacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_artifacts" ADD CONSTRAINT "production_artifacts_production_job_id_organization_id_fkey" FOREIGN KEY ("production_job_id", "organization_id") REFERENCES "production_jobs"("id", "organization_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_artifacts" ADD CONSTRAINT "production_artifacts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_job_events" ADD CONSTRAINT "production_job_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_job_events" ADD CONSTRAINT "production_job_events_production_job_id_organization_id_fkey" FOREIGN KEY ("production_job_id", "organization_id") REFERENCES "production_jobs"("id", "organization_id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_job_events" ADD CONSTRAINT "production_job_events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
