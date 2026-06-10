-- Migration number: 0036_xp_transactions
-- 1. Create xp_transactions table for accurate XP ledger
CREATE TABLE IF NOT EXISTS xp_transactions (
    transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    base_amount INTEGER NOT NULL,
    final_amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    source_type TEXT,
    source_id TEXT,
    multiplier REAL DEFAULT 1.0,
    cap_applied INTEGER DEFAULT 0,
    daily_cap_eligible INTEGER DEFAULT 0,
    metadata_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 2. Indexes for fast retrieval
CREATE INDEX IF NOT EXISTS idx_xp_transactions_user_created_at ON xp_transactions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_xp_transactions_reason ON xp_transactions(reason);
CREATE INDEX IF NOT EXISTS idx_xp_transactions_source ON xp_transactions(source_type, source_id);
