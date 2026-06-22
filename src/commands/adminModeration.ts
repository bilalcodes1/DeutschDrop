import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getActiveAnnouncement } from '../repositories/announcementRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import {
    changeModerationSentenceVisibility,
    countModerationReports,
    countModerationSentences,
    getModerationReportById,
    getModerationSentenceById,
    getModerationStats,
    hideAllPublicLifeSentencesForUser,
    hideModerationSentence,
    listModerationReports,
    listModerationSentences,
    listReportedUsers,
    logModerationAction,
    pinModerationSentence,
    replaceModerationSentenceKeywords,
    restoreModerationSentence,
    searchModerationSentences,
    setLifeSharingSuspended,
    softDeleteModerationSentence,
    unpinModerationSentence,
    updateModerationReportStatus,
    updateModerationSentenceText,
    type ModerationReportStatus,
    type ModerationSentenceRow,
} from '../repositories/lifeModerationRepository';
import { getAdminUserDetail, getUserByTelegramId } from '../repositories/userRepository';
import { isAdminTelegramId } from '../services/adminAccess';
import { sendTelegramMessage } from '../services/notifications';
import { replaceWithText } from './wordPanel';

type AdminModerationSession =
    | { step: 'search' }
    | { step: 'edit'; sentenceId: number; field: 'german' | 'arabic' | 'pronunciation' | 'level' | 'tense' | 'keywords' | 'note' }
    | { step: 'warn_custom'; targetUserId: number };
type AdminModerationEditField = Extract<AdminModerationSession, { step: 'edit' }>['field'];

const MOD_PAGE_SIZE = 5;
const ADMIN_MOD_SESSION = 'admin_moderation';

