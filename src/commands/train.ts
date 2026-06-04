import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import { getTrainingWordCandidates, getWordById } from '../repositories/wordRepository';
import { recordReview } from '../repositories/srsRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import { getActiveReviewPlan, incrementReviewPlanProgress } from '../repositories/reviewPlanRepository';
import { isHardWord, selectTrainingWords } from '../services/srs';
import { addXp } from '../services/xpLevels';
import { checkAchievements } from '../services/achievements';
import { incrementDailyTask } from '../services/dailyTasks';
import { mainMenuKeyboard } from './menu';
import { replaceWithText } from './wordPanel';
import type { TrainExplainSession } from './aiCoach';

export interface TrainingQuestion {
    question_index: number;
    word_id: number;
    type: TrainingQuestionType;
    prompt: string;
    answer: string;
    options: string[];
    direction: 'de_ar' | 'ar_de';
    helper?: string;
}

export interface TrainingSessionData {
    questions: TrainingQuestion[];
    currentIndex: number;
    answeredCount: number;
    correctCount: number;
    wrongCount: number;
    answeredQuestionIndexes: number[];
    wrongWordIds: number[];
    startTime: number;
    planId?: number;
}

type TrainingQuestionType =
    'multiple_choice' |
    'german_to_arabic' |
    'arabic_to_german' |
    'typing_de' |
    'typing_ar' |
    'missing_letters' |
    'first_last_hint' |
    'example_context' |
    'pictogram_recall';

type TrainingMode = 'mixed' | 'typing' | 'missing' | 'de_ar' | 'ar_de' | 'hard' | 'exam' | 'plan';

export function registerTrainCommand(bot: Bot<BotContext>): void {
    bot.command('train', async (ctx) => {
        await showTrainOptions(ctx);
    });

    // Handle training count selection
    bot.callbackQuery(/^train_(\d+)$/, async (ctx) => {
        const count = parseInt(ctx.match[1], 10);
        await ctx.answerCallbackQuery();
        await startTraining(ctx, count, 'mixed');
    });

    bot.callbackQuery('train_quick', async (ctx) => {
        await ctx.answerCallbackQuery();
        await startTraining(ctx, 5, 'mixed');
    });

    bot.callbackQuery('train_mixed', async (ctx) => {
        await ctx.answerCallbackQuery();
        await startTraining(ctx, 10, 'mixed');
    });

    bot.callbackQuery('train_typing', async (ctx) => {
        await ctx.answerCallbackQuery();
        await startTraining(ctx, 10, 'typing');
    });

    bot.callbackQuery('train_missing', async (ctx) => {
        await ctx.answerCallbackQuery();
        await startTraining(ctx, 10, 'missing');
    });

    bot.callbackQuery('train_de_ar', async (ctx) => {
        await ctx.answerCallbackQuery();
        await startTraining(ctx, 10, 'de_ar');
    });

    bot.callbackQuery('train_ar_de', async (ctx) => {
        await ctx.answerCallbackQuery();
        await startTraining(ctx, 10, 'ar_de');
    });

    bot.callbackQuery('train_hard', async (ctx) => {
        await ctx.answerCallbackQuery();
        await startTraining(ctx, 10, 'hard');
    });

    bot.callbackQuery('train_exam', async (ctx) => {
        await ctx.answerCallbackQuery();
        await startTraining(ctx, 20, 'exam');
    });

    bot.callbackQuery('train_plan', async (ctx) => {
        await ctx.answerCallbackQuery();
        await startReviewPlanTraining(ctx);
    });

    bot.callbackQuery(/^train_plan_(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await startReviewPlanTraining(ctx, Number(ctx.match[1]));
    });

    // Handle answer callbacks
    bot.callbackQuery(/^train_ans_(\d+)_(\d+)_(\d+)_(correct|wrong)$/, async (ctx) => {
        const questionIndex = parseInt(ctx.match[1], 10);
        const wordId = parseInt(ctx.match[2], 10);
        const optionIndex = parseInt(ctx.match[3], 10);
        const isCorrect = ctx.match[4] === 'correct';
        await handleTrainAnswer(ctx, questionIndex, wordId, optionIndex, isCorrect);
    });

    bot.callbackQuery('train_continue', async (ctx) => {
        await continueTraining(ctx);
    });

    bot.on('message:text', async (ctx, next) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user || ctx.message.text.startsWith('/')) return next();
        const session = await getBotSession<TrainingSessionData>(ctx.db, user.user_id, 'train');
        const current = session?.data.questions[session.data.currentIndex];
        if (!session || !current) return next();
        if (current.options.length > 0) {
            await ctx.reply('🏋️ عندك تدريب فعال. استخدم أزرار الإجابة الحالية أو اضغط 🏠 الرئيسية لإنهاء الجلسة.');
            return;
        }
        await handleTypedTrainingAnswer(ctx, current, ctx.message.text);
    });
}

