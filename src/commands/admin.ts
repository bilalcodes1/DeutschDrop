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
import { sendTelegramMessage, sendTelegramPlainMessage, sendTelegramPlainPhoto } from '../services/notifications';
import { parseVoiceRssKeys, VOICE_RSS_DAILY_LIMIT_PER_KEY, VOICE_RSS_GERMAN_PROVIDER, VOICE_RSS_GERMAN_VOICE } from '../services/tts/voiceRssGerman';
import { createXpBoost } from '../services/xpBoosts';
import { replaceWithText } from './wordPanel';

interface BroadcastSession {
    step: 'awaiting_message' | 'confirm';
    contentType?: 'text' | 'photo';
    message?: string;
    photoFileId?: string;
    caption?: string | null;
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
const BROADCAST_PAGE_SIZE = 100;
const BROADCAST_RATE_LIMIT_BATCH = 25;
const BROADCAST_RATE_LIMIT_DELAY_MS = 350;
const TTS_STALE_CACHE_PREDICATE = `provider = 'cloudflareTts'
    OR provider IS NULL
    OR language IS NULL
    OR voice IS NULL
    OR provider != '${VOICE_RSS_GERMAN_PROVIDER}'
    OR language != 'de-de'
    OR voice != '${VOICE_RSS_GERMAN_VOICE}'`;

export function registerAdminCommand(bot: Bot<BotContext>): void {
    bot.command('admin', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await showAdminPanel(ctx);
    });

    bot.command('admin_stats', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await showAdminStats(ctx);
    });

    bot.command('admin_db_check', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await showAdminDbCheck(ctx);
    });

    bot.command('admin_word_stats', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await showAdminWordStats(ctx);
    });

    bot.command('admin_health', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await showAdminHealth(ctx);
    });

    bot.command('admin_boost', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await handleAdminBoostCommand(ctx);
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

    bot.callbackQuery('admin_db_check', async (ctx) => {
        if (!await requireAdmin(ctx)) return;
        await showAdminDbCheck(ctx);
    });

    bot.callbackQuery('admin_health', async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        if (!await requireAdmin(ctx)) return;
        await showAdminHealth(ctx);
    });

    bot.callbackQuery('ai_debug_info', async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        if (!await requireAdmin(ctx)) return;
        await replaceWithText(ctx, '🤖 AI Debug\n\nاستخدم الأمر /ai_debug لعرض فحص مزودي الذكاء الصناعي بدون طباعة مفاتيح.', adminHealthKeyboard());
    });

    bot.callbackQuery('tts_debug_info', async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        if (!await requireAdmin(ctx)) return;
        await replaceWithText(ctx, '🔊 TTS Debug\n\nاستخدم الأمر /tts_debug لعرض حالة VoiceRSS والكاش بدون طباعة مفاتيح.', adminHealthKeyboard());
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
        if (!hasBroadcastContent(session?.data)) {
            await replaceWithText(ctx, 'لا توجد رسالة جاهزة للإرسال.', adminPanelKeyboard());
            return;
        }

        await replaceWithText(ctx, '⏳ جاري إرسال التبليغ على دفعات آمنة...', adminPanelKeyboard());
        await sendBroadcast(ctx, user.user_id, session.data);
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

            await saveBotSession<BroadcastSession>(ctx.db, user.user_id, 'admin_broadcast', { step: 'confirm', contentType: 'text', message: text }, 30);
            await previewBroadcast(ctx, { contentType: 'text', message: text });
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

    bot.on('message:photo', async (ctx, next) => {
        if (!isAdminTelegramId(ctx.env, ctx.from?.id)) return next();

        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return next();

        const session = await getBotSession<BroadcastSession>(ctx.db, user.user_id, 'admin_broadcast');
        if (session?.data.step !== 'awaiting_message') return next();

        const photo = ctx.message.photo?.[ctx.message.photo.length - 1];
        if (!photo?.file_id) return next();
        const caption = ctx.message.caption?.trim() || null;
        const data: BroadcastSession = {
            step: 'confirm',
            contentType: 'photo',
            photoFileId: photo.file_id,
            caption,
        };
        await saveBotSession<BroadcastSession>(ctx.db, user.user_id, 'admin_broadcast', data, 30);
        await previewBroadcast(ctx, data);
    });
}

async function requireAdmin(ctx: BotContext): Promise<boolean> {
    if (isAdminTelegramId(ctx.env, ctx.from?.id)) return true;

    await ctx.reply('غير مصرح لك باستخدام هذا الأمر.');
    return false;
}

