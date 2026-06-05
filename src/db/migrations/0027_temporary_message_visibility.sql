CREATE TABLE IF NOT EXISTS temporary_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    word_id INTEGER,
    text TEXT,
    delete_policy TEXT NOT NULL DEFAULT 'after_ttl'
        CHECK (delete_policy IN ('after_ttl', 'after_next_interaction', 'after_seen_or_ttl')),
    seen_after_interaction INTEGER NOT NULL DEFAULT 0,
    min_visible_until TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_temporary_messages_user_policy ON temporary_messages(user_id, delete_policy, min_visible_until);
CREATE INDEX IF NOT EXISTS idx_temporary_messages_expires ON temporary_messages(delete_policy, expires_at);
CREATE INDEX IF NOT EXISTS idx_temporary_messages_kind ON temporary_messages(user_id, chat_id, kind);
