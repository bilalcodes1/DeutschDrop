ALTER TABLE word_audio_cache ADD COLUMN api_key_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_word_audio_cache_provider_key_created
ON word_audio_cache(provider, api_key_hash, created_at);
