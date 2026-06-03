import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { createSupportProof, createSupportRequest } from '../repositories/supportRepository';
import { getUserByTelegramId } from '../repositories/userRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import { sendTelegramMessage } from '../services/notifications';
import { replaceWithText } from './wordPanel';

const ZAINCASH_QR_URL = 'https://deutschdrop.aque7x.workers.dev/support/zaincash-qr';

interface SupportProofSession {
    awaiting: true;
}

export function registerSupportCommand(bot: Bot<BotContext>): void {
    bot.command('support', async (ctx) => showSupportHome(ctx));

    bot.callbackQuery('menu_support', async (ctx) => {
        await showSupportHome(ctx);
    });

    bot.callbackQuery('support_iraq', async (ctx) => {
        await replaceWithText(ctx, '🇮🇶 *داخل العراق*\nاختر طريقة الدعم:', iraqKeyboard(), 'Markdown');
    });

    bot.callbackQuery('support_qicard', async (ctx) => {
        await replaceWithText(ctx, '💳 *QiCard*\n\nرقم البطاقة:\n`7112008623`', backKeyboard('support_iraq'), 'Markdown');
    });

    bot.callbackQuery('support_zaincash', async (ctx) => {
        const qrUrl = supportQrUrl(ctx);
        await editOrSendSupportPhoto(
            ctx,
            qrUrl,
            '📱 ZainCash\n\nامسح الباركود للتحويل، وبعدها أرسل لقطة شاشة أو اكتب تم التحويل + المبلغ + اسمك.',
            backKeyboard('support_iraq')
        );
    });

    bot.callbackQuery('support_local_cards', async (ctx) => {
        await replaceWithText(
            ctx,
            '🎮 *بطاقة زين/آسيا*\n\nتقدر ترسل صورة البطاقة بعد الحك أو تكتب الكود نصاً.\n\nالبطاقات المقبولة:\nZain Iraq\nAsiaCell',
            backKeyboard('support_iraq'),
            'Markdown'
        );
    });

    bot.callbackQuery('support_international', async (ctx) => {
        await replaceWithText(ctx, '🌍 *من خارج العراق*\nاختر طريقة الدعم:', internationalKeyboard(), 'Markdown');
    });

    bot.callbackQuery('support_payoneer', async (ctx) => {
        await replaceWithText(
            ctx,
            '🏦 *Payoneer*\n\nللدعم الدولي عبر Payoneer، اضغط طلب بيانات Payoneer.',
            new InlineKeyboard()
                .text('📩 طلب بيانات Payoneer', 'support_payoneer_request').row()
                .text('⬅️ رجوع', 'support_international')
                .text('🏠 الرئيسية', 'menu_main'),
            'Markdown'
        );
    });

    bot.callbackQuery('support_payoneer_request', async (ctx) => {
        const user = await getCurrentUser(ctx);
        if (!user) return;

        await createSupportRequest(ctx.db, user.user_id, 'payoneer', 'طلب بيانات Payoneer');
        await notifyAdmins(ctx, `📩 طلب Payoneer جديد من ${user.display_name ?? user.name} (${user.telegram_user_id ?? user.telegram_id})`);
        await replaceWithText(ctx, 'تم استلام طلبك ✅ سيتم إرسال بيانات Payoneer لك.', backKeyboard('support_international'));
    });

    bot.callbackQuery('support_global_cards', async (ctx) => {
        await showGiftCards(ctx);
    });

    bot.callbackQuery('support_gift_cards', async (ctx) => {
        await showGiftCards(ctx);
    });

    bot.callbackQuery('support_send_proof', async (ctx) => {
        const user = await getCurrentUser(ctx);
        if (!user) return;

        await saveBotSession<SupportProofSession>(ctx.db, user.user_id, 'support_proof', { awaiting: true }, 30);
        await replaceWithText(ctx, '📩 أرسل صورة أو رسالة تحتوي:\nالطريقة + المبلغ + اسمك', backKeyboard('menu_support'));
    });

    bot.on(['message:text', 'message:photo'], async (ctx, next) => {
        const user = await getCurrentUser(ctx, false);
        if (!user || user.is_banned) return next();

        const session = await getBotSession<SupportProofSession>(ctx.db, user.user_id, 'support_proof');
        if (!session) return next();

        const message = ctx.message?.text ?? ctx.message?.caption ?? null;
        const fileId = ctx.message?.photo?.at(-1)?.file_id ?? null;
        const parsed = parseProofMessage(message);

        await createSupportProof(ctx.db, user.user_id, {
            method: parsed.method,
            amount: parsed.amount,
            message,
            fileId,
        });
        await deleteBotSession(ctx.db, user.user_id, 'support_proof');
        await notifyAdmins(ctx, `📩 إثبات دعم جديد من ${user.display_name ?? user.name}\n${message ?? 'صورة مرفقة'}`);
        await ctx.reply('تم استلام إثبات الدعم ✅ شكراً لدعمك.', { reply_markup: supportHomeKeyboard() });
    });
}

