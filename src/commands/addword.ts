import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import { createWordAndAssignToUser, searchDuplicateWord } from '../repositories/wordRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import { addXp } from '../services/xpLevels';
import { mainMenuKeyboard } from './menu';

interface AddWordSessionData {
    german: string | null;
    step: 'german' | 'arabic' | 'confirm_duplicate';
}

export function registerAddWordCommand(bot: Bot<BotContext>): void {
    bot.command('addword', async (ctx) => {
        await ctx.reply(
            '➕ *إضافة كلمة جديدة*\n\nأرسل الكلمة الألمانية:',
            { parse_mode: 'Markdown' }
        );
        const telegramId = ctx.from?.id ?? 0;
        const user = await getUserByTelegramId(ctx.db, telegramId);
        if (user) {
            await saveBotSession<AddWordSessionData>(ctx.db, user.user_id, 'add_word', { german: null, step: 'german' }, 30);
        }
    });

    bot.callbackQuery('add_word', async (ctx) => {
        await ctx.editMessageText(
            '➕ *إضافة كلمة جديدة*\n\nأرسل الكلمة الألمانية:',
            { parse_mode: 'Markdown' }
        );
        const telegramId = ctx.from?.id ?? 0;
        const user = await getUserByTelegramId(ctx.db, telegramId);
        if (user) {
            await saveBotSession<AddWordSessionData>(ctx.db, user.user_id, 'add_word', { german: null, step: 'german' }, 30);
        }
        await ctx.answerCallbackQuery();
    });

    // Handle text messages for two-step word entry
    bot.on('message:text', async (ctx, next) => {
        const telegramId = ctx.from?.id ?? 0;
        const user = await getUserByTelegramId(ctx.db, telegramId);
        const pending = user ? await getBotSession<AddWordSessionData>(ctx.db, user.user_id, 'add_word') : null;

        if (!pending) {
            // Also check for inline format: "Word = معنى"
            const inlineMatch = ctx.message.text.match(/^(.+?)\s*=\s*(.+)$/);
            if (inlineMatch) {
                const german = inlineMatch[1].trim();
                const arabic = inlineMatch[2].trim();
                await addWordInline(ctx, german, arabic);
                return;
            }
            return await next();
        }

        const text = ctx.message.text.trim();

        if (pending.data.step === 'german') {
            // Check for duplicate
            const existing = await searchDuplicateWord(ctx.db, text);
            if (existing) {
                if (user) {
                    await saveBotSession<AddWordSessionData>(
                        ctx.db,
                        user.user_id,
                        'add_word',
                        { german: text, step: 'confirm_duplicate' },
                        30
                    );
                }
                await ctx.reply(
                    `⚠️ الكلمة *${text}* موجودة مسبقاً.\n\nهل تريد إضافتها برغم ذلك؟`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: new InlineKeyboard()
                            .text('نعم', 'add_dup_yes')
                            .text('لا', 'add_dup_no')
                    }
                );
                return;
            }

            if (user) {
                await saveBotSession<AddWordSessionData>(
                    ctx.db,
                    user.user_id,
                    'add_word',
                    { german: text, step: 'arabic' },
                    30
                );
            }
            await ctx.reply(`تم! الآن أرسل المعنى العربي لـ *${text}*:`, { parse_mode: 'Markdown' });
        } else if (pending.data.step === 'arabic' && pending.data.german) {
            if (!user) {
                await ctx.reply('يرجى استخدام /start أولاً.');
                return;
            }

            await createWordAndAssignToUser(ctx.db, pending.data.german, text, null, user.user_id);
            await addXp(ctx.db, user.user_id, 5, 'new_word');

            await ctx.reply(
                `✅ تمت الإضافة!\n\n🇩🇪 ${pending.data.german}\n🇦🇪 ${text}`,
                { reply_markup: mainMenuKeyboard() }
            );
            await deleteBotSession(ctx.db, user.user_id, 'add_word');
        }
    });

    // Handle duplicate confirmation
    bot.callbackQuery('add_dup_yes', async (ctx) => {
        const telegramId = ctx.from?.id ?? 0;
        const user = await getUserByTelegramId(ctx.db, telegramId);
        const pending = user ? await getBotSession<AddWordSessionData>(ctx.db, user.user_id, 'add_word') : null;
        const german = pending?.data.german;
        if (!user || !german) {
            await ctx.answerCallbackQuery('انتهت الجلسة');
            return;
        }

        await ctx.editMessageText(
            `أرسل المعنى العربي لـ *${german}*:`,
            { parse_mode: 'Markdown' }
        );
        await saveBotSession<AddWordSessionData>(ctx.db, user.user_id, 'add_word', { german, step: 'arabic' }, 30);
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery('add_dup_no', async (ctx) => {
        const telegramId = ctx.from?.id ?? 0;
        const user = await getUserByTelegramId(ctx.db, telegramId);
        if (user) {
            await deleteBotSession(ctx.db, user.user_id, 'add_word');
        }
        await ctx.editMessageText('تم الإلغاء.', { reply_markup: mainMenuKeyboard() });
        await ctx.answerCallbackQuery();
    });
}

async function addWordInline(ctx: BotContext, german: string, arabic: string): Promise<void> {
    const telegramId = ctx.from?.id ?? 0;
    const user = await getUserByTelegramId(ctx.db, telegramId);
    if (!user) {
        await ctx.reply('يرجى استخدام /start أولاً.');
        return;
    }

    await createWordAndAssignToUser(ctx.db, german, arabic, null, user.user_id);
    await addXp(ctx.db, user.user_id, 5, 'new_word');

    await ctx.reply(
        `✅ تمت الإضافة!\n\n🇩🇪 ${german}\n🇦🇪 ${arabic}`,
        { reply_markup: mainMenuKeyboard() }
    );
}