async function showTrainOptions(ctx: BotContext): Promise<void> {
    const keyboard = new InlineKeyboard()
        .text('⚡ تدريب سريع', 'train_quick')
        .text('🎲 مختلط', 'train_mixed').row()
        .text('✍️ كتابة', 'train_typing')
        .text('🧩 حروف ناقصة', 'train_missing').row()
        .text('🇩🇪 ألماني → عربي', 'train_de_ar').row()
        .text('🇮🇶 عربي → ألماني', 'train_ar_de').row()
        .text('🔥 الكلمات الصعبة', 'train_hard').row()
        .text('📦 جلسة خطة المراجعة', 'train_plan').row()
        .text('⬅️ رجوع', 'menu_main')
        .text('🏠 الرئيسية', 'menu_main');

    await replaceWithText(ctx, '🏋️ *اختر نوع التدريب:*\n\nالافتراضي الأفضل هو 🎲 مختلط.', keyboard, 'Markdown');
}

async function startTraining(ctx: BotContext, count: number, mode: TrainingMode, planId?: number): Promise<void> {
    const telegramId = ctx.from?.id ?? 0;
    const user = await getUserByTelegramId(ctx.db, telegramId);

    if (!user) {
        await ctx.reply('يرجى استخدام /start أولاً.');
        return;
    }

    await replaceWithText(ctx, '⏳ جاري تجهيز تدريب جديد...', mainMenuKeyboard());

    const allWords = await getTrainingWordCandidates(ctx.db, user.user_id, Math.max(100, count * 6));
    const words = mode === 'hard'
        ? allWords.filter(w => isHardWord({ wrongCount: w.wrong_count, correctCount: w.correct_count, status: w.status }))
        : allWords;

    if (words.length === 0) {
        const label = mode === 'hard' ? 'كلمة صعبة' : 'كلمة';
        await replaceWithText(
            ctx,
            `⚠️ لا توجد ${label} مناسبة للتدريب حالياً.\nأضف كلمات جديدة أو راجع كلمات أكثر.`,
            mainMenuKeyboard()
        );
        return;
    }

    const selected = selectTrainingWords(
        words.map(w => ({
            wordId: w.word_id,
            status: w.status,
            wrongCount: w.wrong_count,
            correctCount: w.correct_count,
            nextReview: w.next_review,
        })),
        count,
        mode
    );

    const questions = selected.map((s, i) => {
        const w = words.find(word => word.word_id === s.wordId)!;
        return buildTrainingQuestion(words, w, mode, i);
    });

    await clearConflictingTextSessions(ctx, user.user_id);
    await saveBotSession<TrainingSessionData>(ctx.db, user.user_id, 'train', {
        questions,
        currentIndex: 0,
        answeredCount: 0,
        correctCount: 0,
        wrongCount: 0,
        answeredQuestionIndexes: [],
        wrongWordIds: [],
        startTime: Date.now(),
        ...(planId ? { planId } : {}),
    });

    await showTrainingQuestion(ctx, user.user_id);
}

async function clearConflictingTextSessions(ctx: BotContext, userId: number): Promise<void> {
    await deleteBotSession(ctx.db, userId, 'word_edit');
    await deleteBotSession(ctx.db, userId, 'add_word');
    await deleteBotSession(ctx.db, userId, 'word_search');
}

async function startReviewPlanTraining(ctx: BotContext, forcedPlanId?: number): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!user) {
        await ctx.reply('يرجى استخدام /start أولاً.');
        return;
    }
    const plan = await getActiveReviewPlan(ctx.db, user.user_id);
    if (!plan || (forcedPlanId && plan.id !== forcedPlanId)) {
        await replaceWithText(ctx, 'لا توجد خطة مراجعة نشطة حالياً.', mainMenuKeyboard());
        return;
    }
    await startTraining(ctx, Math.min(plan.batch_size, Math.max(1, plan.total_words - plan.reviewed_words)), 'plan', plan.id);
}

