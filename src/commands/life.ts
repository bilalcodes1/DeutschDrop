import { Bot, InlineKeyboard, InputFile } from 'grammy';
import type { BotContext } from '../bot/context';
import type { User } from '../models';
import { getUserByTelegramId, getUserSettings } from '../repositories/userRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import {
    archiveLifeSentence,
    countLifeSentences,
    countCopiedLifeSentencesByUser,
    countPublicLifeSentences,
    countPublishedLifeSentencesByUser,
    createLifeSentenceCopy,
    createLifeSentenceReport,
    ensureLifeSettings,
    getLifeCopyRecord,
    getDueLifeSentences,
    getLifeKeywords,
    getLifeSentenceById,
    getLifeSentenceByShareCode,
    getLifeSentenceByShareCodeAnyVisibility,
    getLifeSentenceWithAuthorById,
    getLifeStats,
    getTodayLifeSentence,
    incrementLifeSentenceView,
    listCopiedLifeSentencesByUser,
    listLifeSentences,
    listPinnedPublicLifeSentences,
    listPublicLifeSentences,
    listPublishedLifeSentencesByUser,
    restoreLifeSentenceCopy,
    setLifeGateReminder,
    setLifeSentenceDifficulty,
    setLifeSentenceVisibility,
    skipLifeReminderToday,
    softDeleteLifeSentence,
    updateLifeSentenceReview,
    updateLifeSettings,
    type LifeLevel,
    type LifeSentence,
    type LifeSentenceWithKeywords,
    type LifeVisibility,
} from '../repositories/lifeSentenceRepository';
import {
    chooseGapKeyword,
    generateUniqueLifeShareCode,
    generateLifeSentenceWithAi,
    getLifeGateDate,
    getLifeGateStatus,
    getLifeStreak,
    isLifeGateOpen,
    parseExternalLifeResult,
    publicLifeAuthorName,
    reviewLifeSentenceStats,
    saveLifeSentenceAndGate,
    sanitizeLifeShareDisplayName,
    shuffledSentenceWords,
    validateLifeSearchQuery,
    validateLifeOriginalInput,
    type LifeSentenceDraft,
} from '../services/lifeSentences';
import { synthesizeGermanTts } from '../services/tts/ttsRouter';
import { normalizeTtsText } from '../services/tts/types';
import { evaluateWrittenAnswer } from '../services/trainingAnswerMatcher';
import { ACTIVE_TEMP_TTL_SECONDS, recordTemporaryMessage } from '../repositories/temporaryMessageRepository';
import { replaceWithText } from './wordPanel';

type LifeSource = 'bot_ai' | 'external_chatgpt' | 'manual';

interface LifeOriginalSession {
    sourceType: LifeSource;
    retryOf?: string;
}

interface LifePreviewSession {
    draft: LifeSentenceDraft;
    sourceType: LifeSource;
    saved?: boolean;
}

interface LifeClarificationSession {
    sourceType: LifeSource;
    originalInput: string;
    clarificationQuestion: string;
}

interface LifeEditSession {
    draft: LifeSentenceDraft;
    sourceType: LifeSource;
}

interface LifeTrainingSession {
    sentenceId: number;
    mode: 'writing' | 'listening' | 'order' | 'gap';
    answer: string;
    shownGerman?: boolean;
    words?: string[];
    selectedIndexes?: number[];
    answered?: boolean;
}

interface LifeSearchSession {
    scope: 'public';
    query?: string;
}

interface LifeShareNameSession {
    mode: 'custom_name';
}

const LIFE_PAGE_SIZE = 5;

export function registerLifeCommand(bot: Bot<BotContext>): void {
    bot.command('life', async (ctx) => {
        await showLifeMenu(ctx);
    });

    bot.callbackQuery('life:menu', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showLifeMenu(ctx);
    });

    bot.callbackQuery('life:add', async (ctx) => {
        await ctx.answerCallbackQuery();
        await startLifeAdd(ctx);
    });

    bot.callbackQuery('life:ext', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showExternalChatGptPrompt(ctx);
    });

    bot.callbackQuery('life:ext_ready', async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await clearLifeSessions(ctx, user.user_id);
        await saveBotSession(ctx.db, user.user_id, 'awaiting_life_external_result', { sourceType: 'external_chatgpt' }, 30);
        await replaceWithText(ctx, '📥 أرسل نتيجة ChatGPT كاملة الآن.\n\nلازم تحتوي على الأقل:\nGerman:\nArabic:', cancelHomeKeyboard());
    });

    bot.callbackQuery('life:save', async (ctx) => {
        await ctx.answerCallbackQuery();
        await saveLifePreview(ctx);
    });

    bot.callbackQuery('life:regen', async (ctx) => {
        await ctx.answerCallbackQuery();
        await regenerateLifePreview(ctx);
    });

    bot.callbackQuery('life:misunderstood', async (ctx) => {
        await ctx.answerCallbackQuery();
        await restartLifeFromMisunderstood(ctx);
    });

    bot.callbackQuery('life:edit:g', async (ctx) => {
        await ctx.answerCallbackQuery();
        await startLifePreviewEdit(ctx, 'german');
    });

    bot.callbackQuery('life:edit:a', async (ctx) => {
        await ctx.answerCallbackQuery();
        await startLifePreviewEdit(ctx, 'arabic');
    });

    bot.callbackQuery('life:cancel', async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx, false);
        if (user) await clearLifeSessions(ctx, user.user_id);
        await replaceWithText(ctx, 'تم إلغاء العملية.', new InlineKeyboard().text('🧠 مواقف الحياة', 'life:menu').text('🏠 الرئيسية', 'menu_main'));
    });

    bot.callbackQuery('life:listen', async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        await listenToLifePreview(ctx);
    });

    bot.callbackQuery('life:today', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showTodayLifeSentence(ctx);
    });

    bot.callbackQuery(/^life:list:(\d+)(?::([a-zA-Z0-9_]+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showLifeList(ctx, Number(ctx.match[1]), ctx.match[2] ?? 'active');
    });

    bot.callbackQuery('life:community', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showLifeCommunity(ctx);
    });

    bot.callbackQuery(/^life:public:(latest|popular):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showPublicLifeList(ctx, Number(ctx.match[2]), { sort: ctx.match[1] as 'latest' | 'popular' });
    });

    bot.callbackQuery(/^life:public:level:(A1|A2|B1):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showPublicLifeList(ctx, Number(ctx.match[2]), { level: ctx.match[1] as LifeLevel });
    });

    bot.callbackQuery(/^life:public:search:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showPublicLifeSearchResults(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery('life:search', async (ctx) => {
        await ctx.answerCallbackQuery();
        await startPublicLifeSearch(ctx);
    });

    bot.callbackQuery(/^life:pub:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showPublicLifeDetails(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^life:copy:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await copyPublicLifeSentence(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^life:copy_code:([A-Za-z0-9]+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await copyLifeSentenceByShareCode(ctx, ctx.match[1]);
    });

    bot.callbackQuery(/^life:pub_listen:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        await listenToPublicLifeSentence(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^life:listen_code:([A-Za-z0-9]+)$/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        await listenToLifeSentenceByShareCode(ctx, ctx.match[1]);
    });

    bot.callbackQuery(/^life:share:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showLifeShareOptions(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^life:vis:(\d+):(private|public|unlisted)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await changeLifeVisibility(ctx, Number(ctx.match[1]), ctx.match[2] as LifeVisibility);
    });

    bot.callbackQuery(/^life:share_link:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showLifeShareLink(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^life:report:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showLifeReportReasons(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^life:report_code:([A-Za-z0-9]+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showLifeReportReasonsByCode(ctx, ctx.match[1]);
    });

    bot.callbackQuery(/^life:report:(\d+):(wrong_translation|bad_german|inappropriate|personal_info|spam|other)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await submitLifeReport(ctx, Number(ctx.match[1]), ctx.match[2]);
    });

    bot.callbackQuery(/^life:published:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showPublishedLifeSentences(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^life:copied:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showCopiedLifeSentences(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^life:view:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showLifeDetails(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^life:train:(w|l|o|f)(?::(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const mode = ctx.match[1] === 'w' ? 'writing' : ctx.match[1] === 'l' ? 'listening' : ctx.match[1] === 'o' ? 'order' : 'gap';
        await startLifeTraining(ctx, mode, ctx.match[2] ? Number(ctx.match[2]) : undefined);
    });

    bot.callbackQuery(/^life:train_filter:(hard|due):(w|l|o|f|m)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const mode = ctx.match[2] === 'm' ? chooseMixedLifeMode() : ctx.match[2] === 'w' ? 'writing' : ctx.match[2] === 'l' ? 'listening' : ctx.match[2] === 'o' ? 'order' : 'gap';
        await startLifeTraining(ctx, mode, undefined, ctx.match[1] as 'hard' | 'due');
    });

    bot.callbackQuery(/^life:ord:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await handleLifeOrderPick(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery('life:ord_undo', async (ctx) => {
        await ctx.answerCallbackQuery();
        await handleLifeOrderUndo(ctx);
    });

    bot.callbackQuery('life:ord_reset', async (ctx) => {
        await ctx.answerCallbackQuery();
        await handleLifeOrderReset(ctx);
    });

    bot.callbackQuery(/^life:diff:(\d+):(easy|medium|hard)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await setLifeSentenceDifficulty(ctx.db, user.user_id, Number(ctx.match[1]), ctx.match[2] as 'easy' | 'medium' | 'hard');
        await showLifeDetails(ctx, Number(ctx.match[1]), 'تم تحديث الصعوبة.');
    });

    bot.callbackQuery(/^life:archive:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await archiveLifeSentence(ctx.db, user.user_id, Number(ctx.match[1]));
        await replaceWithText(ctx, '📦 تم أرشفة الجملة.', new InlineKeyboard().text('📖 جمل من حياتي', 'life:list:1').text('🏠 الرئيسية', 'menu_main'));
    });

    bot.callbackQuery(/^life:delete:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await replaceWithText(
            ctx,
            '🗑 حذف الجملة\n\nهل تريد حذف هذه الجملة؟ سيتم حذفها soft delete فقط.',
            new InlineKeyboard()
                .text('✅ نعم، احذف', `life:delete_ok:${ctx.match[1]}`).row()
                .text('❌ إلغاء', `life:view:${ctx.match[1]}`)
                .text('🏠 الرئيسية', 'menu_main')
        );
    });

    bot.callbackQuery(/^life:delete_ok:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await softDeleteLifeSentence(ctx.db, user.user_id, Number(ctx.match[1]));
        await replaceWithText(ctx, 'تم حذف الجملة.', new InlineKeyboard().text('📖 جمل من حياتي', 'life:list:1').text('🏠 الرئيسية', 'menu_main'));
    });

    bot.callbackQuery('life:due', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showDueLifeSentences(ctx);
    });

    bot.callbackQuery('life:stats', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showLifeStats(ctx);
    });

    bot.callbackQuery('life:settings', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showLifeSettings(ctx);
    });

    bot.callbackQuery(/^life:name:(none|bot|custom)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await updateLifeShareNameMode(ctx, ctx.match[1] as 'none' | 'bot' | 'custom');
    });

    bot.callbackQuery(/^life:gate:(on|off)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await updateLifeSettings(ctx.db, user.user_id, { gate_enabled: ctx.match[1] === 'on' ? 1 : 0, onboarding_seen: 1 });
        await showLifeSettings(ctx, ctx.match[1] === 'on' ? 'تم تفعيل القفل اليومي.' : 'تم إيقاف القفل اليومي.');
    });

    bot.callbackQuery(/^life:remind:(2h|skip)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        const status = await getLifeGateStatus(ctx.db, user.user_id);
        if (ctx.match[1] === '2h') {
            await setLifeGateReminder(ctx.db, user.user_id, status.gateDate, 2);
            await replaceWithText(ctx, 'تمام، أذكّرك بعد ساعتين.', new InlineKeyboard().text('🏠 الرئيسية', 'menu_main'));
        } else {
            await skipLifeReminderToday(ctx.db, user.user_id, status.gateDate);
            await replaceWithText(ctx, 'تم تخطي تذكير اليوم. هذا لا يفتح التدريبات.', new InlineKeyboard().text('🏠 الرئيسية', 'menu_main'));
        }
    });

    bot.on('message:text', async (ctx, next) => {
        const user = await currentUser(ctx, false);
        if (!user || ctx.message.text.startsWith('/')) return next();
        if (await handleLifeText(ctx, user, ctx.message.text)) return;
        return next();
    });
}

