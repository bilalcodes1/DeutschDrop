-- Migration number: 0033_csv_example_ar
-- 1. Add example_ar column to csv_import_items
ALTER TABLE csv_import_items ADD COLUMN example_ar TEXT;
