import { Bot } from 'grammy';
import type { BotContext } from '../bot/context';
import { getLeaderboard } from '../services/xpLevels';
import { mainMenuKeyboard } from './menu';
import { replaceWithText } from './wordPanel';

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
        await replaceWithText(
            ctx,
            '🏆 *لوحة الترتيب*\n\nلا يوجد مستخدمين مسجلين بعد.',
            mainMenuKeyboard(),
            'Markdown'
        );
        return;
    }

    let text = '🏆 *الترتيب العام*\n\n';
    for (let i = 0; i < leaderboard.length; i++) {
        const user = leaderboard[i];
        const rank = i + 1;
        text += `${rank}. ${user.display_name} — ${user.total_xp} XP`;
        if (user.achievements_count > 0) text += ` | 🏅 ${user.achievements_count}`;
        text += '\n';
    }
    text += '\n*الترتيب الأسبوعي جاهز بالبنية:* leaderboard_weekly';

    await replaceWithText(ctx, text, mainMenuKeyboard(), 'Markdown');
}