async function showTrainingQuestion(ctx: BotContext, userId: number): Promise<void> {
    const session = await getBotSession<TrainingSessionData>(ctx.db, userId, 'train');
    if (!session || session.data.currentIndex >= session.data.questions.length) {
        await deleteBotSession(ctx.db, userId, 'train');
        const total = session?.data.answeredCount ?? session?.data.questions.length ?? 0;
        const correct = session?.data.correctCount ?? 0;
        const wrong = session?.data.wrongCount ?? Math.max(0, total - correct);
        const percent = total > 0 ? Math.round((correct / total) * 100) : 0;

        await replaceWithText(
            ctx,
            `✅ انتهى التدريب!\n\n📊 النتيجة: ${correct}/${total} (${percent}%)\n❌ الأخطاء: ${wrong}\n🎯 XP: +${correct * 2}`,
            trainingFinishedKeyboard(session?.data.wrongWordIds.length ?? 0)
        );
        return;
    }

    const q = session.data.questions[session.data.currentIndex];
    const progress = `${session.data.currentIndex + 1}/${session.data.questions.length}`;
    const keyboard = new InlineKeyboard();
    for (let i = 0; i < q.options.length; i++) {
        const opt = q.options[i];
        const isCorrect = normalizeAnswer(opt) === normalizeAnswer(q.answer);
        keyboard.text(opt, `train_ans_${q.question_index}_${q.word_id}_${i}_${isCorrect ? 'correct' : 'wrong'}`).row();
    }
    keyboard.text('⬅️ رجوع', 'menu_train').text('🏠 الرئيسية', 'menu_main');

    const label = questionLabel(q);
    const flag = q.direction === 'de_ar' ? '🇩🇪' : '🇮🇶';
    await replaceWithText(
        ctx,
        `🏋️ (${progress}) ${label}:\n\n${flag} *${q.prompt}*` +
        (q.helper ? `\n\n${q.helper}` : '') +
        (q.options.length === 0 ? `\n\nاكتب جوابك برسالة عادية.` : ''),
        keyboard,
        'Markdown'
    );
}

async function handleTrainAnswer(ctx: BotContext, questionIndex: number, wordId: number, optionIndex: number, isCorrect: boolean): Promise<void> {
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
    if (!current || current.word_id !== wordId || current.question_index !== questionIndex) {
        await ctx.answerCallbackQuery('هذا ليس السؤال الحالي');
        return;
    }

    if (isQuestionAnswered(session.data, current.question_index)) {
        await ctx.answerCallbackQuery('تم احتساب هذا السؤال');
        return;
    }

    markQuestionAnswered(session.data, current, isCorrect);

    if (isCorrect) {
        await addXp(ctx.db, user.user_id, 2, 'correct_train');
        await ctx.answerCallbackQuery('✅ صحيح! +2 XP');
    } else {
        await ctx.answerCallbackQuery('❌ خطأ');
    }

    // Record as review
    await recordReview(ctx.db, user.user_id, wordId, isCorrect, null, null);
    await checkAchievements(ctx, user.user_id);

    if (!isCorrect) {
        const word = await getWordById(ctx.db, wordId);
        if (word) {
            await saveBotSession<TrainExplainSession>(ctx.db, user.user_id, 'train_explain', {
                wordId,
                questionType: current.direction,
                german: word.german,
                arabic: word.arabic,
                userAnswer: current.options[optionIndex] ?? '',
                correctAnswer: current.answer,
                example: word.example,
            }, 30);
        }
        await saveBotSession<TrainingSessionData>(ctx.db, user.user_id, 'train', session.data);
        await replaceWithText(
            ctx,
            `❌ خطأ\n\nالصحيح: *${current.answer}*`,
            new InlineKeyboard()
                .text('🤖 اشرح لي', 'train_explain').row()
                .text('🏋️ أكمل التدريب', 'train_continue').row()
                .text('🏠 الرئيسية', 'menu_main'),
            'Markdown'
        );
        return;
    }

    await advanceTraining(ctx, user.user_id, session.data);
}

