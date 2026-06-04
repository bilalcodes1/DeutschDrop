import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getActiveAnnouncement } from '../repositories/announcementRepository';
import { getActiveSupportStatus } from '../repositories/supportRepository';
import { getUserByTelegramId, getUserSettings } from '../repositories/userRepository';
import { deleteBotSession } from '../repositories/sessionRepository';
import { isAdminTelegramId } from '../services/adminAccess';
import { formatSupportRemaining, getUserRoleBadge } from '../services/roleUi';
import { replaceWithText } from './wordPanel';

export function registerMenuCommand(bot: Bot<BotContext>): void {
    bot.command('menu', async (ctx) => {
        await showMainMenu(ctx);
    });

    // Handle menu callbacks that are not owned by feature modules.
    bot.callbackQuery('menu_train', async (ctx) => {
        await clearTextInteractionSessions(ctx);
        await replaceWithText(
            ctx,
            trainMenuText(),
            trainCountKeyboard(),
            'Markdown'
        );
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery('menu_words', async (ctx) => {
        await clearTrainingAndEditSessions(ctx);
        await replaceWithText(
            ctx,
            '📂 *كلماتي*\n\nاختر إحدى الخيارات:',
            wordsMenuKeyboard(),
            'Markdown'
        );
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery('menu_more', async (ctx) => {
        await clearTrainingAndEditSessions(ctx);
        await replaceWithText(ctx, '⚙️ *المزيد*\n\nكل الأدوات المتقدمة هنا:', moreMenuKeyboard(isAdminTelegramId(ctx.env, ctx.from?.id)), 'Markdown');
        await ctx.answerCallbackQuery();
    });

    // Back to main menu
    bot.callbackQuery('menu_main', async (ctx) => {
        await ctx.answerCallbackQuery();
        await clearTrainingAndEditSessions(ctx);
        await showMainMenu(ctx);
    });
}

export async function showMainMenu(ctx: BotContext): Promise<void> {
    const isAdmin = isAdminTelegramId(ctx.env, ctx.from?.id);
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (user?.display_name) {
        const settings = await getUserSettings(ctx.db, user.user_id);
        if (!settings?.german_level) {
            await showLevelSelection(ctx, 'حدد مستواك حتى أضبط لك المصادر والإشعارات:');
            return;
        }
    }
    await replaceWithText(ctx, await mainMenuText(ctx), mainMenuKeyboard(isAdmin), 'Markdown');
}

export function mainMenuKeyboard(isAdmin: boolean = false): InlineKeyboard {
    void isAdmin;
    return new InlineKeyboard()
        .text('📚 راجع الآن', 'menu_learn')
        .text('🏋️ تدريب', 'menu_train').row()
        .text('📂 كلماتي', 'menu_words')
        .text('⚙️ المزيد', 'menu_more');
}

async function mainMenuText(ctx: BotContext): Promise<string> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    const announcement = await getActiveAnnouncement(ctx.db);
    const announcementText = announcement ? `📌 *إعلان:*\n${announcement.message}\n\n` : '';

    if (!user) return `${announcementText}🏠 *القائمة الرئيسية*`;

    const supportStatus = await getActiveSupportStatus(ctx.db, user.user_id);
    const badge = getUserRoleBadge(user, ctx.env, supportStatus);
    const supportLine = badge === '💙 داعم' && supportStatus?.supporter_until
        ? `\nينتهي الدعم خلال: *${formatSupportRemaining(supportStatus.supporter_until)}*`
        : '';

    const settings = await getUserSettings(ctx.db, user.user_id);
    const germanLevel = settings?.german_level ?? 'A1';

    return `${announcementText}` +
        `🏠 *DeutschDrop*\n\n` +
        `أهلاً *${user.display_name ?? user.name}*\n` +
        `المستوى: *${germanLevel}*\n` +
        `الحالة: *${badge}*${supportLine}\n\n` +
        `ماذا تريد الآن؟`;
}

function trainCountKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
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
}

function wordsMenuKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('➕ إضافة كلمة', 'add_word')
        .text('📤 رفع CSV', 'upload_csv').row()
        .text('📋 عرض كل الكلمات', 'list_words')
        .text('📌 الكلمات الصعبة', 'hard_words').row()
        .text('☑️ تحديد الكلمات', 'select_words_0').row()
        .text('💡 اقتراحات', 'suggest_peer_words').row()
        .text('⬅️ رجوع', 'menu_main')
        .text('🏠 الرئيسية', 'menu_main');
}

export function moreMenuKeyboard(isAdmin: boolean = false): InlineKeyboard {
    const keyboard = new InlineKeyboard()
        .text('👤 ملفي', 'menu_profile')
        .text('🏆 الصدارة', 'menu_leaderboard').row()
        .text('⚔️ التحديات', 'menu_challenge')
        .text('🔔 الإشعارات', 'menu_notifications').row()
        .text('📊 الإحصائيات', 'menu_stats')
        .text('📚 المصادر', 'menu_sources').row()
        .text('💙 دعم المشروع', 'menu_support').row();

    if (isAdmin) keyboard.text('🛠 لوحة الأدمن', 'admin_panel').row();

    return keyboard.text('🏠 الرئيسية', 'menu_main');
}

export function levelSelectionKeyboard(backCallback: string = 'menu_main'): InlineKeyboard {
    return new InlineKeyboard()
        .text('A1', 'level_set_A1')
        .text('A2', 'level_set_A2')
        .text('B1', 'level_set_B1').row()
        .text('⬅️ رجوع', backCallback)
        .text('🏠 الرئيسية', 'menu_main');
}

export async function showLevelSelection(ctx: BotContext, intro: string = 'حدد مستواك:'): Promise<void> {
    await replaceWithText(ctx, `🎚 *${intro}*\n\nA1\nA2\nB1`, levelSelectionKeyboard(), 'Markdown');
}

function trainMenuText(): string {
    return `🏋️ *التدريب*\n\n` +
        `اختر نوع التدريب:\n\n` +
        `الافتراضي الأفضل هو 🎲 مختلط.`;
}

async function clearTrainingAndEditSessions(ctx: BotContext): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!user) return;
    await deleteBotSession(ctx.db, user.user_id, 'word_edit');
    await deleteBotSession(ctx.db, user.user_id, 'add_word');
    await deleteBotSession(ctx.db, user.user_id, 'word_search');
    await deleteBotSession(ctx.db, user.user_id, 'train');
    await deleteBotSession(ctx.db, user.user_id, 'train_explain');
}

async function clearTextInteractionSessions(ctx: BotContext): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!user) return;
    await deleteBotSession(ctx.db, user.user_id, 'word_edit');
    await deleteBotSession(ctx.db, user.user_id, 'add_word');
    await deleteBotSession(ctx.db, user.user_id, 'word_search');
}
