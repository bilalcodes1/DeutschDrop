-- Migration number: 0037_daily_quests
-- Create daily_quests table for Bronze, Silver, Gold tiers

CREATE TABLE IF NOT EXISTS daily_quests (
    quest_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    quest_date TEXT NOT NULL,
    tier TEXT NOT NULL CHECK(tier IN ('bronze', 'silver', 'gold')),
    quest_type TEXT NOT NULL,
    target_value INTEGER NOT NULL,
    current_progress INTEGER DEFAULT 0,
    reward_xp INTEGER NOT NULL,
    is_completed INTEGER DEFAULT 0 CHECK (is_completed IN (0, 1)),
    is_claimed INTEGER DEFAULT 0 CHECK (is_claimed IN (0, 1)),
    completed_at TEXT,
    claimed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_quests_user_date_tier ON daily_quests(user_id, quest_date, tier);
CREATE INDEX IF NOT EXISTS idx_daily_quests_user_date ON daily_quests(user_id, quest_date);
CREATE INDEX IF NOT EXISTS idx_daily_quests_user_claimed ON daily_quests(user_id, is_claimed);