async function handleAdminBoostCommand(ctx: BotContext): Promise<void> {
    const parsed = parseAdminBoostCommand(ctx.message?.text ?? '');
    if (!parsed.ok) {
        await ctx.reply(parsed.message);
        return;
    }

    const target = await getAdminUserDetail(ctx.db, parsed.userId);
    if (!target || target.is_deleted) {
        await ctx.reply(`المستخدم user_id=${parsed.userId} غير موجود.`);
        return;
    }

    const boost = await createXpBoost(
        ctx.db,
        parsed.userId,
        parsed.multiplier,
        parsed.minutes,
        parsed.reason,
        'admin_boost',
        String(ctx.from?.id ?? 'unknown')
    );

    await ctx.reply(
        `✅ تم إنشاء XP Boost\n\n` +
        `user_id: ${parsed.userId}\n` +
        `multiplier: ${parsed.multiplier}x\n` +
        `duration: ${parsed.minutes} دقيقة\n` +
        `reason: ${parsed.reason}\n` +
        `expires_at: ${boost.expires_at}`
    );
}

type AdminBoostParseResult =
    | { ok: true; userId: number; multiplier: number; minutes: number; reason: string }
    | { ok: false; message: string };

function parseAdminBoostCommand(text: string): AdminBoostParseResult {
    const usage = 'الصيغة:\n/admin_boost <user_id> <multiplier> <minutes> <reason>\nمثال:\n/admin_boost 1 2 30 streak_reward';
    const args = text.replace(/^\/admin_boost(@\w+)?\s*/i, '').trim();
    const parts = args ? args.split(/\s+/) : [];
    if (parts.length < 4) return { ok: false, message: usage };

    const [userIdRaw, multiplierRaw, minutesRaw, ...reasonParts] = parts;
    const reason = reasonParts.join(' ').trim();
    const userId = Number(userIdRaw);
    const multiplier = Number(multiplierRaw);
    const minutes = Number(minutesRaw);

    if (!/^\d+$/.test(userIdRaw) || !Number.isInteger(userId) || userId <= 0) {
        return { ok: false, message: 'user_id يجب أن يكون رقم صحيح أكبر من 0.' };
    }
    if (!Number.isFinite(multiplier) || multiplier <= 1) {
        return { ok: false, message: 'multiplier يجب أن يكون أكبر من 1.' };
    }
    if (multiplier > 5) {
        return { ok: false, message: 'multiplier لا يمكن أن يتجاوز 5.' };
    }
    if (!/^\d+$/.test(minutesRaw) || !Number.isInteger(minutes) || minutes <= 0) {
        return { ok: false, message: 'minutes يجب أن يكون رقم صحيح أكبر من 0.' };
    }
    if (minutes > 1440) {
        return { ok: false, message: 'minutes لا يمكن أن يتجاوز 1440.' };
    }
    if (!reason) {
        return { ok: false, message: 'reason مطلوب.' };
    }
    if (reason.length > 50) {
        return { ok: false, message: 'reason لا يمكن أن يتجاوز 50 حرف.' };
    }

    return { ok: true, userId, multiplier, minutes, reason };
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
        .text('🛡 مركز الإشراف', 'adm:mod').row()
        .text('📚 إدارة المصادر', 'admin_sources').row()
        .text('🩺 صحة البوت', 'admin_health')
        .text('🛠 فحص قاعدة البيانات', 'admin_db_check').row()
        .text('💙 طلبات الدعم', 'admin_support_pending_0')
        .text('🚫 المحظورون', 'admin_banned').row()
        .text('🏠 الرئيسية', 'menu_main');
}

