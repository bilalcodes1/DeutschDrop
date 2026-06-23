CREATE TABLE IF NOT EXISTS image_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER,
    provider TEXT NOT NULL CHECK (provider IN ('legacy', 'pexels', 'pixabay', 'unsplash', 'manual_upload', 'user_library')),
    provider_image_id TEXT,
    storage_type TEXT NOT NULL CHECK (storage_type IN ('r2', 'hotlink', 'legacy', 'telegram')),
    r2_key TEXT,
    hotlink_url TEXT,
    preview_url TEXT,
    source_page_url TEXT,
    photographer_name TEXT,
    photographer_url TEXT,
    attribution_text TEXT,
    download_tracking_url TEXT,
    search_query TEXT,
    width INTEGER,
    height INTEGER,
    mime_type TEXT,
    file_size INTEGER,
    sha256 TEXT,
    telegram_file_id TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted', 'orphaned')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_word_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    collection_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    image_asset_id INTEGER,
    state TEXT NOT NULL DEFAULT 'selected' CHECK (state IN ('selected', 'excluded', 'deleted')),
    excluded_reason TEXT,
    selected_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (collection_id) REFERENCES word_collections(id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE CASCADE,
    FOREIGN KEY (image_asset_id) REFERENCES image_assets(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_word_images_one_active
ON user_word_images(user_id, collection_id, word_id)
WHERE deleted_at IS NULL AND state IN ('selected', 'excluded');

CREATE TABLE IF NOT EXISTS image_search_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    query_hash TEXT NOT NULL,
    search_query TEXT NOT NULL,
    page INTEGER NOT NULL DEFAULT 1,
    orientation TEXT,
    results_json TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_word_images_collection_state
ON user_word_images(user_id, collection_id, state);

CREATE INDEX IF NOT EXISTS idx_user_word_images_word
ON user_word_images(user_id, collection_id, word_id);

CREATE INDEX IF NOT EXISTS idx_user_word_images_cleanup
ON user_word_images(deleted_at, updated_at);

CREATE INDEX IF NOT EXISTS idx_image_assets_owner
ON image_assets(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_image_assets_provider_image
ON image_assets(provider, provider_image_id);

CREATE INDEX IF NOT EXISTS idx_image_assets_status
ON image_assets(status);

CREATE INDEX IF NOT EXISTS idx_image_assets_cleanup
ON image_assets(status, deleted_at, updated_at);

CREATE INDEX IF NOT EXISTS idx_image_search_cache_lookup
ON image_search_cache(query_hash, provider, page);

CREATE INDEX IF NOT EXISTS idx_image_search_cache_expires
ON image_search_cache(expires_at);

CREATE TABLE IF NOT EXISTS adventure_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    world TEXT NOT NULL,
    stage INTEGER NOT NULL,
    stars INTEGER NOT NULL DEFAULT 0,
    best_score INTEGER NOT NULL DEFAULT 0,
    boss_defeated INTEGER NOT NULL DEFAULT 0,
    reward_key TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE(user_id, world, stage)
);

CREATE TABLE IF NOT EXISTS adventure_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    reward_key TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT,
    xp_awarded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE(user_id, reward_key)
);

CREATE INDEX IF NOT EXISTS idx_adventure_progress_user
ON adventure_progress(user_id, world, stage);

CREATE INDEX IF NOT EXISTS idx_adventure_rewards_user
ON adventure_rewards(user_id, created_at);
