PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS bot_sessions_new (
    session_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('learn', 'train', 'add_word', 'word_edit', 'challenge', 'register', 'rename', 'support_proof', 'admin_broadcast', 'admin_announcement', 'admin_source', 'csv_update', 'word_selection', 'word_search', 'ai_word', 'train_explain')),
    data TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO bot_sessions_new (session_id, user_id, type, data, expires_at, created_at)
SELECT session_id, user_id, type, data, expires_at, created_at
FROM bot_sessions
WHERE type IN ('learn', 'train', 'add_word', 'word_edit', 'challenge', 'register', 'rename', 'support_proof', 'admin_broadcast', 'admin_announcement', 'admin_source', 'csv_update', 'word_selection', 'word_search', 'ai_word', 'train_explain');

DROP TABLE bot_sessions;
ALTER TABLE bot_sessions_new RENAME TO bot_sessions;

PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_bot_sessions_user_type ON bot_sessions(user_id, type);
CREATE INDEX IF NOT EXISTS idx_bot_sessions_expires_at ON bot_sessions(expires_at);
