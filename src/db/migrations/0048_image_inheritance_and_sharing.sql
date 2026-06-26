-- Image inheritance, sharing snapshots, and safe catalog.
-- The selected image binary remains in R2/hotlink/legacy storage; copies reference
-- the same image asset only through authorized mappings.

ALTER TABLE words ADD COLUMN image_fingerprint TEXT;

ALTER TABLE image_assets ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared', 'global'));
ALTER TABLE image_assets ADD COLUMN source_asset_id INTEGER;
ALTER TABLE image_assets ADD COLUMN published_at TEXT;
ALTER TABLE image_assets ADD COLUMN reusable INTEGER NOT NULL DEFAULT 0 CHECK (reusable IN (0, 1));

ALTER TABLE user_word_images ADD COLUMN origin_type TEXT NOT NULL DEFAULT 'user_selected'
    CHECK (origin_type IN ('user_selected', 'copied_word', 'copied_collection', 'admin_default', 'community_shared', 'legacy_default'));
ALTER TABLE user_word_images ADD COLUMN origin_user_id INTEGER;
ALTER TABLE user_word_images ADD COLUMN origin_share_type TEXT;
ALTER TABLE user_word_images ADD COLUMN origin_share_id INTEGER;
ALTER TABLE user_word_images ADD COLUMN is_user_override INTEGER NOT NULL DEFAULT 1 CHECK (is_user_override IN (0, 1));
ALTER TABLE user_word_images ADD COLUMN inherited_at TEXT;

CREATE TABLE IF NOT EXISTS user_word_default_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    image_asset_id INTEGER,
    state TEXT NOT NULL DEFAULT 'selected' CHECK (state IN ('selected', 'excluded', 'deleted')),
    origin_type TEXT NOT NULL DEFAULT 'user_selected'
        CHECK (origin_type IN ('user_selected', 'copied_word', 'copied_collection', 'admin_default', 'community_shared', 'legacy_default')),
    origin_user_id INTEGER,
    origin_share_type TEXT,
    origin_share_id INTEGER,
    is_user_override INTEGER NOT NULL DEFAULT 1 CHECK (is_user_override IN (0, 1)),
    inherited_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE CASCADE,
    FOREIGN KEY (image_asset_id) REFERENCES image_assets(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_word_default_images_one_active
ON user_word_default_images(user_id, word_id)
WHERE deleted_at IS NULL AND state IN ('selected', 'excluded');

CREATE INDEX IF NOT EXISTS idx_user_word_default_images_word_state
ON user_word_default_images(user_id, word_id, state);

CREATE TABLE IF NOT EXISTS word_image_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL,
    image_asset_id INTEGER NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('admin', 'community_shared', 'legacy')),
    source_user_id INTEGER,
    source_word_id INTEGER,
    source_collection_id INTEGER,
    source_share_type TEXT,
    source_share_id INTEGER,
    priority INTEGER NOT NULL DEFAULT 0,
    usage_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (image_asset_id) REFERENCES image_assets(id) ON DELETE CASCADE,
    FOREIGN KEY (source_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
    FOREIGN KEY (source_word_id) REFERENCES words(word_id) ON DELETE SET NULL,
    FOREIGN KEY (source_collection_id) REFERENCES word_collections(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_word_image_catalog_admin_active
ON word_image_catalog(fingerprint)
WHERE source_type = 'admin' AND status = 'active' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_word_image_catalog_lookup
ON word_image_catalog(fingerprint, status, source_type, priority, updated_at);

CREATE TABLE IF NOT EXISTS shared_word_image_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_type TEXT NOT NULL CHECK (share_type IN ('word', 'collection', 'offer')),
    share_id INTEGER NOT NULL,
    source_user_id INTEGER NOT NULL,
    source_collection_id INTEGER,
    source_word_id INTEGER NOT NULL,
    fingerprint TEXT,
    image_asset_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (source_collection_id) REFERENCES word_collections(id) ON DELETE SET NULL,
    FOREIGN KEY (source_word_id) REFERENCES words(word_id) ON DELETE CASCADE,
    FOREIGN KEY (image_asset_id) REFERENCES image_assets(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_word_image_snapshots_unique
ON shared_word_image_snapshots(share_type, share_id, source_word_id);

CREATE INDEX IF NOT EXISTS idx_shared_word_image_snapshots_share
ON shared_word_image_snapshots(share_type, share_id);

CREATE TABLE IF NOT EXISTS word_image_backfill_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    cursor_user_id INTEGER NOT NULL DEFAULT 0,
    cursor_word_id INTEGER NOT NULL DEFAULT 0,
    added_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    retries INTEGER NOT NULL DEFAULT 0,
    notify_users INTEGER NOT NULL DEFAULT 1 CHECK (notify_users IN (0, 1)),
    created_by_admin_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS word_image_backfill_user_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    added_count INTEGER NOT NULL DEFAULT 0,
    notified_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES word_image_backfill_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE(job_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_words_image_fingerprint ON words(image_fingerprint);
CREATE INDEX IF NOT EXISTS idx_image_assets_visibility ON image_assets(visibility, status);
CREATE INDEX IF NOT EXISTS idx_image_assets_source_asset ON image_assets(source_asset_id);
CREATE INDEX IF NOT EXISTS idx_user_word_images_origin ON user_word_images(origin_type, origin_user_id);
CREATE INDEX IF NOT EXISTS idx_word_image_backfill_jobs_status ON word_image_backfill_jobs(status, updated_at);
