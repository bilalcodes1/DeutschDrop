CREATE TABLE IF NOT EXISTS word_collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
    source_label TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
    FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS word_collection_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    owner_user_id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(collection_id, word_id),
    FOREIGN KEY (collection_id) REFERENCES word_collections(id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(word_id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shared_word_offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_user_id INTEGER NOT NULL,
    receiver_user_id INTEGER NOT NULL,
    offer_type TEXT NOT NULL CHECK (offer_type IN ('word', 'words', 'collection')),
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'ignored', 'expired')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (receiver_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

ALTER TABLE async_challenges ADD COLUMN challenge_source_type TEXT;
ALTER TABLE async_challenges ADD COLUMN challenge_source_id TEXT;
ALTER TABLE async_challenges ADD COLUMN challenge_word_origin_json TEXT;

CREATE INDEX IF NOT EXISTS idx_word_collections_owner ON word_collections(owner_user_id, is_deleted, updated_at);
CREATE INDEX IF NOT EXISTS idx_word_collections_public ON word_collections(visibility, is_deleted, updated_at);
CREATE INDEX IF NOT EXISTS idx_word_collection_items_collection ON word_collection_items(collection_id, position);
CREATE INDEX IF NOT EXISTS idx_shared_word_offers_receiver ON shared_word_offers(receiver_user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_shared_word_offers_cooldown ON shared_word_offers(sender_user_id, receiver_user_id, offer_type, created_at);
