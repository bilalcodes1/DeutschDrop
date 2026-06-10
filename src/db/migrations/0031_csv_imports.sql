-- 0002_csv_imports.sql

CREATE TABLE IF NOT EXISTS csv_import_jobs (
    job_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    collection_id INTEGER,
    list_id INTEGER,
    total_rows INTEGER NOT NULL,
    processed_rows INTEGER DEFAULT 0,
    imported_count INTEGER DEFAULT 0,
    duplicate_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    telegram_chat_id INTEGER NOT NULL,
    telegram_message_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS csv_import_items (
    item_id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    row_number INTEGER NOT NULL,
    german TEXT NOT NULL,
    arabic TEXT NOT NULL,
    example TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'imported', 'duplicate', 'error')),
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    FOREIGN KEY (job_id) REFERENCES csv_import_jobs(job_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_csv_import_items_pending ON csv_import_items(job_id, status);
CREATE INDEX IF NOT EXISTS idx_csv_import_jobs_status ON csv_import_jobs(status);
