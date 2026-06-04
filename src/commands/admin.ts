import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { clearActiveAnnouncements, setActiveAnnouncement } from '../repositories/announcementRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import {
    activateSupporterForHours,
    countActiveSupporters,
    countPendingSupportProofs,
    createBroadcastLog,
    getPendingSupportProofs,
} from '../repositories/supportRepository';
import { deleteAllWordsForUser } from '../repositories/wordRepository';
import { countAdminUsers as countUsersForAdmin, getAdminUserDetail, getAdminUserList, getUserByTelegramId, logAdminAction, resetUserStreak, resetUserXp, setUserBanned, softDeleteUser } from '../repositories/userRepository';
import { isAdminTelegramId } from '../services/adminAccess';
import { sendTelegramMessage } from '../services/notifications';
import { replaceWithText } from './wordPanel';

interface BroadcastSession {
    step: 'awaiting_message' | 'confirm';
    message?: string;
}

interface AnnouncementSession {
    step: 'awaiting_message' | 'confirm';
    message?: string;
}

interface AdminPrivateMessageSession {
    step: 'awaiting_message' | 'confirm';
    targetUserId: number;
    message?: string;
}

const USERS_PAGE_SIZE = 10;

export function registerAdminCommand(bot: Bot<BotContext>): void {
    bot.command('admin', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await showAdminPanel(ctx);
    });

    bot.command('admin_stats', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await showAdminStats(ctx);
    });

    bot.command('users', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await showAdminUsers(ctx, 0);
    });

    bot.command('broadcast', async (ctx) => {
        if (!await requireAdmin(ctx)) return;

        const text = ctx.message?.text?.replace(/^\/broadcast(@\w+)?\s*/i, '').trim();
        if (!text) {
            await startBroadcastFlow(ctx);
            return;
        }

        await previewBroadcast(ctx, text);
    });

    bot.command('ban', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await updateBan(ctx, true);
    });

    bot.command('unban', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await updateBan(ctx, false);
    });

    bot.callbackQuery('admin_panel', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await showAdminPanel(ctx);
    });

    bot.callbackQuery('admin_stats', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await showAdminStats(ctx);
    });

    bot.callbackQuery(/^admin_users_(\d+)$/, async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await showAdminUsers(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^admin_user_(\d+)$/, async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await showAdminUserDetail(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^admin_user_action_(ban|unban|support24|support7|message)_(\d+)$/, async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await handleAdminUserAction(ctx, ctx.match[1], Number(ctx.match[2]));
    });

    bot.callbackQuery(/^admin_user_confirm_(reset_xp|reset_streak|delete_words|delete_user)_(\d+)$/, async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await confirmDangerousAction(ctx, ctx.match[1], Number(ctx.match[2]));
    });

    bot.callbackQuery(/^admin_user_do_(reset_xp|reset_streak|delete_words|delete_user)_(\d+)$/, async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await runDangerousAction(ctx, ctx.match[1], Number(ctx.match[2]));
    });

    bot.callbackQuery('admin_private_message_confirm', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await sendPrivateAdminMessage(ctx);
    });

    bot.callbackQuery('admin_private_message_cancel', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        const admin = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        const session = admin ? await getBotSession<AdminPrivateMessageSession>(ctx.db, admin.user_id, 'admin_private_message') : null;
        if (admin) await deleteBotSession(ctx.db, admin.user_id, 'admin_private_message');
        await showAdminUserDetail(ctx, session?.data.targetUserId ?? admin?.user_id ?? 0);
    });

    bot.callbackQuery('admin_broadcast_start', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await startBroadcastFlow(ctx);
    });

    bot.callbackQuery('admin_broadcast_confirm', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;

        const session = await getBotSession<BroadcastSession>(ctx.db, user.user_id, 'admin_broadcast');
        if (!session?.data.message) {
            await replaceWithText(ctx, 'لا توجد رسالة جاهزة للإرسال.', adminPanelKeyboard());
            return;
        }

        await sendBroadcast(ctx, user.user_id, session.data.message);
        await deleteBotSession(ctx.db, user.user_id, 'admin_broadcast');
    });

    bot.callbackQuery('admin_broadcast_cancel', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (user) await deleteBotSession(ctx.db, user.user_id, 'admin_broadcast');
        await replaceWithText(ctx, 'تم إلغاء إرسال التبليغ.', adminPanelKeyboard());
    });

    bot.callbackQuery('admin_announcement_start', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await startAnnouncementFlow(ctx);
    });

    bot.callbackQuery('admin_announcement_confirm', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;

        const session = await getBotSession<AnnouncementSession>(ctx.db, user.user_id, 'admin_announcement');
        if (!session?.data.message) {
            await replaceWithText(ctx, 'لا توجد رسالة جاهزة للتثبيت.', adminPanelKeyboard());
            return;
        }

        await setActiveAnnouncement(ctx.db, user.user_id, session.data.message);
        await deleteBotSession(ctx.db, user.user_id, 'admin_announcement');
        await replaceWithText(ctx, 'تم تثبيت الرسالة داخل البوت ✅', adminPanelKeyboard());
    });

    bot.callbackQuery('admin_announcement_clear', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (user) await deleteBotSession(ctx.db, user.user_id, 'admin_announcement');
        await clearActiveAnnouncements(ctx.db);
        await replaceWithText(ctx, 'تم حذف الرسالة المثبتة الحالية ✅', adminPanelKeyboard());
    });

    bot.callbackQuery('admin_announcement_cancel', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (user) await deleteBotSession(ctx.db, user.user_id, 'admin_announcement');
        await replaceWithText(ctx, 'تم إلغاء تثبيت الرسالة.', adminPanelKeyboard());
    });

    bot.callbackQuery(/^admin_support_pending(?:_(\d+))?$/, async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await showPendingSupportProofs(ctx, Number(ctx.match[1] ?? 0));
    });

    bot.callbackQuery('admin_banned', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await showBannedUsers(ctx);
    });

    bot.on('message:text', async (ctx, next) => {
        if (!isAdminTelegramId(ctx.env, ctx.from?.id)) return next();

        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return next();

        const session = await getBotSession<BroadcastSession>(ctx.db, user.user_id, 'admin_broadcast');
        if (session?.data.step === 'awaiting_message') {
            const text = ctx.message?.text?.trim();
            if (!text || text.startsWith('/')) return next();

            await saveBotSession<BroadcastSession>(ctx.db, user.user_id, 'admin_broadcast', { step: 'confirm', message: text }, 30);
            await previewBroadcast(ctx, text);
            return;
        }

        const announcementSession = await getBotSession<AnnouncementSession>(ctx.db, user.user_id, 'admin_announcement');
        if (announcementSession?.data.step === 'awaiting_message') {
            const text = ctx.message?.text?.trim();
            if (!text || text.startsWith('/')) return next();

            await saveBotSession<AnnouncementSession>(ctx.db, user.user_id, 'admin_announcement', { step: 'confirm', message: text }, 30);
            await previewAnnouncement(ctx, text);
            return;
        }

        const privateSession = await getBotSession<AdminPrivateMessageSession>(ctx.db, user.user_id, 'admin_private_message');
        if (privateSession?.data.step !== 'awaiting_message') return next();
        const text = ctx.message?.text?.trim();
        if (!text || text.startsWith('/')) return next();

        await saveBotSession<AdminPrivateMessageSession>(ctx.db, user.user_id, 'admin_private_message', { ...privateSession.data, step: 'confirm', message: text }, 30);
        await replaceWithText(
            ctx,
            `📨 *معاينة الرسالة الخاصة:*\n\n${text}\n\nهل تريد إرسال هذه الرسالة؟`,
            new InlineKeyboard().text('✅ إرسال', 'admin_private_message_confirm').text('❌ إلغاء', 'admin_private_message_cancel'),
            'Markdown'
        );
    });
}

