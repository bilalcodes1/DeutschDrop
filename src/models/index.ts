// =====================================================
// Core Models & Types
// =====================================================

export interface Env {
    DB: D1Database;
    AI?: { run(model: string, input: unknown): Promise<unknown> };
    TELEGRAM_BOT_TOKEN: string;
    ADMIN_TELEGRAM_IDS?: string;
    AI_ENABLED?: string;
    AI_PROVIDER_ORDER?: string;
    TTS_PROVIDER_ORDER?: string;
    TTS_LANGUAGE?: string;
    TTS_AUDIO_FORMAT?: string;
    EDGE_TTS_VOICE?: string;
    EDGE_TTS_WORKER_URL?: string;
    VOICERSS_API_KEY?: string;
    VOICERSS_API_KEYS?: string;
    VOICERSS_DISABLED_KEY_HASHES?: string;
    GEMINI_API_KEYS?: string;
    KIMI_API_KEYS?: string;
    GROK_API_KEYS?: string;
    OPENROUTER_API_KEYS?: string;
    ZAI_API_KEYS?: string;
    MISTRAL_API_KEYS?: string;
    COHERE_API_KEYS?: string;
    GEMINI_MODEL?: string;
    KIMI_MODEL?: string;
    GROK_MODEL?: string;
    CLOUDFLARE_AI_MODEL?: string;
    OPENROUTER_MODEL?: string;
    ZAI_MODEL?: string;
    ZAI_BASE_URL?: string;
    MISTRAL_MODEL?: string;
    COHERE_MODEL?: string;
}

export interface User {
    user_id: number;
    id: number | null;
    name: string;
    telegram_id: number;
    telegram_user_id: number | null;
    telegram_username: string | null;
    display_name: string | null;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
    xp: number;
    level: number;
    streak: number;
    is_banned: number;
    is_deleted?: number;
    deleted_at?: string | null;
    last_active_at?: string | null;
    onboarding_seen?: number;
    identity: 'bilal' | 'malak' | null;
    created_at: string;
    updated_at: string | null;
}

export interface Settings {
    user_id: number;
    daily_goal: number;
    new_words_per_day: number;
    german_level: 'A1' | 'A2' | 'B1' | null;
    notification_mode: 'light' | 'normal' | 'intensive' | 'custom' | 'off';
    notification_interval_hours: number | null;
    review_plan: 'none' | 'all_words_day' | 'all_words_week';
    notification_batch_size: number;
    morning_time: string;
    afternoon_time: string;
    evening_time: string;
    reminders_enabled: boolean;
    notification_intensity: 'light' | 'normal' | 'intensive' | 'custom' | 'off';
    notification_timezone: string;
    last_notification_at: string | null;
    last_notified_word_id: number | null;
    competition_notifications_enabled: boolean;
    leaderboard_notifications_enabled: boolean;
}

export interface Word {
    word_id: number;
    german: string;
    arabic: string;
    example: string | null;
    example_ar: string | null;
    pronunciation_ar: string | null;
    pronunciation_latin: string | null;
    level: string | null;
    german_search?: string | null;
    arabic_search?: string | null;
    example_search?: string | null;
    added_by: number;
    created_at: string;
    updated_at?: string | null;
}

export interface WordAudio {
    word_id: number;
    audio_url: string | null;
    generated_at: string | null;
}

export interface WordPictogram {
    word_id: number;
    provider: string;
    pictogram_id: string;
    image_url: string;
    thumbnail_url: string;
    title: string;
    license: string;
    attribution: string;
    source_url: string;
    created_at: string;
}

export interface UserUploadedList {
    list_id: number;
    user_id: number;
    name: string;
    created_at: string;
}

export interface ListWord {
    list_id: number;
    word_id: number;
    added_at: string;
}

export interface UserWord {
    user_id: number;
    word_id: number;
    status: 'new' | 'learning' | 'reviewing' | 'mastered';
    ease_factor: number;
    interval: number;
    repetitions: number;
    next_review: string | null;
    correct_count: number;
    wrong_count: number;
    added_at: string;
}

export interface Review {
    review_id: number;
    user_id: number;
    word_id: number;
    is_correct: boolean;
    response_time_ms: number | null;
    difficulty_rating: 'easy' | 'medium' | 'hard' | null;
    reviewed_at: string;
}

export interface XpLog {
    log_id: number;
    user_id: number;
    amount: number;
    reason: string;
    created_at: string;
}

export interface AchievementDefinition {
    definition_id: number;
    key: string;
    name: string;
    description: string;
    icon: string | null;
    required_value: number;
}

export interface UserAchievement {
    user_id: number;
    achievement_id: number;
    unlocked_at: string;
}

export interface DailyStreak {
    user_id: number;
    current_streak: number;
    last_active_date: string | null;
}

export interface DailySummary {
    user_id: number;
    summary_date: string;
    words_learned: number;
    xp_earned: number;
    train_questions: number;
    sent_at: string | null;
}

export interface Competition {
    competition_id: number;
    user_a: number;
    user_b: number;
    created_at: string;
    is_active: boolean;
}

export interface CompetitionEvent {
    event_id: number;
    competition_id: number;
    event_type: string;
    message: string;
    created_at: string;
}

export interface CompetitionLeaderboardSnapshot {
    snapshot_id: number;
    competition_id: number;
    user_id: number;
    xp_at_snapshot: number;
    words_learned_at_snapshot: number;
    streak_at_snapshot: number;
    snapshot_date: string;
}

export interface JobRun {
    job_name: string;
    last_run: string | null;
    status: 'success' | 'failed' | null;
}

export interface DailyReviewPlan {
    id: number;
    user_id: number;
    plan_type: 'all_words_day' | 'all_words_week';
    total_words: number;
    reviewed_words: number;
    batch_size: number;
    started_at: string;
    ends_at: string;
    is_active: number;
}

export interface LearningSource {
    id: number;
    title: string;
    url: string;
    level: 'A1' | 'A2' | 'B1' | 'General';
    description: string | null;
    is_active: number;
    created_by_admin_id: number | null;
    created_at: string;
    updated_at: string | null;
}

// =====================================================
// Command Context Types
// =====================================================

export interface CustomContext {
    env: Env;
    db: D1Database;
    user: User | null;
}
