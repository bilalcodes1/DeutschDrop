import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import {
    createWordAndAssignToUser,
    countSearchWordsByUser,
    countWordsByUser,
    deleteWordForUser,
    deleteWordsForUser,
    DUPLICATE_WORD_ERROR,
    getPeerWordSuggestions,
    getWordById,
    getWordsByUserPaginated,
    getWordsByUserPaginatedFallback,
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
    step: 'german' | 'arabic';
}

interface WordEditSessionData {
    wordId: number;
}

interface WordSelectionSession {
    selectedIds: number[];
    selected_word_ids?: number[];
    user_id?: number;
    page?: number;
    mode?: 'word_bulk_select';
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
        if (user && await getBotSession(ctx.db, user.user_id, 'train')) {
            return next();
        }
        if (user && await getBotSession(ctx.db, user.user_id, 'challenge')) {
            await ctx.reply('⚔️ عندك تحدي فعال. استخدم أزرار التحدي الحالية أو ارجع للرئيسية.');
            return;
        }
        if (user && (
            await getBotSession(ctx.db, user.user_id, 'admin_source_add') ||
            await getBotSession(ctx.db, user.user_id, 'admin_source_edit') ||
            await getBotSession(ctx.db, user.user_id, 'profile_rename') ||
            await getBotSession(ctx.db, user.user_id, 'collection_create') ||
            await getBotSession(ctx.db, user.user_id, 'collection_add_word_direct') ||
            await getBotSession(ctx.db, user.user_id, 'collection_csv_upload') ||
            await getBotSession(ctx.db, user.user_id, 'collection_add_existing_words') ||
            await getBotSession(ctx.db, user.user_id, 'shared_word_search')
        )) {
            return next();
        }

        const searchSession = user ? await getBotSession<WordSearchSession>(ctx.db, user.user_id, 'word_search') : null;
        if (user && searchSession?.data.awaiting) {
            const query = ctx.message.text.trim();
            if (query.length < 2) {
                await ctx.reply('اكتب حرفين أو أكثر للبحث.', { reply_markup: searchEmptyKeyboard() });
                return;
            }
            await saveBotSession<WordSearchSession>(ctx.db, user.user_id, 'word_search', { awaiting: false, query }, 30);
            await showSearchWords(ctx, user.user_id, query, 0);
            return;
        }

        const pending = user ? await getBotSession<AddWordSessionData>(ctx.db, user.user_id, 'add_word') : null;
        const editSession = user ? await getBotSession<WordEditSessionData>(ctx.db, user.user_id, 'word_edit') : null;

