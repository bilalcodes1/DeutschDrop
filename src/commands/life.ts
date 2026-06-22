import { Bot, InlineKeyboard, InputFile } from 'grammy';
import type { BotContext } from '../bot/context';
import type { User } from '../models';
import { getUserByTelegramId, getUserSettings } from '../repositories/userRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import {
    archiveLifeSentence,
    countLifeSentences,
    ensureLifeSettings,
    getDueLifeSentences,
    getLifeKeywords,
    getLifeSentenceById,
    getLifeStats,
    getTodayLifeSentence,
    listLifeSentences,
    setLifeGateReminder,
    setLifeSentenceDifficulty,
    skipLifeReminderToday,
    softDeleteLifeSentence,
    updateLifeSentenceReview,
    updateLifeSettings,
    type LifeSentence,
    type LifeSentenceWithKeywords,
} from '../repositories/lifeSentenceRepository';
import {
    chooseGapKeyword,
    generateLifeSentenceWithAi,
    getLifeGateDate,
    getLifeGateStatus,
    getLifeStreak,
    isLifeGateOpen,
    parseExternalLifeResult,
    reviewLifeSentenceStats,
    saveLifeSentenceAndGate,
    shuffledSentenceWords,
    validateLifeOriginalInput,
    type LifeSentenceDraft,
} from '../services/lifeSentences';
import { synthesizeGermanTts } from '../services/tts/ttsRouter';
import { normalizeTtsText } from '../services/tts/types';
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

interface LifeEditSession {
    draft: LifeSentenceDraft;
    sourceType: LifeSource;
}

interface LifeTrainingSession {
    sentenceId: number;
    mode: 'writing' | 'listening' | 'order' | 'gap';
    answer: string;
    shownGerman?: boolean;
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

