CREATE TABLE IF NOT EXISTS tts_last_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    word_id INTEGER,
    text TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, chat_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tts_last_messages_expires ON tts_last_messages(expires_at);