async function handleTypedTrainingAnswer(ctx: BotContext, current: TrainingQuestion, answerText: string): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!user) return;
    const isCorrect = normalizeAnswer(answerText) === normalizeAnswer(current.answer);
    const session = await getBotSession<TrainingSessionData>(ctx.db, user.user_id, 'train');
    if (!session) return;

    if (isQuestionAnswered(session.data, current.question_index)) {
        await ctx.reply('تم احتساب هذا السؤال. اضغط 🏋️ التالي أو 🏠 الرئيسية.');
        return;
    }

    markQuestionAnswered(session.data, current, isCorrect);

    if (isCorrect) {
        await addXp(ctx.db, user.user_id, 2, 'correct_train');
    }

    await recordReview(ctx.db, user.user_id, current.word_id, isCorrect, null, null);
    await checkAchievements(ctx, user.user_id);

    if (!isCorrect) {
        const word = await getWordById(ctx.db, current.word_id);
        if (word) {
            await saveBotSession<TrainExplainSession>(ctx.db, user.user_id, 'train_explain', {
                wordId: current.word_id,
                questionType: current.direction,
                german: word.german,
                arabic: word.arabic,
                userAnswer: answerText,
                correctAnswer: current.answer,
                example: word.example,
            }, 30);
        }
        await saveBotSession<TrainingSessionData>(ctx.db, user.user_id, 'train', session.data);
        await replaceWithText(
            ctx,
            `❌ خطأ\n\nجوابك: *${answerText.trim()}*\nالصحيح: *${current.answer}*`,
            new InlineKeyboard()
                .text('🤖 اشرح لي', 'train_explain').row()
                .text('🏋️ أكمل التدريب', 'train_continue').row()
                .text('🏠 الرئيسية', 'menu_main'),
            'Markdown'
        );
        return;
    }

    await saveBotSession<TrainingSessionData>(ctx.db, user.user_id, 'train', session.data);
    await replaceWithText(ctx, '✅ صحيح! +2 XP', new InlineKeyboard().text('🏋️ التالي', 'train_continue').text('🏠 الرئيسية', 'menu_main'));
}

async function continueTraining(ctx: BotContext): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!user) {
        await ctx.answerCallbackQuery('خطأ: المستخدم غير موجود');
        return;
    }
    const session = await getBotSession<TrainingSessionData>(ctx.db, user.user_id, 'train');
    if (!session) {
        await replaceWithText(ctx, 'انتهت جلسة التدريب.', mainMenuKeyboard());
        return;
    }
    const current = session.data.questions[session.data.currentIndex];
    if (current && !isQuestionAnswered(session.data, current.question_index)) {
        await showTrainingQuestion(ctx, user.user_id);
        return;
    }
    await deleteBotSession(ctx.db, user.user_id, 'train_explain');
    await advanceTraining(ctx, user.user_id, session.data);
}

async function advanceTraining(ctx: BotContext, userId: number, data: TrainingSessionData): Promise<void> {
    data.currentIndex++;
    data.startTime = Date.now();
    await saveBotSession<TrainingSessionData>(ctx.db, userId, 'train', data);
    if (data.currentIndex >= data.questions.length) {
        await incrementDailyTask(ctx, userId, 'complete_training');
        if (data.planId) await incrementReviewPlanProgress(ctx.db, data.planId, data.questions.length);
    }
    await showTrainingQuestion(ctx, userId);
}

function markQuestionAnswered(data: TrainingSessionData, question: TrainingQuestion, isCorrect: boolean): void {
    if (isQuestionAnswered(data, question.question_index)) return;
    data.answeredQuestionIndexes.push(question.question_index);
    data.answeredCount = (data.answeredCount ?? 0) + 1;
    if (isCorrect) {
        data.correctCount = (data.correctCount ?? 0) + 1;
    } else {
        data.wrongCount = (data.wrongCount ?? 0) + 1;
        if (!data.wrongWordIds.includes(question.word_id)) data.wrongWordIds.push(question.word_id);
    }
}

function isQuestionAnswered(data: TrainingSessionData, questionIndex: number): boolean {
    return (data.answeredQuestionIndexes ?? []).includes(questionIndex);
}

function trainingFinishedKeyboard(hasWrongWords: number): InlineKeyboard {
    const keyboard = new InlineKeyboard()
        .text('🔁 تدريب جديد', 'train_mixed').row();
    if (hasWrongWords > 0) keyboard.text('🔥 درّب الكلمات الغلط', 'train_hard').row();
    keyboard.text('📚 راجع الآن', 'menu_learn').row()
        .text('🏠 الرئيسية', 'menu_main');
    return keyboard;
}

