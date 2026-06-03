import type { D1Database } from '@cloudflare/workers-types';
import { run } from '../db/queries';

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
        'INSERT INTO support_proofs (user_id, method, amount, message, file_id) VALUES (?, ?, ?, ?, ?)',
        [userId, proof.method, proof.amount, proof.message, proof.fileId]
    );
    return (result.meta as { last_row_id?: number })?.last_row_id ?? 0;
}
