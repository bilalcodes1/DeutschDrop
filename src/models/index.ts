// =====================================================
// Core Models & Types
// =====================================================

export interface Env {
    DB: D1Database;
    AUDIO_BUCKET: R2Bucket;
    TELEGRAM_BOT_TOKEN: string;
}

export interface User {
    user_id: number;
    name: string;
    telegram_id: number;
    telegram_username: string | null;
    created_at: string;
}

export interface Settings {
    user_id: number;
    daily_goal: number;
    new_words_per_day: number;
    notification_mode: 'morning' | 'morning_evening' | 'all_day';
    morning_time: string;
    evening_time: string;
}

export interface Word {
    word_id: number;
    german: string;
    arabic: string;
    example: string | null;
    added_by: number;
    created_at: string;
}

export interface WordAudio {
    word_id: number;
    audio_url: string | null;
    generated_at: string | null;
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

// =====================================================
// Command Context Types
// =====================================================

export interface CustomContext {
    env: Env;
    db: D1Database;
    user: User | null;
}
