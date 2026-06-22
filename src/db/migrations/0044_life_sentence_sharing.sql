-- Life sentence sharing, copies, and reports

ALTER TABLE life_sentences ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private', 'public', 'unlisted'));
ALTER TABLE life_sentences ADD COLUMN share_code TEXT;
ALTER TABLE life_sentences ADD COLUMN published_at TEXT;
ALTER TABLE life_sentences ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE life_sentences ADD COLUMN copied_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE life_sentences ADD COLUMN copied_from_sentence_id INTEGER REFERENCES life_sentences(id);

ALTER TABLE life_user_settings ADD COLUMN share_name_mode TEXT NOT NULL DEFAULT 'none' CHECK(share_name_mode IN ('none', 'bot_name', 'custom'));
ALTER TABLE life_user_settings ADD COLUMN share_display_name TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_life_sentences_share_code ON life_sentences(share_code) WHERE share_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_life_sentences_visibility ON life_sentences(visibility, status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_life_sentences_published ON life_sentences(visibility, published_at);
CREATE INDEX IF NOT EXISTS idx_life_sentences_copied_count ON life_sentences(visibility, copied_count);
CREATE INDEX IF NOT EXISTS idx_life_sentences_copied_from ON life_sentences(copied_from_sentence_id);

CREATE TABLE IF NOT EXISTS life_sentence_copies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_sentence_id INTEGER NOT NULL,
    copied_by_user_id INTEGER NOT NULL,
    new_sentence_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    restored_at TEXT,
    UNIQUE(source_sentence_id, copied_by_user_id),
    FOREIGN KEY (source_sentence_id) REFERENCES life_sentences(id),
    FOREIGN KEY (copied_by_user_id) REFERENCES users(user_id),
    FOREIGN KEY (new_sentence_id) REFERENCES life_sentences(id)
);

CREATE INDEX IF NOT EXISTS idx_life_sentence_copies_user ON life_sentence_copies(copied_by_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_life_sentence_copies_source ON life_sentence_copies(source_sentence_id);

CREATE TABLE IF NOT EXISTS life_sentence_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sentence_id INTEGER NOT NULL,
    reporter_user_id INTEGER NOT NULL,
    reason TEXT NOT NULL CHECK(reason IN ('wrong_translation', 'bad_german', 'inappropriate', 'personal_info', 'spam', 'other')),
    details TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'reviewed', 'dismissed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,
    UNIQUE(sentence_id, reporter_user_id),
    FOREIGN KEY (sentence_id) REFERENCES life_sentences(id),
    FOREIGN KEY (reporter_user_id) REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_life_sentence_reports_status ON life_sentence_reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_life_sentence_reports_sentence ON life_sentence_reports(sentence_id);