export async function ensureLifeGateOrShow(ctx: BotContext, user: User, continuation = 'menu_train'): Promise<boolean> {
    if (await isLifeGateOpen(ctx.db, user.user_id)) return true;
    await showLifeGate(ctx, continuation);
    return false;
}

export async function showLifeGate(ctx: BotContext, continuation = 'menu_train'): Promise<void> {
    const keyboard = new InlineKeyboard()
        .text('➕ أضف موقف اليوم', 'life:add').row()
        .text('📋 استخدم ChatGPT', 'life:ext').row()
        .text('⏳ ذكّرني بعد ساعتين', 'life:remind:2h').row()
        .text('🧠 مواقف الحياة', 'life:menu')
        .text('⚙️ الإعدادات', 'life:settings').row()
        .text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(
        ctx,
        `🔒 بوابة اليوم\n\n` +
        `قبل أن تبدأ التدريب، أخبرني بشيء واحد حقيقياً حدث معك اليوم أو البارحة، أو شيئاً ستفعله اليوم.\n\n` +
        `لا تحتاج إلى كتابة الألمانية.\nفقط اكتب الفكرة بالعربية بطريقتك الطبيعية.\n\n` +
        `أمثلة:\n` +
        `• اليوم كان الجو حاراً.\n` +
        `• رأيت صرصوراً في الحمام.\n` +
        `• أكملت درسين.\n` +
        `• ذهبت إلى الحلاق البارحة.\n` +
        `• سنتعشى في المطعم اليوم.\n` +
        `• لم أنم جيداً.\n\n` +
        `بعد حفظ الجملة، ستُفتح لك تدريبات اليوم.`,
        keyboard
    );
    void continuation;
}

async function showLifeMenu(ctx: BotContext): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    await ensureLifeSettings(ctx.db, user.user_id);
    await replaceWithText(
        ctx,
        `🧠 مواقف الحياة\n\nجمل ألمانية حقيقية من يومك أنت.\n\nDeutsch aus deinem Leben\nالألمانية من حياتك`,
        new InlineKeyboard()
            .text('📅 جملة اليوم', 'life:today').row()
            .text('➕ أضف موقفاً', 'life:add').row()
            .text('📖 جمل من حياتي', 'life:list:1').row()
            .text('🌍 مجتمع الجمل', 'life:community').row()
            .text('📥 الجمل التي نسختها', 'life:copied:1')
            .text('📤 جُملي المنشورة', 'life:published:1').row()
            .text('✍️ اكتبها بالألمانية', 'life:train:w')
            .text('🎧 اسمع واكتب', 'life:train:l').row()
            .text('🧩 رتّب الجملة', 'life:train:o')
            .text('🕳 أكمل الفراغ', 'life:train:f').row()
            .text('🔥 الجمل الصعبة', 'life:list:1:hard').row()
            .text('🔁 المستحقة للمراجعة', 'life:due').row()
            .text('📊 تقدمي', 'life:stats')
            .text('⚙️ إعدادات مواقف الحياة', 'life:settings').row()
            .text('🏠 الرئيسية', 'menu_main')
    );
}

async function startLifeAdd(ctx: BotContext): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    await clearLifeSessions(ctx, user.user_id);
    await saveBotSession<LifeOriginalSession>(ctx.db, user.user_id, 'awaiting_life_original_arabic', { sourceType: 'bot_ai' }, 30);
    await replaceWithText(
        ctx,
        `✍️ اكتب موقفاً واحداً من يومك\n\nاكتب جملة قصيرة أو فكرة طبيعية بالعربية.\n\nمثال:\nرأيت صرصوراً في الحمام اليوم.`,
        cancelHomeKeyboard()
    );
}

async function handleLifeText(ctx: BotContext, user: User, text: string): Promise<boolean> {
    const clarification = await getBotSession<LifeClarificationSession>(ctx.db, user.user_id, 'awaiting_life_clarification');
    if (clarification) {
        await generateLifeFromText(ctx, user, clarification.data.originalInput, clarification.data.sourceType, text);
        return true;
    }

    const original = await getBotSession<LifeOriginalSession>(ctx.db, user.user_id, 'awaiting_life_original_arabic');
    if (original) {
        await generateLifeFromText(ctx, user, text, original.data.sourceType);
        return true;
    }

    const external = await getBotSession(ctx.db, user.user_id, 'awaiting_life_external_result');
    if (external) {
        const draft = parseExternalLifeResult(text);
        if (!draft) {
            await replaceWithText(
                ctx,
                `❌ لم أستطع قراءة النتيجة\n\nتأكد أن النص يحتوي على:\n\nGerman:\nArabic:\n\nثم أعد إرسال النتيجة كاملة.`,
                new InlineKeyboard().text('🔁 حاول مجدداً', 'life:ext_ready').row().text('📋 اعرض البرومبت', 'life:ext').row().text('❌ إلغاء', 'life:cancel')
            );
            return true;
        }
        await saveLifeDraftSession(ctx, user.user_id, draft, 'external_chatgpt');
        await showLifePreview(ctx, draft);
        return true;
    }

    const germanEdit = await getBotSession<LifeEditSession>(ctx.db, user.user_id, 'awaiting_life_german_edit');
    if (germanEdit) {
        const value = text.trim();
        if (!value || value.length > 250) {
            await ctx.reply('اكتب الجملة الألمانية بطول مناسب.');
            return true;
        }
        const draft = { ...germanEdit.data.draft, german: value };
        await saveLifeDraftSession(ctx, user.user_id, draft, germanEdit.data.sourceType);
        await deleteBotSession(ctx.db, user.user_id, 'awaiting_life_german_edit');
        await showLifePreview(ctx, draft);
        return true;
    }

    const arabicEdit = await getBotSession<LifeEditSession>(ctx.db, user.user_id, 'awaiting_life_arabic_edit');
    if (arabicEdit) {
        const value = text.trim();
        if (!value || value.length > 500) {
            await ctx.reply('اكتب المعنى العربي بطول مناسب.');
            return true;
        }
        const draft = { ...arabicEdit.data.draft, arabic: value };
        await saveLifeDraftSession(ctx, user.user_id, draft, arabicEdit.data.sourceType);
        await deleteBotSession(ctx.db, user.user_id, 'awaiting_life_arabic_edit');
        await showLifePreview(ctx, draft);
        return true;
    }

    const lifeSearch = await getBotSession<LifeSearchSession>(ctx.db, user.user_id, 'life_search');
    if (lifeSearch) {
        const query = validateLifeSearchQuery(text);
        if (!query.ok) {
            await replaceWithText(ctx, query.message, new InlineKeyboard().text('🔎 حاول مجدداً', 'life:search').row().text('🌍 المجتمع', 'life:community').text('🏠 الرئيسية', 'menu_main'));
            return true;
        }
        await saveBotSession<LifeSearchSession>(ctx.db, user.user_id, 'life_search', { scope: 'public', query: query.query }, 20);
        await showPublicLifeSearchResults(ctx, 1);
        return true;
    }

    const shareName = await getBotSession<LifeShareNameSession>(ctx.db, user.user_id, 'life_share_name_edit');
    if (shareName) {
        const name = sanitizeLifeShareDisplayName(text);
        if (!name) {
            await replaceWithText(ctx, 'اكتب اسماً بين 2 و30 حرفاً، بدون روابط أو رموز فقط.', new InlineKeyboard().text('❌ إلغاء', 'life:settings').text('🏠 الرئيسية', 'menu_main'));
            return true;
        }
        await updateLifeSettings(ctx.db, user.user_id, { share_name_mode: 'custom', share_display_name: name });
        await deleteBotSession(ctx.db, user.user_id, 'life_share_name_edit');
        await showLifeSettings(ctx, 'تم حفظ اسم الظهور عند المشاركة.');
        return true;
    }

    for (const sessionType of ['life_training_writing', 'life_training_listening', 'life_training_order', 'life_training_gap'] as const) {
        const session = await getBotSession<LifeTrainingSession>(ctx.db, user.user_id, sessionType);
        if (session) {
            await handleLifeTrainingAnswer(ctx, user, session.data, sessionType, text);
            return true;
        }
    }

    return false;
}

