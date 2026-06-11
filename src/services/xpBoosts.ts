import type { D1Database } from '@cloudflare/workers-types';
import { queryOne, run } from '../db/queries';

export interface XpBoost {
    boost_id: number;
    user_id: number;
    multiplier: number;
    starts_at: string;
    expires_at: string;
    reason: string;
    source_type: string | null;
    source_id: string | null;
    is_consumed: number;
    created_at: string;
}

export async function createXpBoost(
    db: D1Database,
    userId: number,
    multiplier: number,
    durationMinutes: number,
    reason: string,
    sourceType?: string,
    sourceId?: string
): Promise<XpBoost> {
    if (!Number.isFinite(multiplier) || multiplier <= 1) {
        throw new Error('XP boost multiplier must be greater than 1.');
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        throw new Error('XP boost duration must be positive.');
    }

    const durationMs = Math.floor(durationMinutes * 60 * 1000);
    const expiresAt = toSqlDateTime(new Date(Date.now() + durationMs));

    const inserted = await queryOne<XpBoost>(
        db,
        `INSERT INTO user_boosts (user_id, multiplier, expires_at, reason, source_type, source_id)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING boost_id, user_id, multiplier, starts_at, expires_at, reason, source_type, source_id, is_consumed, created_at`,
        [userId, multiplier, expiresAt, reason, sourceType ?? null, sourceId ?? null]
    );

    if (!inserted) {
        throw new Error('Failed to create XP boost.');
    }

    return inserted;
}

export async function getActiveXpBoost(db: D1Database, userId: number): Promise<XpBoost | null> {
    return queryOne<XpBoost>(
        db,
        `SELECT boost_id, user_id, multiplier, starts_at, expires_at, reason, source_type, source_id, is_consumed, created_at
         FROM user_boosts
         WHERE user_id = ?
           AND is_consumed = 0
           AND starts_at <= datetime('now')
           AND expires_at > datetime('now')
         ORDER BY multiplier DESC, expires_at DESC, boost_id DESC
         LIMIT 1`,
        [userId]
    );
}

export async function getActiveMultiplier(db: D1Database, userId: number): Promise<number> {
    const boost = await getActiveXpBoost(db, userId);
    return boost?.multiplier ?? 1.0;
}

export function formatBoostStatus(boost: XpBoost | null): string {
    if (!boost) return 'لا يوجد Boost نشط حالياً.';

    const expiresAt = new Date(boost.expires_at);
    const remainingMs = Math.max(0, expiresAt.getTime() - Date.now());
    const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
    return `⚡ XP Boost نشط: ${boost.multiplier}x\nينتهي خلال: ${minutes} دقيقة`;
}

export async function cleanupExpiredBoosts(db: D1Database): Promise<void> {
    await run(
        db,
        `UPDATE user_boosts
         SET is_consumed = 1
         WHERE is_consumed = 0 AND expires_at <= datetime('now')`
    );
}

function toSqlDateTime(date: Date): string {
    return date.toISOString().slice(0, 19).replace('T', ' ');
}
