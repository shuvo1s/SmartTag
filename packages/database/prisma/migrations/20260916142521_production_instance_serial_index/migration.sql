-- CreateIndex
CREATE INDEX "production_instances_serial_idx" ON "production_instances"("production_job_id", "serial_value" varchar_pattern_ops);