async function generateLifeFromText(ctx: BotContext, user: User, text: string, sourceType: LifeSource, clarificationAnswer?: string): Promise<void> {
    const input = validateLifeOriginalInput(text);
    if (!input.ok) {
        await replaceWithText(ctx, input.message, cancelHomeKeyboard());
        return;
    }
    const settings = await getUserSettings(ctx.db, user.user_id);
    await replaceWithText(ctx, '⏳ أحوّل موقفك إلى جملة ألمانية طبيعية...', cancelHomeKeyboard());
    const result = await generateLifeSentenceWithAi(ctx.env, ctx.db, user.user_id, input.value, (settings?.german_level ?? 'A1') as 'A1' | 'A2' | 'B1', false, clarificationAnswer);
    if (!result.ok) {
        if (result.status === 'clarify' && result.clarificationQuestion) {
            await deleteBotSession(ctx.db, user.user_id, 'awaiting_life_original_arabic');
            await saveBotSession<LifeClarificationSession>(ctx.db, user.user_id, 'awaiting_life_clarification', {
                sourceType,
                originalInput: result.originalArabic ?? input.value,
                clarificationQuestion: result.clarificationQuestion,
            }, 20);
            await replaceWithText(
                ctx,
                `أحتاج توضيح بسيط حتى لا أخمّن المعنى:\n\n${result.clarificationQuestion}`,
                new InlineKeyboard().text('✏️ أعد كتابة الموقف', 'life:add').row().text('📋 استخدم ChatGPT', 'life:ext').row().text('❌ إلغاء', 'life:cancel')
            );
            return;
        }
        await replaceWithText(
            ctx,
            `❌ ${result.status}`,
            new InlineKeyboard().text('✏️ أعد كتابة الموقف', 'life:add').row().text('🔄 حاول مرة أخرى', 'life:add').row().text('📋 استخدم ChatGPT', 'life:ext').row().text('❌ إلغاء', 'life:cancel')
        );
        return;
    }
    await saveLifeDraftSession(ctx, user.user_id, result.draft, sourceType);
    await showLifePreview(ctx, result.draft);
}

async function saveLifeDraftSession(ctx: BotContext, userId: number, draft: LifeSentenceDraft, sourceType: LifeSource): Promise<void> {
    await deleteBotSession(ctx.db, userId, 'awaiting_life_original_arabic');
    await deleteBotSession(ctx.db, userId, 'awaiting_life_clarification');
    await deleteBotSession(ctx.db, userId, 'awaiting_life_external_result');
    await saveBotSession<LifePreviewSession>(ctx.db, userId, 'life_preview', { draft, sourceType }, 60);
}

async function showLifePreview(ctx: BotContext, draft: LifeSentenceDraft): Promise<void> {
    await replaceWithText(ctx, previewText(draft), previewKeyboard());
}

async function saveLifePreview(ctx: BotContext): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const session = await getBotSession<LifePreviewSession>(ctx.db, user.user_id, 'life_preview');
    if (!session || session.data.saved) {
        await replaceWithText(ctx, 'هذه المعاينة انتهت أو تم حفظها مسبقاً.', new InlineKeyboard().text('🧠 مواقف الحياة', 'life:menu').text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    session.data.saved = true;
    await saveBotSession<LifePreviewSession>(ctx.db, user.user_id, 'life_preview', session.data, 5);
    const gate = await getLifeGateStatus(ctx.db, user.user_id);
    const result = await saveLifeSentenceAndGate(ctx.db, user.user_id, gate.gateDate, session.data.draft, session.data.sourceType);
    await clearLifeSessions(ctx, user.user_id);
    await replaceWithText(
        ctx,
        `🔓 تم فتح تدريبات اليوم\n\n` +
        `أضفت جملة حقيقية جديدة إلى لغتك:\n\n` +
        `🇩🇪 ${session.data.draft.german}\n` +
        `🇮🇶 ${session.data.draft.arabic}\n\n` +
        `كل يوم تضيف جملة، ستبني لغة مرتبطة بحياتك أنت.` +
        (result.xpAwarded ? `\n\n🎯 +${result.xpAwarded} XP` : ''),
        new InlineKeyboard()
            .text('🎯 ابدأ تدريب اليوم', 'menu_train').row()
            .text('🧠 افتح مواقف الحياة', 'life:menu')
            .text('🔊 استماع', `life:train:l:${result.sentenceId}`).row()
            .text('🏠 الرئيسية', 'menu_main')
    );
}

async function regenerateLifePreview(ctx: BotContext): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const session = await getBotSession<LifePreviewSession>(ctx.db, user.user_id, 'life_preview');
    if (!session) return;
    await generateLifeFromText(ctx, user, session.data.draft.original_arabic, session.data.sourceType);
}

async function restartLifeFromMisunderstood(ctx: BotContext): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const session = await getBotSession<LifePreviewSession>(ctx.db, user.user_id, 'life_preview');
    if (!session) {
        await startLifeAdd(ctx);
        return;
    }
    await deleteBotSession(ctx.db, user.user_id, 'life_preview');
    await saveBotSession<LifeOriginalSession>(ctx.db, user.user_id, 'awaiting_life_original_arabic', {
        sourceType: session.data.sourceType,
        retryOf: session.data.draft.original_arabic,
    }, 30);
    await replaceWithText(
        ctx,
        `تمام، اكتب الموقف مرة ثانية بوضوح أكثر.\n\nالموقف السابق:\n${session.data.draft.original_arabic}`,
        cancelHomeKeyboard()
    );
}

async function startLifePreviewEdit(ctx: BotContext, field: 'german' | 'arabic'): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const session = await getBotSession<LifePreviewSession>(ctx.db, user.user_id, 'life_preview');
    if (!session) return;
    const type = field === 'german' ? 'awaiting_life_german_edit' : 'awaiting_life_arabic_edit';
    await saveBotSession<LifeEditSession>(ctx.db, user.user_id, type, { draft: session.data.draft, sourceType: session.data.sourceType }, 20);
    await replaceWithText(ctx, field === 'german' ? '✏️ أرسل الجملة الألمانية المعدلة:' : '✏️ أرسل المعنى العربي المعدل:', cancelHomeKeyboard());
}

async function listenToLifePreview(ctx: BotContext): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const session = await getBotSession<LifePreviewSession>(ctx.db, user.user_id, 'life_preview');
    if (!session) return;
    await sendLifeTts(ctx, session.data.draft.german);
}

async function showExternalChatGptPrompt(ctx: BotContext): Promise<void> {
    await ctx.reply('📋 انسخ الطلب الموجود في الرسالة التالية، ثم افتح ChatGPT وأرسله هناك.\n\nبعد أن يعطيك ChatGPT النتيجة، انسخ النتيجة كاملة وأرسلها هنا.\n\n⬇️');
    await ctx.reply(EXTERNAL_CHATGPT_PROMPT);
    await ctx.reply('بعد ما تجهز النتيجة:', {
        reply_markup: new InlineKeyboard()
            .text('📥 أنا جاهز لإرسال النتيجة', 'life:ext_ready').row()
            .text('❌ إلغاء', 'life:cancel')
            .text('🏠 الرئيسية', 'menu_main'),
    });
}

