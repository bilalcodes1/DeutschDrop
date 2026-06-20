import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context.js';
import { isAdminTelegramId } from '../services/adminAccess.js';
import { getUserByTelegramId, isRegisteredUser } from '../repositories/userRepository.js';
import { saveBotSession, deleteBotSession, getBotSession } from '../repositories/sessionRepository.js';
import {
    createGoetheImportJob,
    getActiveGoetheLevels,
    getGoetheQuestionOptions,
    listGoetheSources,
    setGoetheSourceStatus,
    type GoetheLevel,
    type GoetheSessionQuestionDetail,
} from '../repositories/goetheRepository.js';
import { formatGoetheImportsList, processGoetheImportJobById } from '../services/goetheImportService.js';
import { formatGoetheReview, formatGoetheStats, getGoetheQuestionRenderData, startGoetheSession, answerGoetheQuestion, type GoetheMode } from '../services/goetheTrainingService.js';
import { sendGoetheQuestionAudio } from '../services/goetheAudioService.js';
import { replaceWithText } from './wordPanel.js';

interface GoetheUploadSession {
    waiting: true;
}

const GOETHE_MODES: Array<{ key: GoetheMode; label: string }> = [
    { key: 'challenge', label: '🎯 Goethe Challenge' },
    { key: 'missed_call', label: '📞 Missed Call Mode' },
    { key: 'speed', label: '⚡ Speed Mode' },
    { key: 'weakness', label: '🧠 Weakness Training' },
    { key: 'mock', label: '📝 Full Mock Test' },
];