async function showAdminHealth(ctx: BotContext): Promise<void> {
    const voiceRssKeys = parseVoiceRssKeys(ctx.env);
    const usersTotal = await safeCount(ctx, 'SELECT COUNT(*) AS count FROM users WHERE display_name IS NOT NULL AND COALESCE(is_deleted, 0) = 0');
    const users24h = await safeCount(ctx, 'SELECT COUNT(*) AS count FROM users WHERE display_name IS NOT NULL AND COALESCE(is_deleted, 0) = 0 AND last_active_at >= datetime("now", "-1 day")');
    const users7d = await safeCount(ctx, 'SELECT COUNT(*) AS count FROM users WHERE display_name IS NOT NULL AND COALESCE(is_deleted, 0) = 0 AND last_active_at >= datetime("now", "-7 days")');
    const banned = await safeCount(ctx, 'SELECT COUNT(*) AS count FROM users WHERE COALESCE(is_banned, 0) = 1 AND COALESCE(is_deleted, 0) = 0');
    const wordsTotal = await safeCount(ctx, 'SELECT COUNT(*) AS count FROM words');
    const hardWords = await safeCount(ctx, 'SELECT COUNT(*) AS count FROM word_learning_stats WHERE COALESCE(is_hard, 0) = 1');
    const focusWords = await safeCount(ctx, 'SELECT COUNT(*) AS count FROM word_learning_stats WHERE COALESCE(difficulty_score, 0) >= 3 OR COALESCE(wrong_count, 0) >= 2');
    const trainSessions = await safeCount(ctx, 'SELECT COUNT(*) AS count FROM bot_sessions WHERE type = "train" AND date(created_at) = date("now")');
    const correctToday = await safeCount(ctx, 'SELECT COUNT(*) AS count FROM reviews WHERE is_correct = 1 AND date(reviewed_at) = date("now")');
    const wrongToday = await safeCount(ctx, 'SELECT COUNT(*) AS count FROM reviews WHERE is_correct = 0 AND date(reviewed_at) = date("now")');
    const notificationsToday = await safeCount(ctx, 'SELECT COUNT(*) AS count FROM notification_events WHERE date(created_at) = date("now")');
    const knownToday = await safeCount(ctx, 'SELECT COUNT(*) AS count FROM notification_events WHERE response = "known" AND date(created_at) = date("now")');
    const forgottenToday = await safeCount(ctx, 'SELECT COUNT(*) AS count FROM notification_events WHERE response = "forgotten" AND date(created_at) = date("now")');
    const ttsCache = await safeCount(ctx, 'SELECT COUNT(*) AS count FROM word_audio_cache');
    const ttsStale = await safeCount(ctx, `SELECT COUNT(*) AS count FROM word_audio_cache WHERE ${TTS_STALE_CACHE_PREDICATE}`);
    const dbCheck = await getDbCheckSummary(ctx);

    const text =
        `🩺 صحة DeutschDrop\n\n` +
        `المستخدمون:\n` +
        `* الكل: ${metric(usersTotal)}\n` +
        `* النشطون آخر 24 ساعة: ${metric(users24h)}\n` +
        `* النشطون آخر 7 أيام: ${metric(users7d)}\n` +
        `* المحظورون: ${metric(banned)}\n\n` +
        `الكلمات:\n` +
        `* مجموع الكلمات: ${metric(wordsTotal)}\n` +
        `* كلمات صعبة: ${metric(hardWords)}\n` +
        `* كلمات تحتاج تركيز: ${metric(focusWords)}\n\n` +
        `التدريب والمراجعة:\n` +
        `* جلسات التدريب اليوم: ${metric(trainSessions)}\n` +
        `* إجابات صحيحة اليوم: ${metric(correctToday)}\n` +
        `* إجابات خاطئة اليوم: ${metric(wrongToday)}\n\n` +
        `الإشعارات:\n` +
        `* المرسلة اليوم: ${metric(notificationsToday)}\n` +
        `* known: ${metric(knownToday)}\n` +
        `* forgotten: ${metric(forgottenToday)}\n\n` +
        `TTS:\n` +
        `* VoiceRSS keys: ${voiceRssKeys.length}\n` +
        `* الاستخدام النظري: ${voiceRssKeys.length * VOICE_RSS_DAILY_LIMIT_PER_KEY}\n` +
        `* cache records: ${metric(ttsCache)}\n` +
        `* stale records: ${metric(ttsStale)}\n\n` +
        `AI:\n` +
        `* AI_ENABLED: ${ctx.env.AI_ENABLED ?? 'false'}\n` +
        `* providers order: ${ctx.env.AI_PROVIDER_ORDER ?? 'غير متوفر'}\n` +
        `* آخر حالة مختصرة: غير متوفر\n\n` +
        `Database:\n` +
        `* /health: OK\n` +
        `* آخر migration معروف: 0024_onboarding_help_admin_health.sql\n` +
        `* db_check: ${dbCheck}\n\n` +
        `Cron:\n` +
        `* آخر تشغيل cron: غير متوفر\n` +
        `* إشعارات اليوم: ${metric(notificationsToday)}`;

    await replaceWithText(ctx, text, adminHealthKeyboard());
}

function adminHealthKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('🔄 تحديث', 'admin_health').row()
        .text('🤖 AI Debug', 'ai_debug_info')
        .text('🔊 TTS Debug', 'tts_debug_info').row()
        .text('🧪 DB Check', 'admin_db_check').row()
        .text('🏠 الرئيسية', 'menu_main');
}

async function safeCount(ctx: BotContext, sql: string): Promise<number | null> {
    try {
        const row = await ctx.db.prepare(sql).first<{ count: number }>();
        return row?.count ?? 0;
    } catch {
        return null;
    }
}

function metric(value: number | null): string {
    return value === null ? 'غير متوفر' : String(value);
}

async function getDbCheckSummary(ctx: BotContext): Promise<string> {
    try {
        const requiredColumns = ['user_id', 'display_name', 'onboarding_seen', 'last_active_at'];
        const rows = await ctx.db.prepare('PRAGMA table_info(users)').all<{ name: string }>();
        const existing = new Set((rows.results ?? []).map(row => row.name));
        const missing = requiredColumns.filter(column => !existing.has(column));
        return missing.length === 0 ? 'OK' : `missing columns count: ${missing.length}`;
    } catch {
        return 'غير متوفر';
    }
}

async function showAdminDbCheck(ctx: BotContext): Promise<void> {
    const requiredTables = ['words', 'users', 'bot_sessions', 'learning_sources', 'ai_cache', 'ai_usage'];
    const requiredWordColumns = [
        'word_id',
        'german',
        'arabic',
        'example',
        'example_ar',
        'created_at',
        'updated_at',
        'pronunciation_ar',
        'pronunciation_latin',
        'level',
        'german_search',
        'arabic_search',
        'example_search',
        'added_by',
    ];

    const tableRows = await ctx.db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${requiredTables.map(() => '?').join(',')})`
    ).bind(...requiredTables).all<{ name: string }>();
    const existingTables = new Set((tableRows.results ?? []).map(row => row.name));
    const columnRows = await ctx.db.prepare('PRAGMA table_info(words)').all<{ name: string }>();
    const existingColumns = new Set((columnRows.results ?? []).map(row => row.name));

    const lines: string[] = ['🛠 فحص قاعدة البيانات', ''];
    for (const table of requiredTables) {
        lines.push(existingTables.has(table) ? `✅ table: ${table}` : `❌ missing table: ${table}`);
    }
    lines.push('');
    for (const column of requiredWordColumns) {
        lines.push(existingColumns.has(column) ? `✅ words.${column}` : `❌ missing column: words.${column}`);
    }

    await replaceWithText(ctx, lines.join('\n'), adminPanelKeyboard());
}

async function showAdminWordStats(ctx: BotContext): Promise<void> {
    const totals = await ctx.db.prepare(
        `SELECT
            COUNT(w.word_id) AS total_words,
            SUM(CASE WHEN COALESCE(wls.is_hard, 0) = 1 THEN 1 ELSE 0 END) AS hard_words
         FROM words w
         LEFT JOIN word_learning_stats wls ON wls.word_id = w.word_id AND wls.user_id = w.added_by`
    ).first<{ total_words: number; hard_words: number }>();
    const hardest = await ctx.db.prepare(
        `SELECT w.german, w.arabic, COALESCE(wls.wrong_count, uw.wrong_count, 0) AS wrong_count,
                COALESCE(wls.difficulty_score, 0) AS difficulty_score
         FROM words w
         LEFT JOIN user_words uw ON uw.word_id = w.word_id AND uw.user_id = w.added_by
         LEFT JOIN word_learning_stats wls ON wls.word_id = w.word_id AND wls.user_id = w.added_by
         ORDER BY COALESCE(wls.difficulty_score, 0) DESC, COALESCE(wls.wrong_count, uw.wrong_count, 0) DESC
         LIMIT 10`
    ).all<{ german: string; arabic: string; wrong_count: number; difficulty_score: number }>();
    const lines = (hardest.results ?? []).map((word, index) =>
        `${index + 1}. ${word.german} — ${word.arabic}\nأخطاء: ${word.wrong_count} | صعوبة: ${word.difficulty_score}`
    ).join('\n\n');
    await replaceWithText(
        ctx,
        `📊 تحليل الكلمات الصعبة\n\n` +
        `عدد الكلمات: ${totals?.total_words ?? 0}\n` +
        `عدد hard words: ${totals?.hard_words ?? 0}\n\n` +
        `أكثر 10 كلمات تحتاج تركيز:\n${lines || '-'}`,
        adminPanelKeyboard()
    );
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
    await replaceWithText(ctx, 'أرسل محتوى التبليغ لكل المستخدمين:\n\n- نص عادي أو يحتوي روابط\n- صورة فقط\n- صورة مع caption وروابط', adminCancelKeyboard());
}

async function previewBroadcast(ctx: BotContext, content: string | Omit<BroadcastSession, 'step'> | BroadcastSession): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    const data: BroadcastSession = typeof content === 'string'
        ? { step: 'confirm', contentType: 'text', message: content }
        : { ...content, step: 'confirm' };
    if (user) {
        await saveBotSession<BroadcastSession>(ctx.db, user.user_id, 'admin_broadcast', data, 30);
    }

    const keyboard = new InlineKeyboard()
        .text('✅ إرسال للجميع', 'admin_broadcast_confirm')
        .text('❌ إلغاء', 'admin_broadcast_cancel');

    if (data.contentType === 'photo' && data.photoFileId) {
        await ctx.replyWithPhoto(data.photoFileId, {
            caption: `${data.caption ? `${data.caption}\n\n` : ''}📢 معاينة التبليغ\n\nهل تريد إرسالها لكل المستخدمين؟`,
            reply_markup: keyboard,
        });
        return;
    }

    await replaceWithText(
        ctx,
        `📢 معاينة التبليغ:\n\n${data.message ?? ''}\n\nهل تريد إرسالها لكل المستخدمين؟`,
        keyboard
    );
}

function adminCancelKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('❌ إلغاء', 'admin_broadcast_cancel')
        .text('🛠 لوحة الأدمن', 'admin_panel');
}

async function sendBroadcast(ctx: BotContext, adminUserId: number, content: BroadcastSession): Promise<void> {
    let sent = 0;
    let failed = 0;
    let totalTargets = 0;
    let offset = 0;

    while (true) {
        const users = await getBroadcastRecipients(ctx, BROADCAST_PAGE_SIZE, offset);
        if (users.length === 0) break;

        for (const user of users) {
            if (user.is_banned || user.is_deleted) continue;
            totalTargets++;
            try {
                const ok = content.contentType === 'photo' && content.photoFileId
                    ? await sendTelegramPlainPhoto(ctx.env, user.telegram_user_id ?? user.telegram_id, content.photoFileId, content.caption ?? null)
                    : await sendTelegramPlainMessage(ctx.env, user.telegram_user_id ?? user.telegram_id, content.message ?? '');
                if (ok) sent++; else failed++;
            } catch {
                failed++;
            }
            if ((sent + failed) % BROADCAST_RATE_LIMIT_BATCH === 0) {
                await sleep(BROADCAST_RATE_LIMIT_DELAY_MS);
            }
        }
        offset += BROADCAST_PAGE_SIZE;
    }

    await createBroadcastLog(ctx.db, adminUserId, broadcastLogMessage(content), sent, failed);
    await replaceWithText(
        ctx,
        `📢 انتهى البث.\n\nالمستهدفون: ${totalTargets}\nتم الإرسال إلى ${sent} مستخدم ✅\nفشل الإرسال إلى ${failed} مستخدم ⚠️`,
        adminPanelKeyboard()
    );
}

function hasBroadcastContent(data?: BroadcastSession): data is BroadcastSession {
    if (!data) return false;
    if (data.contentType === 'photo') return Boolean(data.photoFileId);
    return Boolean(data.message?.trim());
}

async function getBroadcastRecipients(ctx: BotContext, limit: number, offset: number): Promise<Array<{ telegram_id: number; telegram_user_id: number | null; is_banned: number; is_deleted: number }>> {
    const rows = await ctx.db.prepare(
        `SELECT telegram_id, telegram_user_id, COALESCE(is_banned, 0) AS is_banned, COALESCE(is_deleted, 0) AS is_deleted
         FROM users
         WHERE display_name IS NOT NULL
           AND COALESCE(is_banned, 0) = 0
           AND COALESCE(is_deleted, 0) = 0
         ORDER BY user_id
         LIMIT ? OFFSET ?`
    ).bind(limit, offset).all<{ telegram_id: number; telegram_user_id: number | null; is_banned: number; is_deleted: number }>();
    return rows.results ?? [];
}

function broadcastLogMessage(content: BroadcastSession): string {
    if (content.contentType === 'photo') {
        return content.caption ? `[photo] ${content.caption}` : '[photo]';
    }
    return content.message ?? '';
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
