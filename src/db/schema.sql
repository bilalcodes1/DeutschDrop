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
    onboarding_seen INTEGER DEFAULT 0 CHECK (onboarding_seen IN (0, 1)),
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
    german_search TEXT,
    arabic_search TEXT,
    example_search TEXT,
    image_fingerprint TEXT,
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
    format TEXT,
    api_key_hash TEXT,
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

CREATE TABLE IF NOT EXISTS word_visual_cache (
    word_id INTEGER PRIMARY KEY,
    visual_type TEXT NOT NULL CHECK (visual_type IN ('emoji', 'emoji_combo', 'image_url', 'fallback', 'manual')),
    visual_value TEXT NOT NULL,
    source TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS global_word_visuals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    normalized_key TEXT UNIQUE NOT NULL,
    german TEXT,
    arabic TEXT,
    visual_emoji TEXT NOT NULL,
    source TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1,
    created_by_user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

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
    -- Session type validation is handled in application code to avoid D1 migrations for every new flow.
    type TEXT NOT NULL,
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
    challenge_source_type TEXT,
    challenge_source_id TEXT,
    challenge_word_origin_json TEXT,
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

-- 30. tts_last_messages
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

-- 31. temporary_messages
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

-- 32. word_collections
CREATE TABLE IF NOT EXISTS word_collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
    source_label TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
    FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS word_collection_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    owner_user_id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(collection_id, word_id),
    FOREIGN KEY (collection_id) REFERENCES word_collections(id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS game_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    collection_id INTEGER NOT NULL,
    session_data TEXT NOT NULL,
    finished INTEGER NOT NULL DEFAULT 0 CHECK (finished IN (0, 1)),
    xp_awarded INTEGER NOT NULL DEFAULT 0 CHECK (xp_awarded IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (collection_id) REFERENCES word_collections(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS game_challenges (
    challenge_id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_user_id INTEGER NOT NULL,
    opponent_user_id INTEGER NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('mine', 'opponent', 'mixed')),
    collection_id INTEGER,
    collection_title TEXT,
    word_ids_json TEXT NOT NULL,
    question_count INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'expired', 'cancelled')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    completed_at TEXT,
    creator_session_hash TEXT,
    opponent_session_hash TEXT,
    creator_score INTEGER NOT NULL DEFAULT 0,
    opponent_score INTEGER NOT NULL DEFAULT 0,
    creator_completed_words INTEGER NOT NULL DEFAULT 0,
    opponent_completed_words INTEGER NOT NULL DEFAULT 0,
    creator_height_meters INTEGER NOT NULL DEFAULT 0,
    opponent_height_meters INTEGER NOT NULL DEFAULT 0,
    creator_duration_ms INTEGER,
    opponent_duration_ms INTEGER,
    creator_xp_gained INTEGER NOT NULL DEFAULT 0,
    opponent_xp_gained INTEGER NOT NULL DEFAULT 0,
    winner_user_id INTEGER,
    created_by_session TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (opponent_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (collection_id) REFERENCES word_collections(id) ON DELETE SET NULL,
    FOREIGN KEY (winner_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS shared_word_offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_user_id INTEGER NOT NULL,
    receiver_user_id INTEGER NOT NULL,
    offer_type TEXT NOT NULL CHECK (offer_type IN ('word', 'words', 'collection')),
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'ignored', 'expired')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (receiver_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 20. job_runs (Cron job state tracking)
CREATE TABLE IF NOT EXISTS job_runs (
    job_name TEXT PRIMARY KEY,
    last_run DATETIME,
    status TEXT CHECK (status IN ('success', 'failed'))
);

CREATE TABLE IF NOT EXISTS bot_message_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id) ON DELETE CASCADE
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_word_collection_items_collection_word ON word_collection_items(collection_id, word_id);
CREATE INDEX IF NOT EXISTS idx_word_collection_items_owner_collection ON word_collection_items(owner_user_id, collection_id);
CREATE INDEX IF NOT EXISTS idx_word_audio_cache_lookup ON word_audio_cache(user_id, word_id, provider, content_hash);
CREATE INDEX IF NOT EXISTS idx_word_audio_cache_user_created ON word_audio_cache(user_id, provider, created_at);
CREATE INDEX IF NOT EXISTS idx_word_audio_cache_provider_language_voice ON word_audio_cache(provider, language, voice, format);
CREATE INDEX IF NOT EXISTS idx_word_audio_cache_provider_key_created ON word_audio_cache(provider, api_key_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_words_user_german_search ON words(added_by, german_search);
CREATE INDEX IF NOT EXISTS idx_words_user_arabic_search ON words(added_by, arabic_search);
CREATE INDEX IF NOT EXISTS idx_tts_last_messages_expires ON tts_last_messages(expires_at);
CREATE INDEX IF NOT EXISTS idx_temporary_messages_user_policy ON temporary_messages(user_id, delete_policy, min_visible_until);
CREATE INDEX IF NOT EXISTS idx_temporary_messages_expires ON temporary_messages(delete_policy, expires_at);
CREATE INDEX IF NOT EXISTS idx_temporary_messages_kind ON temporary_messages(user_id, chat_id, kind);
CREATE INDEX IF NOT EXISTS idx_word_collections_owner ON word_collections(owner_user_id, is_deleted, updated_at);
CREATE INDEX IF NOT EXISTS idx_word_collections_public ON word_collections(visibility, is_deleted, updated_at);
CREATE INDEX IF NOT EXISTS idx_word_collection_items_collection ON word_collection_items(collection_id, position);
CREATE INDEX IF NOT EXISTS idx_game_sessions_user_expires ON game_sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_game_sessions_collection ON game_sessions(collection_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_word_visual_cache_source ON word_visual_cache(source, updated_at);
CREATE INDEX IF NOT EXISTS idx_global_word_visuals_updated ON global_word_visuals(updated_at);
CREATE INDEX IF NOT EXISTS idx_global_word_visuals_source ON global_word_visuals(source, confidence);
CREATE INDEX IF NOT EXISTS idx_game_challenges_users_status ON game_challenges(creator_user_id, opponent_user_id, status);
CREATE INDEX IF NOT EXISTS idx_game_challenges_opponent_status ON game_challenges(opponent_user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_game_challenges_sessions ON game_challenges(creator_session_hash, opponent_session_hash);
CREATE INDEX IF NOT EXISTS idx_game_challenges_expires ON game_challenges(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_shared_word_offers_receiver ON shared_word_offers(receiver_user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_shared_word_offers_cooldown ON shared_word_offers(sender_user_id, receiver_user_id, offer_type, created_at);
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
CREATE INDEX IF NOT EXISTS idx_bot_message_log_telegram_created ON bot_message_log(telegram_id, created_at);

-- =====================================================
-- Goethe Training & Challenge System
-- =====================================================

CREATE TABLE IF NOT EXISTS goethe_sources (
    source_id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_key TEXT NOT NULL UNIQUE,
    source_name TEXT NOT NULL,
    publisher TEXT,
    source_year INTEGER,
    model_number TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    default_level TEXT,
    description TEXT,
    pack_sha256 TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('importing', 'active', 'disabled', 'failed')),
    rights_confirmed INTEGER NOT NULL DEFAULT 0,
    question_count INTEGER NOT NULL DEFAULT 0,
    audio_count INTEGER NOT NULL DEFAULT 0,
    imported_by_user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activated_at TEXT,
    disabled_at TEXT,
    FOREIGN KEY (imported_by_user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS goethe_questions (
    question_id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    external_id TEXT NOT NULL,
    level TEXT NOT NULL,
    section TEXT NOT NULL,
    format TEXT NOT NULL,
    scenario_type TEXT NOT NULL,
    audio_r2_key TEXT,
    audio_sha256 TEXT,
    audio_size_bytes INTEGER,
    audio_mime_type TEXT,
    telegram_file_id TEXT,
    instruction TEXT,
    question_text TEXT NOT NULL,
    correct_answer TEXT NOT NULL,
    accepted_answers_json TEXT,
    transcript TEXT,
    explanation TEXT,
    difficulty INTEGER NOT NULL,
    tags_json TEXT,
    time_limit_seconds INTEGER,
    points INTEGER NOT NULL DEFAULT 10,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_id, external_id),
    FOREIGN KEY (source_id) REFERENCES goethe_sources(source_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS goethe_question_options (
    option_id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    option_key TEXT NOT NULL,
    option_text TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    UNIQUE(question_id, option_key),
    FOREIGN KEY (question_id) REFERENCES goethe_questions(question_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS goethe_import_jobs (
    job_id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER NOT NULL,
    telegram_chat_id INTEGER NOT NULL,
    telegram_file_id TEXT NOT NULL,
    telegram_file_name TEXT NOT NULL,
    telegram_file_size INTEGER,
    zip_r2_key TEXT,
    pack_sha256 TEXT,
    source_id INTEGER,
    status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    phase TEXT NOT NULL,
    progress_current INTEGER NOT NULL DEFAULT 0,
    progress_total INTEGER NOT NULL DEFAULT 0,
    questions_found INTEGER NOT NULL DEFAULT 0,
    audio_files_found INTEGER NOT NULL DEFAULT 0,
    questions_imported INTEGER NOT NULL DEFAULT 0,
    audio_files_uploaded INTEGER NOT NULL DEFAULT 0,
    progress_message_id INTEGER,
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    summary_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    finished_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_user_id) REFERENCES users(user_id),
    FOREIGN KEY (source_id) REFERENCES goethe_sources(source_id)
);

CREATE TABLE IF NOT EXISTS goethe_import_errors (
    error_id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    row_number INTEGER,
    file_name TEXT,
    error_code TEXT NOT NULL,
    error_message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES goethe_import_jobs(job_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS goethe_sessions (
    session_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    mode TEXT NOT NULL,
    level TEXT NOT NULL,
    section TEXT,
    scenario_type TEXT,
    source_id INTEGER,
    status TEXT NOT NULL CHECK(status IN ('active', 'finished', 'expired', 'cancelled')),
    total_questions INTEGER NOT NULL,
    current_position INTEGER NOT NULL DEFAULT 0,
    correct_count INTEGER NOT NULL DEFAULT 0,
    wrong_count INTEGER NOT NULL DEFAULT 0,
    score INTEGER NOT NULL DEFAULT 0,
    xp_awarded INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (source_id) REFERENCES goethe_sources(source_id)
);

CREATE TABLE IF NOT EXISTS goethe_session_questions (
    session_question_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    deadline_at TEXT,
    answered INTEGER NOT NULL DEFAULT 0,
    is_correct INTEGER,
    selected_answer TEXT,
    response_time_ms INTEGER,
    answered_at TEXT,
    UNIQUE(session_id, position),
    UNIQUE(session_id, question_id),
    FOREIGN KEY (session_id) REFERENCES goethe_sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES goethe_questions(question_id)
);

CREATE TABLE IF NOT EXISTS goethe_attempts (
    attempt_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    session_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    mode TEXT NOT NULL,
    selected_answer TEXT,
    correct_answer TEXT NOT NULL,
    is_correct INTEGER NOT NULL,
    response_time_ms INTEGER,
    points_awarded INTEGER NOT NULL DEFAULT 0,
    xp_awarded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (session_id) REFERENCES goethe_sessions(session_id),
    FOREIGN KEY (question_id) REFERENCES goethe_questions(question_id)
);

CREATE TABLE IF NOT EXISTS goethe_user_question_stats (
    user_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    correct_attempts INTEGER NOT NULL DEFAULT 0,
    wrong_attempts INTEGER NOT NULL DEFAULT 0,
    weakness_score INTEGER NOT NULL DEFAULT 0,
    last_result INTEGER,
    last_attempt_at TEXT,
    last_correct_at TEXT,
    average_response_ms INTEGER,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, question_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (question_id) REFERENCES goethe_questions(question_id)
);

CREATE INDEX IF NOT EXISTS idx_goethe_questions_active_level ON goethe_questions(is_active, level);
CREATE INDEX IF NOT EXISTS idx_goethe_questions_active_level_section ON goethe_questions(is_active, level, section);
CREATE INDEX IF NOT EXISTS idx_goethe_questions_active_level_scenario ON goethe_questions(is_active, level, scenario_type);
CREATE INDEX IF NOT EXISTS idx_goethe_questions_active_level_difficulty ON goethe_questions(is_active, level, difficulty);
CREATE INDEX IF NOT EXISTS idx_goethe_questions_source_active ON goethe_questions(source_id, is_active);
CREATE INDEX IF NOT EXISTS idx_goethe_options_question ON goethe_question_options(question_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_goethe_attempts_user_created ON goethe_attempts(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_goethe_attempts_user_question ON goethe_attempts(user_id, question_id);
CREATE INDEX IF NOT EXISTS idx_goethe_stats_user_weakness ON goethe_user_question_stats(user_id, weakness_score);
CREATE INDEX IF NOT EXISTS idx_goethe_stats_user_last_attempt ON goethe_user_question_stats(user_id, last_attempt_at);
CREATE INDEX IF NOT EXISTS idx_goethe_import_jobs_status_created ON goethe_import_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_goethe_sessions_user_status ON goethe_sessions(user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_goethe_session_questions_current ON goethe_session_questions(session_id, position, answered);

-- =====================================================
-- Word Images for DeutschDrop Adventure
-- =====================================================

CREATE TABLE IF NOT EXISTS image_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER,
    provider TEXT NOT NULL CHECK (provider IN ('legacy', 'pexels', 'pixabay', 'unsplash', 'manual_upload', 'user_library')),
    provider_image_id TEXT,
    storage_type TEXT NOT NULL CHECK (storage_type IN ('r2', 'hotlink', 'legacy', 'telegram')),
    r2_key TEXT,
    hotlink_url TEXT,
    preview_url TEXT,
    source_page_url TEXT,
    photographer_name TEXT,
    photographer_url TEXT,
    attribution_text TEXT,
    download_tracking_url TEXT,
    search_query TEXT,
    width INTEGER,
    height INTEGER,
    mime_type TEXT,
    file_size INTEGER,
    sha256 TEXT,
    telegram_file_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared', 'global')),
    source_asset_id INTEGER,
    published_at TEXT,
    reusable INTEGER NOT NULL DEFAULT 0 CHECK (reusable IN (0, 1)),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted', 'orphaned')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_word_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    collection_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    image_asset_id INTEGER,
    state TEXT NOT NULL DEFAULT 'selected' CHECK (state IN ('selected', 'excluded', 'deleted')),
    excluded_reason TEXT,
    origin_type TEXT NOT NULL DEFAULT 'user_selected'
        CHECK (origin_type IN ('user_selected', 'copied_word', 'copied_collection', 'admin_default', 'community_shared', 'legacy_default')),
    origin_user_id INTEGER,
    origin_share_type TEXT,
    origin_share_id INTEGER,
    is_user_override INTEGER NOT NULL DEFAULT 1 CHECK (is_user_override IN (0, 1)),
    inherited_at TEXT,
    selected_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (collection_id) REFERENCES word_collections(id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE CASCADE,
    FOREIGN KEY (image_asset_id) REFERENCES image_assets(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_word_images_one_active
ON user_word_images(user_id, collection_id, word_id)
WHERE deleted_at IS NULL AND state IN ('selected', 'excluded');

CREATE TABLE IF NOT EXISTS user_word_default_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    image_asset_id INTEGER,
    state TEXT NOT NULL DEFAULT 'selected' CHECK (state IN ('selected', 'excluded', 'deleted')),
    origin_type TEXT NOT NULL DEFAULT 'user_selected'
        CHECK (origin_type IN ('user_selected', 'copied_word', 'copied_collection', 'admin_default', 'community_shared', 'legacy_default')),
    origin_user_id INTEGER,
    origin_share_type TEXT,
    origin_share_id INTEGER,
    is_user_override INTEGER NOT NULL DEFAULT 1 CHECK (is_user_override IN (0, 1)),
    inherited_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE CASCADE,
    FOREIGN KEY (image_asset_id) REFERENCES image_assets(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_word_default_images_one_active
ON user_word_default_images(user_id, word_id)
WHERE deleted_at IS NULL AND state IN ('selected', 'excluded');

CREATE TABLE IF NOT EXISTS word_image_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL,
    image_asset_id INTEGER NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('admin', 'community_shared', 'legacy')),
    source_user_id INTEGER,
    source_word_id INTEGER,
    source_collection_id INTEGER,
    source_share_type TEXT,
    source_share_id INTEGER,
    priority INTEGER NOT NULL DEFAULT 0,
    usage_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (image_asset_id) REFERENCES image_assets(id) ON DELETE CASCADE,
    FOREIGN KEY (source_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
    FOREIGN KEY (source_word_id) REFERENCES words(word_id) ON DELETE SET NULL,
    FOREIGN KEY (source_collection_id) REFERENCES word_collections(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_word_image_catalog_admin_active
ON word_image_catalog(fingerprint)
WHERE source_type = 'admin' AND status = 'active' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS shared_word_image_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_type TEXT NOT NULL CHECK (share_type IN ('word', 'collection', 'offer')),
    share_id INTEGER NOT NULL,
    source_user_id INTEGER NOT NULL,
    source_collection_id INTEGER,
    source_word_id INTEGER NOT NULL,
    fingerprint TEXT,
    image_asset_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (source_collection_id) REFERENCES word_collections(id) ON DELETE SET NULL,
    FOREIGN KEY (source_word_id) REFERENCES words(word_id) ON DELETE CASCADE,
    FOREIGN KEY (image_asset_id) REFERENCES image_assets(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_word_image_snapshots_unique
ON shared_word_image_snapshots(share_type, share_id, source_word_id);

CREATE TABLE IF NOT EXISTS word_image_backfill_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    cursor_user_id INTEGER NOT NULL DEFAULT 0,
    cursor_word_id INTEGER NOT NULL DEFAULT 0,
    added_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    retries INTEGER NOT NULL DEFAULT 0,
    notify_users INTEGER NOT NULL DEFAULT 1 CHECK (notify_users IN (0, 1)),
    created_by_admin_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS word_image_backfill_user_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    added_count INTEGER NOT NULL DEFAULT 0,
    notified_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES word_image_backfill_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE(job_id, user_id)
);

CREATE TABLE IF NOT EXISTS image_search_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    query_hash TEXT NOT NULL,
    search_query TEXT NOT NULL,
    page INTEGER NOT NULL DEFAULT 1,
    orientation TEXT,
    results_json TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_word_images_collection_state ON user_word_images(user_id, collection_id, state);
CREATE INDEX IF NOT EXISTS idx_user_word_images_word ON user_word_images(user_id, collection_id, word_id);
CREATE INDEX IF NOT EXISTS idx_user_word_images_cleanup ON user_word_images(deleted_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_words_image_fingerprint ON words(image_fingerprint);
CREATE INDEX IF NOT EXISTS idx_image_assets_owner ON image_assets(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_image_assets_provider_image ON image_assets(provider, provider_image_id);
CREATE INDEX IF NOT EXISTS idx_image_assets_status ON image_assets(status);
CREATE INDEX IF NOT EXISTS idx_image_assets_cleanup ON image_assets(status, deleted_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_image_assets_visibility ON image_assets(visibility, status);
CREATE INDEX IF NOT EXISTS idx_word_image_catalog_lookup ON word_image_catalog(fingerprint, status, source_type, priority, updated_at);
CREATE INDEX IF NOT EXISTS idx_shared_word_image_snapshots_share ON shared_word_image_snapshots(share_type, share_id);
CREATE INDEX IF NOT EXISTS idx_word_image_backfill_jobs_status ON word_image_backfill_jobs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_image_search_cache_lookup ON image_search_cache(query_hash, provider, page);
CREATE INDEX IF NOT EXISTS idx_image_search_cache_expires ON image_search_cache(expires_at);

CREATE TABLE IF NOT EXISTS adventure_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    world TEXT NOT NULL,
    stage INTEGER NOT NULL,
    stars INTEGER NOT NULL DEFAULT 0,
    best_score INTEGER NOT NULL DEFAULT 0,
    boss_defeated INTEGER NOT NULL DEFAULT 0,
    reward_key TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE(user_id, world, stage)
);

CREATE TABLE IF NOT EXISTS adventure_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    reward_key TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT,
    xp_awarded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE(user_id, reward_key)
);

CREATE INDEX IF NOT EXISTS idx_adventure_progress_user ON adventure_progress(user_id, world, stage);
CREATE INDEX IF NOT EXISTS idx_adventure_rewards_user ON adventure_rewards(user_id, created_at);

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
