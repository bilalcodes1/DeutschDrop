PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS settings_new (
    user_id INTEGER PRIMARY KEY,
    daily_goal INTEGER DEFAULT 10,
    new_words_per_day INTEGER DEFAULT 10,
    german_level TEXT CHECK (german_level IN ('A1', 'A2', 'B1')),
    notification_mode TEXT DEFAULT 'normal' CHECK (notification_mode IN ('light', 'normal', 'intensive', 'custom', 'off')),
    notification_interval_hours INTEGER,
    review_plan TEXT DEFAULT 'none' CHECK (review_plan IN ('none', 'all_words_day', 'all_words_week')),
    notification_batch_size INTEGER DEFAULT 10,
    morning_time TEXT DEFAULT '08:00',
    afternoon_time TEXT DEFAULT '15:00',
    evening_time TEXT DEFAULT '18:00',
    reminders_enabled INTEGER DEFAULT 1 CHECK (reminders_enabled IN (0, 1)),
    notification_intensity TEXT DEFAULT 'normal' CHECK (notification_intensity IN ('light', 'normal', 'intensive', 'custom', 'off')),
    notification_timezone TEXT DEFAULT 'Asia/Baghdad',
    last_notification_at DATETIME,
    last_notified_word_id INTEGER,
    competition_notifications_enabled INTEGER DEFAULT 1 CHECK (competition_notifications_enabled IN (0, 1)),
    leaderboard_notifications_enabled INTEGER DEFAULT 1 CHECK (leaderboard_notifications_enabled IN (0, 1)),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO settings_new (
    user_id,
    daily_goal,
    new_words_per_day,
    german_level,
    notification_mode,
    notification_interval_hours,
    review_plan,
    notification_batch_size,
    morning_time,
    afternoon_time,
    evening_time,
    reminders_enabled,
    notification_intensity,
    notification_timezone,
    last_notification_at,
    last_notified_word_id,
    competition_notifications_enabled,
    leaderboard_notifications_enabled
)
SELECT
    user_id,
    COALESCE(daily_goal, 10),
    COALESCE(new_words_per_day, 10),
    NULL,
    CASE
        WHEN notification_intensity IN ('light', 'normal', 'intensive', 'off') THEN notification_intensity
        WHEN notification_mode = 'morning' THEN 'light'
        WHEN notification_mode = 'morning_evening' THEN 'normal'
        WHEN notification_mode = 'all_day' THEN 'intensive'
        ELSE 'normal'
    END,
    NULL,
    'none',
    10,
    COALESCE(morning_time, '08:00'),
    COALESCE(afternoon_time, '15:00'),
    COALESCE(evening_time, '18:00'),
    COALESCE(reminders_enabled, 1),
    CASE
        WHEN notification_intensity IN ('light', 'normal', 'intensive', 'off') THEN notification_intensity
        ELSE 'normal'
    END,
    COALESCE(notification_timezone, 'Asia/Baghdad'),
    last_notification_at,
    NULL,
    COALESCE(competition_notifications_enabled, 1),
    1
FROM settings;

DROP TABLE settings;
ALTER TABLE settings_new RENAME TO settings;

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

CREATE TABLE IF NOT EXISTS xp_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO xp_events (id, user_id, amount, reason, created_at)
SELECT log_id, user_id, amount, reason, created_at FROM xp_log;

CREATE TABLE IF NOT EXISTS daily_review_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    plan_type TEXT NOT NULL CHECK (plan_type IN ('all_words_day', 'all_words_week')),
    total_words INTEGER NOT NULL,
    reviewed_words INTEGER NOT NULL DEFAULT 0,
    batch_size INTEGER NOT NULL DEFAULT 10,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ends_at DATETIME NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly')),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    winner_user_id INTEGER,
    winner_xp INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(period_type, period_start, period_end),
    FOREIGN KEY (winner_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS learning_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('A1', 'A2', 'B1')),
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_by_admin_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by_admin_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_xp_events_user_created ON xp_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bot_sessions_user_type ON bot_sessions(user_id, type);
CREATE INDEX IF NOT EXISTS idx_bot_sessions_expires_at ON bot_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_daily_review_plans_user_active ON daily_review_plans(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_leaderboard_snapshots_period ON leaderboard_snapshots(period_type, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_learning_sources_level_active ON learning_sources(level, is_active);

INSERT OR IGNORE INTO learning_sources (title, url, level, description) VALUES
('DW Nicos Weg A1', 'https://learngerman.dw.com/ar/nicos-weg/c-47993645', 'A1', 'دروس منظمة للمبتدئين مع فيديو وتمارين.'),
('DW Nicos Weg A2', 'https://learngerman.dw.com/ar/nicos-weg/c-47993645', 'A2', 'تكملة عملية بعد أساسيات A1.'),
('Deutsche Welle B1', 'https://learngerman.dw.com/ar/learn-german/s-2469', 'B1', 'تمارين ومواد قراءة واستماع للمستوى المتوسط.');
