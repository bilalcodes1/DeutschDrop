import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { replaceWithText } from './wordPanel';

const LIFE_DISABLED_TEXT = 'ℹ️ تم إيقاف نظام الجمل.';

export function registerDisabledLifeCompatibility(bot: Bot<BotContext>): void {
    bot.callbackQuery(/^life(?::|_)/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        await showLifeDisabledPanel(ctx);
    });

    bot.callbackQuery(/^adm:/, async (ctx) => {
        await ctx.answerCallbackQuery().catch(() => {});
        await showLifeDisabledPanel(ctx);
    });
}

export async function showLifeDisabledPanel(ctx: BotContext): Promise<void> {
    await replaceWithText(
        ctx,
        LIFE_DISABLED_TEXT,
        new InlineKeyboard().text('🏠 الرئيسية', 'menu_main')
    );
}