async function requireAdmin(ctx: BotContext): Promise<boolean> {
    if (isAdminTelegramId(ctx.env, ctx.from?.id)) return true;

    await ctx.reply('غير مصرح لك باستخدام هذا الأمر.');
    return false;
}

async function showAdminPanel(ctx: BotContext): Promise<void> {
    await replaceWithText(ctx, '🛠 *لوحة الأدمن*\n\nالحالة: 🛡 أدمن\nاختر أداة:', adminPanelKeyboard(), 'Markdown');
}

function adminPanelKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('📊 إحصائيات', 'admin_stats')
        .text('👥 المستخدمون', 'admin_users_0').row()
        .text('📢 إرسال تبليغ', 'admin_broadcast_start').row()
        .text('📌 تثبيت رسالة داخل البوت', 'admin_announcement_start').row()
        .text('📚 إدارة المصادر', 'admin_sources').row()
        .text('💙 طلبات الدعم', 'admin_support_pending_0')
        .text('🚫 المحظورون', 'admin_banned').row()
        .text('🏠 الرئيسية', 'menu_main');
}

async function showAdminStats(ctx: BotContext): Promise<void> {
    const users = await getAdminUserList(ctx.db, 1000, 0);
    const words = await ctx.db.prepare('SELECT COUNT(*) AS count FROM words').first<{ count: number }>();
    const todayUsers = await ctx.db.prepare(
        'SELECT COUNT(*) AS count FROM users WHERE display_name IS NOT NULL AND date(created_at) = date("now")'
    ).first<{ count: number }>();
    const reviewsToday = await ctx.db.prepare(
        'SELECT COUNT(*) AS count FROM reviews WHERE date(reviewed_at) = date("now")'
    ).first<{ count: number }>();
    const pendingProofs = await countPendingSupportProofs(ctx.db);
    const activeSupporters = await countActiveSupporters(ctx.db);
    const banned = users.filter(user => user.is_banned).length;

    await replaceWithText(
        ctx,
        `📊 *إحصائيات الأدمن*\n\n` +
        `عدد المستخدمين: *${users.length}*\n` +
        `عدد المستخدمين اليوم: *${todayUsers?.count ?? 0}*\n` +
        `عدد الكلمات الكلي: *${words?.count ?? 0}*\n` +
        `إثباتات الدعم pending: *${pendingProofs}*\n` +
        `الداعمون النشطون: *${activeSupporters}*\n` +
        `المحظورون: *${banned}*\n` +
        `التدريبات/المراجعات اليوم: *${reviewsToday?.count ?? 0}*`,
        adminPanelKeyboard(),
        'Markdown'
    );
}

