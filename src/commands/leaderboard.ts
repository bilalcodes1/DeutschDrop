import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getLeaderboardByPeriod, type LeaderboardPeriod } from '../services/xpLevels';
import { replaceWithText } from './wordPanel';

export function registerLeaderboardCommand(bot: Bot<BotContext>): void {
    bot.command('leaderboard', async (ctx) => {
        await showLeaderboard(ctx, 'all_time');
    });

    bot.callbackQuery('menu_leaderboard', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showLeaderboard(ctx, 'all_time');
    });

    bot.callbackQuery(/^leaderboard_(daily|weekly|monthly|all_time)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showLeaderboard(ctx, ctx.match[1] as LeaderboardPeriod);
    });
}

async function showLeaderboard(ctx: BotContext, period: LeaderboardPeriod): Promise<void> {
    const leaderboard = await getLeaderboardByPeriod(ctx.db, period);

    if (leaderboard.length === 0) {
        await replaceWithText(
            ctx,
            '🏆 *الصدارة*\n\nلا يوجد مستخدمين مسجلين بعد.',
            leaderboardKeyboard(period),
            'Markdown'
        );
        return;
    }

    let text = `${periodTitle(period)}\n\n`;
    for (let i = 0; i < leaderboard.length; i++) {
        const user = leaderboard[i];
        const rank = i + 1;
        const xp = period === 'all_time' ? user.total_xp : user.period_xp;
        text += `${rank}. ${user.display_name}${user.is_supporter_active ? ' 💙' : ''} — ${xp} XP`;
        if (user.achievements_count > 0) text += ` | 🏅 ${user.achievements_count}`;
        text += '\n';
    }

    await replaceWithText(ctx, text, leaderboardKeyboard(period), 'Markdown');
}

function leaderboardKeyboard(period: LeaderboardPeriod): InlineKeyboard {
    void period;
    return new InlineKeyboard()
        .text('🏆 اليوم', 'leaderboard_daily')
        .text('🔥 الأسبوع', 'leaderboard_weekly').row()
        .text('👑 الشهر', 'leaderboard_monthly')
        .text('🌍 الكل', 'leaderboard_all_time').row()
        .text('⬅️ رجوع', 'menu_more')
        .text('🏠 الرئيسية', 'menu_main');
}

function periodTitle(period: LeaderboardPeriod): string {
    if (period === 'daily') return '🏆 *صدارة اليوم*';
    if (period === 'weekly') return '🔥 *صدارة الأسبوع*';
    if (period === 'monthly') return '👑 *صدارة الشهر*';
    return '🌍 *الترتيب العام*';
}
