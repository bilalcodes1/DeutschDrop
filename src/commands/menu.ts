import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { replaceWithText } from './wordPanel';

export function registerMenuCommand(bot: Bot<BotContext>): void {
    bot.command('menu', async (ctx) => {
        await ctx.reply('القائمة الرئيسية:', { reply_markup: mainMenuKeyboard() });
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
        await replaceWithText(
            ctx,
            '🏠 *القائمة الرئيسية*',
            mainMenuKeyboard(),
            'Markdown'
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
        .text('⚙️ الإعدادات', 'menu_settings')
        .text('🏠 الرئيسية', 'menu_main');
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
