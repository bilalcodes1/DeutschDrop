ALTER TABLE users ADD COLUMN is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1));
ALTER TABLE users ADD COLUMN deleted_at DATETIME;
ALTER TABLE users ADD COLUMN last_active_at DATETIME;

ALTER TABLE async_challenges ADD COLUMN expires_at DATETIME;

CREATE TABLE IF NOT EXISTS async_challenges_new (
    challenge_id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_user_id INTEGER NOT NULL,
    opponent_user_id INTEGER NOT NULL,
    question_count INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting_opponent' CHECK (status IN ('waiting_opponent', 'in_progress', 'completed', 'expired', 'cancelled')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    completed_at DATETIME,
    creator_score INTEGER DEFAULT 0,
    opponent_score INTEGER DEFAULT 0,
    creator_time_ms INTEGER,
    opponent_time_ms INTEGER,
    winner_user_id INTEGER,
    FOREIGN KEY (creator_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (opponent_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (winner_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

INSERT OR REPLACE INTO async_challenges_new (
    challenge_id, creator_user_id, opponent_user_id, question_count, status, created_at, expires_at,
    completed_at, creator_score, opponent_score, creator_time_ms, opponent_time_ms, winner_user_id
)
SELECT challenge_id,
       creator_user_id,
       opponent_user_id,
       question_count,
       CASE
           WHEN status = 'completed' THEN 'completed'
           WHEN status IN ('creator_pending', 'opponent_pending') THEN 'waiting_opponent'
           ELSE status
       END,
       created_at,
       COALESCE(expires_at, datetime(created_at, '+24 hours')),
       completed_at,
       creator_score,
       opponent_score,
       creator_time_ms,
       opponent_time_ms,
       winner_user_id
FROM async_challenges;

DROP TABLE async_challenges;
ALTER TABLE async_challenges_new RENAME TO async_challenges;
CREATE INDEX IF NOT EXISTS idx_async_challenges_status ON async_challenges(status);
CREATE INDEX IF NOT EXISTS idx_async_challenges_users ON async_challenges(creator_user_id, opponent_user_id);

CREATE TABLE IF NOT EXISTS admin_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER NOT NULL,
    target_user_id INTEGER,
    action_type TEXT NOT NULL,
    details_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (target_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_users_deleted_active ON users(is_deleted, last_active_at);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target ON admin_actions(target_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_async_challenges_expires ON async_challenges(status, expires_at);

CREATE TABLE IF NOT EXISTS learning_sources_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('A1', 'A2', 'B1', 'General')),
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_by_admin_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by_admin_id) REFERENCES users(user_id) ON DELETE SET NULL
);

INSERT OR REPLACE INTO learning_sources_new (id, title, url, level, description, is_active, created_by_admin_id, created_at, updated_at)
SELECT id, title, url, level, description, is_active, created_by_admin_id, created_at, updated_at FROM learning_sources;

DROP TABLE learning_sources;
ALTER TABLE learning_sources_new RENAME TO learning_sources;
CREATE INDEX IF NOT EXISTS idx_learning_sources_level_active ON learning_sources(level, is_active);

CREATE TABLE IF NOT EXISTS bot_sessions_new (
    session_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('learn', 'train', 'add_word', 'word_edit', 'challenge', 'register', 'rename', 'profile_rename', 'support_proof', 'admin_broadcast', 'admin_announcement', 'admin_source', 'admin_source_add', 'admin_source_edit', 'admin_private_message', 'admin_confirm', 'csv_update', 'word_selection', 'word_search', 'ai_word', 'train_explain')),
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
