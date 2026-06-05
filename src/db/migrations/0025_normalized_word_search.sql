ALTER TABLE words ADD COLUMN german_search TEXT;
ALTER TABLE words ADD COLUMN arabic_search TEXT;
ALTER TABLE words ADD COLUMN example_search TEXT;

UPDATE words
SET german_search = lower(trim(replace(replace(replace(german, 'ß', 'ss'), '.', ' '), ',', ' '))),
    arabic_search = trim(replace(replace(replace(replace(arabic, 'أ', 'ا'), 'إ', 'ا'), 'آ', 'ا'), 'ـ', '')),
    example_search = lower(trim(replace(replace(replace(COALESCE(example, ''), 'ß', 'ss'), '.', ' '), ',', ' ')));

CREATE INDEX IF NOT EXISTS idx_words_user_german_search ON words(added_by, german_search);
CREATE INDEX IF NOT EXISTS idx_words_user_arabic_search ON words(added_by, arabic_search);