export function registerGoetheCommand(bot: Bot<BotContext>): void {
    bot.command('upload_goethe_pack', async (ctx) => {
        if (!isAdminTelegramId(ctx.env, ctx.from?.id)) {
            await ctx.reply('غير مصرح لك باستخدام هذا الأمر.');
            return;
        }
        const user = await currentUser(ctx);
        if (!user) return;
        await saveBotSession<GoetheUploadSession>(ctx.db, user.user_id, 'goethe_pack_upload', { waiting: true }, 30);
        await ctx.reply(
            `📦 أرسل ملف Goethe ZIP\n\n` +
            `يجب أن يحتوي:\n• questions.csv\n• ملفات الصوت\n\n` +
            `الحد الافتراضي: 50MB مضغوط، 1000 سؤال.`,
            { reply_markup: new InlineKeyboard().text('❌ إلغاء', 'goethe_upload_cancel').text('🏠 الرئيسية', 'menu_main') }
        );
    });

    bot.command('goethe_imports', async (ctx) => {
        if (!isAdminTelegramId(ctx.env, ctx.from?.id)) {
            await ctx.reply('غير مصرح لك باستخدام هذا الأمر.');
            return;
        }
        await ctx.reply(await formatGoetheImportsList(ctx.db), { reply_markup: adminGoetheKeyboard() });
    });

    bot.command('goethe_sources', async (ctx) => {
        if (!isAdminTelegramId(ctx.env, ctx.from?.id)) {
            await ctx.reply('غير مصرح لك باستخدام هذا الأمر.');
            return;
        }
        await showGoetheSources(ctx);
    });

    bot.command('goethe', async (ctx) => {
        await showGoetheMenu(ctx);
    });

    bot.on('message:text', async (ctx, next) => {
        const user = await currentUser(ctx, false);
        if (!user) return next();
        const active = await getGoetheQuestionRenderDataForUser(ctx, user.user_id);
        if (!active || active.question?.format !== 'text_input') return next();
        await handleGoetheAnswer(ctx, user.user_id, active.question.session_id, active.question.position, ctx.message.text);
    });

    bot.on('message:document', async (ctx, next) => {
        const user = await currentUser(ctx, false);
        if (!user) return next();
        const session = await getBotSession<GoetheUploadSession>(ctx.db, user.user_id, 'goethe_pack_upload');
        if (!session) return next();
        if (!isAdminTelegramId(ctx.env, ctx.from?.id)) {
            await ctx.reply('غير مصرح لك باستخدام هذا الأمر.');
            return;
        }
        const doc = ctx.message.document;
        const fileName = doc.file_name || 'goethe_pack.zip';
        if (!fileName.toLowerCase().endsWith('.zip')) {
            await ctx.reply('أرسل ملف ZIP فقط. الجلسة ما زالت مفتوحة.');
            return;
        }
        await deleteBotSession(ctx.db, user.user_id, 'goethe_pack_upload');
        const progress = await ctx.reply(`📦 Goethe Import\nمرحلة: received\nالتقدم: 0%`);
        const jobId = await createGoetheImportJob(ctx.db, {
            adminUserId: user.user_id,
            telegramChatId: ctx.chat.id,
            telegramFileId: doc.file_id,
            telegramFileName: fileName,
            telegramFileSize: doc.file_size ?? null,
            progressMessageId: progress.message_id,
        });
        await ctx.api.editMessageText(ctx.chat.id, progress.message_id, `📦 Goethe Import #${jobId}\nمرحلة: queued\nالتقدم: 0%`).catch(() => undefined);
        if (ctx.executionCtx) {
            const workerBot = new Bot<BotContext>(ctx.env.TELEGRAM_BOT_TOKEN);
            ctx.executionCtx.waitUntil(processGoetheImportJobById(ctx.env, jobId, workerBot));
        }
    });

    bot.callbackQuery('goethe_upload_cancel', async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx, false);
        if (user) await deleteBotSession(ctx.db, user.user_id, 'goethe_pack_upload');
        await replaceWithText(ctx, 'تم إلغاء رفع حزمة Goethe.', new InlineKeyboard().text('🏠 الرئيسية', 'menu_main'));
    });

    bot.callbackQuery('menu_goethe', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showGoetheMenu(ctx);
    });

    bot.callbackQuery(/^goethe:level:(A1|A2|B1)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showGoetheModes(ctx, ctx.match[1] as GoetheLevel);
    });

    bot.callbackQuery(/^goethe:mode:(A1|A2|B1):(challenge|missed_call|speed|weakness|mock)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        const level = ctx.match[1] as GoetheLevel;
        const mode = ctx.match[2] as GoetheMode;
        const result = await startGoetheSession(ctx.db, user.user_id, level, mode);
        if (!result.ok || !result.sessionId) {
            await replaceWithText(ctx, result.message || 'لا توجد أسئلة متاحة.', backGoetheKeyboard(level));
            return;
        }
        await renderGoetheQuestion(ctx, result.sessionId);
    });

    bot.callbackQuery(/^goe:a:(\d+):(\d+):([A-D]|true|false)$/i, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await handleGoetheAnswer(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]), ctx.match[3]);
    });

    bot.callbackQuery(/^goethe:next:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await renderGoetheQuestion(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^goethe:review:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await replaceWithText(ctx, await formatGoetheReview(ctx.db, Number(ctx.match[1]), user.user_id), new InlineKeyboard().text('🎯 أوضاع غوته', 'menu_goethe').text('🏠 الرئيسية', 'menu_main'));
    });

    bot.callbackQuery('goethe:stats', async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await replaceWithText(ctx, await formatGoetheStats(ctx.db, user.user_id), new InlineKeyboard().text('⬅️ رجوع', 'menu_goethe').text('🏠 الرئيسية', 'menu_main'));
    });

    bot.callbackQuery('goethe_imports', async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!isAdminTelegramId(ctx.env, ctx.from?.id)) {
            await replaceWithText(ctx, 'غير مصرح لك باستخدام هذا الأمر.', new InlineKeyboard().text('🏠 الرئيسية', 'menu_main'));
            return;
        }
        await replaceWithText(ctx, await formatGoetheImportsList(ctx.db), adminGoetheKeyboard());
    });

    bot.callbackQuery('goethe_sources', async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!isAdminTelegramId(ctx.env, ctx.from?.id)) {
            await replaceWithText(ctx, 'غير مصرح لك باستخدام هذا الأمر.', new InlineKeyboard().text('🏠 الرئيسية', 'menu_main'));
            return;
        }
        await showGoetheSources(ctx);
    });

    bot.callbackQuery(/^goethe_source:(enable|disable):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!isAdminTelegramId(ctx.env, ctx.from?.id)) {
            await replaceWithText(ctx, 'غير مصرح لك باستخدام هذا الأمر.', new InlineKeyboard().text('🏠 الرئيسية', 'menu_main'));
            return;
        }
        await setGoetheSourceStatus(ctx.db, Number(ctx.match[2]), ctx.match[1] === 'enable');
        await showGoetheSources(ctx);
    });
}

