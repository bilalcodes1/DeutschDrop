import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId, isRegisteredUser, renameUser } from '../repositories/userRepository';
import { getWordsByUser } from '../repositories/wordRepository';
import { getActiveSupportStatus } from '../repositories/supportRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
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

    bot.callbackQuery('profile_rename_start', async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!isRegisteredUser(user)) return;
        await saveBotSession(ctx.db, user.user_id, 'profile_rename', { awaiting: true }, 30);
        await replaceWithText(
            ctx,
            '✏️ اكتب الاسم الجديد الذي تريد ظهوره في البوت:',
            new InlineKeyboard().text('❌ إلغاء', 'profile_rename_cancel').text('🏠 الرئيسية', 'menu_main')
        );
    });

    bot.callbackQuery('profile_rename_cancel', async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (user) await deleteBotSession(ctx.db, user.user_id, 'profile_rename');
        await showProfile(ctx);
    });

    bot.on('message:text', async (ctx, next) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!isRegisteredUser(user)) return next();
        if (await getBotSession(ctx.db, user.user_id, 'train')) return next();
        if (await getBotSession(ctx.db, user.user_id, 'challenge')) return next();
        const session = await getBotSession(ctx.db, user.user_id, 'profile_rename');
        if (!session) return next();

        const name = sanitizeProfileName(ctx.message.text);
        if (!name) {
            await ctx.reply('الاسم غير صالح. اكتب اسماً من 2 إلى 30 حرفاً، بدون روابط أو أسطر كثيرة.');
            return;
        }

        await renameUser(ctx.db, user.user_id, name);
        await deleteBotSession(ctx.db, user.user_id, 'profile_rename');
        await ctx.reply('تم تغيير الاسم ✅');
        await showProfile(ctx);
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

    await replaceWithText(ctx, text, profileKeyboard(), 'Markdown');
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

function profileKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('✏️ تعديل الاسم', 'profile_rename_start').row()
        .text('🏅 الإنجازات', 'menu_achievements').row()
        .text('🏠 الرئيسية', 'menu_main');
}

function sanitizeProfileName(value: string): string | null {
    const name = value.trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 30) return null;
    if (/https?:\/\//i.test(name) || /www\./i.test(name)) return null;
    if (value.split(/\r?\n/).length > 2) return null;
    if (name.startsWith('/')) return null;
    return name;
}
