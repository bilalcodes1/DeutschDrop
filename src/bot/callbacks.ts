import { InlineKeyboard } from 'grammy';
import type { BotContext } from './context';

export async function safeAnswerCallback(ctx: BotContext): Promise<void> {
    if (!ctx.callbackQuery) return;
    await ctx.answerCallbackQuery().catch(() => {});
}

export function safeCallback(handler: (ctx: BotContext) => Promise<void>): (ctx: BotContext) => Promise<void> {
    return async (ctx) => {
        await safeAnswerCallback(ctx);
        try {
            await handler(ctx);
        } catch (error) {
            console.warn('Callback handler failed');
            await showCallbackError(ctx);
        }
    };
}

export async function showCallbackError(ctx: BotContext): Promise<void> {
    const keyboard = new InlineKeyboard().text('🏠 الرئيسية', 'menu_main');
    const text = 'حدث خطأ بسيط، جرّب مرة ثانية.';
    if (ctx.callbackQuery?.message) {
        await ctx.editMessageText(text, { reply_markup: keyboard }).catch(async () => {
            await ctx.reply(text, { reply_markup: keyboard }).catch(() => {});
        });
        return;
    }
    await ctx.reply(text, { reply_markup: keyboard }).catch(() => {});
}
