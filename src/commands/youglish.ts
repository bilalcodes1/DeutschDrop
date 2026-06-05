import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import { getWordById } from '../repositories/wordRepository';
import { buildYouglishDirectUrl, buildYouglishWebAppUrl } from '../services/youglish';
import { replaceWithText } from './wordPanel';

export function registerYouglishCommand(bot: Bot<BotContext>): void {
    bot.callbackQuery(/^youglish:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const wordId = Number(ctx.match[1]);
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }

        const word = await getWordById(ctx.db, wordId);
        if (!word || word.added_by !== user.user_id) {
            await replaceWithText(ctx, '⚠️ لم أجد هذه الكلمة في بنك كلماتك.', youglishFallbackKeyboard(wordId));
            return;
        }

        const directUrl = buildYouglishDirectUrl(word.german, 'german');
        const webAppUrl = ctx.env.TELEGRAM_WEBAPP_URL
            ? buildYouglishWebAppUrl(ctx.env.TELEGRAM_WEBAPP_URL, word.german, 'german')
            : null;

        const keyboard = new InlineKeyboard();
        if (webAppUrl) {
            keyboard.webApp('🎬 فتح داخل Telegram', webAppUrl).row();
        }
        keyboard.url('🔗 فتح YouGlish', webAppUrl ?? directUrl).row()
            .url('🔗 فتح مباشر في YouGlish', directUrl).row()
            .text('🧹 إخفاء هذه الرسالة', 'youglish:hide').row()
            .text('⬅️ رجوع للكلمة', `word_detail_${word.word_id}`)
            .text('🏠 الرئيسية', 'menu_main');

        await replaceWithText(
            ctx,
            `🎬 أمثلة نطق حقيقية من YouGlish German\n\n🇩🇪 ${word.german}\n\nافتح الصفحة لسماع النطق من فيديوهات حقيقية داخل YouGlish. لا يتم تحميل أو إرسال أي فيديو داخل البوت.`,
            keyboard
        );
    });

    bot.callbackQuery('youglish:hide', async (ctx) => {
        await ctx.answerCallbackQuery();
        try {
            await ctx.deleteMessage();
        } catch {
            await replaceWithText(ctx, 'تم إخفاء رسالة YouGlish ✅', new InlineKeyboard().text('🏠 الرئيسية', 'menu_main'));
        }
    });
}

function youglishFallbackKeyboard(wordId: number): InlineKeyboard {
    return new InlineKeyboard()
        .text('⬅️ رجوع للكلمة', `word_detail_${wordId}`)
        .text('🏠 الرئيسية', 'menu_main');
}