export function registerAdminModerationCommand(bot: Bot<BotContext>): void {
    bot.callbackQuery('adm:mod', async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await showModerationCenter(ctx);
    });

    bot.callbackQuery(/^adm:rep:(p|all|rev|dis|rem|pin):(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        const filter = ctx.match[1];
        await showModerationReports(ctx, reportStatusFromFilter(filter), Number(ctx.match[2]), filter === 'pin');
    });

    bot.callbackQuery(/^adm:rep:v:(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await showModerationReportDetail(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^adm:rep:ok:(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await reviewReport(ctx, Number(ctx.match[1]), 'reviewed');
    });

    bot.callbackQuery(/^adm:rep:no:(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await reviewReport(ctx, Number(ctx.match[1]), 'dismissed');
    });

    bot.callbackQuery(/^adm:sent:list:(public|hidden|deleted|pinned):(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await showModerationSentenceList(ctx, ctx.match[1] as 'public' | 'hidden' | 'deleted' | 'pinned', Number(ctx.match[2]));
    });

    bot.callbackQuery(/^adm:sent:v:(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await showModerationSentenceDetail(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^adm:sent:pin:(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await confirmPinSentence(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^adm:sent:pinok:(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await pinSentence(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^adm:sent:unpin:(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await unpinSentence(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^adm:sent:hide:(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await confirmSentenceAction(ctx, Number(ctx.match[1]), 'hide');
    });

    bot.callbackQuery(/^adm:sent:del:(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await confirmSentenceAction(ctx, Number(ctx.match[1]), 'delete');
    });

    bot.callbackQuery(/^adm:sent:do:(hide|del):(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await runSentenceDangerAction(ctx, ctx.match[1] as 'hide' | 'del', Number(ctx.match[2]));
    });

    bot.callbackQuery(/^adm:sent:restore:(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await restoreSentence(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^adm:sent:harddel:(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await replaceWithText(ctx, 'الحذف النهائي غير متاح حالياً حتى لا نكسر البلاغات أو النسخ أو سجلات البوابة اليومية. استخدم soft delete فقط.', moderationSentenceBackKeyboard(Number(ctx.match[1])));
    });

    bot.callbackQuery(/^adm:sent:vis:(\d+):(public|unlisted|private)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await changeSentenceVisibilityByAdmin(ctx, Number(ctx.match[1]), ctx.match[2] as 'public' | 'unlisted' | 'private');
    });

    bot.callbackQuery(/^adm:sent:edit:(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await showEditSentenceMenu(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^adm:sent:edit:(\d+):(g|a|p|lvl|tense|kw|note)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await startEditSentenceField(ctx, Number(ctx.match[1]), editFieldFromToken(ctx.match[2]));
    });

    bot.callbackQuery('adm:search', async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await startAdminSentenceSearch(ctx);
    });

    bot.callbackQuery(/^adm:user:list:(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await showReportedUsers(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^adm:user:(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await showModerationUser(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^adm:user:(susp|restore|hideall):(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await confirmUserAction(ctx, ctx.match[1] as 'susp' | 'restore' | 'hideall', Number(ctx.match[2]));
    });

    bot.callbackQuery(/^adm:user:do:(susp|restore|hideall):(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await runUserAction(ctx, ctx.match[1] as 'susp' | 'restore' | 'hideall', Number(ctx.match[2]));
    });

    bot.callbackQuery(/^adm:user:warn:(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await showWarningReasons(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^adm:user:warn:(\d+):(translation|content|personal|spam|abuse)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await sendUserWarning(ctx, Number(ctx.match[1]), warningText(ctx.match[2]));
    });

    bot.callbackQuery(/^adm:user:warnc:(\d+)$/, async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await startCustomWarning(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery('adm:stats', async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await showModerationStats(ctx);
    });

    bot.callbackQuery('adm:anns', async (ctx) => {
        if (!await requireModerationAdmin(ctx)) return;
        await showModerationAnnouncements(ctx);
    });

    bot.on('message:text', async (ctx, next) => {
        if (!isAdminTelegramId(ctx.env, ctx.from?.id)) return next();
        const admin = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!admin) return next();
        const session = await getBotSession<AdminModerationSession>(ctx.db, admin.user_id, ADMIN_MOD_SESSION);
        if (!session) return next();
        const text = ctx.message.text.trim();
        if (!text || text.startsWith('/')) return next();

        if (session.data.step === 'search') {
            await deleteBotSession(ctx.db, admin.user_id, ADMIN_MOD_SESSION);
            const rows = await searchModerationSentences(ctx.db, text, MOD_PAGE_SIZE, 0);
            await showSearchResults(ctx, text, rows);
            return;
        }
        if (session.data.step === 'edit') {
            await handleEditSentenceInput(ctx, admin.user_id, session.data, text);
            return;
        }
        if (session.data.step === 'warn_custom') {
            await deleteBotSession(ctx.db, admin.user_id, ADMIN_MOD_SESSION);
            await sendUserWarning(ctx, session.data.targetUserId, text);
            return;
        }
        return next();
    });
}

async function requireModerationAdmin(ctx: BotContext): Promise<boolean> {
    await ctx.answerCallbackQuery?.().catch(() => {});
    if (isAdminTelegramId(ctx.env, ctx.from?.id)) return true;
    await ctx.reply('غير مصرح لك باستخدام هذا الأمر.');
    return false;
}

async function currentAdminUserId(ctx: BotContext): Promise<number | null> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    return user?.user_id ?? null;
}

async function showModerationCenter(ctx: BotContext): Promise<void> {
    await replaceWithText(
        ctx,
        '🛡 مركز الإشراف\n\nإدارة بلاغات وجمل مجتمع مواقف الحياة.',
        new InlineKeyboard()
            .text('🚩 البلاغات الجديدة', 'adm:rep:p:1').row()
            .text('📋 جميع البلاغات', 'adm:rep:all:1').row()
            .text('📌 الجمل المثبتة', 'adm:sent:list:pinned:1')
            .text('🌍 الجمل العامة', 'adm:sent:list:public:1').row()
            .text('🔒 الجمل المخفية', 'adm:sent:list:hidden:1')
            .text('🗑 الجمل المحذوفة', 'adm:sent:list:deleted:1').row()
            .text('👥 المستخدمون المُبلّغ عنهم', 'adm:user:list:1').row()
            .text('🔎 بحث عن جملة', 'adm:search')
            .text('📊 إحصائيات الإشراف', 'adm:stats').row()
            .text('📢 الرسائل المثبتة', 'adm:anns').row()
            .text('🏠 لوحة الأدمن', 'admin_panel')
    );
}

async function showModerationReports(ctx: BotContext, status: ModerationReportStatus | 'all', page: number, pinnedOnly = false): Promise<void> {
    const total = await countModerationReports(ctx.db, status, pinnedOnly);
    const totalPages = Math.max(1, Math.ceil(total / MOD_PAGE_SIZE));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const rows = await listModerationReports(ctx.db, status, MOD_PAGE_SIZE, (safePage - 1) * MOD_PAGE_SIZE, pinnedOnly);
    const title = pinnedOnly ? '📌 بلاغات على جمل مثبتة' : status === 'pending' ? '🚩 البلاغات الجديدة' : '📋 جميع البلاغات';
    const body = rows.length
        ? rows.map(row => reportSummary(row)).join('\n\n')
        : 'لا توجد بلاغات في هذا القسم.';
    await replaceWithText(ctx, `${title}\n\nالصفحة: ${safePage}/${totalPages}\n\n${body}`, reportsKeyboard(rows, status, safePage, totalPages, pinnedOnly));
}

function reportsKeyboard(rows: Array<{ id: number }>, status: ModerationReportStatus | 'all', page: number, totalPages: number, pinnedOnly: boolean): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    for (const row of rows) keyboard.text(`👁 بلاغ #${row.id}`, `adm:rep:v:${row.id}`).row();
    keyboard.text('🆕 pending', 'adm:rep:p:1')
        .text('✅ reviewed', 'adm:rep:rev:1').row()
        .text('❌ dismissed', 'adm:rep:dis:1')
        .text('🗑 removed', 'adm:rep:rem:1').row()
        .text('📌 بلاغات مثبتة', 'adm:rep:pin:1').row();
    const filter = pinnedOnly ? 'pin' : reportFilterFromStatus(status);
    if (page > 1) keyboard.text('⬅️ السابق', `adm:rep:${filter}:${page - 1}`);
    if (page < totalPages) keyboard.text('التالي ➡️', `adm:rep:${filter}:${page + 1}`);
    if (page > 1 || page < totalPages) keyboard.row();
    keyboard.text('🔙 رجوع', 'adm:mod').text('🏠 لوحة الأدمن', 'admin_panel');
    return keyboard;
}

async function showModerationReportDetail(ctx: BotContext, reportId: number): Promise<void> {
    const report = await getModerationReportById(ctx.db, reportId);
    if (!report) {
        await replaceWithText(ctx, 'لم أجد هذا البلاغ.', new InlineKeyboard().text('🚩 البلاغات', 'adm:rep:p:1').text('🛡 المركز', 'adm:mod'));
        return;
    }
    await replaceWithText(ctx, reportDetailText(report), reportDetailKeyboard(report));
}

function reportDetailKeyboard(report: { id: number; sentence_id: number; publisher_user_id: number; is_pinned: number }): InlineKeyboard {
    return new InlineKeyboard()
        .text('👁 عرض الجملة', `adm:sent:v:${report.sentence_id}`).row()
        .text('✏️ تعديل الجملة', `adm:sent:edit:${report.sentence_id}`).row()
        .text('🙈 إخفاء الجملة', `adm:sent:hide:${report.sentence_id}`)
        .text('🗑 حذف الجملة', `adm:sent:del:${report.sentence_id}`).row()
        .text(report.is_pinned ? '📌 إلغاء التثبيت' : '📌 تثبيت', report.is_pinned ? `adm:sent:unpin:${report.sentence_id}` : `adm:sent:pin:${report.sentence_id}`).row()
        .text('✅ قبول البلاغ', `adm:rep:ok:${report.id}`)
        .text('❌ رفض البلاغ', `adm:rep:no:${report.id}`).row()
        .text('⚠️ تحذير الناشر', `adm:user:warn:${report.publisher_user_id}`).row()
        .text('🚫 تعطيل مشاركة الناشر', `adm:user:susp:${report.publisher_user_id}`).row()
        .text('👤 ملف الناشر', `adm:user:${report.publisher_user_id}`).row()
        .text('🔙 رجوع', 'adm:rep:p:1');
}

async function reviewReport(ctx: BotContext, reportId: number, status: 'reviewed' | 'dismissed'): Promise<void> {
    const adminUserId = await currentAdminUserId(ctx);
    if (!adminUserId) return;
    const report = await getModerationReportById(ctx.db, reportId);
    if (!report) return;
    await updateModerationReportStatus(ctx.db, reportId, status, adminUserId);
    await logModerationAction(ctx.db, {
        adminUserId,
        actionType: status === 'reviewed' ? 'report_reviewed' : 'report_dismissed',
        targetSentenceId: report.sentence_id,
        targetUserId: report.publisher_user_id,
        reportId,
        oldValue: { status: report.status },
        newValue: { status },
    });
    await showModerationReportDetail(ctx, reportId);
}

async function showModerationSentenceList(ctx: BotContext, kind: 'public' | 'hidden' | 'deleted' | 'pinned', page: number): Promise<void> {
    const total = await countModerationSentences(ctx.db, kind);
    const totalPages = Math.max(1, Math.ceil(total / MOD_PAGE_SIZE));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const rows = await listModerationSentences(ctx.db, kind, MOD_PAGE_SIZE, (safePage - 1) * MOD_PAGE_SIZE, kind === 'public' ? 'latest' : 'latest');
    const title = kind === 'public' ? '🌍 الجمل العامة' : kind === 'hidden' ? '🔒 الجمل المخفية' : kind === 'deleted' ? '🗑 الجمل المحذوفة' : '📌 الجمل المثبتة';
    const body = rows.length ? rows.map(sentenceSummary).join('\n\n') : 'لا توجد جمل هنا.';
    const keyboard = new InlineKeyboard();
    for (const row of rows) keyboard.text(`👁 #${row.id} ${row.german_text.slice(0, 22)}`, `adm:sent:v:${row.id}`).row();
    if (safePage > 1) keyboard.text('⬅️ السابق', `adm:sent:list:${kind}:${safePage - 1}`);
    if (safePage < totalPages) keyboard.text('التالي ➡️', `adm:sent:list:${kind}:${safePage + 1}`);
    if (safePage > 1 || safePage < totalPages) keyboard.row();
    keyboard.text('🔙 رجوع', 'adm:mod').text('🏠 لوحة الأدمن', 'admin_panel');
    await replaceWithText(ctx, `${title}\n\nالصفحة: ${safePage}/${totalPages}\n\n${body}`, keyboard);
}

async function showModerationSentenceDetail(ctx: BotContext, sentenceId: number): Promise<void> {
    const sentence = await getModerationSentenceById(ctx.db, sentenceId);
    if (!sentence) {
        await replaceWithText(ctx, 'لم أجد هذه الجملة.', new InlineKeyboard().text('🛡 المركز', 'adm:mod'));
        return;
    }
    await replaceWithText(ctx, sentenceDetailText(sentence), sentenceDetailKeyboard(sentence));
}

function sentenceDetailKeyboard(sentence: ModerationSentenceRow): InlineKeyboard {
    return new InlineKeyboard()
        .text('✏️ تعديل الجملة', `adm:sent:edit:${sentence.id}`).row()
        .text(sentence.is_pinned ? '📌 إلغاء التثبيت' : '📌 تثبيت', sentence.is_pinned ? `adm:sent:unpin:${sentence.id}` : `adm:sent:pin:${sentence.id}`).row()
        .text('🙈 إخفاء', `adm:sent:hide:${sentence.id}`)
        .text('🗑 حذف', `adm:sent:del:${sentence.id}`).row()
        .text('🔒 خاصة', `adm:sent:vis:${sentence.id}:private`)
        .text('🔗 بالرابط', `adm:sent:vis:${sentence.id}:unlisted`)
        .text('🌍 عامة', `adm:sent:vis:${sentence.id}:public`).row()
        .text('♻️ استعادة', `adm:sent:restore:${sentence.id}`)
        .text('🗑 حذف نهائي', `adm:sent:harddel:${sentence.id}`).row()
        .text('👤 الناشر', `adm:user:${sentence.user_id}`).row()
        .text('🔙 رجوع', 'adm:mod');
}

async function confirmPinSentence(ctx: BotContext, sentenceId: number): Promise<void> {
    const sentence = await getModerationSentenceById(ctx.db, sentenceId);
    if (!sentence) return;
    if (sentence.visibility === 'private') {
        await replaceWithText(
            ctx,
            'هذه الجملة خاصة. لا يمكن تثبيتها مباشرة.\n\nإذا أردت تثبيتها، حوّلها إلى عامة أولاً بتأكيد واضح.',
            new InlineKeyboard().text('🌍 جعلها عامة', `adm:sent:vis:${sentenceId}:public`).row().text('🔙 رجوع', `adm:sent:v:${sentenceId}`)
        );
        return;
    }
    await replaceWithText(
        ctx,
        'هل تريد تثبيت هذه الجملة في أعلى مجتمع الجمل؟',
        new InlineKeyboard().text('✅ تثبيت', `adm:sent:pinok:${sentenceId}`).text('❌ إلغاء', `adm:sent:v:${sentenceId}`)
    );
}

async function pinSentence(ctx: BotContext, sentenceId: number): Promise<void> {
    const adminUserId = await currentAdminUserId(ctx);
    if (!adminUserId) return;
    const before = await getModerationSentenceById(ctx.db, sentenceId);
    const ok = await pinModerationSentence(ctx.db, sentenceId, adminUserId);
    if (ok) await logModerationAction(ctx.db, { adminUserId, actionType: 'sentence_pinned', targetSentenceId: sentenceId, targetUserId: before?.user_id, oldValue: before, newValue: { is_pinned: 1 } });
    await showModerationSentenceDetail(ctx, sentenceId);
}

async function unpinSentence(ctx: BotContext, sentenceId: number): Promise<void> {
    const adminUserId = await currentAdminUserId(ctx);
    if (!adminUserId) return;
    const before = await getModerationSentenceById(ctx.db, sentenceId);
    const ok = await unpinModerationSentence(ctx.db, sentenceId, adminUserId);
    if (ok) await logModerationAction(ctx.db, { adminUserId, actionType: 'sentence_unpinned', targetSentenceId: sentenceId, targetUserId: before?.user_id, oldValue: before, newValue: { is_pinned: 0 } });
    await showModerationSentenceDetail(ctx, sentenceId);
}

async function confirmSentenceAction(ctx: BotContext, sentenceId: number, action: 'hide' | 'delete'): Promise<void> {
    const text = action === 'hide'
        ? '⚠️ هل تريد إخفاء هذه الجملة؟ ستختفي من المجتمع والرابط بدون حذفها.'
        : '⚠️ هل تريد حذف هذه الجملة؟ سيتم soft delete ولن تُحذف نسخ المستخدمين.';
    await replaceWithText(
        ctx,
        text,
        new InlineKeyboard().text('✅ تأكيد', `adm:sent:do:${action === 'hide' ? 'hide' : 'del'}:${sentenceId}`).row().text('❌ إلغاء', `adm:sent:v:${sentenceId}`)
    );
}

async function runSentenceDangerAction(ctx: BotContext, action: 'hide' | 'del', sentenceId: number): Promise<void> {
    const adminUserId = await currentAdminUserId(ctx);
    if (!adminUserId) return;
    const before = await getModerationSentenceById(ctx.db, sentenceId);
    if (!before) return;
    if (action === 'hide') {
        await hideModerationSentence(ctx.db, sentenceId, adminUserId, 'hidden_by_admin');
        await logModerationAction(ctx.db, { adminUserId, actionType: 'sentence_hidden', targetSentenceId: sentenceId, targetUserId: before.user_id, oldValue: before, newValue: { moderation_status: 'hidden' } });
    } else {
        await softDeleteModerationSentence(ctx.db, sentenceId, adminUserId, 'deleted_by_admin');
        await markRelatedPendingReportsRemoved(ctx, adminUserId, sentenceId, before.user_id);
        await logModerationAction(ctx.db, { adminUserId, actionType: 'sentence_deleted', targetSentenceId: sentenceId, targetUserId: before.user_id, oldValue: before, newValue: { moderation_status: 'removed' } });
    }
    await showModerationSentenceDetail(ctx, sentenceId);
}

async function markRelatedPendingReportsRemoved(ctx: BotContext, adminUserId: number, sentenceId: number, targetUserId: number): Promise<void> {
    const reports = await listModerationReports(ctx.db, 'pending', 100, 0);
    for (const report of reports.filter(row => row.sentence_id === sentenceId)) {
        await updateModerationReportStatus(ctx.db, report.id, 'removed', adminUserId);
        await logModerationAction(ctx.db, { adminUserId, actionType: 'sentence_deleted', targetSentenceId: sentenceId, targetUserId, reportId: report.id, newValue: { report_status: 'removed' } });
    }
}

async function restoreSentence(ctx: BotContext, sentenceId: number): Promise<void> {
    const adminUserId = await currentAdminUserId(ctx);
    if (!adminUserId) return;
    const before = await getModerationSentenceById(ctx.db, sentenceId);
    const ok = await restoreModerationSentence(ctx.db, sentenceId, adminUserId, 'private');
    if (ok) await logModerationAction(ctx.db, { adminUserId, actionType: 'sentence_restored', targetSentenceId: sentenceId, targetUserId: before?.user_id, oldValue: before, newValue: { moderation_status: 'approved', visibility: 'private' } });
    await showModerationSentenceDetail(ctx, sentenceId);
}

async function changeSentenceVisibilityByAdmin(ctx: BotContext, sentenceId: number, visibility: 'public' | 'unlisted' | 'private'): Promise<void> {
    const adminUserId = await currentAdminUserId(ctx);
    if (!adminUserId) return;
    const before = await getModerationSentenceById(ctx.db, sentenceId);
    if (!before) return;
    await changeModerationSentenceVisibility(ctx.db, sentenceId, visibility, adminUserId);
    await logModerationAction(ctx.db, { adminUserId, actionType: 'visibility_changed', targetSentenceId: sentenceId, targetUserId: before.user_id, oldValue: { visibility: before.visibility }, newValue: { visibility } });
    await showModerationSentenceDetail(ctx, sentenceId);
}

async function showEditSentenceMenu(ctx: BotContext, sentenceId: number): Promise<void> {
    const sentence = await getModerationSentenceById(ctx.db, sentenceId);
    if (!sentence) return;
    await replaceWithText(
        ctx,
        `✏️ تعديل الجملة\n\n${sentenceDetailCompact(sentence)}\n\nاختر الحقل الذي تريد تعديله:`,
        new InlineKeyboard()
            .text('🇩🇪 تعديل الألماني', `adm:sent:edit:${sentenceId}:g`).row()
            .text('🇮🇶 تعديل العربي', `adm:sent:edit:${sentenceId}:a`).row()
            .text('🔊 تعديل النطق', `adm:sent:edit:${sentenceId}:p`).row()
            .text('🎯 تعديل المستوى', `adm:sent:edit:${sentenceId}:lvl`)
            .text('⏱ تعديل الزمن', `adm:sent:edit:${sentenceId}:tense`).row()
            .text('🔑 تعديل الكلمات', `adm:sent:edit:${sentenceId}:kw`).row()
            .text('📝 إضافة ملاحظة إشراف', `adm:sent:edit:${sentenceId}:note`).row()
            .text('🔙 رجوع', `adm:sent:v:${sentenceId}`)
    );
}

async function startEditSentenceField(ctx: BotContext, sentenceId: number, field: AdminModerationEditField): Promise<void> {
    const adminUserId = await currentAdminUserId(ctx);
    if (!adminUserId) return;
    await saveBotSession<AdminModerationSession>(ctx.db, adminUserId, ADMIN_MOD_SESSION, { step: 'edit', sentenceId, field }, 20);
    await replaceWithText(ctx, editPrompt(field), new InlineKeyboard().text('❌ إلغاء', `adm:sent:v:${sentenceId}`).text('🏠 لوحة الأدمن', 'admin_panel'));
}

async function handleEditSentenceInput(ctx: BotContext, adminUserId: number, session: AdminModerationSession & { step: 'edit' }, text: string): Promise<void> {
    const before = await getModerationSentenceById(ctx.db, session.sentenceId);
    if (!before) return;
    const value = text.trim();
    if (!value && session.field !== 'pronunciation' && session.field !== 'tense' && session.field !== 'note') {
        await ctx.reply('القيمة لا يمكن أن تكون فارغة.');
        return;
    }
    if (session.field === 'level' && !['A1', 'A2', 'B1'].includes(value)) {
        await ctx.reply('المستوى يجب أن يكون A1 أو A2 أو B1.');
        return;
    }
    if (session.field === 'keywords') {
        const keywords = parseKeywordLines(value);
        await replaceModerationSentenceKeywords(ctx.db, session.sentenceId, keywords, adminUserId);
    } else {
        await updateModerationSentenceText(ctx.db, session.sentenceId, {
            germanText: session.field === 'german' ? value : undefined,
            arabicText: session.field === 'arabic' ? value : undefined,
            pronunciationAr: session.field === 'pronunciation' ? value || null : undefined,
            level: session.field === 'level' ? value as 'A1' | 'A2' | 'B1' : undefined,
            tense: session.field === 'tense' ? value || null : undefined,
            moderationNote: session.field === 'note' ? value || null : undefined,
        }, adminUserId);
    }
    await deleteBotSession(ctx.db, adminUserId, ADMIN_MOD_SESSION);
    await logModerationAction(ctx.db, { adminUserId, actionType: 'sentence_edited', targetSentenceId: session.sentenceId, targetUserId: before.user_id, oldValue: before, newValue: { field: session.field, value } });
    await showModerationSentenceDetail(ctx, session.sentenceId);
}

async function startAdminSentenceSearch(ctx: BotContext): Promise<void> {
    const adminUserId = await currentAdminUserId(ctx);
    if (!adminUserId) return;
    await saveBotSession<AdminModerationSession>(ctx.db, adminUserId, ADMIN_MOD_SESSION, { step: 'search' }, 20);
    await replaceWithText(ctx, '🔎 اكتب ID أو share_code أو كلمة ألمانية/عربية أو اسم الناشر.', new InlineKeyboard().text('❌ إلغاء', 'adm:mod'));
}

async function showSearchResults(ctx: BotContext, query: string, rows: ModerationSentenceRow[]): Promise<void> {
    const keyboard = new InlineKeyboard();
    for (const row of rows) keyboard.text(`👁 #${row.id} ${row.german_text.slice(0, 24)}`, `adm:sent:v:${row.id}`).row();
    keyboard.text('🔎 بحث جديد', 'adm:search').text('🔙 رجوع', 'adm:mod');
    await replaceWithText(ctx, `🔎 نتائج البحث الإداري\n\n${query}\n\n${rows.length ? rows.map(sentenceSummary).join('\n\n') : 'لا توجد نتائج.'}`, keyboard);
}

async function showReportedUsers(ctx: BotContext, page: number): Promise<void> {
    const rows = await listReportedUsers(ctx.db, MOD_PAGE_SIZE, (Math.max(1, page) - 1) * MOD_PAGE_SIZE);
    const keyboard = new InlineKeyboard();
    for (const row of rows) keyboard.text(`👤 ${row.display_name ?? row.user_id}`, `adm:user:${row.user_id}`).row();
    if (page > 1) keyboard.text('⬅️ السابق', `adm:user:list:${page - 1}`);
    if (rows.length === MOD_PAGE_SIZE) keyboard.text('التالي ➡️', `adm:user:list:${page + 1}`);
    if (page > 1 || rows.length === MOD_PAGE_SIZE) keyboard.row();
    keyboard.text('🔙 رجوع', 'adm:mod');
    await replaceWithText(ctx, `👥 المستخدمون المُبلّغ عنهم\n\n${rows.length ? rows.map(row =>
        `👤 ${row.display_name ?? row.user_id}\nجمل: ${row.sentence_count} · عامة: ${row.public_sentence_count}\nبلاغات: ${row.received_reports} · مقبولة: ${row.accepted_reports}\nمشاركة: ${row.life_sharing_suspended ? 'موقفة' : 'مفعلة'}`
    ).join('\n\n') : 'لا يوجد مستخدمون ببلاغات.'}`, keyboard);
}

async function showModerationUser(ctx: BotContext, targetUserId: number): Promise<void> {
    const target = await getAdminUserDetail(ctx.db, targetUserId);
    if (!target) return;
    const reportedRows = await listReportedUsers(ctx.db, 1000, 0);
    const reported = reportedRows.find(row => row.user_id === targetUserId);
    await replaceWithText(
        ctx,
        `👤 ملف إشراف المستخدم\n\n` +
        `الاسم: ${target.display_name ?? target.name ?? '-'}\n` +
        `user_id: ${target.user_id}\n` +
        `Telegram ID: ${target.telegram_user_id ?? target.telegram_id}\n` +
        `عدد الجمل: ${reported?.sentence_count ?? 0}\n` +
        `الجمل العامة: ${reported?.public_sentence_count ?? 0}\n` +
        `البلاغات المستلمة: ${reported?.received_reports ?? 0}\n` +
        `بلاغات مقبولة/removed: ${reported?.accepted_reports ?? 0}\n` +
        `المشاركة: ${reported?.life_sharing_suspended ? 'موقفة' : 'مفعلة'}\n` +
        `تاريخ التسجيل: ${target.created_at}`,
        new InlineKeyboard()
            .text('⚠️ إرسال تحذير', `adm:user:warn:${targetUserId}`).row()
            .text('🚫 تعطيل المشاركة', `adm:user:susp:${targetUserId}`)
            .text('✅ إعادة تفعيل المشاركة', `adm:user:restore:${targetUserId}`).row()
            .text('🙈 إخفاء كل جمله العامة', `adm:user:hideall:${targetUserId}`).row()
            .text('📋 عرض جمله', `adm:search`).row()
            .text('🔙 رجوع', 'adm:user:list:1')
    );
}

async function confirmUserAction(ctx: BotContext, action: 'susp' | 'restore' | 'hideall', targetUserId: number): Promise<void> {
    const label = action === 'susp' ? 'تعطيل مشاركة المستخدم' : action === 'restore' ? 'إعادة تفعيل مشاركة المستخدم' : 'إخفاء كل جمله العامة';
    await replaceWithText(ctx, `⚠️ تأكيد\n\n${label}`, new InlineKeyboard().text('✅ تأكيد', `adm:user:do:${action}:${targetUserId}`).row().text('❌ إلغاء', `adm:user:${targetUserId}`));
}

async function runUserAction(ctx: BotContext, action: 'susp' | 'restore' | 'hideall', targetUserId: number): Promise<void> {
    const adminUserId = await currentAdminUserId(ctx);
    if (!adminUserId) return;
    if (action === 'susp') {
        await setLifeSharingSuspended(ctx.db, targetUserId, true, adminUserId);
        await logModerationAction(ctx.db, { adminUserId, actionType: 'sharing_suspended', targetUserId, newValue: { life_sharing_suspended: 1 } });
    } else if (action === 'restore') {
        await setLifeSharingSuspended(ctx.db, targetUserId, false, adminUserId);
        await logModerationAction(ctx.db, { adminUserId, actionType: 'sharing_restored', targetUserId, newValue: { life_sharing_suspended: 0 } });
    } else {
        const changed = await hideAllPublicLifeSentencesForUser(ctx.db, targetUserId, adminUserId, 'hide_all_by_admin');
        await logModerationAction(ctx.db, { adminUserId, actionType: 'sentence_hidden', targetUserId, newValue: { hidden_public_sentences: changed } });
    }
    await showModerationUser(ctx, targetUserId);
}

async function showWarningReasons(ctx: BotContext, targetUserId: number): Promise<void> {
    await replaceWithText(
        ctx,
        '⚠️ إرسال تحذير\n\nاختر السبب:',
        new InlineKeyboard()
            .text('ترجمة خاطئة متكررة', `adm:user:warn:${targetUserId}:translation`).row()
            .text('محتوى غير مناسب', `adm:user:warn:${targetUserId}:content`).row()
            .text('معلومات شخصية', `adm:user:warn:${targetUserId}:personal`).row()
            .text('Spam', `adm:user:warn:${targetUserId}:spam`).row()
            .text('إساءة استخدام المجتمع', `adm:user:warn:${targetUserId}:abuse`).row()
            .text('نص مخصص', `adm:user:warnc:${targetUserId}`).row()
            .text('🔙 رجوع', `adm:user:${targetUserId}`)
    );
}

async function startCustomWarning(ctx: BotContext, targetUserId: number): Promise<void> {
    const adminUserId = await currentAdminUserId(ctx);
    if (!adminUserId) return;
    await saveBotSession<AdminModerationSession>(ctx.db, adminUserId, ADMIN_MOD_SESSION, { step: 'warn_custom', targetUserId }, 15);
    await replaceWithText(ctx, 'اكتب نص التحذير الذي سيرسل للمستخدم بدون كشف هوية الأدمن:', new InlineKeyboard().text('❌ إلغاء', `adm:user:${targetUserId}`));
}

async function sendUserWarning(ctx: BotContext, targetUserId: number, reason: string): Promise<void> {
    const adminUserId = await currentAdminUserId(ctx);
    const target = await getAdminUserDetail(ctx.db, targetUserId);
    if (!adminUserId || !target) return;
    await sendTelegramMessage(
        ctx.env,
        target.telegram_user_id ?? target.telegram_id,
        `⚠️ تنبيه من إدارة DeutschDrop\n\n${reason}\n\nيرجى تعديل أو إزالة المحتوى المخالف.`
    ).catch(() => null);
    await logModerationAction(ctx.db, { adminUserId, actionType: 'user_warned', targetUserId, note: reason });
    await showModerationUser(ctx, targetUserId);
}

async function showModerationStats(ctx: BotContext): Promise<void> {
    const stats = await getModerationStats(ctx.db);
    await replaceWithText(
        ctx,
        `📊 إحصائيات الإشراف\n\n` +
        `🚩 بلاغات معلقة: ${stats.pendingReports}\n` +
        `✅ بلاغات معالجة: ${stats.handledReports}\n` +
        `🗑 جمل محذوفة: ${stats.deletedSentences}\n` +
        `🙈 جمل مخفية: ${stats.hiddenSentences}\n` +
        `📌 جمل مثبتة: ${stats.pinnedSentences}\n` +
        `🌍 جمل عامة: ${stats.publicSentences}\n` +
        `👥 مستخدمون موقوفون عن المشاركة: ${stats.suspendedUsers}\n` +
        `📅 إجراءات اليوم: ${stats.actionsToday}\n` +
        `📅 إجراءات هذا الأسبوع: ${stats.actionsThisWeek}`,
        new InlineKeyboard().text('🔄 تحديث', 'adm:stats').row().text('🔙 رجوع', 'adm:mod')
    );
}

async function showModerationAnnouncements(ctx: BotContext): Promise<void> {
    const active = await getActiveAnnouncement(ctx.db);
    await replaceWithText(
        ctx,
        `📢 الرسائل المثبتة داخل البوت\n\n` +
        (active ? `الرسالة الحالية:\n${active.message}\n\nآخر تحديث: ${active.updated_at}` : 'لا توجد رسالة مثبتة حالياً.') +
        `\n\nملاحظة: هذا نظام الإعلان العام الموجود مسبقاً، وليس Telegram pinChatMessage.`,
        new InlineKeyboard()
            .text('📌 تثبيت/تعديل رسالة', 'admin_announcement_start').row()
            .text('🗑 حذف الرسالة الحالية', 'admin_announcement_clear').row()
            .text('🔙 رجوع', 'adm:mod')
    );
}

function reportStatusFromFilter(filter: string): ModerationReportStatus | 'all' {
    if (filter === 'p') return 'pending';
    if (filter === 'rev') return 'reviewed';
    if (filter === 'dis') return 'dismissed';
    if (filter === 'rem') return 'removed';
    return 'all';
}

function reportFilterFromStatus(status: ModerationReportStatus | 'all'): string {
    if (status === 'pending') return 'p';
    if (status === 'reviewed') return 'rev';
    if (status === 'dismissed') return 'dis';
    if (status === 'removed') return 'rem';
    return 'all';
}

function reportSummary(report: { id: number; german_text: string; arabic_text: string; reason: string; status: string; publisher_name: string | null; report_count: number }): string {
    return `🚩 بلاغ #${report.id}\n🇩🇪 ${report.german_text}\n🇮🇶 ${report.arabic_text}\n📌 السبب: ${report.reason}\nالحالة: ${report.status}\n👤 الناشر: ${safeName(report.publisher_name)}\n📊 بلاغات الجملة: ${report.report_count}`;
}

function reportDetailText(report: {
    id: number;
    german_text: string;
    arabic_text: string;
    reason: string;
    details: string | null;
    publisher_name: string | null;
    reporter_name: string | null;
    created_at: string;
    visibility: string;
    moderation_status: string;
    report_count: number;
    status: string;
}): string {
    return `🚩 بلاغ #${report.id}\n\n` +
        `🧠 الجملة:\n🇩🇪 ${report.german_text}\n🇮🇶 ${report.arabic_text}\n\n` +
        `📌 السبب: ${report.reason}\n` +
        `📝 التفاصيل: ${report.details ?? '-'}\n` +
        `👤 الناشر: ${safeName(report.publisher_name)}\n` +
        `🙋 المبلّغ: ${safeName(report.reporter_name)}\n` +
        `📅 التاريخ: ${report.created_at}\n` +
        `🔒 الخصوصية الحالية: ${report.visibility}\n` +
        `🛡 الإشراف: ${report.moderation_status}\n` +
        `📊 عدد البلاغات على الجملة: ${report.report_count}\n` +
        `الحالة: ${report.status}`;
}

function sentenceSummary(sentence: ModerationSentenceRow): string {
    return `#${sentence.id} 🇩🇪 ${sentence.german_text}\n🇮🇶 ${sentence.arabic_text}\n👤 ${safeName(sentence.author_name)} · ${sentence.visibility} · ${sentence.moderation_status}\n📥 ${sentence.copied_count} · 👁 ${sentence.view_count} · 🚩 ${sentence.report_count}${sentence.is_pinned ? '\n📌 مثبتة' : ''}`;
}

function sentenceDetailText(sentence: ModerationSentenceRow): string {
    return `🧠 جملة #${sentence.id}\n\n${sentenceDetailCompact(sentence)}\n\n` +
        `الناشر: ${safeName(sentence.author_name)} / user_id=${sentence.user_id}\n` +
        `الخصوصية: ${sentence.visibility}\n` +
        `الإشراف: ${sentence.moderation_status}\n` +
        `ملاحظة: ${sentence.moderation_note ?? '-'}\n` +
        `مثبتة: ${sentence.is_pinned ? 'نعم' : 'لا'}\n` +
        `views: ${sentence.view_count} · copies: ${sentence.copied_count} · reports: ${sentence.report_count}\n` +
        `share_code: ${sentence.share_code ?? '-'}\n` +
        `deleted_at: ${sentence.deleted_at ?? '-'}`;
}

function sentenceDetailCompact(sentence: Pick<ModerationSentenceRow, 'german_text' | 'arabic_text' | 'pronunciation_ar' | 'level' | 'tense'>): string {
    return `🇩🇪 ${sentence.german_text}\n🇮🇶 ${sentence.arabic_text}\n🔊 ${sentence.pronunciation_ar ?? '-'}\n🎯 ${sentence.level}${sentence.tense ? ` · ${sentence.tense}` : ''}`;
}

function moderationSentenceBackKeyboard(sentenceId: number): InlineKeyboard {
    return new InlineKeyboard().text('🔙 رجوع', `adm:sent:v:${sentenceId}`).text('🛡 المركز', 'adm:mod');
}

function editFieldFromToken(token: string): AdminModerationEditField {
    if (token === 'g') return 'german';
    if (token === 'a') return 'arabic';
    if (token === 'p') return 'pronunciation';
    if (token === 'lvl') return 'level';
    if (token === 'kw') return 'keywords';
    if (token === 'note') return 'note';
    return 'tense';
}

function editPrompt(field: AdminModerationEditField): string {
    if (field === 'german') return 'أرسل النص الألماني الجديد:';
    if (field === 'arabic') return 'أرسل النص العربي الجديد:';
    if (field === 'pronunciation') return 'أرسل النطق العربي الجديد، أو - لحذفه:';
    if (field === 'level') return 'أرسل المستوى: A1 أو A2 أو B1';
    if (field === 'keywords') return 'أرسل الكلمات بصيغة كل سطر:\nGerman = Arabic';
    if (field === 'note') return 'أرسل ملاحظة الإشراف:';
    return 'أرسل الزمن الجديد أو - لحذفه:';
}

function parseKeywordLines(text: string): Array<{ german_word: string; arabic_meaning: string }> {
    return text.split(/\n+/)
        .map(line => line.split(/\s*=\s*/))
        .filter(parts => parts.length >= 2)
        .map(([german, ...arabicParts]) => ({
            german_word: german.trim(),
            arabic_meaning: arabicParts.join('=').trim(),
        }))
        .filter(keyword => keyword.german_word && keyword.arabic_meaning)
        .slice(0, 5);
}

function warningText(type: string): string {
    if (type === 'translation') return 'لاحظنا وجود ترجمات خاطئة متكررة في الجمل العامة.';
    if (type === 'content') return 'لاحظنا محتوى غير مناسب في إحدى الجمل العامة.';
    if (type === 'personal') return 'لاحظنا معلومات شخصية في إحدى الجمل العامة.';
    if (type === 'spam') return 'لاحظنا سلوك Spam في مجتمع الجمل.';
    return 'لاحظنا إساءة استخدام لمجتمع الجمل.';
}

function safeName(value: string | null | undefined): string {
    return value?.trim() || 'غير معروف';
}
