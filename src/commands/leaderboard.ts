import { Bot } from 'grammy';
import type { BotContext } from '../bot/context';
import { getLeaderboard } from '../services/xpLevels';
import { mainMenuKeyboard } from './menu';

export function registerLeaderboardCommand(bot: Bot<BotContext>): void {
    bot.command('leaderboard', async (ctx) => {
        await showLeaderboard(ctx);
    });

    bot.callbackQuery('menu_leaderboard', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showLeaderboard(ctx);
    });
}

async function showLeaderboard(ctx: BotContext): Promise<void> {
    const leaderboard = await getLeaderboard(ctx.db);

    if (leaderboard.length === 0) {
        await ctx.reply(
            '🏆 *لوحة الترتيب*\n\nلا يوجد مستخدمين مسجلين بعد.',
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
        );
        return;
    }

    let text = '🏆 *لوحة الترتيب*\n\n';
    for (let i = 0; i < leaderboard.length; i++) {
        const user = leaderboard[i];
        const rank = i + 1;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '📌';
        const username = user.telegram_username ? `@${user.telegram_username}` : user.name;
        text += `${medal} *${rank}.* ${username}\n   ⭐ XP: ${user.total_xp} | 🏅 Level: ${user.level}\n\n`;
    }

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() });
}
