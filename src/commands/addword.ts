import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import {
    createWordAndAssignToUser,
    countSearchWordsByUser,
    countWordsByUser,
    deleteAllWordsForUser,
    deleteWordForUser,
    deleteWordsForUser,
    DUPLICATE_WORD_ERROR,
    getPeerWordSuggestions,
    getWordById,
    getWordsByUser,
    getWordsByUserPaginated,
    searchWordsByUser,
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

interface WordSelectionSession {
    selectedIds: number[];
}

interface WordSearchSession {
    awaiting: boolean;
    query: string | null;
}

const WORDS_PAGE_SIZE = 10;

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
        const searchSession = user ? await getBotSession<WordSearchSession>(ctx.db, user.user_id, 'word_search') : null;
        if (user && searchSession?.data.awaiting) {
            const query = ctx.message.text.trim();
            await saveBotSession<WordSearchSession>(ctx.db, user.user_id, 'word_search', { awaiting: false, query }, 30);
            await showSearchWords(ctx, user.user_id, query, 0);
            return;
        }

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

        await deleteBotSession(ctx.db, user.user_id, 'word_search');
        await showUserWords(ctx, user.user_id, 0);
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^list_words_(\d+)$/, async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }
        await deleteBotSession(ctx.db, user.user_id, 'word_search');
        await showUserWords(ctx, user.user_id, Number(ctx.match[1]));
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery('word_search_start', async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }
        await saveBotSession<WordSearchSession>(ctx.db, user.user_id, 'word_search', { awaiting: true, query: null }, 10);
        await replaceWithText(ctx, '🔍 اكتب كلمة للبحث', navigationKeyboard('list_words'));
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^word_search_page_(\d+)$/, async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }
        const session = await getBotSession<WordSearchSession>(ctx.db, user.user_id, 'word_search');
        if (!session?.data.query) {
            await showUserWords(ctx, user.user_id, 0);
            await ctx.answerCallbackQuery();
            return;
        }
        await showSearchWords(ctx, user.user_id, session.data.query, Number(ctx.match[1]));
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^select_words(?:_(\d+))?$/, async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }
        await ensureSelectionSession(ctx, user.user_id);
        await showSelectionPanel(ctx, user.user_id, Number(ctx.match[1] ?? 0));
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^word_select_toggle_(\d+)_(\d+)$/, async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }
        const wordId = Number(ctx.match[1]);
        const page = Number(ctx.match[2]);
        const word = await getWordById(ctx.db, wordId);
        if (!word || word.added_by !== user.user_id) {
            await ctx.answerCallbackQuery('الكلمة غير موجودة');
            return;
        }
        const session = await ensureSelectionSession(ctx, user.user_id);
        const selected = new Set(session.selectedIds);
        if (selected.has(wordId)) selected.delete(wordId);
        else selected.add(wordId);
        await saveSelectionSession(ctx, user.user_id, [...selected]);
        await showSelectionPanel(ctx, user.user_id, page);
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery('word_select_all', async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }
        const words = await getWordsByUser(ctx.db, user.user_id);
        await saveSelectionSession(ctx, user.user_id, words.map(word => word.word_id));
        await showSelectionPanel(ctx, user.user_id, 0);
        await ctx.answerCallbackQuery('تم تحديد كل كلماتك');
    });

    bot.callbackQuery('word_select_clear', async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }
        await saveSelectionSession(ctx, user.user_id, []);
        await showSelectionPanel(ctx, user.user_id, 0);
        await ctx.answerCallbackQuery('تم إلغاء التحديد');
    });

    bot.callbackQuery('word_delete_selected', async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }
        const session = await ensureSelectionSession(ctx, user.user_id);
        if (session.selectedIds.length === 0) {
            await replaceWithText(ctx, 'لم تحدد أي كلمة.', selectionActionsKeyboard());
            await ctx.answerCallbackQuery();
            return;
        }
        await replaceWithText(
            ctx,
            `هل تريد حذف ${session.selectedIds.length} كلمة؟`,
            new InlineKeyboard()
                .text('✅ نعم احذف', 'word_delete_selected_confirm')
                .text('❌ إلغاء', 'select_words_0')
        );
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery('word_delete_selected_confirm', async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }
        const session = await ensureSelectionSession(ctx, user.user_id);
        const deleted = await deleteWordsForUser(ctx.db, user.user_id, session.selectedIds);
        await saveSelectionSession(ctx, user.user_id, []);
        await replaceWithText(ctx, `تم حذف ${deleted} كلمة ✅`, selectionActionsKeyboard());
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery('word_delete_all', async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }
        const words = await getWordsByUser(ctx.db, user.user_id);
        await replaceWithText(
            ctx,
            `سيتم حذف كل كلماتك وعددها ${words.length}. هل أنت متأكد؟`,
            new InlineKeyboard()
                .text('✅ نعم احذف كل كلماتي', 'word_delete_all_confirm').row()
                .text('❌ إلغاء', 'select_words_0')
        );
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery('word_delete_all_confirm', async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }
        const deleted = await deleteAllWordsForUser(ctx.db, user.user_id);
        await saveSelectionSession(ctx, user.user_id, []);
        await replaceWithText(ctx, `تم حذف ${deleted} كلمة من حسابك ✅`, selectionActionsKeyboard());
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
        await showUserWords(ctx, user.user_id, 0);
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

