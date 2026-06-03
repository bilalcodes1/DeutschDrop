CREATE UNIQUE INDEX IF NOT EXISTS idx_word_pictograms_word_id ON word_pictograms(word_id);

UPDATE word_pictograms
SET attribution = 'Pictogram: ARASAAC / Sergio Palao'
WHERE provider = 'arasaac';