    bot.callbackQuery(/^life:view:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showLifeDetails(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^life:train:(w|l|o|f)(?::(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const mode = ctx.match[1] === 'w' ? 'writing' : ctx.match[1] === 'l' ? 'listening' : ctx.match[1] === 'o' ? 'order' : 'gap';
        await startLifeTraining(ctx, mode, ctx.match[2] ? Number(ctx.match[2]) : undefined);
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
            .text('➕ أضف موقفاً جديداً', 'life:add').row()
            .text('📖 جمل من حياتي', 'life:list:1').row()
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

    for (const sessionType of ['life_training_writing', 'life_training_listening', 'life_training_order', 'life_training_gap'] as const) {
        const session = await getBotSession<LifeTrainingSession>(ctx.db, user.user_id, sessionType);
        if (session) {
            await handleLifeTrainingAnswer(ctx, user, session.data, sessionType, text);
            return true;
        }
    }

    return false;
}

async function generateLifeFromText(ctx: BotContext, user: User, text: string, sourceType: LifeSource): Promise<void> {
    const input = validateLifeOriginalInput(text);
    if (!input.ok) {
        await replaceWithText(ctx, input.message, cancelHomeKeyboard());
        return;
    }
    const settings = await getUserSettings(ctx.db, user.user_id);
    await replaceWithText(ctx, '⏳ أحوّل موقفك إلى جملة ألمانية طبيعية...', cancelHomeKeyboard());
    const result = await generateLifeSentenceWithAi(ctx.env, ctx.db, user.user_id, input.value, (settings?.german_level ?? 'A1') as 'A1' | 'A2' | 'B1');
    if (!result.ok) {
        await replaceWithText(
            ctx,
            `تعذر التوليد حالياً.\n\n${result.status}`,
            new InlineKeyboard().text('🔁 إعادة المحاولة', 'life:add').row().text('📋 استخدم ChatGPT', 'life:ext').row().text('❌ إلغاء', 'life:cancel')
        );
        return;
    }
    await saveLifeDraftSession(ctx, user.user_id, result.draft, sourceType);
    await showLifePreview(ctx, result.draft);
}

async function saveLifeDraftSession(ctx: BotContext, userId: number, draft: LifeSentenceDraft, sourceType: LifeSource): Promise<void> {
    await deleteBotSession(ctx.db, userId, 'awaiting_life_original_arabic');
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
    if (safePage > 1) keyboard.text('⬅️ السابق', `life:list:${safePage - 1}:${filter}`);
    if (safePage < totalPages) keyboard.text('التالي ➡️', `life:list:${safePage + 1}:${filter}`);
    if (safePage > 1 || safePage < totalPages) keyboard.row();
    keyboard.text('🔍 بحث', 'life:search').row()
        .text('A1', 'life:list:1:A1').text('A2', 'life:list:1:A2').text('B1', 'life:list:1:B1').row()
        .text('🔥 صعبة', 'life:list:1:hard').text('🔁 مستحقة', 'life:list:1:due').row()
        .text('⬅️ رجوع', 'life:menu').text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, `📖 جمل من حياتي\n\nالصفحة: ${safePage} / ${totalPages}\nعدد الجمل: ${total}`, keyboard);
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
        .text('🔥 اجعلها صعبة', `life:diff:${sentence.id}:hard`).row()
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
    keyboard.text('✍️ ابدأ مراجعة كتابة', `life:train:w:${due[0].id}`).row()
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
        `🎯 المستوى المستهدف: ${settings.target_level}`,
        new InlineKeyboard()
            .text(settings.gate_enabled ? '🔒 إيقاف القفل اليومي' : '🔓 تفعيل القفل اليومي', settings.gate_enabled ? 'life:gate:off' : 'life:gate:on').row()
            .text('🔔 تذكير جملة اليوم', 'life:settings').row()
            .text('🔙 رجوع', 'life:menu')
            .text('🏠 الرئيسية', 'menu_main')
    );
}

async function startLifeTraining(ctx: BotContext, mode: LifeTrainingSession['mode'], sentenceId?: number): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;
    const sentence = sentenceId
        ? await getLifeSentenceById(ctx.db, user.user_id, sentenceId)
        : (await getDueLifeSentences(ctx.db, user.user_id, 1))[0] ? await getLifeSentenceById(ctx.db, user.user_id, (await getDueLifeSentences(ctx.db, user.user_id, 1))[0].id) : null;
    if (!sentence) {
        await replaceWithText(ctx, 'لا توجد جملة مناسبة للتدريب الآن.', new InlineKeyboard().text('➕ أضف موقفاً', 'life:add').text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    await clearLifeTrainingSessions(ctx, user.user_id);
    if (mode === 'listening') await sendLifeTts(ctx, sentence.german_text);
    const keywords = await getLifeKeywords(ctx.db, sentence.id);
    const gap = chooseGapKeyword(sentence, keywords);
    const session: LifeTrainingSession = {
        sentenceId: sentence.id,
        mode,
        answer: mode === 'gap' ? gap.answer : sentence.german_text,
        shownGerman: mode !== 'listening',
    };
    await saveBotSession<LifeTrainingSession>(ctx.db, user.user_id, lifeTrainingSessionType(mode), session, 30);
    const text = mode === 'writing'
        ? `✍️ اكتبها بالألمانية\n\n🇮🇶 ${sentence.arabic_text}\n\nاكتب الجملة الألمانية برسالة عادية.`
        : mode === 'listening'
            ? `🎧 اسمع واكتب\n\nأرسلت لك الصوت. اكتب الجملة الألمانية التي سمعتها.`
            : mode === 'order'
                ? `🧩 رتّب الجملة\n\nالكلمات:\n${shuffledSentenceWords(sentence.german_text).join(' / ')}\n\nاكتب الجملة بالترتيب الصحيح.`
                : `🕳 أكمل الفراغ\n\n${gap.prompt}\n\nاكتب الكلمة الناقصة.`;
    await replaceWithText(ctx, text, new InlineKeyboard().text('❌ إلغاء', 'life:menu').text('🏠 الرئيسية', 'menu_main'));
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
    const isCorrect = normalizeGermanLifeAnswer(answer) === normalizeGermanLifeAnswer(session.answer);
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
    await ctx.replyWithAudio(new InputFile(result.audioBytes, 'life-sentence.mp3'), {
        title: text,
        performer: 'DeutschDrop',
        caption: `🔊 ${text}`,
    }).catch(() => undefined);
}

async function currentUser(ctx: BotContext, reply = true): Promise<User | null> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return null;
    const user = await getUserByTelegramId(ctx.db, telegramId);
    if (!user?.display_name && reply) await ctx.reply('اكتب /start وسجل اسمك أولاً.');
    return user?.display_name ? user : null;
}

async function clearLifeSessions(ctx: BotContext, userId: number): Promise<void> {
    for (const type of ['awaiting_life_original_arabic', 'awaiting_life_external_result', 'awaiting_life_german_edit', 'awaiting_life_arabic_edit', 'life_preview', 'life_search'] as const) {
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
        `🔑 الكلمات:\n${sentence.keywords.length ? sentence.keywords.map(keyword => `• ${keyword.german_word} — ${keyword.arabic_meaning}`).join('\n') : '-'}`;
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

function normalizeGermanLifeAnswer(value: string): string {
    return value
        .trim()
        .toLocaleLowerCase('de-DE')
        .replace(/ß/g, 'ss')
        .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
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
