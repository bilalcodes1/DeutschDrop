import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import {
    createWordAndAssignToUser,
    deleteWordForUser,
    DUPLICATE_WORD_ERROR,
    getPeerWordSuggestions,
    getWordsByUser,
    searchDuplicateWordForUser,
    updateWordForUser,
} from '../repositories/wordRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import { addXp } from '../services/xpLevels';
import { checkAchievements } from '../services/achievements';
import { incrementDailyTask } from '../services/dailyTasks';
import { mainMenuKeyboard } from './menu';
import { startPictogramSelection } from './pictograms';
import { navigationKeyboard, replaceWithText, showWordDetailPanel } from './wordPanel';

interface AddWordSessionData {
    german: string | null;
    wordId?: number;
    step: 'german' | 'arabic' | 'edit';
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
            if (!user) {
                await ctx.reply('يرجى استخدام /start أولاً.');
                await next();
                return;
            }

            const existing = await searchDuplicateWordForUser(ctx.db, user.user_id, text);
            if (existing) {
                await ctx.reply(
                    `⚠️ الكلمة *${text}* موجودة مسبقاً في بنك كلماتك.`,
                    { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
                );
                await deleteBotSession(ctx.db, user.user_id, 'add_word');
                return;
            }

            await saveBotSession<AddWordSessionData>(
                ctx.db,
                user.user_id,
                'add_word',
                { german: text, step: 'arabic' },
                30
            );
            await ctx.reply(`تم! الآن أرسل المعنى العربي لـ *${text}*:`, { parse_mode: 'Markdown' });
        } else if (pending.data.step === 'arabic' && pending.data.german) {
            if (!user) {
                await ctx.reply('يرجى استخدام /start أولاً.');
                return;
            }

            try {
                const wordId = await createWordAndAssignToUser(ctx.db, pending.data.german, text, null, user.user_id);
                await addXp(ctx.db, user.user_id, 5, 'new_word');
                await incrementDailyTask(ctx, user.user_id, 'learn_words');
                await checkAchievements(ctx, user.user_id);
                await ctx.reply(
                    `✅ تمت الإضافة!\n\n🇩🇪 ${pending.data.german}\n🇦🇪 ${text}`
                );
                await deleteBotSession(ctx.db, user.user_id, 'add_word');
                await startPictogramSelection(ctx, wordId);
                return;
            } catch (error) {
                if ((error as Error).message === DUPLICATE_WORD_ERROR) {
                    await ctx.reply('⚠️ هذه الكلمة موجودة مسبقاً في بنك كلماتك.', { reply_markup: mainMenuKeyboard() });
                    await deleteBotSession(ctx.db, user.user_id, 'add_word');
                    return;
                }
                throw error;
            }

        } else if (pending.data.step === 'edit' && pending.data.wordId) {
            if (!user) {
                await ctx.reply('يرجى استخدام /start أولاً.');
                return;
            }

            const parsed = parseWordInput(text);
            if (!parsed) {
                await ctx.reply('أرسل التعديل بهذه الصيغة:\nHaus = بيت\nأو:\nHaus,بيت,Das Haus ist groß.');
                return;
            }

            try {
                const updated = await updateWordForUser(
                    ctx.db,
                    user.user_id,
                    pending.data.wordId,
                    parsed.german,
                    parsed.arabic,
                    parsed.example
                );
                await deleteBotSession(ctx.db, user.user_id, 'add_word');
                await ctx.reply(
                    updated ? `✅ تم تعديل الكلمة.\n\n🇩🇪 ${parsed.german}\n🇦🇪 ${parsed.arabic}` : '⚠️ لم أجد هذه الكلمة في بنك كلماتك.',
                    { reply_markup: mainMenuKeyboard() }
                );
            } catch (error) {
                if ((error as Error).message === DUPLICATE_WORD_ERROR) {
                    await ctx.reply('⚠️ لا يمكن التعديل: الكلمة الألمانية موجودة مسبقاً في بنك كلماتك.');
                    return;
                }
                throw error;
            }
        }
    });

    bot.callbackQuery('list_words', async (ctx) => {
        const telegramId = ctx.from?.id ?? 0;
        const user = await getUserByTelegramId(ctx.db, telegramId);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }

        await showUserWords(ctx, user.user_id);
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^word_detail_(\d+)$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        await ctx.answerCallbackQuery();
        await showWordDetailPanel(ctx, wordId);
    });

    bot.callbackQuery(/^delete_word_(\d+)$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        const telegramId = ctx.from?.id ?? 0;
        const user = await getUserByTelegramId(ctx.db, telegramId);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }

        const deleted = await deleteWordForUser(ctx.db, user.user_id, wordId);
        await ctx.answerCallbackQuery(deleted ? 'تم الحذف' : 'الكلمة غير موجودة');
        await showUserWords(ctx, user.user_id);
    });

    bot.callbackQuery(/^edit_word_(\d+)$/, async (ctx) => {
        const wordId = parseInt(ctx.match[1], 10);
        const telegramId = ctx.from?.id ?? 0;
        const user = await getUserByTelegramId(ctx.db, telegramId);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }

        await saveBotSession<AddWordSessionData>(
            ctx.db,
            user.user_id,
            'add_word',
            { german: null, wordId, step: 'edit' },
            30
        );
        await ctx.editMessageText(
            '✏️ أرسل التعديل بهذه الصيغة:\n\nHaus = بيت\n\nأو:\nHaus,بيت,Das Haus ist groß.',
            { reply_markup: navigationKeyboard(`word_detail_${wordId}`) }
        );
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery('suggest_peer_words', async (ctx) => {
        const telegramId = ctx.from?.id ?? 0;
        const user = await getUserByTelegramId(ctx.db, telegramId);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }

        const suggestions = await getPeerWordSuggestions(ctx.db, user.user_id, 10);
        if (suggestions.length === 0) {
            await ctx.editMessageText('💡 لا توجد اقتراحات جديدة حالياً.', { reply_markup: mainMenuKeyboard() });
            await ctx.answerCallbackQuery();
            return;
        }

        const text = '💡 *اقتراحات من الطرف الآخر*\n\n' +
            suggestions.map((word, index) => `${index + 1}. 🇩🇪 ${word.german}\n   🇦🇪 ${word.arabic}`).join('\n\n') +
            '\n\nهذه اقتراحات فقط، لن تُضاف تلقائياً.';

        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: new InlineKeyboard().text('⬅️ رجوع', 'menu_words'),
        });
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

    try {
        const wordId = await createWordAndAssignToUser(ctx.db, german, arabic, null, user.user_id);
        await addXp(ctx.db, user.user_id, 5, 'new_word');
        await incrementDailyTask(ctx, user.user_id, 'learn_words');
        await checkAchievements(ctx, user.user_id);
        await ctx.reply(`✅ تمت الإضافة!\n\n🇩🇪 ${german}\n🇦🇪 ${arabic}`);
        await startPictogramSelection(ctx, wordId);
        return;
    } catch (error) {
        if ((error as Error).message === DUPLICATE_WORD_ERROR) {
            await ctx.reply('⚠️ هذه الكلمة موجودة مسبقاً في بنك كلماتك.', { reply_markup: mainMenuKeyboard() });
            return;
        }
        throw error;
    }
}

