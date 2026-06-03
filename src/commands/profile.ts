import { Bot } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId, isRegisteredUser } from '../repositories/userRepository';
import { getWordsByUser } from '../repositories/wordRepository';
import { getActiveSupportStatus } from '../repositories/supportRepository';
import { getTotalXp, getLevelFromXp } from '../services/xpLevels';
import { formatSupportRemaining, getUserRoleBadge } from '../services/roleUi';
import { mainMenuKeyboard } from './menu';
import { replaceWithText } from './wordPanel';

export function registerProfileCommand(bot: Bot<BotContext>): void {
    bot.command('profile', async (ctx) => showProfile(ctx));
    bot.callbackQuery('menu_profile', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showProfile(ctx);
    });

    bot.command('achievements', async (ctx) => showAchievements(ctx));
    bot.callbackQuery('menu_achievements', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showAchievements(ctx);
    });
}

async function showProfile(ctx: BotContext): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!isRegisteredUser(user)) {
        await ctx.reply('استخدم /start للتسجيل أولاً.');
        return;
    }

    const words = await getWordsByUser(ctx.db, user.user_id);
    const xp = await getTotalXp(ctx.db, user.user_id);
    const level = getLevelFromXp(xp).level;
    const streak = await ctx.db.prepare('SELECT current_streak FROM daily_streaks WHERE user_id = ?').bind(user.user_id).first<{ current_streak: number }>();
    const achievements = await getAchievementCount(ctx, user.user_id);
    const supportStatus = await getActiveSupportStatus(ctx.db, user.user_id);
    const badge = getUserRoleBadge(user, ctx.env, supportStatus);
    const supporterLine = badge === '💙 داعم' && supportStatus?.supporter_until
        ? `\n💙 حسابك مثبت كداعِم حتى:\n${supportStatus.supporter_until}\nالوقت المتبقي: ${formatSupportRemaining(supportStatus.supporter_until)}\n`
        : '\n';

    const text = `👤 *الملف الشخصي*\n\n` +
        `الاسم: *${user.display_name}*\n` +
        `الحالة: *${badge}*\n` +
        `Telegram ID: *${user.telegram_user_id ?? user.telegram_id}*\n` +
        supporterLine +
        `XP: *${xp}*\n` +
        `المستوى: *${level}*\n` +
        `عدد الكلمات: *${words.length}*\n` +
        `Streak: *${streak?.current_streak ?? 0}*\n` +
        `الإنجازات: *${achievements}*`;

    await replaceWithText(ctx, text, mainMenuKeyboard(), 'Markdown');
}

async function showAchievements(ctx: BotContext): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!isRegisteredUser(user)) {
        await ctx.reply('استخدم /start للتسجيل أولاً.');
        return;
    }

    const rows = await ctx.db.prepare(
        `SELECT ad.name, ad.icon, ua.unlocked_at
         FROM user_achievements ua
         INNER JOIN achievement_definitions ad ON ad.definition_id = ua.achievement_id
         WHERE ua.user_id = ?
         ORDER BY ua.unlocked_at DESC`
    ).bind(user.user_id).all<{ name: string; icon: string | null; unlocked_at: string }>();

    const achievements = rows.results ?? [];
    const text = achievements.length === 0
        ? '🏅 *إنجازاتي*\n\nلا توجد إنجازات مفتوحة بعد.'
        : '🏅 *إنجازاتي*\n\n' + achievements.map(item => `${item.icon ?? '🏅'} ${item.name}`).join('\n');

    await replaceWithText(ctx, text, mainMenuKeyboard(), 'Markdown');
}

async function getAchievementCount(ctx: BotContext, userId: number): Promise<number> {
    const result = await ctx.db.prepare(
        'SELECT COUNT(*) AS count FROM user_achievements WHERE user_id = ?'
    ).bind(userId).first<{ count: number }>();
    return result?.count ?? 0;
}
