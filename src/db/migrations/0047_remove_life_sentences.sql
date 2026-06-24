-- Remove the discontinued Life Sentences / مواقف الحياة subsystem.
-- Historical migrations remain intact; this migration only cleans tables and rows
-- owned exclusively by the removed subsystem.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS admin_moderation_actions;
DROP TABLE IF EXISTS life_sentence_reports;
DROP TABLE IF EXISTS life_sentence_copies;
DROP TABLE IF EXISTS life_daily_gate;
DROP TABLE IF EXISTS life_sentence_keywords;
DROP TABLE IF EXISTS life_user_settings;
DROP TABLE IF EXISTS life_sentences;

PRAGMA foreign_keys = ON;

DELETE FROM ai_cache WHERE task_type IN ('generate_life_sentence', 'validate_life_sentence');
DELETE FROM ai_usage WHERE task_type IN ('generate_life_sentence', 'validate_life_sentence');
DELETE FROM bot_sessions WHERE type LIKE 'life_%' OR type LIKE 'awaiting_life_%';
