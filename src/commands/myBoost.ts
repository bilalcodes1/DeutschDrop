import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId, isRegisteredUser } from '../repositories/userRepository';
import { getActiveXpBoost, type XpBoost } from '../services/xpBoosts';

export function registerMyBoostCommand(bot: Bot<BotContext>): void {
    bot.command('my_boost', async (ctx) => {
        await showMyBoost(ctx);
    });
}

async function showMyBoost(ctx: BotContext): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
        await ctx.reply('تعذر تحديد حسابك. أرسل /start ثم جرّب مرة ثانية.');
        return;
    }

    const user = await getUserByTelegramId(ctx.db, telegramId);
    if (!isRegisteredUser(user)) {
        await ctx.reply('استخدم /start للتسجيل أولاً.');
        return;
    }

    const boost = await getActiveXpBoost(ctx.db, user.user_id);
    if (!boost) {
        await ctx.reply('ما عندك XP Boost نشط حالياً.', {
            reply_markup: new InlineKeyboard().text('🏠 الرئيسية', 'menu_main'),
        });
        return;
    }

    await ctx.reply(formatMyBoostMessage(boost), {
        reply_markup: new InlineKeyboard().text('🏠 الرئيسية', 'menu_main'),
    });
}

function formatMyBoostMessage(boost: XpBoost): string {
    return `🚀 عندك XP Boost نشط!\n\n` +
        `المضاعف: ${boost.multiplier}x\n` +
        `السبب: ${boost.reason}\n` +
        `ينتهي في: ${boost.expires_at}\n` +
        `المتبقي تقريباً: ${formatRemainingMinutes(boost.expires_at)}`;
}

function formatRemainingMinutes(expiresAt: string): string {
    const normalized = expiresAt.includes('T') ? expiresAt : `${expiresAt.replace(' ', 'T')}Z`;
    const remainingMs = new Date(normalized).getTime() - Date.now();
    const minutes = Math.max(0, Math.ceil(remainingMs / 60_000));
    return `${minutes} دقيقة`;
}
