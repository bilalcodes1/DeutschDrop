import type { D1Database } from '@cloudflare/workers-types';
import { getUserByTelegramId } from '../repositories/userRepository';
import { getWordCountByStatus } from '../repositories/srsRepository';
import { getTotalXp } from './xpLevels';
import {
    getActiveCompetition,
    createCompetition,
    addCompetitionEvent,
    createSnapshot,
} from '../repositories/competitionRepository';

// =====================================================
// Competition & Notification Service
// =====================================================

export interface CompetitorInfo {
    userId: number;
    name: string;
    telegramId: number;
    xp: number;
    wordsLearned: number;
    streak: number;
}

/**
 * Ensure a competition exists between two users.
 */
export async function ensureCompetition(
    db: D1Database,
    userAId: number,
    userBId: number
): Promise<number> {
    const existing = await getActiveCompetition(db, userAId, userBId);
    if (existing) {
        return existing.competition_id;
    }
    return createCompetition(db, userAId, userBId);
}

/**
 * Record a competition event (e.g., user overtook another).
 */
export async function recordEvent(
    db: D1Database,
    competitionId: number,
    eventType: string,
    message: string
): Promise<void> {
    await addCompetitionEvent(db, competitionId, eventType, message);
}

/**
 * Take a daily snapshot of the competition standings.
 */
export async function snapshotCompetition(
    db: D1Database,
    competitionId: number,
    userId: number
): Promise<void> {
    const user = await getUserByTelegramId(db, (await db.prepare('SELECT telegram_id FROM users WHERE user_id = ?').bind(userId).first<{ telegram_id: number }>())?.telegram_id ?? 0);
    if (!user) return;

    const xp = await getTotalXp(db, userId);
    const statusCounts = await getWordCountByStatus(db, userId);
    const wordsLearned = Object.values(statusCounts).reduce((a, b) => a + b, 0);

    // Get streak from daily_streaks
    const streakRow = await db.prepare('SELECT current_streak FROM daily_streaks WHERE user_id = ?').bind(userId).first<{ current_streak: number }>();
    const streak = streakRow?.current_streak ?? 0;

    await createSnapshot(db, competitionId, userId, xp, wordsLearned, streak);
}

/**
 * Check if one user overtook another and send notifications.
 */
export async function checkOvertake(
    db: D1Database,
    competitionId: number,
    leaderId: number,
    followerId: number,
    leaderTelegramId: number,
    followerTelegramId: number
): Promise<void> {
    // Get previous snapshot
    const prev = await db.prepare(
        `SELECT * FROM competition_leaderboard_snapshot
         WHERE competition_id = ? AND snapshot_date < date('now')
         ORDER BY snapshot_date DESC LIMIT 1`
    ).bind(competitionId).first<{ user_id: number; xp_at_snapshot: number }>();

    if (!prev) return; // No previous snapshot to compare

    // Only notify if there was a change in leadership
    // (This is a simplified version - full implementation would track both users)
    const message = `🔥 تهانينا! لقد تجاوزت منافسك في الترتيب!`;
    await addCompetitionEvent(db, competitionId, 'overtake', message);
}
