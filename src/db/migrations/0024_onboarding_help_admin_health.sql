ALTER TABLE users ADD COLUMN onboarding_seen INTEGER DEFAULT 0 CHECK (onboarding_seen IN (0, 1));

UPDATE users
SET onboarding_seen = 1
WHERE user_id IN (
    SELECT user_id FROM settings WHERE german_level IS NOT NULL
);
