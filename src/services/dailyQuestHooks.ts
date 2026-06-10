import type { D1Database } from '@cloudflare/workers-types';
import { updateQuestProgress } from './dailyQuests';

export async function recordCorrectTrainingAnswer(db: D1Database, userId: number): Promise<void> {
    await updateQuestProgress(db, userId, 'correct_answers_count', 1);
}

export async function recordCorrectReviewAnswer(db: D1Database, userId: number): Promise<void> {
    await updateQuestProgress(db, userId, 'correct_answers_count', 1);
    await updateQuestProgress(db, userId, 'review_answers_count', 1);
}

export async function recordTrainingSessionComplete(
    db: D1Database, 
    userId: number, 
    stats: { total: number; correct: number; wrong: number }
): Promise<void> {
    await updateQuestProgress(db, userId, 'complete_training_session', 1);
    
    // perfect_session implies at least some questions were answered correctly and 0 wrong.
    if (stats.total > 0 && stats.wrong === 0 && stats.correct > 0) {
        await updateQuestProgress(db, userId, 'perfect_session', 1);
    }
}
