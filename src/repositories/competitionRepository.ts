import type { D1Database } from '@cloudflare/workers-types';
import { queryOne, queryAll, run } from '../db/queries';
import type { Competition, CompetitionEvent, CompetitionLeaderboardSnapshot } from '../models';

export async function getActiveCompetition(
    db: D1Database,
    userA: number,
    userB: number
): Promise<Competition | null> {
    return queryOne<Competition>(
        db,
        `SELECT * FROM competitions
         WHERE is_active = 1
           AND ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?))
         LIMIT 1`,
        [userA, userB, userB, userA]
    );
}

export async function createCompetition(
    db: D1Database,
    userA: number,
    userB: number
): Promise<number> {
    const result = await run(
        db,
        'INSERT INTO competitions (user_a, user_b) VALUES (?, ?)',
        [userA, userB]
    );
    return (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
}

export async function addCompetitionEvent(
    db: D1Database,
    competitionId: number,
    eventType: string,
    message: string
): Promise<void> {
    await run(
        db,
        'INSERT INTO competition_events (competition_id, event_type, message) VALUES (?, ?, ?)',
        [competitionId, eventType, message]
    );
}

export async function getCompetitionEvents(
    db: D1Database,
    competitionId: number,
    limit: number = 10
): Promise<CompetitionEvent[]> {
    return queryAll<CompetitionEvent>(
        db,
        'SELECT * FROM competition_events WHERE competition_id = ? ORDER BY created_at DESC LIMIT ?',
        [competitionId, limit]
    );
}

export async function createSnapshot(
    db: D1Database,
    competitionId: number,
    userId: number,
    xp: number,
    words: number,
    streak: number
): Promise<void> {
    await run(
        db,
        'INSERT INTO competition_leaderboard_snapshot (competition_id, user_id, xp_at_snapshot, words_learned_at_snapshot, streak_at_snapshot, snapshot_date) VALUES (?, ?, ?, ?, ?, date("now"))',
        [competitionId, userId, xp, words, streak]
    );
}

export async function getLatestSnapshot(
    db: D1Database,
    competitionId: number
): Promise<CompetitionLeaderboardSnapshot | null> {
    return queryOne<CompetitionLeaderboardSnapshot>(
        db,
        'SELECT * FROM competition_leaderboard_snapshot WHERE competition_id = ? ORDER BY snapshot_date DESC LIMIT 1',
        [competitionId]
    );
}
