-- Support direct collection imports with explicit duplicate protection and faster collection item lookups.
CREATE UNIQUE INDEX IF NOT EXISTS idx_word_collection_items_collection_word ON word_collection_items(collection_id, word_id);
CREATE INDEX IF NOT EXISTS idx_word_collection_items_owner_collection ON word_collection_items(owner_user_id, collection_id);
