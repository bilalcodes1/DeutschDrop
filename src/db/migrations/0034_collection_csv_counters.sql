ALTER TABLE csv_import_jobs ADD COLUMN linked_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE csv_import_jobs ADD COLUMN skipped_in_collection_count INTEGER NOT NULL DEFAULT 0;
