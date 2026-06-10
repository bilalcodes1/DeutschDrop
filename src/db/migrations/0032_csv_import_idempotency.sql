-- Migration number: 0032_csv_import_idempotency
-- 1. Add telegram_file_unique_id column to csv_import_jobs
ALTER TABLE csv_import_jobs ADD COLUMN telegram_file_unique_id TEXT;

-- 2. Create index for idempotency check
CREATE INDEX idx_csv_import_jobs_idempotency ON csv_import_jobs(user_id, telegram_file_unique_id);
