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
    const weeklyXp = await getWeeklyXp(ctx, user.user_id);
    const reviewStats = await getReviewStats(ctx, user.user_id);
    const hardWords = await getHardWordCount(ctx, user.user_id);
    const streak = await getCurrentStreak(ctx, user.user_id);
    const levelInfo = getProgressToNextLevel(totalXp);

    const totalWords = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    const newWords = statusCounts['new'] ?? 0;
    const learning = statusCounts['learning'] ?? 0;
    const reviewing = statusCounts['reviewing'] ?? 0;
    const mastered = statusCounts['mastered'] ?? 0;
    const totalAnswers = reviewStats.correct + reviewStats.wrong;
    const accuracy = totalAnswers > 0 ? Math.round((reviewStats.correct / totalAnswers) * 100) : 0;
    const cefr = getCefrProgress(totalWords);

    const progressBar = '█'.repeat(Math.floor(levelInfo.percent / 10)) + '░'.repeat(10 - Math.floor(levelInfo.percent / 10));

    const text = `📊 *إحصائياتك*\n\n` +
        `📚 إجمالي الكلمات: *${totalWords}*\n` +
        `🆕 جديدة: *${newWords}*\n` +
        `📖 قيد التعلم: *${learning}*\n` +
        `🔄 قيد المراجعة: *${reviewing}*\n` +
        `✅ محفوظة: *${mastered}*\n` +
        `🔥 كلمات صعبة: *${hardWords}*\n\n` +
        `🎯 نسبة النجاح: *${accuracy}%*\n` +
        `✅ إجابات صحيحة: *${reviewStats.correct}*\n` +
        `❌ أخطاء: *${reviewStats.wrong}*\n\n` +
        `🏆 المستوى: *${levelInfo.currentLevel}*\n` +
        `⭐ XP: *${levelInfo.current}* / ${levelInfo.target ?? '∞'}\n` +
        `📆 XP الأسبوعي: *${weeklyXp}*\n` +
        `🔥 السلسلة اليومية: *${streak}*\n` +
        `${progressBar} ${levelInfo.percent}%\n\n` +
        `🇩🇪 تقدم ${cefr.level}: *${cefr.current}/${cefr.target}* كلمة (${cefr.percent}%)`;

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() });
}

async function getWeeklyXp(ctx: BotContext, userId: number): Promise<number> {
    const row = await ctx.db.prepare(
        'SELECT COALESCE(SUM(amount), 0) AS total FROM xp_log WHERE user_id = ? AND created_at >= datetime("now", "-7 days")'
    ).bind(userId).first<{ total: number }>();
    return row?.total ?? 0;
}

async function getReviewStats(ctx: BotContext, userId: number): Promise<{ correct: number; wrong: number }> {
    const row = await ctx.db.prepare(
        `SELECT
            COALESCE(SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END), 0) AS correct,
            COALESCE(SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END), 0) AS wrong
         FROM reviews
         WHERE user_id = ?`
    ).bind(userId).first<{ correct: number; wrong: number }>();

    return {
        correct: row?.correct ?? 0,
        wrong: row?.wrong ?? 0,
    };
}

async function getHardWordCount(ctx: BotContext, userId: number): Promise<number> {
    const row = await ctx.db.prepare(
        `SELECT COUNT(*) AS count
         FROM user_words
         WHERE user_id = ?
           AND (wrong_count >= 2 OR wrong_count > correct_count OR status = 'learning')`
    ).bind(userId).first<{ count: number }>();
    return row?.count ?? 0;
}

async function getCurrentStreak(ctx: BotContext, userId: number): Promise<number> {
    const row = await ctx.db.prepare(
        'SELECT current_streak FROM daily_streaks WHERE user_id = ?'
    ).bind(userId).first<{ current_streak: number }>();
    return row?.current_streak ?? 0;
}

function getCefrProgress(totalWords: number): { level: 'A1' | 'A2' | 'B1'; current: number; target: number; percent: number } {
    if (totalWords < 500) {
        return buildCefrProgress('A1', totalWords, 500);
    }
    if (totalWords < 1500) {
        return buildCefrProgress('A2', totalWords, 1500);
    }
    return buildCefrProgress('B1', totalWords, 3000);
}

function buildCefrProgress(level: 'A1' | 'A2' | 'B1', current: number, target: number): { level: 'A1' | 'A2' | 'B1'; current: number; target: number; percent: number } {
    return {
        level,
        current,
        target,
        percent: Math.min(100, Math.round((current / target) * 100)),
    };
}
