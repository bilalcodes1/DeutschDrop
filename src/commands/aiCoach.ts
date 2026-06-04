import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import { getWordById, updateWordAiFieldsForUser } from '../repositories/wordRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import { AI_ERROR_MESSAGES, getAiUsageSummary, runAiTask } from '../services/ai/aiRouter';
import type { AiTaskResult } from '../services/ai/aiTypes';
import { buildAiDebugReport, formatAiDebugReport } from '../services/ai/aiDebug';
import { isAdminTelegramId } from '../services/adminAccess';
import { navigationKeyboard, replaceWithText, showWordDetailPanel } from './wordPanel';

interface ExampleResult {
    example_de: string;
    example_ar: string;
    pronunciation_ar: string;
    level: string;
}

interface PronunciationResult {
    pronunciation_ar: string;
    note?: string | null;
}

interface LevelResult {
    level: string;
    reason?: string;
}

interface ExplainResult {
    short_explanation: string;
    correct_answer: string;
    extra_example_de?: string;
    extra_example_ar?: string;
}

interface AiWordSession {
    wordId: number;
    mode: 'suggestion' | 'pronunciation' | 'level';
    result: ExampleResult | PronunciationResult | LevelResult;
}

export interface TrainExplainSession {
    wordId: number;
    questionType: 'de_ar' | 'ar_de';
    german: string;
    arabic: string;
    userAnswer: string;
    correctAnswer: string;
    example: string | null;
}

export function registerAiCoachCommand(bot: Bot<BotContext>): void {
    bot.command('ai_debug', async (ctx) => {
        if (!isAdminTelegramId(ctx.env, ctx.from?.id)) {
            await ctx.reply('غير مصرح لك باستخدام هذا الأمر.');
            return;
        }
        const report = await buildAiDebugReport(ctx.env);
        await ctx.reply(formatAiDebugReport(report));
    });

    bot.callbackQuery(/^ai_improve_(\d+)$/, async (ctx) => {
        const wordId = Number(ctx.match[1]);
        await generateExampleSuggestion(ctx, wordId, false);
    });

    bot.callbackQuery(/^ai_regen_suggestion_(\d+)$/, async (ctx) => {
        const wordId = Number(ctx.match[1]);
        await generateExampleSuggestion(ctx, wordId, true);
    });

    bot.callbackQuery(/^ai_save_suggestion_(\d+)$/, async (ctx) => {
        const wordId = Number(ctx.match[1]);
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return replaceWithText(ctx, 'يرجى استخدام /start أولاً.', navigationKeyboard('menu_main'));
        const session = await getBotSession<AiWordSession>(ctx.db, user.user_id, 'ai_word');
        if (!session || session.data.wordId !== wordId || session.data.mode !== 'suggestion') {
            return replaceWithText(ctx, 'انتهت صلاحية الاقتراح. جرّب التوليد مرة ثانية.', navigationKeyboard(`word_detail_${wordId}`));
        }
        const result = session.data.result as ExampleResult;
        await updateWordAiFieldsForUser(ctx.db, user.user_id, wordId, {
            example: result.example_de,
            example_ar: result.example_ar,
            pronunciation_ar: result.pronunciation_ar,
            level: normalizeLevel(result.level),
        });
        await deleteBotSession(ctx.db, user.user_id, 'ai_word');
        await showWordDetailPanel(ctx, wordId, 'تم حفظ اقتراح الذكاء الاصطناعي ✅');
    });

    bot.callbackQuery(/^ai_pron_(\d+)$/, async (ctx) => {
        const wordId = Number(ctx.match[1]);
        await generatePronunciationSuggestion(ctx, wordId, false);
    });

    bot.callbackQuery(/^ai_regen_pron_(\d+)$/, async (ctx) => {
        const wordId = Number(ctx.match[1]);
        await generatePronunciationSuggestion(ctx, wordId, true);
    });

    bot.callbackQuery(/^ai_save_pron_(\d+)$/, async (ctx) => {
        const wordId = Number(ctx.match[1]);
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return replaceWithText(ctx, 'يرجى استخدام /start أولاً.', navigationKeyboard('menu_main'));
        const session = await getBotSession<AiWordSession>(ctx.db, user.user_id, 'ai_word');
        if (!session || session.data.wordId !== wordId || session.data.mode !== 'pronunciation') {
            return replaceWithText(ctx, 'انتهت صلاحية الاقتراح. جرّب التوليد مرة ثانية.', navigationKeyboard(`word_detail_${wordId}`));
        }
        const result = session.data.result as PronunciationResult;
        await updateWordAiFieldsForUser(ctx.db, user.user_id, wordId, { pronunciation_ar: result.pronunciation_ar });
        await deleteBotSession(ctx.db, user.user_id, 'ai_word');
        await showWordDetailPanel(ctx, wordId, 'تم حفظ اللفظ ✅');
    });

    bot.callbackQuery(/^ai_level_(\d+)$/, async (ctx) => {
        const wordId = Number(ctx.match[1]);
        await generateLevelSuggestion(ctx, wordId, false);
    });

    bot.callbackQuery(/^ai_save_level_(\d+)$/, async (ctx) => {
        const wordId = Number(ctx.match[1]);
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return replaceWithText(ctx, 'يرجى استخدام /start أولاً.', navigationKeyboard('menu_main'));
        const session = await getBotSession<AiWordSession>(ctx.db, user.user_id, 'ai_word');
        if (!session || session.data.wordId !== wordId || session.data.mode !== 'level') {
            return replaceWithText(ctx, 'انتهت صلاحية الاقتراح. جرّب التحديد مرة ثانية.', navigationKeyboard(`word_detail_${wordId}`));
        }
        const result = session.data.result as LevelResult;
        await updateWordAiFieldsForUser(ctx.db, user.user_id, wordId, { level: normalizeLevel(result.level) });
        await deleteBotSession(ctx.db, user.user_id, 'ai_word');
        await showWordDetailPanel(ctx, wordId, 'تم حفظ المستوى ✅');
    });

    bot.callbackQuery(/^ai_cancel_(\d+)$/, async (ctx) => {
        const wordId = Number(ctx.match[1]);
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (user) await deleteBotSession(ctx.db, user.user_id, 'ai_word');
        await showWordDetailPanel(ctx, wordId);
    });

    bot.callbackQuery('ai_settings', async (ctx) => {
        await showAiSettings(ctx);
    });

    bot.callbackQuery('train_explain', async (ctx) => {
        await explainCurrentTrainingAnswer(ctx);
    });
}

