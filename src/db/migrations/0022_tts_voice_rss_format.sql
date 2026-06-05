ALTER TABLE word_audio_cache ADD COLUMN format TEXT;

CREATE INDEX IF NOT EXISTS idx_word_audio_cache_provider_language_voice
ON word_audio_cache(provider, language, voice, format);