async function showTodayLifeSentence(ctx: BotContext): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const status = await getLifeGateStatus(ctx.db, user.user_id);
    const sentence = await getTodayLifeSentence(ctx.db, user.user_id, status.gateDate);
    if (!sentence) {
        await showLifeGate(ctx, 'life:today');
        return;
    }
    await showLifeDetails(ctx, sentence.id);
}

async function showLifeList(ctx: BotContext, page: number, filter = 'active'): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const total = await countLifeSentences(ctx.db, user.user_id, filter);
    const totalPages = Math.max(1, Math.ceil(total / LIFE_PAGE_SIZE));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const rows = await listLifeSentences(ctx.db, user.user_id, LIFE_PAGE_SIZE, (safePage - 1) * LIFE_PAGE_SIZE, filter);
    if (rows.length === 0) {
        await replaceWithText(ctx, 'لا توجد جمل في هذا القسم بعد.', new InlineKeyboard().text('➕ أضف موقفاً', 'life:add').text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    const keyboard = new InlineKeyboard();
    for (const row of rows) keyboard.text(`${row.german_text.slice(0, 30)} — ${row.level}`, `life:view:${row.id}`).row();
    if (filter === 'hard') {
        keyboard.text('🎯 تدريب الجمل الصعبة', 'life:train_filter:hard:m').row();
    } else if (filter === 'due') {
        keyboard.text('🎯 تدريب المستحقة', 'life:train_filter:due:m').row();
    }
    if (safePage > 1) keyboard.text('⬅️ السابق', `life:list:${safePage - 1}:${filter}`);
    if (safePage < totalPages) keyboard.text('التالي ➡️', `life:list:${safePage + 1}:${filter}`);
    if (safePage > 1 || safePage < totalPages) keyboard.row();
    keyboard.text('🔍 بحث', 'life:search').row()
        .text('A1', 'life:list:1:A1').text('A2', 'life:list:1:A2').text('B1', 'life:list:1:B1').row()
        .text('🔥 صعبة', 'life:list:1:hard').text('🔁 مستحقة', 'life:list:1:due').row()
        .text('⬅️ رجوع', 'life:menu').text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, `📖 جمل من حياتي\n\nالصفحة: ${safePage} / ${totalPages}\nعدد الجمل: ${total}`, keyboard);
}

async function showLifeCommunity(ctx: BotContext): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const pinned = await listPinnedPublicLifeSentences(ctx.db, 3);
    const pinnedText = pinned.length
        ? `\n\n📌 جمل مميزة\n\n${pinned.map((row, index) =>
            `${index + 1}. 🇩🇪 ${row.german_text}\n   🇮🇶 ${row.arabic_text}\n   👤 ${publicLifeAuthorName(row.author_display_name)} · 📥 ${row.copied_count}`
        ).join('\n\n')}`
        : '';
    const keyboard = new InlineKeyboard();
    for (const row of pinned) {
        keyboard.text(`📌 ${row.german_text.slice(0, 28)}`, `life:pub:${row.id}`).row();
    }
    keyboard
        .text('🔥 الأكثر نسخاً', 'life:public:popular:1').row()
        .text('🆕 الأحدث', 'life:public:latest:1').row()
        .text('🔎 بحث', 'life:search')
        .text('🏷 حسب الكلمات', 'life:search').row()
        .text('🎯 A1', 'life:public:level:A1:1')
        .text('🎯 A2', 'life:public:level:A2:1')
        .text('🎯 B1', 'life:public:level:B1:1').row()
        .text('📤 جُملي المنشورة', 'life:published:1')
        .text('📥 الجمل التي نسختها', 'life:copied:1').row()
        .text('🔙 رجوع', 'life:menu')
        .text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(
        ctx,
        `🌍 مجتمع الجمل\n\nاكتشف جملاً عامة من مستخدمين آخرين، وانسخ ما يفيدك إلى جُمَلك الخاصة.${pinnedText}`,
        keyboard
    );
}

async function startPublicLifeSearch(ctx: BotContext): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    await saveBotSession<LifeSearchSession>(ctx.db, user.user_id, 'life_search', { scope: 'public' }, 20);
    await replaceWithText(
        ctx,
        `🔎 ابحث في جمل الحياة\n\nاكتب كلمة أو عبارة بالعربية أو الألمانية.`,
        new InlineKeyboard().text('❌ إلغاء', 'life:community').text('🏠 الرئيسية', 'menu_main')
    );
}

async function showPublicLifeSearchResults(ctx: BotContext, page: number): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const session = await getBotSession<LifeSearchSession>(ctx.db, user.user_id, 'life_search');
    if (!session?.data.query) {
        await startPublicLifeSearch(ctx);
        return;
    }
    await showPublicLifeList(ctx, page, { query: session.data.query, sort: 'latest' });
}