async function generateExampleSuggestion(ctx: BotContext, wordId: number, bypassCache: boolean): Promise<void> {
    const access = await getUserWord(ctx, wordId);
    if (!access) return;
    await replaceWithText(ctx, '✨ أجهّز اقتراح بسيط للكلمة...', navigationKeyboard(`word_detail_${wordId}`));
    const result = await runAiTask<ExampleResult>(
        ctx.env,
        ctx.db,
        'generate_example_and_pronunciation',
        {
            german: access.word.german,
            arabic: access.word.arabic,
            currentExample: access.word.example,
        },
        { userId: access.user.user_id, bypassCache }
    );
    if (!result.result) return showAiError(ctx, result, `word_detail_${wordId}`);
    await saveBotSession<AiWordSession>(ctx.db, access.user.user_id, 'ai_word', {
        wordId,
        mode: 'suggestion',
        result: result.result,
    }, 30);
    await replaceWithText(ctx, formatExampleSuggestion(result.result), suggestionKeyboard(wordId, 'suggestion'), 'Markdown');
}

async function generatePronunciationSuggestion(ctx: BotContext, wordId: number, bypassCache: boolean): Promise<void> {
    const access = await getUserWord(ctx, wordId);
    if (!access) return;
    await replaceWithText(ctx, '🗣 أكتب اللفظ بحروف عربية...', navigationKeyboard(`word_detail_${wordId}`));
    const result = await runAiTask<PronunciationResult>(
        ctx.env,
        ctx.db,
        'generate_pronunciation',
        { german: access.word.german, arabic: access.word.arabic },
        { userId: access.user.user_id, bypassCache }
    );
    if (!result.result) return showAiError(ctx, result, `word_detail_${wordId}`);
    await saveBotSession<AiWordSession>(ctx.db, access.user.user_id, 'ai_word', {
        wordId,
        mode: 'pronunciation',
        result: result.result,
    }, 30);
    await replaceWithText(
        ctx,
        `🗣 *اقتراح اللفظ*\n\n🇩🇪 *${access.word.german}*\n🗣 ${result.result.pronunciation_ar}`,
        suggestionKeyboard(wordId, 'pronunciation'),
        'Markdown'
    );
}

async function generateLevelSuggestion(ctx: BotContext, wordId: number, bypassCache: boolean): Promise<void> {
    const access = await getUserWord(ctx, wordId);
    if (!access) return;
    await replaceWithText(ctx, '📊 أحدد مستوى الكلمة...', navigationKeyboard(`word_detail_${wordId}`));
    const result = await runAiTask<LevelResult>(
        ctx.env,
        ctx.db,
        'classify_level',
        { german: access.word.german, arabic: access.word.arabic, example: access.word.example },
        { userId: access.user.user_id, bypassCache }
    );
    if (!result.result) return showAiError(ctx, result, `word_detail_${wordId}`);
    await saveBotSession<AiWordSession>(ctx.db, access.user.user_id, 'ai_word', {
        wordId,
        mode: 'level',
        result: result.result,
    }, 30);
    await replaceWithText(
        ctx,
        `📊 *اقتراح المستوى*\n\n🇩🇪 *${access.word.german}*\nالمستوى: *${normalizeLevel(result.result.level)}*` +
        (result.result.reason ? `\nالسبب: ${result.result.reason}` : ''),
        suggestionKeyboard(wordId, 'level'),
        'Markdown'
    );
}

