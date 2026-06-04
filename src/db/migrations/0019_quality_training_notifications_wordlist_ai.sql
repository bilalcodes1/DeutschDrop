-- AI quality, adaptive training stats, notification metadata, and word list hardening.
-- Safe for D1: additive only, no data deletion.

ALTER TABLE words ADD COLUMN pronunciation_latin TEXT DEFAULT NULL;
ALTER TABLE words ADD COLUMN updated_at DATETIME;

CREATE TABLE IF NOT EXISTS word_learning_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    seen_count INTEGER DEFAULT 0,
    correct_count INTEGER DEFAULT 0,
    wrong_count INTEGER DEFAULT 0,
    lapse_count INTEGER DEFAULT 0,
    consecutive_correct INTEGER DEFAULT 0,
    consecutive_wrong INTEGER DEFAULT 0,
    last_seen_at TEXT,
    last_correct_at TEXT,
    last_wrong_at TEXT,
    last_question_type TEXT,
    ease_factor REAL DEFAULT 2.5,
    stability REAL DEFAULT 0,
    difficulty_score REAL DEFAULT 0,
    retrievability REAL DEFAULT 1,
    is_hard INTEGER DEFAULT 0,
    hard_reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, word_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE CASCADE
);

ALTER TABLE notification_events ADD COLUMN prompt_type TEXT;
ALTER TABLE notification_events ADD COLUMN selected_reason TEXT;
ALTER TABLE notification_events ADD COLUMN question_type TEXT;

CREATE INDEX IF NOT EXISTS idx_word_learning_stats_user_word ON word_learning_stats(user_id, word_id);
CREATE INDEX IF NOT EXISTS idx_word_learning_stats_user_hard ON word_learning_stats(user_id, is_hard);
CREATE INDEX IF NOT EXISTS idx_word_learning_stats_user_difficulty ON word_learning_stats(user_id, difficulty_score);
CREATE INDEX IF NOT EXISTS idx_words_user_next_review ON user_words(user_id, next_review);
CREATE INDEX IF NOT EXISTS idx_words_added_by_created ON words(added_by, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_events_user_word_created ON notification_events(user_id, word_id, sent_at);