async function showAdminUsers(ctx: BotContext, page: number): Promise<void> {
    const totalUsers = await countUsersForAdmin(ctx.db);
    const users = await getAdminUserList(ctx.db, USERS_PAGE_SIZE, page * USERS_PAGE_SIZE);
    const totalPages = Math.max(1, Math.ceil(totalUsers / USERS_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const pageUsers = safePage === page ? users : await getAdminUserList(ctx.db, USERS_PAGE_SIZE, safePage * USERS_PAGE_SIZE);

    const text = pageUsers.length === 0
        ? '👥 *المستخدمون*\n\nلا يوجد مستخدمون.'
        : '👥 *المستخدمون*\n\n' + pageUsers.map((user, index) =>
            `${safePage * USERS_PAGE_SIZE + index + 1}. ${user.display_name} — ${user.telegram_user_id ?? user.telegram_id}\n` +
            `XP: ${user.total_xp} | كلمات: ${user.word_count} | ${adminUserStatus(ctx, user)}\n` +
            `آخر نشاط: ${user.last_active_at ?? '-'}`
        ).join('\n\n');

    await replaceWithText(ctx, `${text}\n\nصفحة ${safePage + 1}/${totalPages}`, usersKeyboard(pageUsers, safePage, totalPages), 'Markdown');
}

function usersKeyboard(users: Array<{ user_id: number; display_name: string | null }>, page: number, totalPages: number): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    for (const user of users) {
        keyboard.text(`👤 ${user.display_name ?? user.user_id}`, `admin_user_${user.user_id}`).row();
    }
    if (page > 0) keyboard.text('⬅️ السابق', `admin_users_${page - 1}`);
    if (page < totalPages - 1) keyboard.text('التالي ➡️', `admin_users_${page + 1}`);
    if (page > 0 || page < totalPages - 1) keyboard.row();
    keyboard.text('🛠 لوحة الأدمن', 'admin_panel').text('🏠 الرئيسية', 'menu_main');
    return keyboard;
}

async function showAdminUserDetail(ctx: BotContext, targetUserId: number): Promise<void> {
    const target = await getAdminUserDetail(ctx.db, targetUserId);
    if (!target) {
        await replaceWithText(ctx, 'لم أجد هذا المستخدم.', usersKeyboard([], 0, 1));
        return;
    }
    const text =
        `👤 *تفاصيل المستخدم*\n\n` +
        `الاسم:\n${target.display_name ?? '-'}\n\n` +
        `Telegram ID:\n${target.telegram_user_id ?? target.telegram_id}\n\n` +
        `الحالة:\n${adminUserStatus(ctx, target)}\n\n` +
        `XP:\n${target.total_xp}\n\n` +
        `عدد الكلمات:\n${target.word_count}\n\n` +
        `المستوى:\n${target.german_level ?? '-'}\n\n` +
        `آخر نشاط:\n${target.last_active_at ?? target.updated_at ?? '-'}\n\n` +
        `الداعم حتى:\n${target.supporter_until ?? '-'}`;
    await replaceWithText(ctx, text, adminUserDetailKeyboard(target), 'Markdown');
}

function adminUserDetailKeyboard(user: { user_id: number; is_banned: number; is_deleted?: number }): InlineKeyboard {
    return new InlineKeyboard()
        .text(user.is_banned ? '✅ إلغاء الحظر' : '🚫 حظر', `admin_user_action_${user.is_banned ? 'unban' : 'ban'}_${user.user_id}`).row()
        .text('🔄 تصفير XP', `admin_user_confirm_reset_xp_${user.user_id}`)
        .text('🧹 تصفير streak', `admin_user_confirm_reset_streak_${user.user_id}`).row()
        .text('🗑 حذف كلمات المستخدم', `admin_user_confirm_delete_words_${user.user_id}`).row()
        .text('💙 داعم 24 ساعة', `admin_user_action_support24_${user.user_id}`)
        .text('💙 داعم 7 أيام', `admin_user_action_support7_${user.user_id}`).row()
        .text('📨 إرسال رسالة خاصة', `admin_user_action_message_${user.user_id}`).row()
        .text('🗑 حذف المستخدم من البوت', `admin_user_confirm_delete_user_${user.user_id}`).row()
        .text('⬅️ رجوع', 'admin_users_0')
        .text('🏠 الرئيسية', 'menu_main');
}

function adminUserStatus(ctx: BotContext, user: { telegram_user_id?: number | null; telegram_id: number; is_banned: number; is_deleted?: number; is_supporter_active?: number }): string {
    if (isAdminTelegramId(ctx.env, user.telegram_user_id ?? user.telegram_id)) return '🛡 أدمن';
    if (user.is_deleted) return 'محذوف';
    if (user.is_banned) return 'محظور';
    if (user.is_supporter_active) return '💙 داعم';
    return '👤 عضو';
}

async function handleAdminUserAction(ctx: BotContext, action: string, targetUserId: number): Promise<void> {
    const admin = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    const target = await getAdminUserDetail(ctx.db, targetUserId);
    if (!admin || !target) return;
    if ((action === 'ban' || action === 'unban') && !canModerateTarget(ctx, admin.user_id, target)) {
        await replaceWithText(ctx, 'لا يمكن تنفيذ هذا الإجراء على هذا المستخدم.', adminUserDetailKeyboard(target));
        return;
    }
    if (action === 'ban' || action === 'unban') {
        await setUserBanned(ctx.db, target.telegram_user_id ?? target.telegram_id, action === 'ban');
        await logAdminAction(ctx.db, admin.user_id, target.user_id, action, null);
        await showAdminUserDetail(ctx, target.user_id);
        return;
    }
    if (action === 'support24' || action === 'support7') {
        const hours = action === 'support24' ? 24 : 24 * 7;
        await activateSupporterForHours(ctx.db, target.user_id, ctx.from?.id ?? 0, hours);
        await logAdminAction(ctx.db, admin.user_id, target.user_id, action === 'support24' ? 'activate_supporter_24h' : 'activate_supporter_7d', { hours });
        await showAdminUserDetail(ctx, target.user_id);
        return;
    }
    if (action === 'message') {
        await saveBotSession<AdminPrivateMessageSession>(ctx.db, admin.user_id, 'admin_private_message', { step: 'awaiting_message', targetUserId }, 30);
        await replaceWithText(ctx, `اكتب الرسالة التي تريد إرسالها إلى ${target.display_name ?? target.name}.`, new InlineKeyboard().text('❌ إلغاء', 'admin_private_message_cancel'));
    }
}

async function confirmDangerousAction(ctx: BotContext, action: string, targetUserId: number): Promise<void> {
    const target = await getAdminUserDetail(ctx.db, targetUserId);
    if (!target) return;
    await replaceWithText(
        ctx,
        `تأكيد العملية الخطرة:\n${dangerousActionLabel(action)}\n\nالمستخدم: ${target.display_name ?? target.name}`,
        new InlineKeyboard()
            .text('✅ تأكيد', `admin_user_do_${action}_${targetUserId}`).row()
            .text('❌ إلغاء', `admin_user_${targetUserId}`)
    );
}

async function runDangerousAction(ctx: BotContext, action: string, targetUserId: number): Promise<void> {
    const admin = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    const target = await getAdminUserDetail(ctx.db, targetUserId);
    if (!admin || !target) return;
    if ((action === 'delete_user') && (target.user_id === admin.user_id || isAdminTelegramId(ctx.env, target.telegram_user_id ?? target.telegram_id))) {
        await replaceWithText(ctx, 'لا يمكن حذف نفسك أو حذف أدمن آخر.', adminUserDetailKeyboard(target));
        return;
    }
    if (action === 'reset_xp') await resetUserXp(ctx.db, targetUserId);
    if (action === 'reset_streak') await resetUserStreak(ctx.db, targetUserId);
    if (action === 'delete_words') await deleteAllWordsForUser(ctx.db, targetUserId);
    if (action === 'delete_user') await softDeleteUser(ctx.db, targetUserId);
    await logAdminAction(ctx.db, admin.user_id, targetUserId, action === 'delete_words' ? 'delete_user_words' : action, null);
    if (action === 'delete_user') {
        await replaceWithText(ctx, 'تم حذف المستخدم من البوت ✅', usersKeyboard([], 0, 1));
        return;
    }
    await showAdminUserDetail(ctx, targetUserId);
}

async function sendPrivateAdminMessage(ctx: BotContext): Promise<void> {
    const admin = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!admin) return;
    const session = await getBotSession<AdminPrivateMessageSession>(ctx.db, admin.user_id, 'admin_private_message');
    if (!session?.data.message) return;
    const target = await getAdminUserDetail(ctx.db, session.data.targetUserId);
    if (!target) return;
    await sendTelegramMessage(ctx.env, target.telegram_user_id ?? target.telegram_id, session.data.message);
    await logAdminAction(ctx.db, admin.user_id, target.user_id, 'send_private_message', { message: session.data.message });
    await deleteBotSession(ctx.db, admin.user_id, 'admin_private_message');
    await showAdminUserDetail(ctx, target.user_id);
}

