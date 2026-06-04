import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { addXp } from '../services/xpLevels';
import {
    getNotificationEventWord,
    markForgottenForTrainingPriority,
    recordNotificationResponse,
} from '../services/smartNotificationService';
import { replaceWithText } from './wordPanel';

export function registerSmartNotificationCommand(bot: Bot<BotContext>): void {
    bot.callbackQuery(/^notif_show_(\d+)$/, async (ctx) => {
        const eventId = Number(ctx.match[1]);
        const word = await getNotificationEventWord(ctx.db, eventId);
        if (!word) {
            await ctx.answerCallbackQuery();
            await replaceWithText(ctx, 'لم أجد هذه الكلمة.', notificationDoneKeyboard());
            return;
        }

        await recordNotificationResponse(ctx.db, eventId, 'shown');
        await ctx.answerCallbackQuery();
        await replaceWithText(
            ctx,
            `🇩🇪 ${word.german}\n🇮🇶 ${word.arabic}` +
            (word.example ? `\n\nمثال:\n${word.example}` : '') +
            `\n\nهل كنت تعرفها؟`,
            new InlineKeyboard()
                .text('✅ نعم عرفتها', `notif_known_${eventId}`)
                .text('❌ لا نسيتها', `notif_forgot_${eventId}`).row()
                .text('🏋️ تدريب سريع', 'train_5')
                .text('📚 راجع الآن', 'menu_learn')
        );
    });

    bot.callbackQuery(/^notif_known_(\d+)$/, async (ctx) => {
        const eventId = Number(ctx.match[1]);
        await recordNotificationResponse(ctx.db, eventId, 'known');
        const userId = await getEventUserId(ctx, eventId);
        if (userId) await addXp(ctx.db, userId, 1, 'notification_recall_known');
        await ctx.answerCallbackQuery('ممتاز');
        await replaceWithText(ctx, 'ممتاز ✅ ثبتها بمراجعة قصيرة: /learn', notificationDoneKeyboard());
    });

    bot.callbackQuery(/^notif_forgot_(\d+)$/, async (ctx) => {
        const eventId = Number(ctx.match[1]);
        await recordNotificationResponse(ctx.db, eventId, 'forgotten');
        await markForgottenForTrainingPriority(ctx.db, eventId);
        await ctx.answerCallbackQuery('تم تسجيلها');
        await replaceWithText(ctx, 'تمام، هاي فرصة ذهبية للتثبيت. راجعها الآن: /learn', notificationDoneKeyboard());
    });
}

function notificationDoneKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('📚 راجع الآن', 'menu_learn')
        .text('🏋️ تدريب سريع', 'train_5').row()
        .text('🏠 الرئيسية', 'menu_main');
}

async function getEventUserId(ctx: BotContext, eventId: number): Promise<number | null> {
    const event = await ctx.db.prepare('SELECT user_id FROM notification_events WHERE id = ?').bind(eventId).first<{ user_id: number }>();
    return event?.user_id ?? null;
}