async function explainCurrentTrainingAnswer(ctx: BotContext): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!user) return replaceWithText(ctx, 'يرجى استخدام /start أولاً.', navigationKeyboard('menu_main'));
    const session = await getBotSession<TrainExplainSession>(ctx.db, user.user_id, 'train_explain');
    if (!session) {
        await replaceWithText(ctx, 'لا يوجد سؤال لشرحه حالياً.', navigationKeyboard('menu_train'));
        return;
    }
    await replaceWithText(ctx, '🤖 أشرح لك الجواب...', navigationKeyboard('train_continue'));
    const result = await runAiTask<ExplainResult>(
        ctx.env,
        ctx.db,
        'explain_answer',
        {
            questionType: session.data.questionType,
            german: session.data.german,
            arabic: session.data.arabic,
            userAnswer: session.data.userAnswer,
            correctAnswer: session.data.correctAnswer,
            example: session.data.example,
        },
        { userId: user.user_id }
    );
    if (!result.result) return showAiError(ctx, result, 'train_continue');
    await replaceWithText(
        ctx,
        `🤖 *الشرح*\n\n${result.result.short_explanation}\n\n✅ الصحيح: *${result.result.correct_answer}*` +
        (result.result.extra_example_de ? `\n\nمثال:\n${result.result.extra_example_de}` : '') +
        (result.result.extra_example_ar ? `\n${result.result.extra_example_ar}` : ''),
        new InlineKeyboard()
            .text('🏋️ أكمل التدريب', 'train_continue').row()
            .text('🏠 الرئيسية', 'menu_main'),
        'Markdown'
    );
}

async function showAiSettings(ctx: BotContext): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!user) return replaceWithText(ctx, 'يرجى استخدام /start أولاً.', navigationKeyboard('menu_main'));
    const enabled = ctx.env.AI_ENABLED === 'true';
    const usage = await getAiUsageSummary(ctx.db, user.user_id);
    const labels: Record<string, string> = {
        generate_example_and_pronunciation: 'تحسين الكلمات',
        generate_pronunciation: 'توليد اللفظ',
        explain_answer: 'شرح التدريب',
        classify_level: 'تحديد المستوى',
    };
    const lines = usage.map(row => `${labels[row.task_type]}: ${row.count}/${row.limit}`).join('\n');
    await replaceWithText(
        ctx,
        `🤖 *إعدادات الذكاء الاصطناعي*\n\n` +
        `الحالة: *${enabled ? 'مفعل' : 'متوقف'}*\n` +
        `المزوّدات: *${ctx.env.AI_PROVIDER_ORDER || 'gemini,kimi,grok'}*\n\n` +
        `استخدام اليوم:\n${lines || '-'}`,
        navigationKeyboard('menu_settings'),
        'Markdown'
    );
}

async function getUserWord(ctx: BotContext, wordId: number) {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!user) {
        await replaceWithText(ctx, 'يرجى استخدام /start أولاً.', navigationKeyboard('menu_main'));
        return null;
    }
    const word = await getWordById(ctx.db, wordId);
    if (!word || word.added_by !== user.user_id) {
        await replaceWithText(ctx, '⚠️ لم أجد هذه الكلمة في بنك كلماتك.', navigationKeyboard('list_words'));
        return null;
    }
    return { user, word };
}

async function showAiError(ctx: BotContext, result: AiTaskResult, backCallback: string): Promise<void> {
    const message = result.status === 'ok' ? 'تعذر قراءة نتيجة الذكاء الاصطناعي.' : AI_ERROR_MESSAGES[result.status];
    await replaceWithText(ctx, message, navigationKeyboard(backCallback));
}

function formatExampleSuggestion(result: ExampleResult): string {
    return `✨ *اقتراح تحسين الكلمة*\n\n` +
        `مثال ألماني:\n${result.example_de}\n\n` +
        `الترجمة:\n${result.example_ar}\n\n` +
        `🗣 اللفظ: ${result.pronunciation_ar}\n` +
        `📊 المستوى: ${normalizeLevel(result.level)}`;
}

function suggestionKeyboard(wordId: number, mode: AiWordSession['mode']): InlineKeyboard {
    const saveCallback = mode === 'suggestion'
        ? `ai_save_suggestion_${wordId}`
        : mode === 'pronunciation'
            ? `ai_save_pron_${wordId}`
            : `ai_save_level_${wordId}`;
    const regenCallback = mode === 'suggestion'
        ? `ai_regen_suggestion_${wordId}`
        : mode === 'pronunciation'
            ? `ai_regen_pron_${wordId}`
            : `ai_level_${wordId}`;
    return new InlineKeyboard()
        .text('✅ حفظ', saveCallback)
        .text('🔄 توليد غيره', regenCallback).row()
        .text('❌ إلغاء', `ai_cancel_${wordId}`)
        .text('🏠 الرئيسية', 'menu_main');
}

function normalizeLevel(value: string): string {
    const level = value.toUpperCase().trim();
    return ['A1', 'A2', 'B1'].includes(level) ? level : 'Unknown';
}
