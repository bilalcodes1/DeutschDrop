import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import { getWordsForUserWithStatus } from '../repositories/wordRepository';
import { recordReview } from '../repositories/srsRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import { isHardWord, selectTrainingWords } from '../services/srs';
import { addXp } from '../services/xpLevels';
import { mainMenuKeyboard } from './menu';

interface TrainingQuestion {
    word_id: number;
    prompt: string;
    answer: string;
    options: string[];
    direction: 'de_ar' | 'ar_de';
}

interface TrainingSessionData {
    questions: TrainingQuestion[];
    currentIndex: number;
    correctCount: number;
    startTime: number;
}

export function registerTrainCommand(bot: Bot<BotContext>): void {
    bot.command('train', async (ctx) => {
        await showTrainOptions(ctx);
    });

    // Handle training count selection
    bot.callbackQuery(/^train_(\d+)$/, async (ctx) => {
        const count = parseInt(ctx.match[1], 10);
        await ctx.answerCallbackQuery();
        await startTraining(ctx, count, 'standard');
    });

    bot.callbackQuery('train_hard', async (ctx) => {
        await ctx.answerCallbackQuery();
        await startTraining(ctx, 10, 'hard');
    });

    bot.callbackQuery('train_exam', async (ctx) => {
        await ctx.answerCallbackQuery();
        await startTraining(ctx, 20, 'exam');
    });

    // Handle answer callbacks
    bot.callbackQuery(/^train_ans_(\d+)_(\d+)_(correct|wrong)$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        const isCorrect = ctx.match[3] === 'correct';
        await handleTrainAnswer(ctx, wordId, isCorrect);
    });
}

async function showTrainOptions(ctx: BotContext): Promise<void> {
    const keyboard = new InlineKeyboard()
        .text('تدريب سريع 5 أسئلة', 'train_5').row()
        .text('10 أسئلة', 'train_10')
        .text('20 سؤال', 'train_20').row()
        .text('🔥 الكلمات الصعبة', 'train_hard').row()
        .text('🎯 مراجعة قبل الامتحان', 'train_exam').row()
        .text('⬅️ رجوع', 'menu_main');

    await ctx.reply('🏋️ *اختر عدد الأسئلة:*', { parse_mode: 'Markdown', reply_markup: keyboard });
}

async function startTraining(ctx: BotContext, count: number, mode: 'standard' | 'hard' | 'exam'): Promise<void> {
    const telegramId = ctx.from?.id ?? 0;
    const user = await getUserByTelegramId(ctx.db, telegramId);

    if (!user) {
        await ctx.reply('يرجى استخدام /start أولاً.');
        return;
    }

    const allWords = await getWordsForUserWithStatus(ctx.db, user.user_id);
    const words = mode === 'hard'
        ? allWords.filter(w => isHardWord({ wrongCount: w.wrong_count, correctCount: w.correct_count, status: w.status }))
        : allWords;

    if (words.length < count) {
        const label = mode === 'hard' ? 'كلمة صعبة' : 'كلمة';
        await ctx.reply(
            `⚠️ لديك ${words.length} ${label} فقط.\nأضف المزيد عبر /addword أو راجع كلمات أكثر.`,
            { reply_markup: mainMenuKeyboard() }
        );
        return;
    }

    const selected = mode === 'exam'
        ? selectExamWords(words, count)
        : selectTrainingWords(
            words.map(w => ({ wordId: w.word_id, status: w.status, wrongCount: w.wrong_count, correctCount: w.correct_count })),
            count
        );

    const questions = selected.map((s, i) => {
        const w = words.find(word => word.word_id === s.wordId)!;
        const direction: 'de_ar' | 'ar_de' = i % 2 === 0 ? 'de_ar' : 'ar_de';
        const answer = direction === 'de_ar' ? w.arabic : w.german;
        const prompt = direction === 'de_ar' ? w.german : w.arabic;
        const distractors = buildDistractors(words, w.word_id, direction, 2);
        return {
            word_id: w.word_id,
            prompt,
            answer,
            direction,
            options: shuffle([answer, ...distractors]),
        };
    });

    await saveBotSession<TrainingSessionData>(ctx.db, user.user_id, 'train', {
        questions,
        currentIndex: 0,
        correctCount: 0,
        startTime: Date.now(),
    });

    await showTrainingQuestion(ctx, user.user_id);
}

