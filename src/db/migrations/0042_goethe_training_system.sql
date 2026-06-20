-- Goethe Training & Challenge System

CREATE TABLE IF NOT EXISTS goethe_sources (
    source_id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_key TEXT NOT NULL UNIQUE,
    source_name TEXT NOT NULL,
    publisher TEXT,
    source_year INTEGER,
    model_number TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    default_level TEXT,
    description TEXT,
    pack_sha256 TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('importing', 'active', 'disabled', 'failed')),
    rights_confirmed INTEGER NOT NULL DEFAULT 0,
    question_count INTEGER NOT NULL DEFAULT 0,
    audio_count INTEGER NOT NULL DEFAULT 0,
    imported_by_user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activated_at TEXT,
    disabled_at TEXT,
    FOREIGN KEY (imported_by_user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS goethe_questions (
    question_id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    external_id TEXT NOT NULL,
    level TEXT NOT NULL,
    section TEXT NOT NULL,
    format TEXT NOT NULL,
    scenario_type TEXT NOT NULL,
    audio_r2_key TEXT,
    audio_sha256 TEXT,
    audio_size_bytes INTEGER,
    audio_mime_type TEXT,
    telegram_file_id TEXT,
    instruction TEXT,
    question_text TEXT NOT NULL,
    correct_answer TEXT NOT NULL,
    accepted_answers_json TEXT,
    transcript TEXT,
    explanation TEXT,
    difficulty INTEGER NOT NULL,
    tags_json TEXT,
    time_limit_seconds INTEGER,
    points INTEGER NOT NULL DEFAULT 10,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_id, external_id),
    FOREIGN KEY (source_id) REFERENCES goethe_sources(source_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS goethe_question_options (
    option_id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    option_key TEXT NOT NULL,
    option_text TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    UNIQUE(question_id, option_key),
    FOREIGN KEY (question_id) REFERENCES goethe_questions(question_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS goethe_import_jobs (
    job_id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER NOT NULL,
    telegram_chat_id INTEGER NOT NULL,
    telegram_file_id TEXT NOT NULL,
    telegram_file_name TEXT NOT NULL,
    telegram_file_size INTEGER,
    zip_r2_key TEXT,
    pack_sha256 TEXT,
    source_id INTEGER,
    status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    phase TEXT NOT NULL,
    progress_current INTEGER NOT NULL DEFAULT 0,
    progress_total INTEGER NOT NULL DEFAULT 0,
    questions_found INTEGER NOT NULL DEFAULT 0,
    audio_files_found INTEGER NOT NULL DEFAULT 0,
    questions_imported INTEGER NOT NULL DEFAULT 0,
    audio_files_uploaded INTEGER NOT NULL DEFAULT 0,
    progress_message_id INTEGER,
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    summary_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    finished_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_user_id) REFERENCES users(user_id),
    FOREIGN KEY (source_id) REFERENCES goethe_sources(source_id)
);

CREATE TABLE IF NOT EXISTS goethe_import_errors (
    error_id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    row_number INTEGER,
    file_name TEXT,
    error_code TEXT NOT NULL,
    error_message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES goethe_import_jobs(job_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS goethe_sessions (
    session_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    mode TEXT NOT NULL,
    level TEXT NOT NULL,
    section TEXT,
    scenario_type TEXT,
    source_id INTEGER,
    status TEXT NOT NULL CHECK(status IN ('active', 'finished', 'expired', 'cancelled')),
    total_questions INTEGER NOT NULL,
    current_position INTEGER NOT NULL DEFAULT 0,
    correct_count INTEGER NOT NULL DEFAULT 0,
    wrong_count INTEGER NOT NULL DEFAULT 0,
    score INTEGER NOT NULL DEFAULT 0,
    xp_awarded INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (source_id) REFERENCES goethe_sources(source_id)
);

CREATE TABLE IF NOT EXISTS goethe_session_questions (
    session_question_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    deadline_at TEXT,
    answered INTEGER NOT NULL DEFAULT 0,
    is_correct INTEGER,
    selected_answer TEXT,
    response_time_ms INTEGER,
    answered_at TEXT,
    UNIQUE(session_id, position),
    UNIQUE(session_id, question_id),
    FOREIGN KEY (session_id) REFERENCES goethe_sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES goethe_questions(question_id)
);

CREATE TABLE IF NOT EXISTS goethe_attempts (
    attempt_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    session_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    mode TEXT NOT NULL,
    selected_answer TEXT,
    correct_answer TEXT NOT NULL,
    is_correct INTEGER NOT NULL,
    response_time_ms INTEGER,
    points_awarded INTEGER NOT NULL DEFAULT 0,
    xp_awarded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (session_id) REFERENCES goethe_sessions(session_id),
    FOREIGN KEY (question_id) REFERENCES goethe_questions(question_id)
);

CREATE TABLE IF NOT EXISTS goethe_user_question_stats (
    user_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    correct_attempts INTEGER NOT NULL DEFAULT 0,
    wrong_attempts INTEGER NOT NULL DEFAULT 0,
    weakness_score INTEGER NOT NULL DEFAULT 0,
    last_result INTEGER,
    last_attempt_at TEXT,
    last_correct_at TEXT,
    average_response_ms INTEGER,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, question_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (question_id) REFERENCES goethe_questions(question_id)
);

CREATE INDEX IF NOT EXISTS idx_goethe_questions_active_level ON goethe_questions(is_active, level);
CREATE INDEX IF NOT EXISTS idx_goethe_questions_active_level_section ON goethe_questions(is_active, level, section);
CREATE INDEX IF NOT EXISTS idx_goethe_questions_active_level_scenario ON goethe_questions(is_active, level, scenario_type);
CREATE INDEX IF NOT EXISTS idx_goethe_questions_active_level_difficulty ON goethe_questions(is_active, level, difficulty);
CREATE INDEX IF NOT EXISTS idx_goethe_questions_source_active ON goethe_questions(source_id, is_active);
CREATE INDEX IF NOT EXISTS idx_goethe_options_question ON goethe_question_options(question_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_goethe_attempts_user_created ON goethe_attempts(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_goethe_attempts_user_question ON goethe_attempts(user_id, question_id);
CREATE INDEX IF NOT EXISTS idx_goethe_stats_user_weakness ON goethe_user_question_stats(user_id, weakness_score);
CREATE INDEX IF NOT EXISTS idx_goethe_stats_user_last_attempt ON goethe_user_question_stats(user_id, last_attempt_at);
CREATE INDEX IF NOT EXISTS idx_goethe_import_jobs_status_created ON goethe_import_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_goethe_sessions_user_status ON goethe_sessions(user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_goethe_session_questions_current ON goethe_session_questions(session_id, position, answered);
