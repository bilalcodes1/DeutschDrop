import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import { getWordById } from '../repositories/wordRepository';
import { buildYouglishDirectUrl, buildYouglishWebAppUrl } from '../services/youglish';
import { normalizeReturnContext, sideFlowBackCallback } from '../services/returnContext';
import { replaceWithText } from './wordPanel';

export function registerYouglishCommand(bot: Bot<BotContext>): void {
    bot.callbackQuery(/^youglish:(\d+)(?::ctx:([a-z_]+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const wordId = Number(ctx.match[1]);
        const returnContext = normalizeReturnContext(ctx.match[2]);
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }

        const word = await getWordById(ctx.db, wordId);
        if (!word || word.added_by !== user.user_id) {
            await replaceWithText(ctx, '⚠️ لم أجد هذه الكلمة في بنك كلماتك.', youglishFallbackKeyboard(wordId, returnContext));
            return;
        }

        const directUrl = buildYouglishDirectUrl(word.german, 'german');
        const webAppUrl = ctx.env.TELEGRAM_WEBAPP_URL
            ? buildYouglishWebAppUrl(ctx.env.TELEGRAM_WEBAPP_URL, word.german, 'german')
            : null;

        const keyboard = new InlineKeyboard();
        if (webAppUrl) {
            keyboard.webApp('🎬 فتح صفحة YouGlish', webAppUrl).row();
        }
        keyboard.url('🔗 فتح YouGlish', directUrl).row()
            .text('🧹 إخفاء هذه الرسالة', 'youglish:hide').row()
            .text('⬅️ رجوع', sideFlowBackCallback(word.word_id, returnContext))
            .text('🏠 الرئيسية', 'menu_main');

        await replaceWithText(
            ctx,
            `🎬 YouGlish German\n\n🇩🇪 ${word.german}\n\nYouGlish خيار خارجي احتياطي. إذا لم يعمل داخل Telegram بسبب مشغل الفيديو، افتحه مباشرة من الزر الرسمي.`,
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

function youglishFallbackKeyboard(wordId: number, context: ReturnType<typeof normalizeReturnContext>): InlineKeyboard {
    return new InlineKeyboard()
        .text('⬅️ رجوع', sideFlowBackCallback(wordId, context))
        .text('🏠 الرئيسية', 'menu_main');
}
