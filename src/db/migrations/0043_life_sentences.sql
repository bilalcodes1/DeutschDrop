-- Deutsch aus deinem Leben / الألمانية من حياتك

CREATE TABLE IF NOT EXISTS life_sentences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('bot_ai', 'external_chatgpt', 'manual')),
    original_arabic TEXT NOT NULL,
    german_text TEXT NOT NULL,
    arabic_text TEXT NOT NULL,
    pronunciation_ar TEXT,
    memory_hint TEXT,
    level TEXT NOT NULL DEFAULT 'A1' CHECK(level IN ('A1', 'A2', 'B1')),
    tense TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
    difficulty TEXT NOT NULL DEFAULT 'medium' CHECK(difficulty IN ('easy', 'medium', 'hard')),
    review_count INTEGER NOT NULL DEFAULT 0,
    correct_count INTEGER NOT NULL DEFAULT 0,
    wrong_count INTEGER NOT NULL DEFAULT 0,
    ease_factor REAL NOT NULL DEFAULT 2.5,
    interval INTEGER NOT NULL DEFAULT 0,
    repetitions INTEGER NOT NULL DEFAULT 0,
    last_reviewed_at TEXT,
    next_review_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS life_sentence_keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    life_sentence_id INTEGER NOT NULL,
    german_word TEXT NOT NULL,
    arabic_meaning TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (life_sentence_id) REFERENCES life_sentences(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS life_daily_gate (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    gate_date TEXT NOT NULL,
    life_sentence_id INTEGER,
    completed_at TEXT,
    remind_after_at TEXT,
    reminder_sent_count INTEGER NOT NULL DEFAULT 0,
    reminder_skipped_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, gate_date),
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (life_sentence_id) REFERENCES life_sentences(id)
);

CREATE TABLE IF NOT EXISTS life_user_settings (
    user_id INTEGER PRIMARY KEY,
    gate_enabled INTEGER NOT NULL DEFAULT 1,
    reminders_enabled INTEGER NOT NULL DEFAULT 1,
    reminder_time TEXT NOT NULL DEFAULT '20:00',
    timezone TEXT NOT NULL DEFAULT 'Asia/Baghdad',
    target_level TEXT NOT NULL DEFAULT 'A1',
    reminder_days TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7',
    onboarding_seen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_life_sentences_user_status ON life_sentences(user_id, status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_life_sentences_user_next_review ON life_sentences(user_id, next_review_at, status);
CREATE INDEX IF NOT EXISTS idx_life_sentences_user_created ON life_sentences(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_life_sentence_keywords_sentence ON life_sentence_keywords(life_sentence_id);
CREATE INDEX IF NOT EXISTS idx_life_daily_gate_user_date ON life_daily_gate(user_id, gate_date);
CREATE INDEX IF NOT EXISTS idx_life_daily_gate_remind ON life_daily_gate(remind_after_at);
