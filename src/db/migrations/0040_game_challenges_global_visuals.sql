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

CREATE INDEX IF NOT EXISTS idx_global_word_visuals_updated ON global_word_visuals(updated_at);
CREATE INDEX IF NOT EXISTS idx_global_word_visuals_source ON global_word_visuals(source, confidence);

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

CREATE INDEX IF NOT EXISTS idx_game_challenges_users_status ON game_challenges(creator_user_id, opponent_user_id, status);
CREATE INDEX IF NOT EXISTS idx_game_challenges_opponent_status ON game_challenges(opponent_user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_game_challenges_sessions ON game_challenges(creator_session_hash, opponent_session_hash);
CREATE INDEX IF NOT EXISTS idx_game_challenges_expires ON game_challenges(status, expires_at);