async function showPublicLifeList(
    ctx: BotContext,
    page: number,
    options: { sort?: 'latest' | 'popular'; query?: string; level?: LifeLevel | null } = {}
): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const total = await countPublicLifeSentences(ctx.db, options);
    const totalPages = Math.max(1, Math.ceil(total / LIFE_PAGE_SIZE));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const rows = await listPublicLifeSentences(ctx.db, LIFE_PAGE_SIZE, (safePage - 1) * LIFE_PAGE_SIZE, options);
    if (!rows.length) {
        await replaceWithText(ctx, 'لا توجد جمل عامة مطابقة حالياً.', new InlineKeyboard().text('🔎 بحث', 'life:search').row().text('🌍 المجتمع', 'life:community').text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    const keyboard = new InlineKeyboard();
    for (const row of rows) {
        keyboard.text(`👁 ${row.german_text.slice(0, 24)} — ${row.level}`, `life:pub:${row.id}`).row();
        keyboard.text('📥 نسخ', `life:copy:${row.id}`).text('🔊 استماع', `life:pub_listen:${row.id}`).row();
    }
    const pageCallback = options.query
        ? (p: number) => `life:public:search:${p}`
        : options.level
            ? (p: number) => `life:public:level:${options.level}:${p}`
            : (p: number) => `life:public:${options.sort === 'popular' ? 'popular' : 'latest'}:${p}`;
    if (safePage > 1) keyboard.text('⬅️ السابق', pageCallback(safePage - 1));
    if (safePage < totalPages) keyboard.text('التالي ➡️', pageCallback(safePage + 1));
    if (safePage > 1 || safePage < totalPages) keyboard.row();
    keyboard.text('🔎 بحث', 'life:search').text('🌍 المجتمع', 'life:community').row()
        .text('🏠 الرئيسية', 'menu_main');
    const title = options.query ? `🔎 نتائج البحث: ${options.query}` : options.level ? `🎯 جمل ${options.level}` : options.sort === 'popular' ? '🔥 الأكثر نسخاً' : '🆕 أحدث الجمل';
    const body = rows.map((row, index) =>
        `${index + 1}. 🇩🇪 ${row.german_text}\n` +
        `   🇮🇶 ${row.arabic_text}\n` +
        `   🎯 ${row.level} · 👤 ${publicLifeAuthorName(row.author_display_name)} · 📥 ${row.copied_count}`
    ).join('\n\n');
    await replaceWithText(ctx, `${title}\n\nالصفحة: ${safePage} / ${totalPages}\n\n${body}`, keyboard);
}

async function showPublicLifeDetails(ctx: BotContext, sentenceId: number): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const sentence = await getLifeSentenceWithAuthorById(ctx.db, sentenceId, false);
    if (!sentence) {
        await replaceWithText(ctx, 'هذه الجملة غير متاحة.', new InlineKeyboard().text('🌍 المجتمع', 'life:community').text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    if (sentence.user_id === user.user_id) {
        await showLifeDetails(ctx, sentence.id);
        return;
    }
    await incrementLifeSentenceView(ctx.db, sentence.id).catch(() => undefined);
    await showSharedLifeDetails(ctx, sentence, {
        copyCallback: `life:copy:${sentence.id}`,
        listenCallback: `life:pub_listen:${sentence.id}`,
        reportCallback: `life:report:${sentence.id}`,
        backCallback: 'life:community',
    });
}

export async function showLifeSentenceFromShareCode(ctx: BotContext, shareCode: string): Promise<boolean> {
    const user = await currentUser(ctx);
    if (!user) return true;
    const unavailable = await getLifeSentenceByShareCodeAnyVisibility(ctx.db, shareCode);
    const sentence = await getLifeSentenceByShareCode(ctx.db, shareCode);
    if (!sentence) {
        await replaceWithText(
            ctx,
            unavailable?.visibility === 'private'
                ? '🔒 هذه الجملة لم تعد متاحة للمشاركة.'
                : '❌ هذه الجملة غير موجودة أو تمت إزالتها.',
            new InlineKeyboard().text('🧠 مواقف الحياة', 'life:menu').text('🏠 الرئيسية', 'menu_main')
        );
        return true;
    }
    if (sentence.user_id === user.user_id) {
        await showLifeDetails(ctx, sentence.id);
        return true;
    }
    await incrementLifeSentenceView(ctx.db, sentence.id).catch(() => undefined);
    await showSharedLifeDetails(ctx, sentence, {
        copyCallback: `life:copy_code:${shareCode}`,
        listenCallback: `life:listen_code:${shareCode}`,
        reportCallback: `life:report_code:${shareCode}`,
        backCallback: 'life:community',
    });
    return true;
}

async function showSharedLifeDetails(
    ctx: BotContext,
    sentence: LifeSentenceWithKeywords & { author_display_name?: string | null; copied_count: number },
    callbacks: { copyCallback: string; listenCallback: string; reportCallback: string; backCallback: string }
): Promise<void> {
    const keyboard = new InlineKeyboard()
        .text('📥 نسخ إلى جُملي', callbacks.copyCallback).row()
        .text('🔊 استماع', callbacks.listenCallback);
    if (sentence.share_code) {
        const link = lifeDeepLink(ctx, sentence.share_code);
        keyboard.url('📤 مشاركة', `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`🧠 جملة ألمانية من الحياة\n\n🇩🇪 ${sentence.german_text}\n🇮🇶 ${sentence.arabic_text}`)}`);
    }
    keyboard.row()
        .text('🚩 إبلاغ', callbacks.reportCallback).row()
        .text('🔙 رجوع', callbacks.backCallback)
        .text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, publicLifeDetailsText(sentence), keyboard);
}

async function copyPublicLifeSentence(ctx: BotContext, sentenceId: number): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const sentence = await getLifeSentenceWithAuthorById(ctx.db, sentenceId, true);
    if (!sentence) {
        await replaceWithText(ctx, 'هذه الجملة غير متاحة للنسخ.', new InlineKeyboard().text('🌍 المجتمع', 'life:community').text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    await copySharedLifeSentence(ctx, user, sentence, 'life:community');
}

async function copyLifeSentenceByShareCode(ctx: BotContext, shareCode: string): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const sentence = await getLifeSentenceByShareCode(ctx.db, shareCode);
    if (!sentence) {
        await replaceWithText(ctx, 'هذه الجملة غير متاحة للنسخ.', new InlineKeyboard().text('🌍 المجتمع', 'life:community').text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    await copySharedLifeSentence(ctx, user, sentence, 'life:community');
}

async function copySharedLifeSentence(ctx: BotContext, user: User, sentence: LifeSentenceWithKeywords, backCallback: string): Promise<void> {
    if (sentence.user_id === user.user_id) {
        await replaceWithText(ctx, 'هذه جملتك أنت، لا تحتاج إلى نسخها.', new InlineKeyboard().text('📖 افتحها', `life:view:${sentence.id}`).text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    const existing = await getLifeCopyRecord(ctx.db, sentence.id, user.user_id);
    const result = await createLifeSentenceCopy(ctx.db, sentence, user.user_id);
    const message = result.copiedNow
        ? `✅ تمت إضافة الجملة إلى جُمَلك\n\n🇩🇪 ${sentence.german_text}\n🇮🇶 ${sentence.arabic_text}\n\nيمكنك الآن التدريب عليها مثل أي جملة أخرى.`
        : existing
            ? `ℹ️ هذه الجملة موجودة بالفعل ضمن جُمَلك.`
            : `♻️ تم فتح نسختك الحالية.`;
    await replaceWithText(
        ctx,
        message,
        new InlineKeyboard()
            .text('✍️ اكتبها بالألمانية', `life:train:w:${result.newSentenceId}`)
            .text('🎧 اسمع واكتب', `life:train:l:${result.newSentenceId}`).row()
            .text('🧩 رتّبها', `life:train:o:${result.newSentenceId}`)
            .text('🕳 أكمل الفراغ', `life:train:f:${result.newSentenceId}`).row()
            .text('📖 افتح نسختي', `life:view:${result.newSentenceId}`)
            .text('🌍 العودة للمجتمع', backCallback).row()
            .text('🏠 الرئيسية', 'menu_main')
    );
}

async function listenToPublicLifeSentence(ctx: BotContext, sentenceId: number): Promise<void> {
    const sentence = await getLifeSentenceWithAuthorById(ctx.db, sentenceId, false);
    if (sentence) await sendLifeTts(ctx, sentence.german_text);
}

async function listenToLifeSentenceByShareCode(ctx: BotContext, shareCode: string): Promise<void> {
    const sentence = await getLifeSentenceByShareCode(ctx.db, shareCode);
    if (sentence) await sendLifeTts(ctx, sentence.german_text);
}

async function showLifeShareOptions(ctx: BotContext, sentenceId: number): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const sentence = await getLifeSentenceById(ctx.db, user.user_id, sentenceId);
    if (!sentence) {
        await replaceWithText(ctx, 'لم أجد هذه الجملة.', new InlineKeyboard().text('🧠 مواقف الحياة', 'life:menu').text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    const settings = await ensureLifeSettings(ctx.db, user.user_id);
    const keyboard = new InlineKeyboard();
    if (!settings.life_sharing_suspended) {
        keyboard.text('🌍 عامة', `life:vis:${sentence.id}:public`).row()
            .text('🔗 برابط فقط', `life:vis:${sentence.id}:unlisted`).row();
    }
    keyboard.text('🔒 خاصة', `life:vis:${sentence.id}:private`).row();
    if (!settings.life_sharing_suspended && sentence.visibility !== 'private' && sentence.share_code) keyboard.text('📤 رابط المشاركة', `life:share_link:${sentence.id}`).row();
    keyboard.text('🔙 رجوع', `life:view:${sentence.id}`).text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(
        ctx,
        `📤 مشاركة الجملة\n\nاختر الخصوصية:\n\n` +
        `🌍 عامة: تظهر في المجتمع والبحث.\n` +
        `🔗 برابط فقط: لا تظهر في البحث، وتفتح بالرابط فقط.\n` +
        `🔒 خاصة: لا يراها إلا أنت.\n\n` +
        (settings.life_sharing_suspended ? `🚫 مشاركة الجمل معطلة لحسابك مؤقتاً من الإدارة.\n\n` : '') +
        `الحالة الحالية: ${visibilityLabel(sentence.visibility)}`,
        keyboard
    );
}

async function changeLifeVisibility(ctx: BotContext, sentenceId: number, visibility: LifeVisibility): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const settings = await ensureLifeSettings(ctx.db, user.user_id);
    if (settings.life_sharing_suspended && visibility !== 'private') {
        await replaceWithText(
            ctx,
            '🚫 تم تعطيل مشاركة جملك مؤقتاً من إدارة DeutschDrop.\n\nتستطيع استخدام جملك الخاصة والتدريب عليها، لكن لا يمكنك نشرها للعامة أو بالرابط حالياً.',
            new InlineKeyboard().text('🔙 رجوع', `life:view:${sentenceId}`).text('🏠 الرئيسية', 'menu_main')
        );
        return;
    }
    const sentence = await getLifeSentenceById(ctx.db, user.user_id, sentenceId);
    if (!sentence) {
        await replaceWithText(ctx, 'غير مصرح لك بتغيير هذه الجملة.', new InlineKeyboard().text('🧠 مواقف الحياة', 'life:menu').text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    const shareCode = visibility === 'private' ? sentence.share_code : sentence.share_code ?? await generateUniqueLifeShareCode(ctx.db);
    await setLifeSentenceVisibility(ctx.db, user.user_id, sentenceId, visibility, shareCode);
    await showLifeDetails(ctx, sentenceId, visibility === 'private' ? 'تم جعل الجملة خاصة.' : visibility === 'public' ? 'تم نشر الجملة للعامة.' : 'تم جعل الجملة متاحة بالرابط فقط.');
}

async function showLifeShareLink(ctx: BotContext, sentenceId: number): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const settings = await ensureLifeSettings(ctx.db, user.user_id);
    if (settings.life_sharing_suspended) {
        await replaceWithText(ctx, '🚫 مشاركة الجمل معطلة لحسابك مؤقتاً من الإدارة.', new InlineKeyboard().text('🔙 رجوع', `life:view:${sentenceId}`).text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    const sentence = await getLifeSentenceById(ctx.db, user.user_id, sentenceId);
    if (!sentence || !sentence.share_code || sentence.visibility === 'private') {
        await replaceWithText(ctx, 'هذه الجملة غير متاحة للمشاركة الآن.', new InlineKeyboard().text('🧠 مواقف الحياة', 'life:menu').text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    const link = lifeDeepLink(ctx, sentence.share_code);
    await replaceWithText(
        ctx,
        `📤 رابط المشاركة\n\n${safeShareText(sentence, link)}`,
        new InlineKeyboard()
            .url('📤 مشاركة في تيليغرام', `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`🧠 جملة ألمانية من الحياة\n\n🇩🇪 ${sentence.german_text}\n🇮🇶 ${sentence.arabic_text}`)}`).row()
            .text('🔙 رجوع', `life:view:${sentence.id}`)
            .text('🏠 الرئيسية', 'menu_main')
    );
}

async function showLifeReportReasons(ctx: BotContext, sentenceId: number): Promise<void> {
    const sentence = await getLifeSentenceWithAuthorById(ctx.db, sentenceId, false);
    if (sentence) await showLifeReportReasonKeyboard(ctx, sentence.id, 'life:community');
}

async function showLifeReportReasonsByCode(ctx: BotContext, shareCode: string): Promise<void> {
    const sentence = await getLifeSentenceByShareCode(ctx.db, shareCode);
    if (sentence) await showLifeReportReasonKeyboard(ctx, sentence.id, 'life:community');
}

async function showLifeReportReasonKeyboard(ctx: BotContext, sentenceId: number, backCallback: string): Promise<void> {
    await replaceWithText(
        ctx,
        '🚩 إبلاغ عن الجملة\n\nاختر سبب البلاغ:',
        new InlineKeyboard()
            .text('ترجمة خاطئة', `life:report:${sentenceId}:wrong_translation`).row()
            .text('ألمانية غير صحيحة', `life:report:${sentenceId}:bad_german`).row()
            .text('محتوى غير مناسب', `life:report:${sentenceId}:inappropriate`).row()
            .text('معلومات شخصية', `life:report:${sentenceId}:personal_info`).row()
            .text('Spam', `life:report:${sentenceId}:spam`).row()
            .text('سبب آخر', `life:report:${sentenceId}:other`).row()
            .text('🔙 رجوع', backCallback).text('🏠 الرئيسية', 'menu_main')
    );
}

async function submitLifeReport(ctx: BotContext, sentenceId: number, reason: string): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const sentence = await getLifeSentenceWithAuthorById(ctx.db, sentenceId, false);
    if (!sentence || sentence.user_id === user.user_id) {
        await replaceWithText(ctx, 'لا يمكن إرسال بلاغ لهذه الجملة.', new InlineKeyboard().text('🌍 المجتمع', 'life:community').text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    const created = await createLifeSentenceReport(ctx.db, sentenceId, user.user_id, reason);
    await replaceWithText(ctx, created ? 'تم إرسال البلاغ. شكراً لمساعدتك في تحسين المجتمع.' : 'أرسلت بلاغاً لهذه الجملة سابقاً.', new InlineKeyboard().text('🌍 المجتمع', 'life:community').text('🏠 الرئيسية', 'menu_main'));
}

async function showPublishedLifeSentences(ctx: BotContext, page: number): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const total = await countPublishedLifeSentencesByUser(ctx.db, user.user_id);
    const totalPages = Math.max(1, Math.ceil(total / LIFE_PAGE_SIZE));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const rows = await listPublishedLifeSentencesByUser(ctx.db, user.user_id, LIFE_PAGE_SIZE, (safePage - 1) * LIFE_PAGE_SIZE);
    if (!rows.length) {
        await replaceWithText(ctx, 'لا توجد جمل منشورة حالياً.', new InlineKeyboard().text('📖 جمل من حياتي', 'life:list:1').text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    const keyboard = new InlineKeyboard();
    for (const row of rows) {
        keyboard.text(`👁 ${row.german_text.slice(0, 24)} — ${visibilityLabel(row.visibility)}`, `life:view:${row.id}`).row()
            .text('🔒 خاصة', `life:vis:${row.id}:private`)
            .text('🌍 عامة', `life:vis:${row.id}:public`)
            .text('🔗 رابط', `life:vis:${row.id}:unlisted`).row();
    }
    if (safePage > 1) keyboard.text('⬅️ السابق', `life:published:${safePage - 1}`);
    if (safePage < totalPages) keyboard.text('التالي ➡️', `life:published:${safePage + 1}`);
    if (safePage > 1 || safePage < totalPages) keyboard.row();
    keyboard.text('🔙 رجوع', 'life:community').text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, `📤 جُملي المنشورة\n\nالصفحة: ${safePage} / ${totalPages}\n\n${rows.map(row => `🇩🇪 ${row.german_text}\n🇮🇶 ${row.arabic_text}\n${visibilityLabel(row.visibility)} · 👁 ${row.view_count} · 📥 ${row.copied_count}`).join('\n\n')}`, keyboard);
}

async function showCopiedLifeSentences(ctx: BotContext, page: number): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const total = await countCopiedLifeSentencesByUser(ctx.db, user.user_id);
    const totalPages = Math.max(1, Math.ceil(total / LIFE_PAGE_SIZE));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const rows = await listCopiedLifeSentencesByUser(ctx.db, user.user_id, LIFE_PAGE_SIZE, (safePage - 1) * LIFE_PAGE_SIZE);
    if (!rows.length) {
        await replaceWithText(ctx, 'لا توجد جمل منسوخة بعد.', new InlineKeyboard().text('🌍 مجتمع الجمل', 'life:community').text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    const keyboard = new InlineKeyboard();
    for (const row of rows) {
        keyboard.text(`👁 ${row.german_text.slice(0, 24)}`, `life:view:${row.id}`).row()
            .text('✍️ كتابة', `life:train:w:${row.id}`)
            .text('🎧 استماع', `life:train:l:${row.id}`).row()
            .text('🧩 ترتيب', `life:train:o:${row.id}`)
            .text('🕳 فراغ', `life:train:f:${row.id}`).row();
    }
    if (safePage > 1) keyboard.text('⬅️ السابق', `life:copied:${safePage - 1}`);
    if (safePage < totalPages) keyboard.text('التالي ➡️', `life:copied:${safePage + 1}`);
    if (safePage > 1 || safePage < totalPages) keyboard.row();
    keyboard.text('🔙 رجوع', 'life:community').text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, `📥 الجمل التي نسختها\n\nالصفحة: ${safePage} / ${totalPages}`, keyboard);
}

async function showLifeDetails(ctx: BotContext, sentenceId: number, notice = ''): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const sentence = await getLifeSentenceById(ctx.db, user.user_id, sentenceId);
    if (!sentence) {
        await replaceWithText(ctx, 'لم أجد هذه الجملة.', new InlineKeyboard().text('🧠 مواقف الحياة', 'life:menu').text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    const keyboard = new InlineKeyboard()
        .text('🔊 استماع', `life:train:l:${sentence.id}`).row()
        .text('✍️ كتابة', `life:train:w:${sentence.id}`)
        .text('🎧 اسمع واكتب', `life:train:l:${sentence.id}`).row()
        .text('🧩 ترتيب', `life:train:o:${sentence.id}`)
        .text('🕳 فراغ', `life:train:f:${sentence.id}`).row()
        .text('📤 مشاركة الجملة', `life:share:${sentence.id}`).row()
        .text('🔥 اجعلها صعبة', `life:diff:${sentence.id}:hard`)
        .text('🟢 متوسطة', `life:diff:${sentence.id}:medium`).row()
        .text('📦 أرشفة', `life:archive:${sentence.id}`)
        .text('🗑 حذف', `life:delete:${sentence.id}`).row()
        .text('🔙 رجوع', 'life:list:1')
        .text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, `${notice ? `${notice}\n\n` : ''}${lifeDetailsText(sentence)}`, keyboard);
}

async function showDueLifeSentences(ctx: BotContext): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const due = await getDueLifeSentences(ctx.db, user.user_id, 5);
    if (!due.length) {
        await replaceWithText(ctx, '✅ لا توجد مراجعات مستحقة الآن.', new InlineKeyboard().text('🧠 مواقف الحياة', 'life:menu').text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    const keyboard = new InlineKeyboard();
    for (const sentence of due) keyboard.text(sentence.german_text.slice(0, 32), `life:view:${sentence.id}`).row();
    keyboard.text('✍️ كتابة', `life:train:w:${due[0].id}`)
        .text('🎧 استماع', `life:train:l:${due[0].id}`).row()
        .text('🧩 ترتيب', `life:train:o:${due[0].id}`)
        .text('🕳 فراغ', `life:train:f:${due[0].id}`).row()
        .text('🎯 تدريب المستحقة', 'life:train_filter:due:m').row()
        .text('⬅️ رجوع', 'life:menu').text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, `🔁 المستحقة للمراجعة\n\n${due.length} جمل جاهزة للمراجعة.`, keyboard);
}

async function showLifeStats(ctx: BotContext): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const stats = await getLifeStats(ctx.db, user.user_id);
    const streak = await getLifeStreak(ctx.db, user.user_id);
    await replaceWithText(
        ctx,
        `📊 تقدم مواقف الحياة\n\n` +
        `🔥 السلسلة الحالية: ${streak.current} أيام\n` +
        `🏆 أفضل سلسلة: ${streak.best} يوماً\n` +
        `🧠 مجموع الجمل: ${stats.total}\n` +
        `✅ مراجعات صحيحة: ${stats.correct}\n` +
        `❌ مراجعات خاطئة: ${stats.wrong}\n` +
        `📅 جمل هذا الأسبوع: ${stats.week}\n` +
        `🔥 الجمل الصعبة: ${stats.hard}\n` +
        `🔁 المستحقة: ${stats.due}`,
        new InlineKeyboard().text('⬅️ رجوع', 'life:menu').text('🏠 الرئيسية', 'menu_main')
    );
}

async function showLifeSettings(ctx: BotContext, notice = ''): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const settings = await ensureLifeSettings(ctx.db, user.user_id);
    await replaceWithText(
        ctx,
        `${notice ? `${notice}\n\n` : ''}⚙️ إعدادات مواقف الحياة\n\n` +
        `🔒 القفل اليومي: ${settings.gate_enabled ? 'تشغيل' : 'إيقاف'}\n` +
        `🔔 التذكير: ${settings.reminders_enabled ? 'تشغيل' : 'إيقاف'}\n` +
        `⏰ وقت التذكير: ${settings.reminder_time}\n` +
        `🌍 المنطقة الزمنية: ${settings.timezone}\n` +
        `🎯 المستوى المستهدف: ${settings.target_level}\n` +
        `👤 اسم المشاركة: ${settings.share_name_mode === 'bot_name' ? 'اسمي داخل البوت' : settings.share_name_mode === 'custom' ? settings.share_display_name ?? 'اسم مخصص' : 'بدون اسم'}`,
        new InlineKeyboard()
            .text(settings.gate_enabled ? '🔒 إيقاف القفل اليومي' : '🔓 تفعيل القفل اليومي', settings.gate_enabled ? 'life:gate:off' : 'life:gate:on').row()
            .text('🔔 تذكير جملة اليوم', 'life:settings').row()
            .text('👤 بدون اسم', 'life:name:none')
            .text('اسمي داخل البوت', 'life:name:bot').row()
            .text('✏️ اسم مخصص', 'life:name:custom').row()
            .text('🔙 رجوع', 'life:menu')
            .text('🏠 الرئيسية', 'menu_main')
    );
}

async function updateLifeShareNameMode(ctx: BotContext, mode: 'none' | 'bot' | 'custom'): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    if (mode === 'custom') {
        await saveBotSession<LifeShareNameSession>(ctx.db, user.user_id, 'life_share_name_edit', { mode: 'custom_name' }, 20);
        await replaceWithText(ctx, 'اكتب اسم الظهور عند المشاركة.\n\nالشروط: 2 إلى 30 حرفاً، بدون روابط.', new InlineKeyboard().text('❌ إلغاء', 'life:settings').text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    await updateLifeSettings(ctx.db, user.user_id, {
        share_name_mode: mode === 'bot' ? 'bot_name' : 'none',
        share_display_name: mode === 'none' ? null : undefined,
    });
    await showLifeSettings(ctx, 'تم تحديث اسم الظهور عند المشاركة.');
}

async function startLifeTraining(ctx: BotContext, mode: LifeTrainingSession['mode'], sentenceId?: number, filter: 'hard' | 'due' | 'active' = 'active'): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const sentence = await chooseLifeTrainingSentence(ctx, user.user_id, mode, sentenceId, filter);
    if (!sentence) {
        await replaceWithText(ctx, 'لا توجد جملة مناسبة للتدريب الآن.', new InlineKeyboard().text('➕ أضف موقفاً', 'life:add').text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    await clearLifeTrainingSessions(ctx, user.user_id);
    if (mode === 'listening') await sendLifeTts(ctx, sentence.german_text);
    const keywords = await getLifeKeywords(ctx.db, sentence.id);
    const gap = chooseGapKeyword(sentence, keywords);
    const words = splitGermanSentenceWords(sentence.german_text);
    const shuffled = shuffledSentenceWords(sentence.german_text);
    const session: LifeTrainingSession = {
        sentenceId: sentence.id,
        mode,
        answer: mode === 'gap' ? gap.answer : sentence.german_text,
        shownGerman: mode !== 'listening',
        words,
        selectedIndexes: [],
    };
    await saveBotSession<LifeTrainingSession>(ctx.db, user.user_id, lifeTrainingSessionType(mode), session, 30);
    if (mode === 'order') {
        await showLifeOrderQuestion(ctx, sentence, { ...session, words: shuffled, selectedIndexes: [] });
        return;
    }
    const text = mode === 'writing'
        ? `✍️ اكتبها بالألمانية\n\n🇮🇶 ${sentence.arabic_text}\n\nاكتب الجملة الألمانية برسالة عادية.`
        : mode === 'listening'
            ? `🎧 اسمع واكتب\n\nأرسلت لك الصوت. اكتب الجملة الألمانية التي سمعتها.`
            : `🕳 أكمل الفراغ\n\n${gap.prompt}\n\nاكتب الكلمة الناقصة.`;
    await replaceWithText(ctx, text, new InlineKeyboard().text('❌ إلغاء', 'life:menu').text('🏠 الرئيسية', 'menu_main'));
}

async function chooseLifeTrainingSentence(
    ctx: BotContext,
    userId: number,
    mode: LifeTrainingSession['mode'],
    sentenceId?: number,
    filter: 'hard' | 'due' | 'active' = 'active'
): Promise<LifeSentenceWithKeywords | null> {
    if (sentenceId) return getLifeSentenceById(ctx.db, userId, sentenceId);
    const candidates = filter === 'due'
        ? await getDueLifeSentences(ctx.db, userId, 10)
        : await listLifeSentences(ctx.db, userId, 10, 0, filter === 'hard' ? 'hard' : 'active');
    const usable = mode === 'order'
        ? candidates.find(sentence => splitGermanSentenceWords(sentence.german_text).length > 1)
        : candidates[0];
    return usable ? getLifeSentenceById(ctx.db, userId, usable.id) : null;
}

async function showLifeOrderQuestion(ctx: BotContext, sentence: LifeSentenceWithKeywords, session: LifeTrainingSession): Promise<void> {
    const words = session.words?.length ? session.words : shuffledSentenceWords(sentence.german_text);
    const selected = new Set(session.selectedIndexes ?? []);
    const keyboard = new InlineKeyboard();
    words.forEach((word, index) => {
        keyboard.text(selected.has(index) ? `✅ ${word}` : word, `life:ord:${index}`);
        if ((index + 1) % 2 === 0) keyboard.row();
    });
    keyboard.row().text('↩️ تراجع', 'life:ord_undo').text('🔄 إعادة', 'life:ord_reset').row()
        .text('❌ إلغاء', 'life:menu').text('🏠 الرئيسية', 'menu_main');
    const current = (session.selectedIndexes ?? []).map(index => words[index]).filter(Boolean).join(' ');
    await replaceWithText(
        ctx,
        `🧩 رتّب الجملة\n\n🇮🇶 ${sentence.arabic_text}\n\nالترتيب الحالي:\n${current || '—'}\n\nاختر الكلمات بالترتيب الصحيح:`,
        keyboard
    );
}

async function handleLifeOrderPick(ctx: BotContext, index: number): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const session = await getBotSession<LifeTrainingSession>(ctx.db, user.user_id, 'life_training_order');
    if (!session || session.data.answered) return;
    const words = session.data.words ?? [];
    if (index < 0 || index >= words.length) return;
    const selected = session.data.selectedIndexes ?? [];
    if (selected.includes(index)) return;
    const next = { ...session.data, selectedIndexes: [...selected, index] };
    const sentence = await getLifeSentenceById(ctx.db, user.user_id, session.data.sentenceId);
    if (!sentence) {
        await deleteBotSession(ctx.db, user.user_id, 'life_training_order');
        return;
    }
    if (next.selectedIndexes.length >= words.length) {
        const answer = next.selectedIndexes.map(item => words[item]).join(' ');
        await handleLifeTrainingAnswer(ctx, user, { ...next, answer: session.data.answer, answered: true }, 'life_training_order', answer);
        return;
    }
    await saveBotSession<LifeTrainingSession>(ctx.db, user.user_id, 'life_training_order', next, 30);
    await showLifeOrderQuestion(ctx, sentence, next);
}

async function handleLifeOrderUndo(ctx: BotContext): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const session = await getBotSession<LifeTrainingSession>(ctx.db, user.user_id, 'life_training_order');
    if (!session) return;
    const sentence = await getLifeSentenceById(ctx.db, user.user_id, session.data.sentenceId);
    if (!sentence) return;
    const next = { ...session.data, selectedIndexes: (session.data.selectedIndexes ?? []).slice(0, -1) };
    await saveBotSession<LifeTrainingSession>(ctx.db, user.user_id, 'life_training_order', next, 30);
    await showLifeOrderQuestion(ctx, sentence, next);
}

async function handleLifeOrderReset(ctx: BotContext): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const session = await getBotSession<LifeTrainingSession>(ctx.db, user.user_id, 'life_training_order');
    if (!session) return;
    const sentence = await getLifeSentenceById(ctx.db, user.user_id, session.data.sentenceId);
    if (!sentence) return;
    const next = { ...session.data, selectedIndexes: [] };
    await saveBotSession<LifeTrainingSession>(ctx.db, user.user_id, 'life_training_order', next, 30);
    await showLifeOrderQuestion(ctx, sentence, next);
}

async function handleLifeTrainingAnswer(
    ctx: BotContext,
    user: User,
    session: LifeTrainingSession,
    sessionType: 'life_training_writing' | 'life_training_listening' | 'life_training_order' | 'life_training_gap',
    answer: string
): Promise<void> {
    const sentence = await getLifeSentenceById(ctx.db, user.user_id, session.sentenceId);
    if (!sentence) {
        await deleteBotSession(ctx.db, user.user_id, sessionType);
        return;
    }
    const evaluation = evaluateWrittenAnswer({
        userAnswer: answer,
        expectedAnswer: session.answer,
        answerLanguage: 'de',
    });
    const isCorrect = evaluation.accepted;
    const stats = reviewLifeSentenceStats(sentence, isCorrect);
    await updateLifeSentenceReview(ctx.db, user.user_id, sentence.id, { isCorrect, ...stats });
    await deleteBotSession(ctx.db, user.user_id, sessionType);
    await replaceWithText(
        ctx,
        `${isCorrect ? '✅ صحيح' : '❌ غير صحيح'}\n\nجوابك: ${answer.trim()}\nالصحيح: ${session.answer}`,
        new InlineKeyboard()
            .text('🔁 تدريب آخر', `life:train:${modeAlias(session.mode)}:${sentence.id}`).row()
            .text('🧠 تفاصيل الجملة', `life:view:${sentence.id}`)
            .text('🏠 الرئيسية', 'menu_main')
    );
}

async function sendLifeTts(ctx: BotContext, germanText: string): Promise<void> {
    const text = normalizeTtsText(germanText);
    if (!text || !ctx.chat?.id) return;
    const { result } = await synthesizeGermanTts(ctx.env, text, { db: ctx.db });
    if (!result.ok) {
        await ctx.answerCallbackQuery?.('النطق الألماني غير متاح حالياً.').catch(() => {});
        return;
    }
    const sent = await ctx.replyWithAudio(new InputFile(result.audioBytes, 'life-sentence.mp3')).catch(() => null) as { message_id?: number; chat?: { id?: number } } | null;
    const user = await currentUser(ctx, false);
    if (sent?.message_id && user && ctx.chat?.id) {
        await recordTemporaryMessage(ctx.db, {
            userId: user.user_id,
            chatId: sent.chat?.id ?? ctx.chat.id,
            messageId: sent.message_id,
            kind: 'life_tts',
            text: null,
            deletePolicy: 'after_ttl',
            ttlSeconds: ACTIVE_TEMP_TTL_SECONDS,
        }).catch(() => undefined);
    }
}

async function currentUser(ctx: BotContext, reply = true): Promise<User | null> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return null;
    const user = await getUserByTelegramId(ctx.db, telegramId);
    if (!user?.display_name && reply) await ctx.reply('اكتب /start وسجل اسمك أولاً.');
    return user?.display_name ? user : null;
}

async function clearLifeSessions(ctx: BotContext, userId: number): Promise<void> {
    for (const type of ['awaiting_life_original_arabic', 'awaiting_life_clarification', 'awaiting_life_external_result', 'awaiting_life_german_edit', 'awaiting_life_arabic_edit', 'life_preview', 'life_search'] as const) {
        await deleteBotSession(ctx.db, userId, type);
    }
    await clearLifeTrainingSessions(ctx, userId);
}

async function clearLifeTrainingSessions(ctx: BotContext, userId: number): Promise<void> {
    for (const type of ['life_training_writing', 'life_training_listening', 'life_training_order', 'life_training_gap'] as const) {
        await deleteBotSession(ctx.db, userId, type);
    }
}

function previewText(draft: LifeSentenceDraft): string {
    return `🧠 جملة من حياتك\n\n` +
        (draft.understood_meaning_ar ? `📝 فهمت موقفك هكذا:\n${draft.understood_meaning_ar}\n\n` : '') +
        `🇩🇪 ${draft.german}\n` +
        `🇮🇶 ${draft.arabic}\n\n` +
        `🔊 النطق: ${draft.pronunciation_ar ?? '-'}\n\n` +
        `💡 التذكّر: ${draft.memory_hint ?? '-'}\n\n` +
        `🔑 الكلمات المهمة:\n${draft.keywords.length ? draft.keywords.map(keyword => `• ${keyword.german} — ${keyword.arabic}`).join('\n') : '• -'}\n\n` +
        `هل تريد حفظها؟`;
}

function previewKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('✅ حفظ وفتح التدريبات', 'life:save').row()
        .text('✏️ لم تفهم قصدي', 'life:misunderstood').row()
        .text('✏️ تعديل الفكرة', 'life:add').row()
        .text('✏️ تعديل الألماني', 'life:edit:g')
        .text('✏️ تعديل العربي', 'life:edit:a').row()
        .text('🔄 إعادة الصياغة', 'life:regen')
        .text('🔊 استماع', 'life:listen').row()
        .text('❌ إلغاء', 'life:cancel');
}

function lifeDetailsText(sentence: LifeSentenceWithKeywords): string {
    return `🧠 تفاصيل الجملة\n\n` +
        `🇩🇪 ${sentence.german_text}\n` +
        `🇮🇶 ${sentence.arabic_text}\n` +
        `🔊 ${sentence.pronunciation_ar ?? '-'}\n` +
        `💡 ${sentence.memory_hint ?? '-'}\n` +
        `🎯 المستوى: ${sentence.level}\n` +
        `🔥 الصعوبة: ${sentence.difficulty}\n` +
        `🔁 المراجعات: ${sentence.review_count}\n` +
        `✅ الصحيح: ${sentence.correct_count}\n` +
        `❌ الخطأ: ${sentence.wrong_count}\n` +
        `📅 أضيفت: ${sentence.created_at}\n` +
        `⏰ المراجعة القادمة: ${sentence.next_review_at ?? '-'}\n\n` +
        `🔒 الخصوصية: ${visibilityLabel(sentence.visibility)}\n` +
        `📥 مرات النسخ: ${sentence.copied_count ?? 0}\n\n` +
        `🔑 الكلمات:\n${sentence.keywords.length ? sentence.keywords.map(keyword => `• ${keyword.german_word} — ${keyword.arabic_meaning}`).join('\n') : '-'}`;
}

function publicLifeDetailsText(sentence: LifeSentenceWithKeywords & { author_display_name?: string | null; copied_count: number }): string {
    return `🧠 جملة من الحياة\n\n` +
        `🇩🇪 ${sentence.german_text}\n` +
        `🇮🇶 ${sentence.arabic_text}\n\n` +
        `🔊 النطق:\n${sentence.pronunciation_ar ?? '-'}\n\n` +
        `🔑 الكلمات:\n${sentence.keywords.length ? sentence.keywords.map(keyword => `• ${keyword.german_word} — ${keyword.arabic_meaning}`).join('\n') : '-'}\n\n` +
        `🎯 المستوى: ${sentence.level}\n` +
        `👤 بواسطة: ${publicLifeAuthorName(sentence.author_display_name)}\n` +
        `📥 نسخها: ${sentence.copied_count ?? 0}`;
}

function visibilityLabel(value: LifeVisibility | string | null | undefined): string {
    return value === 'public' ? '🌍 عامة' : value === 'unlisted' ? '🔗 رابط فقط' : '🔒 خاصة';
}

function lifeDeepLink(ctx: BotContext, shareCode: string): string {
    const username = ctx.me?.username ?? 'DeutschDropBot';
    return `https://t.me/${username}?start=life_${shareCode}`;
}

function safeShareText(sentence: LifeSentenceWithKeywords | LifeSentence, link: string): string {
    return `🧠 جملة ألمانية من الحياة\n\n` +
        `🇩🇪 ${sentence.german_text}\n` +
        `🇮🇶 ${sentence.arabic_text}\n\n` +
        `تعلّم جملاً حقيقية مع DeutschDrop:\n${link}`;
}

function splitGermanSentenceWords(value: string): string[] {
    return value.split(/\s+/).map(word => word.trim()).filter(word => /[\p{Letter}\p{Number}]/u.test(word));
}

function cancelHomeKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('❌ إلغاء', 'life:cancel')
        .text('🏠 الرئيسية', 'menu_main');
}

function lifeTrainingSessionType(mode: LifeTrainingSession['mode']): 'life_training_writing' | 'life_training_listening' | 'life_training_order' | 'life_training_gap' {
    return mode === 'writing' ? 'life_training_writing' : mode === 'listening' ? 'life_training_listening' : mode === 'order' ? 'life_training_order' : 'life_training_gap';
}

function modeAlias(mode: LifeTrainingSession['mode']): 'w' | 'l' | 'o' | 'f' {
    return mode === 'writing' ? 'w' : mode === 'listening' ? 'l' : mode === 'order' ? 'o' : 'f';
}

function chooseMixedLifeMode(): LifeTrainingSession['mode'] {
    const modes: Array<LifeTrainingSession['mode']> = ['writing', 'listening', 'order', 'gap'];
    return modes[Math.floor(Date.now() / 1000) % modes.length];
}

const EXTERNAL_CHATGPT_PROMPT = `أنا أتعلم اللغة الألمانية.

اسألني أولاً بالعربية:

ما الشيء الحقيقي الذي حدث معك اليوم أو البارحة، أو ما الشيء الذي ستفعله اليوم؟

بعد أن أجيبك، حوّل كلامي إلى جملة ألمانية طبيعية وشائعة تناسب مستواي.

أعد النتيجة بهذا التنسيق حصراً:

German: [الجملة الألمانية]
Arabic: [المعنى العربي الدقيق]
Pronunciation: [نطق الجملة بحروف عربية بصورة مبسطة]
Memory: [طريقة قصيرة تساعدني على تذكّر الجملة]
Keywords: [أهم الكلمات بصيغة كلمة ألمانية = معناها العربي]
Level: [A1 أو A2 أو B1]

الشروط:

* حافظ على المعنى الذي قصدته.
* لا تستخدم ترجمة حرفية غريبة.
* اجعل الجملة طبيعية ويستعملها الألمان فعلاً.
* لا تجعل الجملة أعلى من مستواي إلا عند الضرورة.
* إذا كان كلامي غامضاً، اسألني سؤالاً واحداً فقط.
* لا تضف أي شرح خارج التنسيق المطلوب.`;