async function showUserWords(ctx: BotContext, userId: number, page: number): Promise<void> {
    const totalWords = await countWordsByUser(ctx.db, userId);
    if (totalWords === 0) {
        await replaceWithText(
            ctx,
            '📭 لا توجد كلمات بعد.\nأضف كلمة بهذه الصيغة:\nHaus = بيت\nأو ارفع ملف CSV.',
            new InlineKeyboard()
                .text('📤 رفع CSV', 'upload_csv')
                .text('➕ إضافة كلمة', 'add_word').row()
                .text('🏠 الرئيسية', 'menu_main')
        );
        return;
    }

    const totalPages = Math.max(1, Math.ceil(totalWords / WORDS_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const visible = await getWordsByUserPaginated(ctx.db, userId, WORDS_PAGE_SIZE, safePage * WORDS_PAGE_SIZE);
    await replaceWithText(ctx, formatWordsPage('📋 *كلماتي*', visible, safePage, totalPages, totalWords), wordsPageKeyboard(visible, safePage, totalPages, false), 'Markdown');
}

async function showSearchWords(ctx: BotContext, userId: number, query: string, page: number): Promise<void> {
    const totalWords = await countSearchWordsByUser(ctx.db, userId, query);
    const totalPages = Math.max(1, Math.ceil(totalWords / WORDS_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const visible = totalWords > 0
        ? await searchWordsByUser(ctx.db, userId, query, WORDS_PAGE_SIZE, safePage * WORDS_PAGE_SIZE)
        : [];

    const text = totalWords === 0
        ? `🔍 *نتائج البحث*\n\nلا توجد نتائج لـ: ${query}`
        : formatWordsPage(`🔍 *نتائج البحث: ${query}*`, visible, safePage, totalPages, totalWords);
    await replaceWithText(ctx, text, wordsPageKeyboard(visible, safePage, totalPages, true), 'Markdown');
}

function formatWordsPage(title: string, words: Array<{ german: string; arabic: string }>, page: number, totalPages: number, totalWords: number): string {
    return `${title}\n\n` +
        `الصفحة: *${page + 1} / ${totalPages}*\n` +
        `عدد الكلمات: *${totalWords}*\n\n` +
        words.map((word, index) =>
            `${index + 1}. 🇩🇪 ${word.german}\n   🇮🇶 ${word.arabic}`
        ).join('\n\n');
}

function wordsPageKeyboard(words: Array<{ word_id: number; german: string; arabic: string }>, page: number, totalPages: number, search: boolean): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    words.forEach((word, index) => {
        keyboard.text(`${index + 1}. ${word.german} — ${word.arabic}`, `word_detail_${word.word_id}`).row();
    });

    if (page > 0) {
        keyboard.text('⬅️ السابق', search ? `word_search_page_${page - 1}` : `list_words_${page - 1}`);
    }
    if (page < totalPages - 1) {
        keyboard.text('التالي ➡️', search ? `word_search_page_${page + 1}` : `list_words_${page + 1}`);
    }
    if (page > 0 || page < totalPages - 1) keyboard.row();
    keyboard.text('🔍 بحث', 'word_search_start')
        .text('☑️ تحديد', `select_words_${page}`).row()
        .text('⬅️ رجوع', 'menu_words').text('🏠 الرئيسية', 'menu_main');
    return keyboard;
}

async function ensureSelectionSession(ctx: BotContext, userId: number): Promise<WordSelectionSession> {
    const session = await getBotSession<WordSelectionSession>(ctx.db, userId, 'word_selection');
    if (session) return session.data;
    const data: WordSelectionSession = { selectedIds: [] };
    await saveSelectionSession(ctx, userId, data.selectedIds);
    return data;
}

async function saveSelectionSession(ctx: BotContext, userId: number, selectedIds: number[]): Promise<void> {
    await saveBotSession<WordSelectionSession>(ctx.db, userId, 'word_selection', { selectedIds }, 120);
}

async function showSelectionPanel(ctx: BotContext, userId: number, page: number): Promise<void> {
    const session = await ensureSelectionSession(ctx, userId);
    const selected = new Set(session.selectedIds);
    const totalWords = await countWordsByUser(ctx.db, userId);
    const totalPages = Math.max(1, Math.ceil(totalWords / WORDS_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const visible = await getWordsByUserPaginated(ctx.db, userId, WORDS_PAGE_SIZE, safePage * WORDS_PAGE_SIZE);

    const text = visible.length === 0
        ? '☑️ *تحديد الكلمات*\n\nلا توجد كلمات.'
        : '☑️ *تحديد الكلمات*\n\n' + visible.map(word =>
            `${selected.has(word.word_id) ? '✅' : '☐'} ${word.german} — ${word.arabic}`
        ).join('\n');

    const keyboard = new InlineKeyboard();
    for (const word of visible) {
        keyboard.text(`${selected.has(word.word_id) ? '✅' : '☐'} ${word.german}`, `word_select_toggle_${word.word_id}_${safePage}`).row();
    }
    keyboard
        .text('✅ تحديد الكل', 'word_select_all')
        .text('❎ إلغاء التحديد', 'word_select_clear').row()
        .text('🗑 حذف المحدد', 'word_delete_selected').row();
    if (safePage > 0) keyboard.text('⬅️ السابق', `select_words_${safePage - 1}`);
    if (safePage < totalPages - 1) keyboard.text('التالي ➡️', `select_words_${safePage + 1}`);
    if (safePage > 0 || safePage < totalPages - 1) keyboard.row();
    keyboard.text('⬅️ رجوع للعرض', `list_words_${safePage}`).text('🏠 الرئيسية', 'menu_main');

    await replaceWithText(ctx, `${text}\n\nالمحدد: ${selected.size}\nصفحة ${safePage + 1}/${totalPages}`, keyboard, 'Markdown');
}

function selectionActionsKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('☑️ تحديد', 'select_words_0').row()
        .text('⬅️ رجوع', 'menu_words')
        .text('🏠 الرئيسية', 'menu_main');
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