async function showGoetheMenu(ctx: BotContext): Promise<void> {
    const levels = await getActiveGoetheLevels(ctx.db);
    const keyboard = new InlineKeyboard();
    if (levels.length === 0) {
        keyboard.text('🏠 الرئيسية', 'menu_main');
        await replaceWithText(ctx, '🎯 Goethe Training\n\nلا توجد أسئلة Goethe فعالة حالياً.', keyboard);
        return;
    }
    for (const level of levels) keyboard.text(`${level.level} — ${level.count}`, `goethe:level:${level.level}`).row();
    keyboard.text('📊 إحصائياتي', 'goethe:stats').row().text('⬅️ رجوع', 'menu_train').text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, '🎯 Goethe Training\n\nاختر مستواك:', keyboard);
}

async function showGoetheModes(ctx: BotContext, level: GoetheLevel): Promise<void> {
    const keyboard = new InlineKeyboard();
    for (const mode of GOETHE_MODES) keyboard.text(mode.label, `goethe:mode:${level}:${mode.key}`).row();
    keyboard.text('📊 إحصائياتي', 'goethe:stats').row().text('⬅️ رجوع', 'menu_goethe').text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, `🎯 Goethe Training\n\nالمستوى: ${level}\nاختر الوضع:`, keyboard);
}