function canModerateTarget(ctx: BotContext, adminUserId: number, target: { user_id: number; telegram_user_id?: number | null; telegram_id: number }): boolean {
    if (target.user_id === adminUserId) return false;
    if (isAdminTelegramId(ctx.env, target.telegram_user_id ?? target.telegram_id)) return false;
    return true;
}

function dangerousActionLabel(action: string): string {
    if (action === 'reset_xp') return 'تصفير XP';
    if (action === 'reset_streak') return 'تصفير streak';
    if (action === 'delete_words') return 'حذف كلمات المستخدم';
    if (action === 'delete_user') return 'حذف المستخدم من البوت';
    return action;
}

async function startBroadcastFlow(ctx: BotContext): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!user) return;

    await saveBotSession<BroadcastSession>(ctx.db, user.user_id, 'admin_broadcast', { step: 'awaiting_message' }, 30);
    await replaceWithText(ctx, 'اكتب الرسالة التي تريد إرسالها لكل المستخدمين:', adminCancelKeyboard());
}

async function previewBroadcast(ctx: BotContext, text: string): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (user) {
        await saveBotSession<BroadcastSession>(ctx.db, user.user_id, 'admin_broadcast', { step: 'confirm', message: text }, 30);
    }

    await replaceWithText(
        ctx,
        `📢 *معاينة التبليغ:*\n\n${text}\n\nهل تريد إرسالها لكل المستخدمين؟`,
        new InlineKeyboard()
            .text('✅ إرسال للجميع', 'admin_broadcast_confirm')
            .text('❌ إلغاء', 'admin_broadcast_cancel'),
        'Markdown'
    );
}

function adminCancelKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('❌ إلغاء', 'admin_broadcast_cancel')
        .text('🛠 لوحة الأدمن', 'admin_panel');
}

async function sendBroadcast(ctx: BotContext, adminUserId: number, text: string): Promise<void> {
    const users = await getAdminUserList(ctx.db, 10000, 0);
    let sent = 0;
    let failed = 0;

    for (const user of users) {
        if (user.is_banned) continue;
        try {
            await sendTelegramMessage(ctx.env, user.telegram_user_id ?? user.telegram_id, text);
            sent++;
        } catch {
            failed++;
        }
    }

    await createBroadcastLog(ctx.db, adminUserId, text, sent, failed);
    await replaceWithText(ctx, `تم الإرسال إلى ${sent} مستخدم ✅\nفشل الإرسال إلى ${failed} مستخدم ⚠️`, adminPanelKeyboard());
}

async function startAnnouncementFlow(ctx: BotContext): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!user) return;

    await saveBotSession<AnnouncementSession>(ctx.db, user.user_id, 'admin_announcement', { step: 'awaiting_message' }, 30);
    await replaceWithText(ctx, 'اكتب الرسالة التي تريد تثبيتها داخل البوت:', announcementCancelKeyboard());
}

async function previewAnnouncement(ctx: BotContext, text: string): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (user) {
        await saveBotSession<AnnouncementSession>(ctx.db, user.user_id, 'admin_announcement', { step: 'confirm', message: text }, 30);
    }

    await replaceWithText(
        ctx,
        `📌 *الرسالة المثبتة:*\n\n${text}`,
        new InlineKeyboard()
            .text('✅ تثبيت', 'admin_announcement_confirm').row()
            .text('🗑 حذف الرسالة الحالية', 'admin_announcement_clear').row()
            .text('❌ إلغاء', 'admin_announcement_cancel'),
        'Markdown'
    );
}

function announcementCancelKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('🗑 حذف الرسالة الحالية', 'admin_announcement_clear').row()
        .text('❌ إلغاء', 'admin_announcement_cancel')
        .text('🛠 لوحة الأدمن', 'admin_panel');
}

async function showPendingSupportProofs(ctx: BotContext, page: number): Promise<void> {
    const proofs = await getPendingSupportProofs(ctx.db, 5, page * 5);
    if (proofs.length === 0) {
        await replaceWithText(ctx, '💙 *طلبات الدعم*\n\nلا توجد إثباتات pending.', adminPanelKeyboard(), 'Markdown');
        return;
    }

    const text = '💙 *طلبات الدعم pending*\n\n' + proofs.map((proof, index) =>
        `${page * 5 + index + 1}. ${proof.display_name ?? 'بدون اسم'}\n` +
        `الوقت: ${proof.created_at}\n` +
        `النوع: ${proof.file_id ? 'صورة' : 'نص'}\n` +
        `#${proof.id}`
    ).join('\n\n');

    await replaceWithText(ctx, text, pendingSupportKeyboard(proofs[0].id, page, proofs.length === 5), 'Markdown');
}

function pendingSupportKeyboard(firstProofId: number, page: number, hasNext: boolean): InlineKeyboard {
    const keyboard = new InlineKeyboard()
        .text('✅ تأكيد أول طلب', `support_approve_${firstProofId}`)
        .text('❌ رفض أول طلب', `support_reject_${firstProofId}`).row();
    if (page > 0) keyboard.text('⬅️ السابق', `admin_support_pending_${page - 1}`);
    if (hasNext) keyboard.text('التالي ➡️', `admin_support_pending_${page + 1}`);
    if (page > 0 || hasNext) keyboard.row();
    keyboard.text('🛠 لوحة الأدمن', 'admin_panel').text('🏠 الرئيسية', 'menu_main');
    return keyboard;
}

async function showBannedUsers(ctx: BotContext): Promise<void> {
    const users = (await getAdminUserList(ctx.db, 1000, 0)).filter(user => user.is_banned);
    const text = users.length === 0
        ? '🚫 لا يوجد مستخدمون محظورون.'
        : '🚫 *المحظورون*\n\n' + users.map(user => `${user.display_name} — ${user.telegram_user_id ?? user.telegram_id}`).join('\n');
    await replaceWithText(ctx, text, adminPanelKeyboard(), 'Markdown');
}

async function updateBan(ctx: BotContext, banned: boolean): Promise<void> {
    const target = ctx.message?.text?.split(/\s+/)[1];
    const telegramId = Number(target);
    if (!Number.isFinite(telegramId)) {
        await ctx.reply(`استخدم:\n/${banned ? 'ban' : 'unban'} TELEGRAM_ID`);
        return;
    }

    const updated = await setUserBanned(ctx.db, telegramId, banned);
    await ctx.reply(updated ? (banned ? 'تم الحظر.' : 'تم إلغاء الحظر.') : 'لم أجد هذا المستخدم.');
}
