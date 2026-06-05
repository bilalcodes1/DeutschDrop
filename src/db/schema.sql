-- =====================================================
-- DeutschDrop Database Schema
-- Cloudflare D1 (SQLite)
-- 16 tables, normalized, ready for multi-user scaling
-- =====================================================

-- 1. users
CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    id INTEGER,
    name TEXT NOT NULL,
    telegram_id INTEGER NOT NULL UNIQUE,
    telegram_user_id INTEGER UNIQUE,
    telegram_username TEXT,
    display_name TEXT,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    streak INTEGER DEFAULT 0,
    is_banned INTEGER DEFAULT 0 CHECK (is_banned IN (0, 1)),
    is_deleted INTEGER DEFAULT 0 CHECK (is_deleted IN (0, 1)),
    deleted_at DATETIME,
    last_active_at DATETIME,
    identity TEXT CHECK (identity IN ('bilal', 'malak')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. settings
CREATE TABLE IF NOT EXISTS settings (
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

-- 3. words
CREATE TABLE IF NOT EXISTS words (
    word_id INTEGER PRIMARY KEY AUTOINCREMENT,
    german TEXT NOT NULL,
    arabic TEXT NOT NULL,
    example TEXT,
    example_ar TEXT DEFAULT NULL,
    pronunciation_ar TEXT DEFAULT NULL,
    pronunciation_latin TEXT DEFAULT NULL,
    level TEXT DEFAULT NULL,
    added_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME,
    FOREIGN KEY (added_by) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 4. word_audio
CREATE TABLE IF NOT EXISTS word_audio (
    word_id INTEGER PRIMARY KEY,
    audio_url TEXT,
    generated_at DATETIME,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS word_audio_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    provider TEXT NOT NULL,
    telegram_file_id TEXT,
    content_hash TEXT NOT NULL,
    language TEXT,
    voice TEXT,
    model TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, word_id, text, provider),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tts_request_locks (
    lock_key TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4.1. word_pictograms
CREATE TABLE IF NOT EXISTS word_pictograms (
    word_id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL,
    pictogram_id TEXT NOT NULL,
    image_url TEXT NOT NULL,
    thumbnail_url TEXT NOT NULL,
    title TEXT NOT NULL,
    license TEXT NOT NULL,
    attribution TEXT NOT NULL,
    source_url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_word_pictograms_word_id ON word_pictograms(word_id);

-- 5. user_uploaded_lists
CREATE TABLE IF NOT EXISTS user_uploaded_lists (
    list_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 5.1. list_words (many-to-many between lists and words)
CREATE TABLE IF NOT EXISTS list_words (
    list_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (list_id, word_id),
    FOREIGN KEY (list_id) REFERENCES user_uploaded_lists(list_id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE CASCADE
);

-- 6. user_words (SRS state per user per word)
CREATE TABLE IF NOT EXISTS user_words (
    user_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    status TEXT DEFAULT 'new' CHECK (status IN ('new', 'learning', 'reviewing', 'mastered')),
    ease_factor REAL DEFAULT 2.5,
    interval INTEGER DEFAULT 0,
    repetitions INTEGER DEFAULT 0,
    next_review DATETIME,
    correct_count INTEGER DEFAULT 0,
    wrong_count INTEGER DEFAULT 0,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, word_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE CASCADE
);

-- 7. reviews
CREATE TABLE IF NOT EXISTS reviews (
    review_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
    response_time_ms INTEGER,
    difficulty_rating TEXT CHECK (difficulty_rating IN ('easy', 'medium', 'hard')),
    reviewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE CASCADE
);

-- 8. xp_log
CREATE TABLE IF NOT EXISTS xp_log (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS xp_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 9. achievement_definitions
CREATE TABLE IF NOT EXISTS achievement_definitions (
    definition_id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT,
    required_value INTEGER NOT NULL
);

-- 10. user_achievements
CREATE TABLE IF NOT EXISTS user_achievements (
    user_id INTEGER NOT NULL,
    achievement_id INTEGER NOT NULL,
    unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, achievement_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (achievement_id) REFERENCES achievement_definitions(definition_id) ON DELETE CASCADE
);

-- 11. daily_streaks
CREATE TABLE IF NOT EXISTS daily_streaks (
    user_id INTEGER PRIMARY KEY,
    current_streak INTEGER DEFAULT 0,
    last_active_date DATE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 12. daily_summaries
CREATE TABLE IF NOT EXISTS daily_summaries (
    user_id INTEGER NOT NULL,
    summary_date DATE NOT NULL,
    words_learned INTEGER DEFAULT 0,
    xp_earned INTEGER DEFAULT 0,
    train_questions INTEGER DEFAULT 0,
    sent_at DATETIME,
    PRIMARY KEY (user_id, summary_date),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 13. competitions
CREATE TABLE IF NOT EXISTS competitions (
    competition_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a INTEGER NOT NULL,
    user_b INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
    FOREIGN KEY (user_a) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (user_b) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 14. competition_events
CREATE TABLE IF NOT EXISTS competition_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    competition_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (competition_id) REFERENCES competitions(competition_id) ON DELETE CASCADE
);

-- 15. competition_leaderboard_snapshot
CREATE TABLE IF NOT EXISTS competition_leaderboard_snapshot (
    snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
    competition_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    xp_at_snapshot INTEGER NOT NULL,
    words_learned_at_snapshot INTEGER NOT NULL,
    streak_at_snapshot INTEGER NOT NULL,
    snapshot_date DATE NOT NULL,
    FOREIGN KEY (competition_id) REFERENCES competitions(competition_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 16. bot_sessions (persistent Telegram interaction state)
CREATE TABLE IF NOT EXISTS bot_sessions (
    session_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('learn', 'train', 'add_word', 'word_edit', 'challenge', 'register', 'rename', 'profile_rename', 'support_proof', 'admin_broadcast', 'admin_announcement', 'admin_source', 'admin_source_add', 'admin_source_edit', 'admin_private_message', 'admin_confirm', 'csv_update', 'word_selection', 'word_search', 'ai_word', 'train_explain')),
    data TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

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
    level TEXT NOT NULL CHECK (level IN ('A1', 'A2', 'B1', 'General')),
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_by_admin_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by_admin_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- 17. async_challenges
CREATE TABLE IF NOT EXISTS async_challenges (
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

-- 18. challenge_questions
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

-- 19. daily_tasks
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

-- 21. support_requests
CREATE TABLE IF NOT EXISTS support_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 22. support_proofs
CREATE TABLE IF NOT EXISTS support_proofs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    method TEXT,
    amount TEXT,
    message TEXT,
    file_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by_admin_id INTEGER,
    reviewed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 23. user_support_status
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

-- 24. broadcast_logs
CREATE TABLE IF NOT EXISTS broadcast_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 25. bot_announcements
CREATE TABLE IF NOT EXISTS bot_announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_by_admin_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by_admin_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 26. notification_logs
CREATE TABLE IF NOT EXISTS notification_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 27. notification_events
CREATE TABLE IF NOT EXISTS notification_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    word_id INTEGER,
    prompt_type TEXT,
    selected_reason TEXT,
    question_type TEXT,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    responded_at DATETIME,
    response TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE SET NULL
);

-- 28. ai_cache
CREATE TABLE IF NOT EXISTS ai_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_type TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(task_type, input_hash)
);

-- 29. ai_usage
CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    usage_date TEXT NOT NULL,
    task_type TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, usage_date, task_type),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 20. job_runs (Cron job state tracking)
CREATE TABLE IF NOT EXISTS job_runs (
    job_name TEXT PRIMARY KEY,
    last_run DATETIME,
    status TEXT CHECK (status IN ('success', 'failed'))
);

-- =====================================================
-- Indexes for performance
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_user_words_next_review ON user_words(next_review);
CREATE INDEX IF NOT EXISTS idx_user_words_status ON user_words(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_user_id ON users(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_word_id ON reviews(word_id);
CREATE INDEX IF NOT EXISTS idx_xp_log_user_id ON xp_log(user_id);
CREATE INDEX IF NOT EXISTS idx_xp_events_user_created ON xp_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_competitions_active ON competitions(is_active);
CREATE INDEX IF NOT EXISTS idx_competition_events_comp_id ON competition_events(competition_id);
CREATE INDEX IF NOT EXISTS idx_list_words_list_id ON list_words(list_id);
CREATE INDEX IF NOT EXISTS idx_list_words_word_id ON list_words(word_id);
CREATE INDEX IF NOT EXISTS idx_words_added_by ON words(added_by);
CREATE INDEX IF NOT EXISTS idx_bot_sessions_user_type ON bot_sessions(user_id, type);
CREATE INDEX IF NOT EXISTS idx_bot_sessions_expires_at ON bot_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_word_audio_cache_lookup ON word_audio_cache(user_id, word_id, provider, content_hash);
CREATE INDEX IF NOT EXISTS idx_word_audio_cache_user_created ON word_audio_cache(user_id, provider, created_at);
CREATE INDEX IF NOT EXISTS idx_tts_request_locks_expires ON tts_request_locks(expires_at);
CREATE INDEX IF NOT EXISTS idx_async_challenges_status ON async_challenges(status);
CREATE INDEX IF NOT EXISTS idx_async_challenges_users ON async_challenges(creator_user_id, opponent_user_id);
CREATE INDEX IF NOT EXISTS idx_async_challenges_expires ON async_challenges(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_daily_tasks_user_date ON daily_tasks(user_id, task_date);
CREATE INDEX IF NOT EXISTS idx_support_requests_user_id ON support_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_support_proofs_user_id ON support_proofs(user_id);
CREATE INDEX IF NOT EXISTS idx_support_proofs_status ON support_proofs(status);
CREATE INDEX IF NOT EXISTS idx_user_support_status_active ON user_support_status(is_supporter, supporter_until);
CREATE INDEX IF NOT EXISTS idx_bot_announcements_active ON bot_announcements(is_active, updated_at);
CREATE INDEX IF NOT EXISTS idx_notification_logs_user_type_time ON notification_logs(user_id, type, sent_at);
CREATE INDEX IF NOT EXISTS idx_notification_events_user_sent ON notification_events(user_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_notification_events_user_word_sent ON notification_events(user_id, word_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_daily_review_plans_user_active ON daily_review_plans(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_leaderboard_snapshots_period ON leaderboard_snapshots(period_type, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_learning_sources_level_active ON learning_sources(level, is_active);

-- =====================================================
-- Seed: Default achievement definitions
-- =====================================================

INSERT OR IGNORE INTO achievement_definitions (key, name, description, icon, required_value) VALUES
('first_50_words', 'أول 50 كلمة', 'تعلمت 50 كلمة ألمانية', '📚', 50),
('first_100_words', 'أول 100 كلمة', 'تعلمت 100 كلمة ألمانية', '📖', 100),
('first_500_words', 'أول 500 كلمة', 'تعلمت 500 كلمة ألمانية', '🏆', 500),
('train_100', '100 سؤال صحيح', 'أجبت على 100 سؤال بشكل صحيح', '🎯', 100),
('train_500', '500 سؤال صحيح', 'أجبت على 500 سؤال بشكل صحيح', '🎖️', 500),
('streak_7', '7 أيام متواصلة', 'تعلمت 7 أيام متتالية', '🔥', 7),
('streak_30', '30 يوم متواصلة', 'تعلمت 30 يوماً متتالياً', '⚡', 30),
('streak_100', '100 يوم متواصلة', 'تعلمت 100 يوماً متتالياً', '👑', 100),
('first_word', 'أول كلمة', 'أضفت أول كلمة ألمانية', '🌱', 1),
('first_csv', 'أول ملف CSV', 'استوردت أول ملف CSV', '📤', 1),
('correct_streak_20', '20 إجابة صحيحة متتالية', 'حققت 20 إجابة صحيحة متتالية', '⚡', 20),
('first_challenge_win', 'أول فوز بتحدي', 'فزت بأول تحدي', '⚔️', 1);