async function showSupportHome(ctx: BotContext): Promise<void> {
    await replaceWithText(ctx, '💙 *دعم DeutschDrop*\nاختر طريقة الدعم:', supportHomeKeyboard(), 'Markdown');
}

function supportHomeKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('🇮🇶 داخل العراق', 'support_iraq')
        .text('🌍 من خارج العراق', 'support_international').row()
        .text('🎁 بطاقات هدايا', 'support_gift_cards').row()
        .text('📩 إرسال إثبات الدعم', 'support_send_proof').row()
        .text('🏠 الرئيسية', 'menu_main');
}

function iraqKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('💳 QiCard', 'support_qicard')
        .text('📱 ZainCash', 'support_zaincash').row()
        .text('🎮 بطاقة زين/آسيا', 'support_local_cards').row()
        .text('⬅️ رجوع', 'menu_support')
        .text('🏠 الرئيسية', 'menu_main');
}

function internationalKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('🏦 Payoneer', 'support_payoneer').row()
        .text('🎁 بطاقات عالمية', 'support_global_cards').row()
        .text('⬅️ رجوع', 'menu_support')
        .text('🏠 الرئيسية', 'menu_main');
}

async function showGiftCards(ctx: BotContext): Promise<void> {
    await replaceWithText(
        ctx,
        '🎁 *بطاقات هدايا*\n\nأرسل صورة البطاقة أو الكود بعد الشراء.\nاكتب نوع البطاقة وقيمتها.\nتأكد أن البطاقة غير مستخدمة وصالحة للمنطقة المطلوبة.',
        new InlineKeyboard()
            .text('🍎 Apple Gift Card', 'support_send_proof').row()
            .text('🛒 Amazon Gift Card', 'support_send_proof').row()
            .text('🛍 eBay Gift Card', 'support_send_proof').row()
            .text('📱 Zain / AsiaCell', 'support_send_proof').row()
            .text('⬅️ رجوع', 'menu_support')
            .text('🏠 الرئيسية', 'menu_main'),
        'Markdown'
    );
}

function backKeyboard(back: string): InlineKeyboard {
    return new InlineKeyboard()
        .text('⬅️ رجوع', back)
        .text('🏠 الرئيسية', 'menu_main');
}

async function editOrSendSupportPhoto(ctx: BotContext, url: string, caption: string, keyboard: InlineKeyboard): Promise<void> {
    try {
        if (ctx.callbackQuery?.message) {
            await ctx.editMessageMedia({ type: 'photo', media: url, caption }, { reply_markup: keyboard });
            return;
        }
    } catch {
        if (ctx.callbackQuery?.message) {
            try { await ctx.deleteMessage(); } catch {}
        }
    }
    await ctx.replyWithPhoto(url, { caption, reply_markup: keyboard });
}

function supportQrUrl(ctx: BotContext): string {
    return ZAINCASH_QR_URL;
}

async function getCurrentUser(ctx: BotContext, reply: boolean = true) {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!user && reply) await ctx.reply('استخدم /start للتسجيل أولاً.');
    return user;
}

async function notifyAdmins(ctx: BotContext, text: string): Promise<void> {
    const ids = ctx.env.ADMIN_TELEGRAM_IDS?.split(',').map(id => Number(id.trim())).filter(Number.isFinite) ?? [];
    for (const id of ids) {
        await sendTelegramMessage(ctx.env, id, text);
    }
}

function parseProofMessage(message: string | null): { method: string | null; amount: string | null } {
    if (!message) return { method: null, amount: null };
    const amount = message.match(/\d[\d,.]*/)?.[0] ?? null;
    const method = ['QiCard', 'ZainCash', 'AsiaCell', 'Zain', 'Apple', 'Amazon', 'eBay', 'Payoneer']
        .find(item => message.toLowerCase().includes(item.toLowerCase())) ?? null;
    return { method, amount };
}
