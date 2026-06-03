ALTER TABLE settings ADD COLUMN reminders_enabled INTEGER DEFAULT 1 CHECK (reminders_enabled IN (0, 1));
ALTER TABLE settings ADD COLUMN competition_notifications_enabled INTEGER DEFAULT 1 CHECK (competition_notifications_enabled IN (0, 1));

CREATE TABLE IF NOT EXISTS bot_sessions_new (
    session_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('learn', 'train', 'add_word', 'challenge')),
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

CREATE TABLE IF NOT EXISTS async_challenges (
    challenge_id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_user_id INTEGER NOT NULL,
    opponent_user_id INTEGER NOT NULL,
    question_count INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'creator_pending' CHECK (status IN ('creator_pending', 'opponent_pending', 'completed')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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

CREATE TABLE IF NOT EXISTS challenge_questions (
    challenge_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    prompt TEXT NOT NULL,
    answer TEXT NOT NULL,
    options TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('de_ar', 'ar_de')),
    position INTEGER NOT NULL,
    PRIMARY KEY (challenge_id, position),
    FOREIGN KEY (challenge_id) REFERENCES async_challenges(challenge_id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS daily_tasks (
    user_id INTEGER NOT NULL,
    task_date DATE NOT NULL,
    task_type TEXT NOT NULL CHECK (task_type IN ('learn_words', 'review_words', 'complete_training')),
    target INTEGER NOT NULL,
    progress INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0 CHECK (completed IN (0, 1)),
    xp_awarded INTEGER DEFAULT 0 CHECK (xp_awarded IN (0, 1)),
    PRIMARY KEY (user_id, task_date, task_type),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_async_challenges_status ON async_challenges(status);
CREATE INDEX IF NOT EXISTS idx_async_challenges_users ON async_challenges(creator_user_id, opponent_user_id);
CREATE INDEX IF NOT EXISTS idx_daily_tasks_user_date ON daily_tasks(user_id, task_date);

INSERT OR IGNORE INTO achievement_definitions (key, name, description, icon, required_value) VALUES
('first_word', 'أول كلمة', 'أضفت أول كلمة ألمانية', '🌱', 1),
('first_csv', 'أول ملف CSV', 'استوردت أول ملف CSV', '📤', 1),
('correct_streak_20', '20 إجابة صحيحة متتالية', 'حققت 20 إجابة صحيحة متتالية', '⚡', 20),
('first_challenge_win', 'أول فوز بتحدي', 'فزت بأول تحدي', '⚔️', 1);