        if (!pending && !editSession) {
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

        if (editSession) {
            if (!user) {
                await ctx.reply('يرجى استخدام /start أولاً.');
                return;
            }
            await handleWordEditText(ctx, user.user_id, editSession.data.wordId, text);
            return;
        }

        if (pending?.data.step === 'german') {
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
        } else if (pending?.data.step === 'arabic' && pending.data.german) {
            if (!user) {
                await ctx.reply('يرجى استخدام /start أولاً.');
                return;
            }

            try {
                const wordId = await createWordAndAssignToUser(ctx.db, pending.data.german, text, null, user.user_id);
                await addXp(ctx.db, user.user_id, 5, {
                    reason: 'new_word',
                    sourceType: 'word_addition',
                });
                await incrementDailyTask(ctx, user.user_id, 'learn_words');
                await checkAchievements(ctx, user.user_id);
                await ctx.reply(
                    `✅ تمت الإضافة!\n\n🇩🇪 ${pending.data.german}\n🇦🇪 ${text}`,
                    { reply_markup: wordAddedKeyboard() }
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
        }
    });

    bot.callbackQuery(/^(list_words|words:list|words_list|word_list|manage_words:list)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const telegramId = ctx.from?.id ?? 0;
        const user = await getUserByTelegramId(ctx.db, telegramId);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }

        await deleteBotSession(ctx.db, user.user_id, 'word_search');
        await showUserWords(ctx, user.user_id, 1, ctx.callbackQuery?.data);
    });

    bot.callbackQuery('list_words_retry', async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }
        await showUserWords(ctx, user.user_id, 1, ctx.callbackQuery?.data);
    });

    bot.callbackQuery(/^list_words_(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }
        await deleteBotSession(ctx.db, user.user_id, 'word_search');
        await showUserWords(ctx, user.user_id, parseSafePage(ctx.match[1]) + 1, ctx.callbackQuery?.data);
    });

    bot.callbackQuery(/^words:page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        await deleteBotSession(ctx.db, user.user_id, 'word_search');
        await showUserWords(ctx, user.user_id, parseSafePage(ctx.match[1]), ctx.callbackQuery?.data);
    });

    bot.callbackQuery(/^words:list:page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        await deleteBotSession(ctx.db, user.user_id, 'word_search');
        await showUserWords(ctx, user.user_id, normalizeRequestedPage(Number(ctx.match[1])), ctx.callbackQuery?.data);
    });

    bot.callbackQuery('word_search_start', async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }
        await saveBotSession<WordSearchSession>(ctx.db, user.user_id, 'word_search', { awaiting: true, query: null }, 10);
        await replaceWithText(
            ctx,
            '🔍 اكتب جزءاً من الكلمة الألمانية أو العربية:\n\nمثال:\nstu\nمدرس\nAuto\nسيار',
            navigationKeyboard('list_words')
        );
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

    bot.callbackQuery(/^(?:words:select:page:|select_words_?|bulk_select_?|manage_words_select_?|word_select_?)(\d+)?$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }
        const page = normalizeRequestedPage(Number(ctx.match[1] ?? 1));
        await ensureSelectionSession(ctx, user.user_id, page);
        await runWordCallback(ctx, user.user_id, 'bulk_select', undefined, page, () => showSelectionPanel(ctx, user.user_id, page));
    });

    bot.callbackQuery(/^(?:words:select:toggle:|word_select_toggle_)(\d+)(?::page:|_)(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }
        const wordId = Number(ctx.match[1]);
        const page = normalizeRequestedPage(Number(ctx.match[2]));
        await runWordCallback(ctx, user.user_id, 'toggle_select', wordId, page, async () => {
            const word = await getWordById(ctx.db, wordId);
            if (!word || word.added_by !== user.user_id) {
                await replaceWithText(ctx, '⚠️ لم أجد هذه الكلمة في بنك كلماتك.', safeWordErrorKeyboard(page));
                return;
            }
            const session = await ensureSelectionSession(ctx, user.user_id, page);
            const selected = new Set(session.selectedIds);
            if (selected.has(wordId)) selected.delete(wordId);
            else selected.add(wordId);
            await saveSelectionSession(ctx, user.user_id, [...selected], page);
            await showSelectionPanel(ctx, user.user_id, page);
        });
    });

    bot.callbackQuery(/^(?:words:select:all:|word_select_all_?)(\d+)?$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }
        const page = normalizeRequestedPage(Number(ctx.match[1] ?? 1));
        await runWordCallback(ctx, user.user_id, 'select_all', undefined, page, async () => {
            const visible = await getWordsByUserPaginated(ctx.db, user.user_id, WORDS_PAGE_SIZE, (page - 1) * WORDS_PAGE_SIZE);
            const session = await ensureSelectionSession(ctx, user.user_id, page);
            const selected = new Set(session.selectedIds);
            for (const word of visible) selected.add(word.word_id);
            await saveSelectionSession(ctx, user.user_id, [...selected], page);
            await showSelectionPanel(ctx, user.user_id, page);
        });
    });

    bot.callbackQuery(/^(?:words:select:clear:|word_select_clear_?)(\d+)?$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }
        const page = normalizeRequestedPage(Number(ctx.match[1] ?? 1));
        await saveSelectionSession(ctx, user.user_id, [], page);
        await showSelectionPanel(ctx, user.user_id, page);
    });

    bot.callbackQuery(/^(?:words:select:delete_confirm:|word_delete_selected_?)(\d+)?$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }
        const page = normalizeRequestedPage(Number(ctx.match[1] ?? 1));
        const session = await ensureSelectionSession(ctx, user.user_id, page);
        if (session.selectedIds.length === 0) {
            await replaceWithText(ctx, 'لم تحدد أي كلمة بعد.', selectionActionsKeyboard(page));
            return;
        }
        await replaceWithText(
            ctx,
            `هل تريد حذف ${session.selectedIds.length} كلمة؟`,
            new InlineKeyboard()
                .text('✅ حذف المحدد', `words:select:delete_do:${page}`).row()
                .text('❌ إلغاء', `words:select:page:${page}`)
        );
    });

    bot.callbackQuery(/^(?:words:select:delete_do:|word_delete_selected_confirm_?)(\d+)?$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }
        const page = normalizeRequestedPage(Number(ctx.match[1] ?? 1));
        await runWordCallback(ctx, user.user_id, 'delete_selected', undefined, page, async () => {
            const session = await ensureSelectionSession(ctx, user.user_id, page);
            const deleted = await deleteWordsForUser(ctx.db, user.user_id, session.selectedIds);
            await saveSelectionSession(ctx, user.user_id, [], page);
            await replaceWithText(ctx, `تم حذف ${deleted} كلمة ✅`, selectionActionsKeyboard(page));
        });
    });

    bot.callbackQuery(/^(?:word_detail_|words:detail:)(\d+)(?::(page|search):(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const wordId = parseInt(ctx.match[1], 10);
        const returnMode = ctx.match[2];
        const page = normalizeRequestedPage(Number(ctx.match[3] ?? 1));
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (user) await deleteBotSession(ctx.db, user.user_id, 'word_edit');
        if (!user) return;
        await runWordCallback(ctx, user.user_id, 'word_details', wordId, page, async () => {
            if (!Number.isInteger(wordId) || wordId <= 0) {
                await replaceWithText(ctx, '⚠️ لم أجد هذه الكلمة.', safeWordErrorKeyboard(page));
                return;
            }
            const word = await getWordById(ctx.db, wordId);
            if (!word || word.added_by !== user.user_id) {
                await replaceWithText(ctx, '⚠️ لم أجد هذه الكلمة في بنك كلماتك.', safeWordErrorKeyboard(page));
                return;
            }
            const backCallback = returnMode === 'search'
                ? `word_search_page_${page - 1}`
                : `words:list:page:${page}`;
            await showWordDetailPanel(ctx, wordId, undefined, backCallback);
        });
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

        await showEditWordPrompt(ctx, user.user_id, wordId);
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^cancel_word_edit_(\d+)$/, async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        const wordId = Number(ctx.match[1]);
        if (user) await deleteBotSession(ctx.db, user.user_id, 'word_edit');
        await ctx.answerCallbackQuery('تم إلغاء التعديل');
        await showWordDetailPanel(ctx, wordId, 'تم إلغاء التعديل.');
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

async function showEditWordPrompt(ctx: BotContext, userId: number, wordId: number, error?: string): Promise<void> {
    const word = await getWordById(ctx.db, wordId);
    if (!word || word.added_by !== userId) {
        await replaceWithText(ctx, '⚠️ لم أجد هذه الكلمة في بنك كلماتك.', navigationKeyboard('list_words'));
        return;
    }

    await saveBotSession<WordEditSessionData>(ctx.db, userId, 'word_edit', { wordId }, 30);
    await replaceWithText(
        ctx,
        formatEditWordPrompt(word, error),
        editWordKeyboard(wordId),
        'Markdown'
    );
}

function formatEditWordPrompt(word: { german: string; arabic: string; example: string | null }, error?: string): string {
    const copyLine = word.example
        ? `${word.german},${word.arabic},${word.example}`
        : `${word.german} = ${word.arabic}`;
    return (error ? `⚠️ ${error}\n\n` : '') +
        `✏️ *تعديل الكلمة*\n\n` +
        `انسخ السطر وعدّله ثم أرسله:\n\n` +
        `${copyLine}\n\n` +
        `الألماني الحالي: ${word.german}\n` +
        `العربي الحالي: ${word.arabic}` +
        (word.example ? `\nالمثال الحالي: ${word.example}` : '');
}

function editWordKeyboard(wordId: number): InlineKeyboard {
    return new InlineKeyboard()
        .text('❌ إلغاء التعديل', `cancel_word_edit_${wordId}`).row()
        .text('⬅️ رجوع', `word_detail_${wordId}`)
        .text('🏠 الرئيسية', 'menu_main');
}

async function handleWordEditText(ctx: BotContext, userId: number, wordId: number, text: string): Promise<void> {
    const word = await getWordById(ctx.db, wordId);
    if (!word || word.added_by !== userId) {
        await deleteBotSession(ctx.db, userId, 'word_edit');
        await ctx.reply('⚠️ لم أجد هذه الكلمة في بنك كلماتك.', { reply_markup: mainMenuKeyboard() });
        return;
    }

    const parsed = parseWordInput(text);
    if (!parsed) {
        await showEditWordPrompt(ctx, userId, wordId, 'الصيغة غير صحيحة. عدّل السطر الحالي ثم أرسله مرة ثانية.');
        return;
    }

    try {
        const updated = await updateWordForUser(ctx.db, userId, wordId, parsed.german, parsed.arabic, parsed.example);
        if (!updated) {
            await showEditWordPrompt(ctx, userId, wordId, 'لم أجد هذه الكلمة في بنك كلماتك.');
            return;
        }
        await deleteBotSession(ctx.db, userId, 'word_edit');
        await showWordDetailPanel(ctx, wordId, '✅ تم تعديل الكلمة.');
    } catch (error) {
        if ((error as Error).message === DUPLICATE_WORD_ERROR) {
            await showEditWordPrompt(ctx, userId, wordId, 'لا يمكن التعديل: الكلمة الألمانية موجودة مسبقاً في بنك كلماتك.');
            return;
        }
        throw error;
    }
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
        await addXp(ctx.db, user.user_id, 5, {
            reason: 'new_word',
            sourceType: 'word_addition',
            sourceId: wordId.toString(),
        });
        await incrementDailyTask(ctx, user.user_id, 'learn_words');
        await checkAchievements(ctx, user.user_id);
        await ctx.reply(`✅ تمت الإضافة!\n\n🇩🇪 ${german}\n🇦🇪 ${arabic}`, { reply_markup: wordAddedKeyboard() });
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

async function showUserWords(ctx: BotContext, userId: number, page: number | undefined, callbackData?: string): Promise<void> {
    const safeRequestedPage = normalizeRequestedPage(page);
    try {
        const totalWords = await loadWordCountWithLogging(ctx, userId, safeRequestedPage, callbackData);
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
        const safePage = Math.min(safeRequestedPage, totalPages);
        const offset = (safePage - 1) * WORDS_PAGE_SIZE;
        const visible = await loadWordsPageWithFallback(ctx, userId, WORDS_PAGE_SIZE, offset, safePage, callbackData);
        await replaceWithText(ctx, formatWordsPage('📋 كلماتي', visible, safePage, totalPages, totalWords), wordsPageKeyboard(visible, safePage, totalPages, false));
    } catch (error) {
        logWordListFailure({ userId, page: safeRequestedPage, limit: WORDS_PAGE_SIZE, callbackData, step: 'render', error });
        const isAdmin = ctx.env.ADMIN_TELEGRAM_IDS?.split(',').map(id => id.trim()).includes(String(ctx.from?.id));
        const errorText = error instanceof Error ? error.message.slice(0, 160) : 'unknown';
        await replaceWithText(
            ctx,
            'تعذر تحميل الكلمات حالياً.' +
            (isAdmin ? `\n\nسبب تقني مختصر:\n${errorText}` : ''),
            wordListErrorKeyboard(Boolean(isAdmin))
        );
    }
}

async function showSearchWords(ctx: BotContext, userId: number, query: string, page: number): Promise<void> {
    const totalWords = await countSearchWordsByUser(ctx.db, userId, query);
    const totalPages = Math.max(1, Math.ceil(totalWords / WORDS_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const visible = totalWords > 0
        ? await searchWordsByUser(ctx.db, userId, query, WORDS_PAGE_SIZE, safePage * WORDS_PAGE_SIZE)
        : [];

    const text = totalWords === 0
        ? `لم أجد كلمة قريبة من بحثك.\nجرّب جزءاً آخر من الكلمة.`
        : formatWordsPage(`🔍 نتائج البحث عن: ${query}`, visible, safePage + 1, totalPages, totalWords);
    await replaceWithText(ctx, text, wordsPageKeyboard(visible, safePage + 1, totalPages, true));
}

function formatWordsPage(title: string, words: Array<{ german: string; arabic: string }>, page: number, totalPages: number, totalWords: number): string {
    return `${title}\n\n` +
        `عدد الكلمات: ${totalWords}\n` +
        `الصفحة: ${page}/${totalPages}\n\n` +
        words.map((word, index) =>
            `${index + 1}. 🇩🇪 ${word.german}\n   🇮🇶 ${word.arabic}`
        ).join('\n\n');
}

function wordsPageKeyboard(words: Array<{ word_id: number; german: string; arabic: string }>, page: number, totalPages: number, search: boolean): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    words.forEach((word, index) => {
        const detailCallback = search
            ? `words:detail:${word.word_id}:search:${page}`
            : `words:detail:${word.word_id}:page:${page}`;
        keyboard.text(`${index + 1}. ${word.german} — ${word.arabic}`, detailCallback).row();
    });

    if (page > 1) {
        keyboard.text('⬅️ السابق', search ? `word_search_page_${page - 2}` : `words:page:${page - 1}`);
    }
    if (page < totalPages) {
        keyboard.text('التالي ➡️', search ? `word_search_page_${page}` : `words:page:${page + 1}`);
    }
    if (page > 1 || page < totalPages) keyboard.row();
    if (search) {
        keyboard.text('🔍 بحث جديد', 'word_search_start').row()
            .text('📋 كل الكلمات', 'list_words')
            .text('🏠 الرئيسية', 'menu_main');
        return keyboard;
    }
    keyboard.text('🔍 بحث', 'word_search_start')
        .text('☑️ تحديد', `words:select:page:${page}`).row()
        .text('👥 كلمات المستخدمين', 'shared_users:page:1').row()
        .text('🗂 مجموعات الكلمات', 'collections:menu').row()
        .text('📥 العروض المشتركة', 'shared_offers:page:1').row()
        .text('🗑 حذف كل كلماتي', 'user_delete:words').row()
        .text('➕ إضافة كلمة', 'add_word')
        .text('📤 رفع CSV', 'upload_csv').row()
        .text('⬅️ رجوع', 'menu_words')
        .text('🏠 الرئيسية', 'menu_main');
    return keyboard;
}

function searchEmptyKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('🔍 بحث جديد', 'word_search_start')
        .text('📋 كل الكلمات', 'list_words').row()
        .text('🏠 الرئيسية', 'menu_main');
}

async function ensureSelectionSession(ctx: BotContext, userId: number, page = 1): Promise<WordSelectionSession> {
    const session = await getBotSession<WordSelectionSession>(ctx.db, userId, 'word_selection');
    if (session) return session.data;
    const data: WordSelectionSession = { selectedIds: [], selected_word_ids: [], user_id: userId, page, mode: 'word_bulk_select' };
    await saveSelectionSession(ctx, userId, data.selectedIds, page);
    return data;
}

async function saveSelectionSession(ctx: BotContext, userId: number, selectedIds: number[], page = 1): Promise<void> {
    await saveBotSession<WordSelectionSession>(ctx.db, userId, 'word_selection', {
        selectedIds,
        selected_word_ids: selectedIds,
        user_id: userId,
        page,
        mode: 'word_bulk_select',
    }, 120);
}

async function showSelectionPanel(ctx: BotContext, userId: number, page: number): Promise<void> {
    const session = await ensureSelectionSession(ctx, userId, page);
    const selected = new Set(session.selectedIds);
    const totalWords = await countWordsByUser(ctx.db, userId);
    const totalPages = Math.max(1, Math.ceil(totalWords / WORDS_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 1), totalPages);
    const visible = totalWords > 0 ? await getWordsByUserPaginated(ctx.db, userId, WORDS_PAGE_SIZE, (safePage - 1) * WORDS_PAGE_SIZE) : [];

    const text = visible.length === 0
        ? '☑️ وضع التحديد\n\n📭 لا توجد كلمات بعد.'
        : '☑️ وضع التحديد\n\nاختر الكلمات التي تريد حذفها أو إدارتها:\n\n' + visible.map(word =>
            `${selected.has(word.word_id) ? '☑' : '☐'} ${word.german} — ${word.arabic}`
        ).join('\n');

    const keyboard = new InlineKeyboard();
    for (const word of visible) {
        keyboard.text(`${selected.has(word.word_id) ? '☑' : '☐'} ${word.german}`, `words:select:toggle:${word.word_id}:page:${safePage}`).row();
    }
    keyboard
        .text('✅ حذف المحدد', `words:select:delete_confirm:${safePage}`).row()
        .text('☑️ تحديد الكل في الصفحة', `words:select:all:${safePage}`).row()
        .text('🧹 إلغاء التحديد', `words:select:clear:${safePage}`).row();
    if (safePage > 1) keyboard.text('⬅️ السابق', `words:select:page:${safePage - 1}`);
    if (safePage < totalPages) keyboard.text('التالي ➡️', `words:select:page:${safePage + 1}`);
    if (safePage > 1 || safePage < totalPages) keyboard.row();
    keyboard.text('⬅️ رجوع للعرض', `words:list:page:${safePage}`).text('🏠 الرئيسية', 'menu_main');

    await replaceWithText(ctx, `${text}\n\nالمحدد: ${selected.size}\nصفحة ${safePage}/${totalPages}`, keyboard);
}

function selectionActionsKeyboard(page = 1): InlineKeyboard {
    return new InlineKeyboard()
        .text('☑️ تحديد', `words:select:page:${page}`).row()
        .text('🗑 حذف كل كلماتي', 'user_delete:words').row()
        .text('⬅️ رجوع', 'menu_words')
        .text('🏠 الرئيسية', 'menu_main');
}

function normalizeRequestedPage(page: number | undefined): number {
    const value = Number(page);
    if (!Number.isFinite(value) || Number.isNaN(value)) return 1;
    return Math.max(1, Math.floor(value));
}

async function loadWordCountWithLogging(ctx: BotContext, userId: number, page: number, callbackData?: string): Promise<number> {
    try {
        return await countWordsByUser(ctx.db, userId);
    } catch (error) {
        logWordListFailure({ userId, page, limit: WORDS_PAGE_SIZE, callbackData, step: 'count', error });
        throw error;
    }
}

async function loadWordsPageWithFallback(ctx: BotContext, userId: number, limit: number, offset: number, page: number, callbackData?: string) {
    try {
        return await getWordsByUserPaginated(ctx.db, userId, limit, offset);
    } catch (error) {
        logWordListFailure({ userId, page, limit, callbackData, step: 'query', error });
        return getWordsByUserPaginatedFallback(ctx.db, userId, limit, offset);
    }
}

function logWordListFailure(input: {
    userId: number;
    page: number;
    limit: number;
    callbackData?: string;
    step: 'count' | 'query' | 'render';
    error: unknown;
}): void {
    const error = input.error instanceof Error ? input.error : new Error('unknown');
    console.warn('word_list_load_failed', {
        userId: input.userId,
        page: input.page,
        limit: input.limit,
        callbackData: input.callbackData,
        step: input.step,
        errorName: error.name,
        errorMessage: error.message.slice(0, 200),
    });
}

async function runWordCallback(
    ctx: BotContext,
    userId: number,
    action: string,
    wordId: number | undefined,
    page: number,
    run: () => Promise<void>
): Promise<void> {
    try {
        await run();
    } catch (error) {
        logWordCallbackFailure({
            userId,
            callbackData: ctx.callbackQuery?.data,
            action,
            wordId,
            page,
            error,
        });
        const errorMessage = error instanceof Error ? error.message.slice(0, 160) : 'unknown';
        const debug = isCurrentUserAdmin(ctx) ? `\n\nDebug: ${errorMessage}` : '';
        await replaceWithText(ctx, `حدث خطأ بسيط، جرّب مرة ثانية.${debug}`, safeWordErrorKeyboard(page));
    }
}

function logWordCallbackFailure(input: {
    userId: number;
    callbackData?: string;
    action: string;
    wordId?: number;
    page?: number;
    error: unknown;
}): void {
    const error = input.error instanceof Error ? input.error : new Error('unknown');
    console.warn('word_callback_failed', {
        userId: input.userId,
        callbackData: input.callbackData,
        action: input.action,
        wordId: input.wordId,
        page: input.page,
        errorName: error.name,
        errorMessage: error.message.slice(0, 200),
    });
}

function safeWordErrorKeyboard(page = 1): InlineKeyboard {
    return new InlineKeyboard()
        .text('🔄 إعادة المحاولة', `words:list:page:${page}`).row()
        .text('📂 كلماتي', `words:list:page:${page}`)
        .text('🏠 الرئيسية', 'menu_main');
}

function isCurrentUserAdmin(ctx: BotContext): boolean {
    return ctx.env.ADMIN_TELEGRAM_IDS?.split(',').map(id => id.trim()).includes(String(ctx.from?.id)) ?? false;
}

function wordListErrorKeyboard(isAdmin: boolean): InlineKeyboard {
    const keyboard = new InlineKeyboard()
        .text('🔄 إعادة المحاولة', 'list_words_retry').row()
        .text('🏠 الرئيسية', 'menu_main');
    if (isAdmin) keyboard.row().text('🛠 فحص قاعدة البيانات', 'admin_db_check');
    return keyboard;
}

function parseSafePage(value: string | undefined): number {
    const page = Number(value);
    return Number.isFinite(page) && page >= 0 ? Math.floor(page) : 0;
}

function wordAddedKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('➕ إضافة كلمة أخرى', 'add_word').row()
        .text('📂 كلماتي', 'list_words').row()
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