async function showTrainingQuestion(ctx: BotContext, userId: number): Promise<void> {
    const session = await getBotSession<TrainingSessionData>(ctx.db, userId, 'train');
    if (!session || session.data.currentIndex >= session.data.questions.length) {
        await deleteBotSession(ctx.db, userId, 'train');
        const total = session?.data.questions.length ?? 0;
        const correct = session?.data.correctCount ?? 0;
        const percent = total > 0 ? Math.round((correct / total) * 100) : 0;

        await ctx.reply(
            `✅ انتهى التدريب!\n\n📊 النتيجة: ${correct}/${total} (${percent}%)\n🎯 XP: +${correct * 2}`,
            { reply_markup: mainMenuKeyboard() }
        );
        return;
    }

    const q = session.data.questions[session.data.currentIndex];
    const progress = `${session.data.currentIndex + 1}/${session.data.questions.length}`;
    const keyboard = new InlineKeyboard();
    for (let i = 0; i < q.options.length; i++) {
        const opt = q.options[i];
        const isCorrect = opt === q.answer;
        keyboard.text(opt, `train_ans_${q.word_id}_${i}_${isCorrect ? 'correct' : 'wrong'}`).row();
    }
    keyboard.text('⬅️ رجوع', 'menu_main');

    const label = q.direction === 'de_ar' ? 'اختر المعنى العربي' : 'اختر الكلمة الألمانية';
    const flag = q.direction === 'de_ar' ? '🇩🇪' : '🇦🇪';
    await ctx.reply(
        `🏋️ (${progress}) ${label}:\n\n${flag} *${q.prompt}*`,
        { parse_mode: 'Markdown', reply_markup: keyboard }
    );
}

async function handleTrainAnswer(ctx: BotContext, wordId: number, isCorrect: boolean): Promise<void> {
    const telegramId = ctx.from?.id ?? 0;
    const user = await getUserByTelegramId(ctx.db, telegramId);

    if (!user) {
        await ctx.answerCallbackQuery('خطأ: المستخدم غير موجود');
        return;
    }

    const session = await getBotSession<TrainingSessionData>(ctx.db, user.user_id, 'train');
    if (!session) {
        await ctx.answerCallbackQuery('انتهت الجلسة');
        return;
    }

    const current = session.data.questions[session.data.currentIndex];
    if (!current || current.word_id !== wordId) {
        await ctx.answerCallbackQuery('هذا ليس السؤال الحالي');
        return;
    }

    if (isCorrect) {
        session.data.correctCount++;
        await addXp(ctx.db, user.user_id, 2, 'correct_train');
        await ctx.answerCallbackQuery('✅ صحيح! +2 XP');
    } else {
        await ctx.answerCallbackQuery('❌ خطأ');
    }

    // Record as review
    await recordReview(ctx.db, user.user_id, wordId, isCorrect, null, null);

    // Move to next question
    session.data.currentIndex++;
    session.data.startTime = Date.now();
    await saveBotSession<TrainingSessionData>(ctx.db, user.user_id, 'train', session.data);
    await showTrainingQuestion(ctx, user.user_id);
}

function buildDistractors(
    words: Array<{ word_id: number; german: string; arabic: string }>,
    currentWordId: number,
    direction: 'de_ar' | 'ar_de',
    count: number
): string[] {
    const seen = new Set<string>();
    const options: string[] = [];
    for (const word of shuffle(words.filter(w => w.word_id !== currentWordId))) {
        const value = direction === 'de_ar' ? word.arabic : word.german;
        if (seen.has(value)) continue;
        seen.add(value);
        options.push(value);
        if (options.length >= count) break;
    }
    return options;
}

function selectExamWords(
    words: Array<{ word_id: number; status: string; wrong_count: number; correct_count: number }>,
    count: number
): Array<{ wordId: number; status: string }> {
    return [...words]
        .sort((a, b) => {
            const aScore = a.wrong_count * 2 - a.correct_count;
            const bScore = b.wrong_count * 2 - b.correct_count;
            return bScore - aScore;
        })
        .slice(0, count)
        .map(w => ({ wordId: w.word_id, status: w.status }));
}

function shuffle<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
