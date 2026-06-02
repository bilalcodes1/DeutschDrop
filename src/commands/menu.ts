import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';

export function registerMenuCommand(bot: Bot<BotContext>): void {
    bot.command('menu', async (ctx) => {
        await ctx.reply('القائمة الرئيسية:', { reply_markup: mainMenuKeyboard() });
    });

    // Handle menu callbacks that are not owned by feature modules.
    bot.callbackQuery('menu_train', async (ctx) => {
        await ctx.editMessageText(
            '🏋️ *وضع التدريب*\n\nاختر عدد الأسئلة:',
            { parse_mode: 'Markdown', reply_markup: trainCountKeyboard() }
        );
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery('menu_words', async (ctx) => {
        await ctx.editMessageText(
            '📂 *إدارة الكلمات*\n\nاختر إحدى الخيارات:',
            { parse_mode: 'Markdown', reply_markup: wordsMenuKeyboard() }
        );
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery('menu_challenge', async (ctx) => {
        await ctx.editMessageText(
            '⚔️ *التحديات*\n\nقريباً!',
            { parse_mode: 'Markdown' }
        );
        await ctx.answerCallbackQuery();
    });

    // Back to main menu
    bot.callbackQuery('menu_main', async (ctx) => {
        await ctx.editMessageText(
            '🏠 *القائمة الرئيسية*',
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
        );
        await ctx.answerCallbackQuery();
    });
}

export function mainMenuKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('📚 تعلم', 'menu_learn')
        .text('🏋️ تدريب', 'menu_train').row()
        .text('⚔️ تحدي', 'menu_challenge')
        .text('🏆 الترتيب', 'menu_leaderboard').row()
        .text('📂 إدارة الكلمات', 'menu_words')
        .text('📊 الإحصائيات', 'menu_stats').row()
        .text('⚙️ الإعدادات', 'menu_settings');
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
        .text('💡 اقتراحات', 'suggest_peer_words').row()
        .text('⬅️ رجوع', 'menu_main');
}
