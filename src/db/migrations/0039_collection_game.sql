CREATE TABLE IF NOT EXISTS game_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    collection_id INTEGER NOT NULL,
    session_data TEXT NOT NULL,
    finished INTEGER NOT NULL DEFAULT 0 CHECK (finished IN (0, 1)),
    xp_awarded INTEGER NOT NULL DEFAULT 0 CHECK (xp_awarded IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (collection_id) REFERENCES word_collections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_game_sessions_user_expires ON game_sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_game_sessions_collection ON game_sessions(collection_id, expires_at);

CREATE TABLE IF NOT EXISTS word_visual_cache (
    word_id INTEGER PRIMARY KEY,
    visual_type TEXT NOT NULL CHECK (visual_type IN ('emoji', 'emoji_combo', 'image_url', 'fallback', 'manual')),
    visual_value TEXT NOT NULL,
    source TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_word_visual_cache_source ON word_visual_cache(source, updated_at);
