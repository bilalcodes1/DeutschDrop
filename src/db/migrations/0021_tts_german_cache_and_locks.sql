ALTER TABLE word_audio_cache ADD COLUMN language TEXT;
ALTER TABLE word_audio_cache ADD COLUMN voice TEXT;
ALTER TABLE word_audio_cache ADD COLUMN model TEXT;

CREATE TABLE IF NOT EXISTS tts_request_locks (
    lock_key TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tts_request_locks_expires
ON tts_request_locks(expires_at);
