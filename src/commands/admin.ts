import { Bot } from 'grammy';
import type { BotContext } from '../bot/context';
import { getAdminUserList, setUserBanned } from '../repositories/userRepository';
import { sendTelegramMessage } from '../services/notifications';

export function registerAdminCommand(bot: Bot<BotContext>): void {
    bot.command('admin_stats', async (ctx) => {
        if (!isAdmin(ctx)) return;

        const users = await getAdminUserList(ctx.db);
        const words = await ctx.db.prepare('SELECT COUNT(*) AS count FROM words').first<{ count: number }>();
        const reviews = await ctx.db.prepare('SELECT COUNT(*) AS count FROM reviews').first<{ count: number }>();
        await ctx.reply(
            `🛠 Admin stats\n\n` +
            `Users: ${users.length}\n` +
            `Words: ${words?.count ?? 0}\n` +
            `Reviews: ${reviews?.count ?? 0}`
        );
    });

    bot.command('users', async (ctx) => {
        if (!isAdmin(ctx)) return;

        const users = await getAdminUserList(ctx.db);
        const text = users.length === 0
            ? 'لا يوجد مستخدمون.'
            : users.slice(0, 30).map((user, index) =>
                `${index + 1}. ${user.display_name} (${user.telegram_user_id ?? user.telegram_id}) — ${user.total_xp} XP — ${user.word_count} words${user.is_banned ? ' — banned' : ''}`
            ).join('\n');
        await ctx.reply(text);
    });

    bot.command('broadcast', async (ctx) => {
        if (!isAdmin(ctx)) return;

        const text = ctx.message?.text?.replace(/^\/broadcast(@\w+)?\s*/i, '').trim();
        if (!text) {
            await ctx.reply('استخدم:\n/broadcast نص الرسالة');
            return;
        }

        const users = await getAdminUserList(ctx.db);
        let sent = 0;
        for (const user of users) {
            if (user.is_banned) continue;
            await sendTelegramMessage(ctx.env, user.telegram_user_id ?? user.telegram_id, text);
            sent++;
        }
        await ctx.reply(`تم إرسال الرسالة إلى ${sent} مستخدم.`);
    });

    bot.command('ban', async (ctx) => {
        if (!isAdmin(ctx)) return;
        await updateBan(ctx, true);
    });

    bot.command('unban', async (ctx) => {
        if (!isAdmin(ctx)) return;
        await updateBan(ctx, false);
    });
}

function isAdmin(ctx: BotContext): boolean {
    const ids = ctx.env.ADMIN_TELEGRAM_IDS?.split(',').map(id => id.trim()).filter(Boolean) ?? [];
    if (ids.length === 0) return false;
    return ids.includes(String(ctx.from?.id ?? ''));
}

async function updateBan(ctx: BotContext, banned: boolean): Promise<void> {
    const target = ctx.message?.text?.split(/\s+/)[1];
    const telegramId = Number(target);
    if (!Number.isFinite(telegramId)) {
        await ctx.reply(`استخدم:\n/${banned ? 'ban' : 'unban'} TELEGRAM_ID`);
        return;
    }

    const updated = await setUserBanned(ctx.db, telegramId, banned);
    await ctx.reply(updated ? (banned ? 'تم الحظر.' : 'تم إلغاء الحظر.') : 'لم أجد هذا المستخدم.');
}
