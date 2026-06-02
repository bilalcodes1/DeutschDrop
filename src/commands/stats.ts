import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import { getWordCountByStatus } from '../repositories/srsRepository';
import { getTotalXp, getProgressToNextLevel } from '../services/xpLevels';
import { mainMenuKeyboard } from './menu';

export function registerStatsCommand(bot: Bot<BotContext>): void {
    bot.command('stats', async (ctx) => {
        await showStats(ctx);
    });

    bot.callbackQuery('menu_stats', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showStats(ctx);
    });
}

async function showStats(ctx: BotContext): Promise<void> {
    const telegramId = ctx.from?.id ?? 0;
    const user = await getUserByTelegramId(ctx.db, telegramId);

    if (!user) {
        await ctx.reply('يرجى استخدام /start أولاً.');
        return;
    }

    const statusCounts = await getWordCountByStatus(ctx.db, user.user_id);
    const totalXp = await getTotalXp(ctx.db, user.user_id);
    const levelInfo = getProgressToNextLevel(totalXp);

    const totalWords = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    const newWords = statusCounts['new'] ?? 0;
    const learning = statusCounts['learning'] ?? 0;
    const reviewing = statusCounts['reviewing'] ?? 0;
    const mastered = statusCounts['mastered'] ?? 0;

    const progressBar = '█'.repeat(Math.floor(levelInfo.percent / 10)) + '░'.repeat(10 - Math.floor(levelInfo.percent / 10));

    const text = `📊 *إحصائياتك*\n\n` +
        `📚 إجمالي الكلمات: *${totalWords}*\n` +
        `🆕 جديدة: *${newWords}*\n` +
        `📖 قيد التعلم: *${learning}*\n` +
        `🔄 قيد المراجعة: *${reviewing}*\n` +
        `✅ محفوظة: *${mastered}*\n\n` +
        `🏆 المستوى: *${levelInfo.currentLevel}*\n` +
        `⭐ XP: *${levelInfo.current}* / ${levelInfo.target ?? '∞'}\n` +
        `${progressBar} ${levelInfo.percent}%`;

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() });
}