async function showUserWords(ctx: BotContext, userId: number): Promise<void> {
    const words = await getWordsByUser(ctx.db, userId);
    if (words.length === 0) {
        await replaceWithText(ctx, '📋 لا توجد كلمات بعد.', new InlineKeyboard()
                .text('➕ إضافة كلمة', 'add_word')
                .text('📤 رفع CSV', 'upload_csv').row()
                .text('⬅️ رجوع', 'menu_words')
                .text('🏠 الرئيسية', 'menu_main'));
        return;
    }

    const visible = words.slice(0, 10);
    const text = '📋 *كلماتك*\n\n' +
        visible.map((word, index) => `${index + 1}. 🇩🇪 ${word.german}\n   🇦🇪 ${word.arabic}`).join('\n\n') +
        (words.length > visible.length ? `\n\nو ${words.length - visible.length} كلمة أخرى.` : '');

    const keyboard = new InlineKeyboard();
    for (const word of visible) {
        keyboard.text(`📄 ${word.german}`, `word_detail_${word.word_id}`).row();
    }
    keyboard.text('⬅️ رجوع', 'menu_words').text('🏠 الرئيسية', 'menu_main');

    await replaceWithText(ctx, text, keyboard, 'Markdown');
}

function parseWordInput(text: string): { german: string; arabic: string; example: string | null } | null {
    const equalsMatch = text.match(/^(.+?)\s*=\s*(.+)$/);
    if (equalsMatch) {
        return {
            german: equalsMatch[1].trim(),
            arabic: equalsMatch[2].trim(),
            example: null,
        };
    }

    const parts = text.split(',').map(part => part.trim());
    if (parts.length >= 2 && parts[0] && parts[1]) {
        return {
            german: parts[0],
            arabic: parts[1],
            example: parts[2] || null,
        };
    }

    return null;
}
