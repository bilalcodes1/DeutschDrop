import type { D1Database } from '@cloudflare/workers-types';
import { queryAll, queryOne, run } from '../db/queries';

export interface SupportProofWithUser {
    id: number;
    user_id: number;
    method: string | null;
    amount: string | null;
    message: string | null;
    file_id: string | null;
    status: 'pending' | 'approved' | 'rejected';
    created_at: string;
    display_name: string | null;
    username: string | null;
    telegram_username: string | null;
    telegram_user_id: number | null;
    telegram_id: number;
}

export interface SupportStatus {
    user_id: number;
    is_supporter: number;
    supporter_until: string | null;
    last_confirmed_by_admin_id: number | null;
    last_support_proof_id: number | null;
    created_at: string;
    updated_at: string;
}

export async function createSupportRequest(
    db: D1Database,
    userId: number,
    type: string,
    message: string | null
): Promise<number> {
    const result = await run(
        db,
        'INSERT INTO support_requests (user_id, type, message) VALUES (?, ?, ?)',
        [userId, type, message]
    );
    return (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
}

export async function createSupportProof(
    db: D1Database,
    userId: number,
    proof: { method: string | null; amount: string | null; message: string | null; fileId: string | null }
): Promise<number> {
    const result = await run(
        db,
        'INSERT INTO support_proofs (user_id, method, amount, message, file_id, status) VALUES (?, ?, ?, ?, ?, "pending")',
        [userId, proof.method, proof.amount, proof.message, proof.fileId]
    );
    return (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
}

export async function getSupportProofById(db: D1Database, proofId: number): Promise<SupportProofWithUser | null> {
    return queryOne(
        db,
        `SELECT sp.*,
                u.display_name,
                u.username,
                u.telegram_username,
                u.telegram_user_id,
                u.telegram_id
         FROM support_proofs sp
         INNER JOIN users u ON u.user_id = sp.user_id
         WHERE sp.id = ?`,
        [proofId]
    );
}

export async function getPendingSupportProofs(db: D1Database, limit: number = 10, offset: number = 0): Promise<SupportProofWithUser[]> {
    return queryAll(
        db,
        `SELECT sp.*,
                u.display_name,
                u.username,
                u.telegram_username,
                u.telegram_user_id,
                u.telegram_id
         FROM support_proofs sp
         INNER JOIN users u ON u.user_id = sp.user_id
         WHERE sp.status = 'pending'
         ORDER BY sp.created_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
    );
}

export async function updateSupportProofStatus(
    db: D1Database,
    proofId: number,
    status: 'approved' | 'rejected',
    adminTelegramId: number
): Promise<boolean> {
    const result = await run(
        db,
        'UPDATE support_proofs SET status = ?, reviewed_by_admin_id = ?, reviewed_at = datetime("now") WHERE id = ? AND status = "pending"',
        [status, adminTelegramId, proofId]
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
}

export async function activateSupporterFor24Hours(
    db: D1Database,
    userId: number,
    adminTelegramId: number,
    proofId: number
): Promise<string> {
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await run(
        db,
        `INSERT INTO user_support_status (
            user_id, is_supporter, supporter_until, last_confirmed_by_admin_id, last_support_proof_id, updated_at
         ) VALUES (?, 1, ?, ?, ?, datetime("now"))
         ON CONFLICT(user_id) DO UPDATE SET
            is_supporter = 1,
            supporter_until = excluded.supporter_until,
            last_confirmed_by_admin_id = excluded.last_confirmed_by_admin_id,
            last_support_proof_id = excluded.last_support_proof_id,
            updated_at = datetime("now")`,
        [userId, until, adminTelegramId, proofId]
    );
    return until;
}

export async function activateSupporterForHours(
    db: D1Database,
    userId: number,
    adminTelegramId: number,
    hours: number,
    proofId: number | null = null
): Promise<string> {
    const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    await run(
        db,
        `INSERT INTO user_support_status (
            user_id, is_supporter, supporter_until, last_confirmed_by_admin_id, last_support_proof_id, updated_at
         ) VALUES (?, 1, ?, ?, ?, datetime("now"))
         ON CONFLICT(user_id) DO UPDATE SET
            is_supporter = 1,
            supporter_until = excluded.supporter_until,
            last_confirmed_by_admin_id = excluded.last_confirmed_by_admin_id,
            last_support_proof_id = excluded.last_support_proof_id,
            updated_at = datetime("now")`,
        [userId, until, adminTelegramId, proofId]
    );
    return until;
}

export async function getActiveSupportStatus(db: D1Database, userId: number): Promise<SupportStatus | null> {
    const status = await queryOne<SupportStatus>(
        db,
        'SELECT * FROM user_support_status WHERE user_id = ?',
        [userId]
    );
    if (!status) return null;

    if (!status.is_supporter || !status.supporter_until || new Date(status.supporter_until).getTime() <= Date.now()) {
        if (status.is_supporter) {
            await run(db, 'UPDATE user_support_status SET is_supporter = 0, updated_at = datetime("now") WHERE user_id = ?', [userId]);
        }
        return null;
    }

    return status;
}

export async function countPendingSupportProofs(db: D1Database): Promise<number> {
    const row = await queryOne<{ count: number }>(db, 'SELECT COUNT(*) AS count FROM support_proofs WHERE status = "pending"');
    return row?.count ?? 0;
}

export async function countActiveSupporters(db: D1Database): Promise<number> {
    const row = await queryOne<{ count: number }>(
        db,
        'SELECT COUNT(*) AS count FROM user_support_status WHERE is_supporter = 1 AND supporter_until > datetime("now")'
    );
    return row?.count ?? 0;
}

export async function createBroadcastLog(
    db: D1Database,
    adminUserId: number,
    message: string,
    sentCount: number,
    failedCount: number
): Promise<void> {
    await run(
        db,
        'INSERT INTO broadcast_logs (admin_user_id, message, sent_count, failed_count) VALUES (?, ?, ?, ?)',
        [adminUserId, message, sentCount, failedCount]
    );
}