async function renderGoetheQuestion(ctx: BotContext, sessionId: number): Promise<void> {
    const { question, options } = await getGoetheQuestionRenderData(ctx.db, sessionId);
    if (!question) {
        await replaceWithText(ctx, 'هذه الجلسة انتهت أو غير متاحة.', new InlineKeyboard().text('🎯 أوضاع غوته', 'menu_goethe').text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    if (question.section === 'listening') {
        await sendGoetheQuestionAudio(ctx, question);
    }
    await replaceWithText(ctx, formatQuestionText(question), questionKeyboard(question, options));
}

async function handleGoetheAnswer(ctx: BotContext, userId: number, sessionId: number, position: number, selected: string): Promise<void> {
    const result = await answerGoetheQuestion(ctx.db, userId, sessionId, position, selected);
    if (!result.ok) {
        await replaceWithText(ctx, result.message || 'تعذر تسجيل الإجابة.', new InlineKeyboard().text('🎯 أوضاع غوته', 'menu_goethe').text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    if (result.duplicate) {
        await ctx.answerCallbackQuery?.('تم تسجيل الإجابة مسبقاً.').catch(() => {});
        return;
    }
    if (result.finished && result.session) {
        await replaceWithText(ctx, formatFinished(result.session), finishedKeyboard(result.session.session_id));
        return;
    }
    await replaceWithText(ctx, formatAnswerFeedback(result), new InlineKeyboard().text('التالي ➡️', `goethe:next:${sessionId}`).row().text('🏠 الرئيسية', 'menu_main'));
}

function formatQuestionText(question: GoetheSessionQuestionDetail): string {
    const timer = question.deadline_at ? `\n⏱ الوقت: ${question.time_limit_seconds ?? 30} ثانية` : '';
    return `🎯 Goethe\n\n` +
        `السؤال ${question.position + 1}\n` +
        `المستوى: ${question.level}\n` +
        `القسم: ${question.section}${timer}\n\n` +
        `${question.instruction ? `${question.instruction}\n\n` : ''}` +
        `${question.question_text}`;
}

function questionKeyboard(question: GoetheSessionQuestionDetail, options: Awaited<ReturnType<typeof getGoetheQuestionOptions>>): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    if (question.format === 'mcq_single') {
        for (const option of options) keyboard.text(`${option.option_key}) ${option.option_text}`, `goe:a:${question.session_id}:${question.position}:${option.option_key}`).row();
    } else if (question.format === 'true_false') {
        keyboard.text('✅ Richtig', `goe:a:${question.session_id}:${question.position}:true`).text('❌ Falsch', `goe:a:${question.session_id}:${question.position}:false`).row();
    } else {
        keyboard.text('✍️ اكتب الجواب برسالة نصية').row();
    }
    return keyboard.text('🎯 أوضاع غوته', 'menu_goethe').text('🏠 الرئيسية', 'menu_main');
}

function formatAnswerFeedback(result: Awaited<ReturnType<typeof answerGoetheQuestion>>): string {
    const head = result.correct ? `✅ إجابة صحيحة\n+${result.xpAwarded ?? 0} XP` : `❌ إجابة غير صحيحة\nالصحيح: ${result.correctAnswer}`;
    const explain = result.explanation ? `\n\nشرح: ${result.explanation}` : '';
    const transcript = result.transcript ? `\n\n📜 النص:\n${result.transcript}` : '';
    return `${head}${explain}${transcript}`;
}

function formatFinished(session: { level: string; mode: string; correct_count: number; wrong_count: number; score: number; total_questions: number; xp_awarded: number; session_id: number }): string {
    const totalScore = Math.max(1, session.total_questions * 10);
    return `🏁 انتهى تحدي غوته\n\n` +
        `🎓 المستوى: ${session.level}\n` +
        `🎮 الوضع: ${modeLabel(session.mode)}\n` +
        `✅ صحيح: ${session.correct_count}\n` +
        `❌ خطأ: ${session.wrong_count}\n` +
        `⭐ النتيجة: ${session.score} / ${totalScore}\n` +
        `🎁 XP: +${session.xp_awarded}`;
}

function finishedKeyboard(sessionId: number): InlineKeyboard {
    return new InlineKeyboard()
        .text('🔁 إعادة نفس الوضع', 'menu_goethe').row()
        .text('🧠 تدرب على أخطائي', 'goethe:stats').row()
        .text('📖 مراجعة الإجابات', `goethe:review:${sessionId}`).row()
        .text('🎯 أوضاع غوته', 'menu_goethe')
        .text('🏠 الرئيسية', 'menu_main');
}

async function showGoetheSources(ctx: BotContext): Promise<void> {
    const sources = await listGoetheSources(ctx.db, true);
    const keyboard = new InlineKeyboard();
    if (!sources.length) {
        keyboard.text('🏠 الرئيسية', 'menu_main');
        await replaceWithText(ctx, '📚 لا توجد مصادر Goethe بعد.', keyboard);
        return;
    }
    const text = `📚 مصادر غوته\n\n` + sources.map(source =>
        `#${source.source_id} ${source.source_name}\nstatus: ${source.status}\nquestions: ${source.question_count}\n`
    ).join('\n');
    for (const source of sources.slice(0, 10)) {
        keyboard.text(source.status === 'active' ? `تعطيل #${source.source_id}` : `تفعيل #${source.source_id}`, `goethe_source:${source.status === 'active' ? 'disable' : 'enable'}:${source.source_id}`).row();
    }
    keyboard.text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, text, keyboard);
}

async function currentUser(ctx: BotContext, reply = true) {
    const telegramId = ctx.from?.id;
    if (!telegramId) return null;
    const user = await getUserByTelegramId(ctx.db, telegramId);
    if (!isRegisteredUser(user) && reply) await ctx.reply('استخدم /start للتسجيل أولاً.');
    return isRegisteredUser(user) ? user : null;
}

async function getGoetheQuestionRenderDataForUser(ctx: BotContext, userId: number) {
    const { getActiveGoetheSession } = await import('../repositories/goetheRepository.js');
    const session = await getActiveGoetheSession(ctx.db, userId);
    return session ? getGoetheQuestionRenderData(ctx.db, session.session_id) : null;
}

function adminGoetheKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('📦 آخر الاستيرادات', 'goethe_imports')
        .text('📚 مصادر غوته', 'goethe_sources').row()
        .text('🏠 الرئيسية', 'menu_main');
}

function backGoetheKeyboard(level: GoetheLevel): InlineKeyboard {
    return new InlineKeyboard().text('⬅️ رجوع', `goethe:level:${level}`).text('🏠 الرئيسية', 'menu_main');
}

function modeLabel(mode: string): string {
    return GOETHE_MODES.find(item => item.key === mode)?.label ?? mode;
}
