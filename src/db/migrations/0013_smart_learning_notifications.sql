CREATE TABLE IF NOT EXISTS notification_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    word_id INTEGER,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    responded_at DATETIME,
    response TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_events_user_sent ON notification_events(user_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_notification_events_user_word_sent ON notification_events(user_id, word_id, sent_at);

ALTER TABLE settings ADD COLUMN notification_intensity TEXT DEFAULT 'normal' CHECK (notification_intensity IN ('light', 'normal', 'intensive', 'off'));
ALTER TABLE settings ADD COLUMN afternoon_time TEXT DEFAULT '15:00';
ALTER TABLE settings ADD COLUMN notification_timezone TEXT DEFAULT 'Asia/Baghdad';
ALTER TABLE settings ADD COLUMN last_notification_at DATETIME;
