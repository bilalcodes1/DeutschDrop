ALTER TABLE support_proofs ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE support_proofs ADD COLUMN reviewed_by_admin_id INTEGER;
ALTER TABLE support_proofs ADD COLUMN reviewed_at DATETIME;

CREATE TABLE IF NOT EXISTS user_support_status (
    user_id INTEGER PRIMARY KEY,
    is_supporter INTEGER NOT NULL DEFAULT 0 CHECK (is_supporter IN (0, 1)),
    supporter_until DATETIME,
    last_confirmed_by_admin_id INTEGER,
    last_support_proof_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (last_support_proof_id) REFERENCES support_proofs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS broadcast_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_support_proofs_status ON support_proofs(status);
CREATE INDEX IF NOT EXISTS idx_user_support_status_active ON user_support_status(is_supporter, supporter_until);

CREATE TABLE IF NOT EXISTS bot_sessions_new (
    session_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('learn', 'train', 'add_word', 'challenge', 'register', 'rename', 'support_proof', 'admin_broadcast')),
    data TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

INSERT OR REPLACE INTO bot_sessions_new (session_id, user_id, type, data, expires_at, created_at)
SELECT session_id, user_id, type, data, expires_at, created_at FROM bot_sessions;

DROP TABLE bot_sessions;
ALTER TABLE bot_sessions_new RENAME TO bot_sessions;
CREATE INDEX IF NOT EXISTS idx_bot_sessions_user_type ON bot_sessions(user_id, type);
CREATE INDEX IF NOT EXISTS idx_bot_sessions_expires_at ON bot_sessions(expires_at);
