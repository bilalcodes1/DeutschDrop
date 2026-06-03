ALTER TABLE users ADD COLUMN id INTEGER;
ALTER TABLE users ADD COLUMN telegram_user_id INTEGER;
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name TEXT;
ALTER TABLE users ADD COLUMN xp INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN level INTEGER DEFAULT 1;
ALTER TABLE users ADD COLUMN streak INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN updated_at DATETIME;

UPDATE users
SET id = user_id,
    telegram_user_id = telegram_id,
    display_name = COALESCE(display_name, name),
    username = COALESCE(username, telegram_username),
    first_name = COALESCE(first_name, name),
    xp = COALESCE(xp, 0),
    level = COALESCE(level, 1),
    streak = COALESCE(streak, 0),
    updated_at = COALESCE(updated_at, created_at, datetime('now'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_user_id ON users(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name);

CREATE TABLE IF NOT EXISTS bot_sessions_new (
    session_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('learn', 'train', 'add_word', 'challenge', 'register', 'rename')),
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
