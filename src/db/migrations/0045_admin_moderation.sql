-- Admin moderation center for life sentence community

ALTER TABLE life_sentences ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'approved' CHECK(moderation_status IN ('approved', 'hidden', 'under_review', 'removed'));
ALTER TABLE life_sentences ADD COLUMN moderation_note TEXT;
ALTER TABLE life_sentences ADD COLUMN moderated_by INTEGER;
ALTER TABLE life_sentences ADD COLUMN moderated_at TEXT;
ALTER TABLE life_sentences ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE life_sentences ADD COLUMN pinned_at TEXT;
ALTER TABLE life_sentences ADD COLUMN pinned_by INTEGER;
ALTER TABLE life_sentences ADD COLUMN pin_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE life_user_settings ADD COLUMN life_sharing_suspended INTEGER NOT NULL DEFAULT 0;
ALTER TABLE life_user_settings ADD COLUMN sharing_suspended_at TEXT;
ALTER TABLE life_user_settings ADD COLUMN sharing_suspended_by INTEGER;

CREATE INDEX IF NOT EXISTS idx_life_sentences_moderation ON life_sentences(moderation_status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_life_sentences_pinned ON life_sentences(is_pinned, pin_order, pinned_at);
CREATE INDEX IF NOT EXISTS idx_life_settings_sharing_suspended ON life_user_settings(life_sharing_suspended);

-- SQLite/D1 cannot alter a CHECK constraint in place, so rebuild reports to add the
-- 'removed' status and review metadata while preserving existing report history.
PRAGMA foreign_keys = OFF;

CREATE TABLE life_sentence_reports_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sentence_id INTEGER NOT NULL,
    reporter_user_id INTEGER NOT NULL,
    reason TEXT NOT NULL CHECK(reason IN ('wrong_translation', 'bad_german', 'inappropriate', 'personal_info', 'spam', 'other')),
    details TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'reviewed', 'dismissed', 'removed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,
    reviewed_by_admin_id INTEGER,
    reviewed_at TEXT,
    UNIQUE(sentence_id, reporter_user_id),
    FOREIGN KEY (sentence_id) REFERENCES life_sentences(id),
    FOREIGN KEY (reporter_user_id) REFERENCES users(user_id)
);

INSERT INTO life_sentence_reports_new (
    id, sentence_id, reporter_user_id, reason, details, status, created_at, resolved_at
)
SELECT id, sentence_id, reporter_user_id, reason, details, status, created_at, resolved_at
FROM life_sentence_reports;

DROP TABLE life_sentence_reports;
ALTER TABLE life_sentence_reports_new RENAME TO life_sentence_reports;

PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_life_reports_status_created ON life_sentence_reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_life_sentence_reports_status ON life_sentence_reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_life_sentence_reports_sentence ON life_sentence_reports(sentence_id);

CREATE TABLE IF NOT EXISTS admin_moderation_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER NOT NULL,
    action_type TEXT NOT NULL,
    target_sentence_id INTEGER,
    target_user_id INTEGER,
    report_id INTEGER,
    old_value TEXT,
    new_value TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (target_sentence_id) REFERENCES life_sentences(id),
    FOREIGN KEY (target_user_id) REFERENCES users(user_id),
    FOREIGN KEY (report_id) REFERENCES life_sentence_reports(id)
);

CREATE INDEX IF NOT EXISTS idx_admin_moderation_actions_admin ON admin_moderation_actions(admin_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_moderation_actions_sentence ON admin_moderation_actions(target_sentence_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_moderation_actions_user ON admin_moderation_actions(target_user_id, created_at);
