import type { D1Database } from '@cloudflare/workers-types';
import { queryOne, run } from '../db/queries';

export interface BotAnnouncement {
    id: number;
    message: string;
    is_active: number;
    created_by_admin_id: number;
    created_at: string;
    updated_at: string;
}

export async function getActiveAnnouncement(db: D1Database): Promise<BotAnnouncement | null> {
    return queryOne(
        db,
        'SELECT * FROM bot_announcements WHERE is_active = 1 ORDER BY updated_at DESC, id DESC LIMIT 1'
    );
}

export async function setActiveAnnouncement(db: D1Database, adminUserId: number, message: string): Promise<void> {
    await run(db, 'UPDATE bot_announcements SET is_active = 0, updated_at = datetime("now") WHERE is_active = 1');
    await run(
        db,
        'INSERT INTO bot_announcements (message, is_active, created_by_admin_id) VALUES (?, 1, ?)',
        [message, adminUserId]
    );
}

export async function clearActiveAnnouncements(db: D1Database): Promise<void> {
    await run(db, 'UPDATE bot_announcements SET is_active = 0, updated_at = datetime("now") WHERE is_active = 1');
}
