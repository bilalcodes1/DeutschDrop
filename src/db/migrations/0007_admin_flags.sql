ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0 CHECK (is_banned IN (0, 1));

UPDATE users
SET is_banned = 0
WHERE is_banned IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_is_banned ON users(is_banned);