export function validateTrainingSessionQuestions(session: TrainingSessionData, availableUniqueWords: number = session.questions.length): boolean {
    if (session.questions.length === 0) return false;
    const exactQuestions = new Set<string>();
    const wordIds = new Set<number>();
    for (const question of session.questions) {
        if (!question.word_id || question.question_index === undefined || !question.answer?.trim()) return false;
        const exactKey = `${question.word_id}:${question.type}:${question.prompt}:${question.answer}`;
        if (exactQuestions.has(exactKey) && availableUniqueWords >= session.questions.length) return false;
        exactQuestions.add(exactKey);
        wordIds.add(question.word_id);
    }
    const duplicates = session.questions.length - wordIds.size;
    return duplicates === 0 || availableUniqueWords < session.questions.length;
}

function buildTrainingQuestion(
    words: Array<{ word_id: number; german: string; arabic: string; example: string | null }>,
    word: { word_id: number; german: string; arabic: string; example: string | null },
    mode: TrainingMode,
    index: number
): TrainingQuestion {
    const type = chooseQuestionType(mode, index, Boolean(word.example));
    if (type === 'typing_de') {
        return { question_index: index, word_id: word.word_id, type, prompt: word.arabic, answer: word.german, direction: 'ar_de', options: [] };
    }
    if (type === 'typing_ar') {
        return { question_index: index, word_id: word.word_id, type, prompt: word.german, answer: word.arabic, direction: 'de_ar', options: [] };
    }
    if (type === 'missing_letters') {
        return {
            question_index: index,
            word_id: word.word_id,
            type,
            prompt: `${maskGerman(word.german)}`,
            answer: word.german,
            direction: 'ar_de',
            options: [],
            helper: `المعنى: ${word.arabic}`,
        };
    }
    if (type === 'first_last_hint') {
        return {
            question_index: index,
            word_id: word.word_id,
            type,
            prompt: word.arabic,
            answer: word.german,
            direction: 'ar_de',
            options: [],
            helper: `أول حرف: ${word.german[0] ?? '-'}\nآخر حرف: ${word.german[word.german.length - 1] ?? '-'}`,
        };
    }
    if (type === 'example_context' && word.example) {
        const distractors = buildDistractors(words, word.word_id, 'de_ar', 2);
        return {
            question_index: index,
            word_id: word.word_id,
            type,
            prompt: word.example,
            answer: word.arabic,
            direction: 'de_ar',
            options: shuffle([word.arabic, ...distractors]),
            helper: `شنو معنى "${word.german}" من السياق؟`,
        };
    }

    const direction: 'de_ar' | 'ar_de' = type === 'arabic_to_german' ? 'ar_de' : 'de_ar';
    const answer = direction === 'de_ar' ? word.arabic : word.german;
    const prompt = direction === 'de_ar' ? word.german : word.arabic;
    const distractors = buildDistractors(words, word.word_id, direction, 2);
    return {
        question_index: index,
        word_id: word.word_id,
        type,
        prompt,
        answer,
        direction,
        options: shuffle([answer, ...distractors]),
    };
}

function chooseQuestionType(mode: TrainingMode, index: number, hasExample: boolean): TrainingQuestionType {
    if (mode === 'de_ar') return 'german_to_arabic';
    if (mode === 'ar_de') return 'arabic_to_german';
    if (mode === 'typing') return index % 2 === 0 ? 'typing_de' : 'typing_ar';
    if (mode === 'missing') return index % 2 === 0 ? 'missing_letters' : 'first_last_hint';
    const types: TrainingQuestionType[] = [
        'multiple_choice',
        'german_to_arabic',
        'arabic_to_german',
        'typing_de',
        'typing_ar',
        'missing_letters',
        'first_last_hint',
        ...(hasExample ? ['example_context' as TrainingQuestionType] : []),
        'pictogram_recall',
    ];
    return types[index % types.length];
}

function questionLabel(question: TrainingQuestion): string {
    if (question.type === 'typing_de') return '✍️ اكتبها بالألماني';
    if (question.type === 'typing_ar') return '✍️ اكتب معناها بالعربي';
    if (question.type === 'missing_letters') return '🧩 أكمل الكلمة';
    if (question.type === 'first_last_hint') return '✍️ تلميح كتابة';
    if (question.type === 'example_context') return '🧠 من السياق';
    return question.direction === 'de_ar' ? 'اختر المعنى العربي' : 'اختر الكلمة الألمانية';
}

function maskGerman(value: string): string {
    return value.split('').map((char, index) => {
        if (char === ' ') return ' ';
        if (index === 0 || index === value.length - 1) return char;
        return '_';
    }).join(' ');
}

function normalizeAnswer(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE');
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

function shuffle<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
