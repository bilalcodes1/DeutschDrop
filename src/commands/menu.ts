import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getActiveAnnouncement } from '../repositories/announcementRepository';
import { getActiveSupportStatus } from '../repositories/supportRepository';
import { getUserByTelegramId } from '../repositories/userRepository';
import { formatSupportRemaining, getUserRoleBadge } from '../services/roleUi';
import { replaceWithText } from './wordPanel';

export function registerMenuCommand(bot: Bot<BotContext>): void {
    bot.command('menu', async (ctx) => {
        await showMainMenu(ctx);
    });

    // Handle menu callbacks that are not owned by feature modules.
    bot.callbackQuery('menu_train', async (ctx) => {
        await replaceWithText(
            ctx,
            '🏋️ *وضع التدريب*\n\nاختر عدد الأسئلة:',
            trainCountKeyboard(),
            'Markdown'
        );
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery('menu_words', async (ctx) => {
        await replaceWithText(
            ctx,
            '📂 *إدارة الكلمات*\n\nاختر إحدى الخيارات:',
            wordsMenuKeyboard(),
            'Markdown'
        );
        await ctx.answerCallbackQuery();
    });

    // Back to main menu
    bot.callbackQuery('menu_main', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showMainMenu(ctx);
    });
}

export async function showMainMenu(ctx: BotContext): Promise<void> {
    await replaceWithText(ctx, await mainMenuText(ctx), mainMenuKeyboard(), 'Markdown');
}

export function mainMenuKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('📚 تعلم', 'menu_learn')
        .text('🏋️ تدريب', 'menu_train').row()
        .text('⚔️ تحدي', 'menu_challenge')
        .text('📂 إدارة الكلمات', 'menu_words').row()
        .text('👤 ملفي الشخصي', 'menu_profile')
        .text('🏆 الترتيب', 'menu_leaderboard').row()
        .text('📊 الإحصائيات', 'menu_stats').row()
        .text('💙 دعم المشروع', 'menu_support').row()
        .text('⚙️ الإعدادات', 'menu_settings')
        .text('🏠 الرئيسية', 'menu_main');
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

    return `${announcementText}` +
        `🏠 *القائمة الرئيسية*\n\n` +
        `الحساب: *${user.display_name ?? user.name}*\n` +
        `الحالة: *${badge}*${supportLine}`;
}

function trainCountKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('تدريب سريع 5 أسئلة', 'train_5').row()
        .text('10 أسئلة', 'train_10')
        .text('20 سؤال', 'train_20').row()
        .text('🔥 الكلمات الصعبة', 'train_hard').row()
        .text('🎯 مراجعة قبل الامتحان', 'train_exam').row()
        .text('⬅️ رجوع', 'menu_main');
}

function wordsMenuKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('➕ إضافة كلمة', 'add_word')
        .text('📤 رفع CSV', 'upload_csv').row()
        .text('📋 عرض الكلمات', 'list_words')
        .text('📌 الكلمات الصعبة', 'hard_words').row()
        .text('💡 اقتراحات', 'suggest_peer_words').row()
        .text('⬅️ رجوع', 'menu_main');
}
