import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import { getDueWords, updateWordProgress, recordReview } from '../repositories/srsRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import { calculateNextReview } from '../services/srs';
import { addXp } from '../services/xpLevels';
import { checkAchievements } from '../services/achievements';
import { incrementDailyTask } from '../services/dailyTasks';

interface LearnSessionData {
    words: Array<{ word_id: number; german: string; arabic: string; example: string | null; status: string; ease_factor: number; interval: number; repetitions: number; correct_count: number; wrong_count: number }>;
    currentIndex: number;
    startTime: number;
}

export function registerLearnCommand(bot: Bot<BotContext>): void {
    bot.command('learn', async (ctx) => {
        await startLearning(ctx);
    });

    // Menu callback also triggers learn
    bot.callbackQuery('menu_learn', async (ctx) => {
        await ctx.answerCallbackQuery('جاري تحميل الكلمات...');
        await startLearning(ctx);
    });

    // Handle difficulty rating callbacks
    bot.callbackQuery(/^review_(easy|medium|hard)_(\d+)$/, async (ctx) => {
        const difficulty = ctx.match[1] as 'easy' | 'medium' | 'hard';
        const wordId = parseInt(ctx.match[2], 10);
        await handleReviewAnswer(ctx, true, difficulty, wordId);
    });

    // Handle "I know it" callback (skip with correct answer)
    bot.callbackQuery(/^review_known_(\d+)$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        await handleReviewAnswer(ctx, true, 'easy', wordId);
    });

    // Handle "I don't know" callback
    bot.callbackQuery(/^review_unknown_(\d+)$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        await handleReviewAnswer(ctx, false, 'hard', wordId);
    });
}

async function startLearning(ctx: BotContext): Promise<void> {
    const telegramId = ctx.from?.id ?? 0;
    const user = await getUserByTelegramId(ctx.db, telegramId);

    if (!user) {
        await ctx.reply('يرجى استخدام /start أولاً.');
        return;
    }

    const words = await getDueWords(ctx.db, user.user_id, 10);

    if (words.length === 0) {
        await ctx.reply(
            '✅ لا توجد كلمات مستحقة للمراجعة حالياً!\n\nيمكنك إضافة كلمات جديدة عبر /addword أو رفع ملف CSV.',
            { reply_markup: new InlineKeyboard().text('➕ إضافة كلمة', 'add_word').text('📤 رفع CSV', 'upload_csv') }
        );
        return;
    }

    await saveBotSession<LearnSessionData>(ctx.db, user.user_id, 'learn', {
        words,
        currentIndex: 0,
        startTime: Date.now(),
    });

    await showWord(ctx, user.user_id);
}

async function showWord(ctx: BotContext, userId: number): Promise<void> {
    const session = await getBotSession<LearnSessionData>(ctx.db, userId, 'learn');
    if (!session || session.data.currentIndex >= session.data.words.length) {
        // Session complete
        await deleteBotSession(ctx.db, userId, 'learn');
        await ctx.reply(
            '✅ انتهت المراجعة!\n\nأحسنت، استمر بالتعلم! 🎉',
            { reply_markup: new InlineKeyboard().text('📚 مراجعة أخرى', 'menu_learn').text('🏠 القائمة', 'menu_main') }
        );
        return;
    }

    const word = session.data.words[session.data.currentIndex];
    const progress = `${session.data.currentIndex + 1}/${session.data.words.length}`;

    const text = `📚 *مراجعة* (${progress})\n\n` +
        `🇩🇪 *${word.german}*\n\n` +
        `🇦🇪 ${word.arabic}` +
        (word.example ? `\n\n💬 مثال: _${word.example}_` : '');

    const keyboard = new InlineKeyboard()
        .text('👍 أعرفها', `review_known_${word.word_id}`).row()
        .text('😊 سهلة', `review_easy_${word.word_id}`)
        .text('😐 متوسطة', `review_medium_${word.word_id}`)
        .text('😰 صعبة', `review_hard_${word.word_id}`).row()
        .text('❌ لا أعرفها', `review_unknown_${word.word_id}`);

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

async function handleReviewAnswer(
    ctx: BotContext,
    isCorrect: boolean,
    difficulty: 'easy' | 'medium' | 'hard',
    wordId: number
): Promise<void> {
    const telegramId = ctx.from?.id ?? 0;
    const user = await getUserByTelegramId(ctx.db, telegramId);

    if (!user) {
        await ctx.answerCallbackQuery('خطأ: المستخدم غير موجود');
        return;
    }

    const session = await getBotSession<LearnSessionData>(ctx.db, user.user_id, 'learn');
    if (!session) {
        await ctx.answerCallbackQuery('انتهت الجلسة');
        return;
    }

    const word = session.data.words[session.data.currentIndex];
    if (!word) {
        await ctx.answerCallbackQuery('خطأ: الكلمة غير موجودة');
        return;
    }
    if (word.word_id !== wordId) {
        await ctx.answerCallbackQuery('هذه ليست الكلمة الحالية');
        return;
    }

    // Calculate SRS update
    const srsResult = calculateNextReview(
        {
            easeFactor: word.ease_factor,
            interval: word.interval,
            repetitions: word.repetitions,
            correctCount: word.correct_count,
            wrongCount: word.wrong_count,
        },
        isCorrect,
        difficulty
    );

    // Update word progress
    await updateWordProgress(ctx.db, user.user_id, wordId, {
        status: srsResult.status,
        ease_factor: srsResult.easeFactor,
        interval: srsResult.interval,
        repetitions: srsResult.repetitions,
        next_review: srsResult.nextReview,
        correct_count: word.correct_count + (isCorrect ? 1 : 0),
        wrong_count: word.wrong_count + (isCorrect ? 0 : 1),
    });

    // Record review
    const responseTime = Date.now() - session.data.startTime;
    await recordReview(ctx.db, user.user_id, wordId, isCorrect, responseTime, difficulty);

    // Award XP
    if (isCorrect) {
        await addXp(ctx.db, user.user_id, 2, 'correct_review');
    }
    await incrementDailyTask(ctx, user.user_id, 'review_words');
    await checkAchievements(ctx, user.user_id);

    await ctx.answerCallbackQuery(isCorrect ? '✅ صحيح!' : '❌ خطأ، سنعيدها قريباً');

    // Move to next word
    session.data.currentIndex++;
    session.data.startTime = Date.now();
    await saveBotSession<LearnSessionData>(ctx.db, user.user_id, 'learn', session.data);
    await showWord(ctx, user.user_id);
}
