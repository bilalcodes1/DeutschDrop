-- Create FTS5 virtual table for words
CREATE VIRTUAL TABLE words_fts USING fts5(
    word_id UNINDEXED,
    german_search,
    arabic_search
);

-- Backfill existing words into words_fts
INSERT INTO words_fts (word_id, german_search, arabic_search)
SELECT word_id, german_search, arabic_search 
FROM words 
WHERE german_search IS NOT NULL OR arabic_search IS NOT NULL;

-- Triggers to keep words_fts synchronized
CREATE TRIGGER words_after_insert_fts AFTER INSERT ON words BEGIN
    INSERT INTO words_fts (word_id, german_search, arabic_search)
    VALUES (new.word_id, new.german_search, new.arabic_search);
END;

CREATE TRIGGER words_after_delete_fts AFTER DELETE ON words BEGIN
    DELETE FROM words_fts WHERE word_id = old.word_id;
END;

CREATE TRIGGER words_after_update_fts AFTER UPDATE ON words BEGIN
    DELETE FROM words_fts WHERE word_id = old.word_id;
    INSERT INTO words_fts (word_id, german_search, arabic_search)
    VALUES (new.word_id, new.german_search, new.arabic_search);
END;
