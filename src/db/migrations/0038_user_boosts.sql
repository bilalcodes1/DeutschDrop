-- Migration number: 0038_user_boosts
-- XP boosts are time-based multipliers for explicitly boost-eligible XP only.

ALTER TABLE xp_transactions ADD COLUMN cap_base_amount INTEGER DEFAULT 0;

UPDATE xp_transactions
SET cap_base_amount = final_amount
WHERE daily_cap_eligible = 1
  AND (cap_base_amount IS NULL OR cap_base_amount = 0);

CREATE TABLE IF NOT EXISTS user_boosts (
  boost_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  multiplier REAL NOT NULL,
  starts_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_type TEXT,
  source_id TEXT,
  is_consumed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_boosts_user_expires
ON user_boosts(user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_user_boosts_user_consumed
ON user_boosts(user_id, is_consumed);

CREATE INDEX IF NOT EXISTS idx_xp_transactions_user_cap_date
ON xp_transactions(user_id, daily_cap_eligible, created_at);
