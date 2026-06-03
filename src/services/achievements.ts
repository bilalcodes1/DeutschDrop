import type { D1Database } from '@cloudflare/workers-types';
import type { BotContext } from '../bot/context';
import { queryAll, queryOne, run } from '../db/queries';
import { addXp } from './xpLevels';
import { displayUserName, getPeerUser, sendTelegramMessage } from './notifications';

const ACHIEVEMENT_XP = 100;

export async function checkAchievements(ctx: BotContext, userId: number): Promise<void> {
    const candidates = await getUnlockedCandidateKeys(ctx.db, userId);
    for (const key of candidates) {
        await unlockAchievement(ctx, userId, key);
    }
}

export async function unlockAchievement(ctx: BotContext, userId: number, key: string): Promise<boolean> {
    const definition = await queryOne<{ definition_id: number; name: string }>(
        ctx.db,
        'SELECT definition_id, name FROM achievement_definitions WHERE key = ?',
        [key]
    );
    if (!definition) return false;

    const result = await run(
        ctx.db,
        'INSERT OR IGNORE INTO user_achievements (user_id, achievement_id) VALUES (?, ?)',
        [userId, definition.definition_id]
    );

    const changes = (result.meta as { changes?: number })?.changes ?? 0;
    if (changes === 0) return false;

    await addXp(ctx.db, userId, ACHIEVEMENT_XP, `achievement_${key}`);

    const user = await queryOne<{ telegram_id: number; name: string; identity: 'bilal' | 'malak' | null }>(
        ctx.db,
        'SELECT telegram_id, name, identity FROM users WHERE user_id = ?',
        [userId]
    );
    const currentTelegramId = ctx.from?.id;
    const achievementMessage = `🏅 تم فتح إنجاز: ${definition.name} +${ACHIEVEMENT_XP} XP`;
    if (user && currentTelegramId !== user.telegram_id) {
        await sendTelegramMessage(ctx.env, user.telegram_id, achievementMessage);
    } else {
        await ctx.reply(achievementMessage);
    }

    const peer = await getPeerUser(ctx.db, userId);
    if (peer && user) {
        await sendTelegramMessage(
            ctx.env,
            peer.telegram_id,
            `🎉 ${displayUserName(user)} فتح إنجاز: ${definition.name}`
        );
    }

    return true;
}

async function getUnlockedCandidateKeys(db: D1Database, userId: number): Promise<string[]> {
    const keys: string[] = [];

    const wordCount = await queryOne<{ count: number }>(
        db,
        'SELECT COUNT(*) AS count FROM user_words WHERE user_id = ?',
        [userId]
    );
    const words = wordCount?.count ?? 0;
    if (words >= 1) keys.push('first_word');
    if (words >= 50) keys.push('first_50_words');
    if (words >= 100) keys.push('first_100_words');
    if (words >= 500) keys.push('first_500_words');

    const correct = await queryOne<{ count: number }>(
        db,
        'SELECT COUNT(*) AS count FROM reviews WHERE user_id = ? AND is_correct = 1',
        [userId]
    );
    const correctCount = correct?.count ?? 0;
    if (correctCount >= 100) keys.push('train_100');
    if (correctCount >= 500) keys.push('train_500');

    if (await hasCorrectStreak(db, userId, 20)) keys.push('correct_streak_20');

    const streak = await queryOne<{ current_streak: number }>(
        db,
        'SELECT current_streak FROM daily_streaks WHERE user_id = ?',
        [userId]
    );
    const currentStreak = streak?.current_streak ?? 0;
    if (currentStreak >= 7) keys.push('streak_7');
    if (currentStreak >= 30) keys.push('streak_30');
    if (currentStreak >= 100) keys.push('streak_100');

    return keys;
}

async function hasCorrectStreak(db: D1Database, userId: number, target: number): Promise<boolean> {
    const rows = await queryAll<{ is_correct: number }>(
        db,
        'SELECT is_correct FROM reviews WHERE user_id = ? ORDER BY reviewed_at DESC LIMIT ?',
        [userId, target]
    );
    return rows.length >= target && rows.every(row => row.is_correct === 1);
}
