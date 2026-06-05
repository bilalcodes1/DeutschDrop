CREATE TABLE IF NOT EXISTS word_audio_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    provider TEXT NOT NULL,
    telegram_file_id TEXT,
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, word_id, text, provider),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_word_audio_cache_lookup
ON word_audio_cache(user_id, word_id, provider, content_hash);

CREATE INDEX IF NOT EXISTS idx_word_audio_cache_user_created
ON word_audio_cache(user_id, provider, created_at);
