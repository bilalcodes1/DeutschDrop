import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context.js';
import { getBotSession, saveBotSession, deleteBotSession, type BotSession } from '../repositories/sessionRepository.js';
import { getUserByTelegramId } from '../repositories/userRepository.js';
import { getCollectionsByUser } from '../repositories/wordSharingRepository.js';
import { searchUserWords, searchCollectionWords, searchCollections, searchUsers } from '../repositories/searchRepository.js';
import { replaceWithText } from './wordPanel.js';
import { normalizeGermanSearch, normalizeArabicSearch, normalizeUserSearchText } from '../services/searchNormalization.js';
import { isAdminTelegramId } from '../services/adminAccess.js';

export interface GlobalSearchSession {
    searchType?: 'my_words' | 'collection' | 'user' | 'in_collection';
    query?: string;
    page: number;
    collectionId?: number;
}

const PAGE_LIMIT = 10;

export function registerSearchCommand(bot: Bot<BotContext>): void {
    
    bot.callbackQuery('global_search_start', async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;


        // Clear all text interaction sessions to prevent conflicts
        await deleteBotSession(ctx.db, user.user_id, 'word_edit');
        await deleteBotSession(ctx.db, user.user_id, 'add_word');
        await deleteBotSession(ctx.db, user.user_id, 'collection_add_word_direct');
        await deleteBotSession(ctx.db, user.user_id, 'collection_csv_upload');
        await deleteBotSession(ctx.db, user.user_id, 'collection_add_existing_words');
        
        // Clear and reset search session
        await deleteBotSession(ctx.db, user.user_id, 'global_search');
        await saveBotSession<GlobalSearchSession>(ctx.db, user.user_id, 'global_search', { page: 1 });


        const kb = new InlineKeyboard()
            .text('🔤 كلمة في كلماتي', 'gsearch_type:my_words')
            .text('📂 مجموعة', 'gsearch_type:collection').row()
            .text('👤 مستخدم', 'gsearch_type:user')
            .text('📚 داخل مجموعة', 'gsearch_type:in_collection').row()
            .text('🏠 الرئيسية', 'menu_main');

        await replaceWithText(ctx, '🔎 *ماذا تريد أن تبحث؟*', kb, 'Markdown');
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^gsearch_type:(.+)$/, async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;

        const type = ctx.match[1] as GlobalSearchSession['searchType'];
        
        await saveBotSession<GlobalSearchSession>(ctx.db, user.user_id, 'global_search', {
            searchType: type,
            page: 1
        });

        if (type === 'in_collection') {
            // Show user collections to pick from
            const cols = await getCollectionsByUser(ctx.db, user.user_id, 100, 0);
            if (cols.length === 0) {
                await replaceWithText(ctx, 'لا تملك أي مجموعة للبحث داخلها.', new InlineKeyboard().text('⬅️ رجوع', 'global_search_start').text('🏠 الرئيسية', 'menu_main'));
                await ctx.answerCallbackQuery();
                return;
            }

            const kb = new InlineKeyboard();
            for (const c of cols) {
                kb.text(`📚 ${c.title}`, `gsearch_col:${c.id}`).row();
            }
            kb.text('⬅️ رجوع', 'global_search_start').text('🏠 الرئيسية', 'menu_main');

            await replaceWithText(ctx, 'اختر المجموعة التي تريد البحث داخلها:', kb);
        } else {
            const hints: Record<string, string> = {
                'my_words': 'اكتب الكلمة للبحث في كلماتك:',
                'collection': 'اكتب اسم المجموعة:',
                'user': 'اكتب اسم المستخدم:'
            };
            const kb = new InlineKeyboard().text('⬅️ إلغاء', 'global_search_start');
            await replaceWithText(ctx, `🔎 ${hints[type!]}`, kb);
        }
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^gsearch_col:(\d+)$/, async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;

        const colId = parseInt(ctx.match[1], 10);
        const session = await getBotSession<GlobalSearchSession>(ctx.db, user.user_id, 'global_search');
        if (!session || session.data.searchType !== 'in_collection') {
            await ctx.answerCallbackQuery('الجلسة منتهية.');
            return;
        }

        session.data.collectionId = colId;
        await saveBotSession(ctx.db, user.user_id, 'global_search', session.data);

        const kb = new InlineKeyboard().text('⬅️ إلغاء', 'global_search_start');
        await replaceWithText(ctx, `🔎 اكتب الكلمة للبحث داخل المجموعة:`, kb);
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^gsearch_page:(prev|next)$/, async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;

        const session = await getBotSession<GlobalSearchSession>(ctx.db, user.user_id, 'global_search');
        if (!session || !session.data.query || !session.data.searchType) {
            await ctx.answerCallbackQuery('الجلسة منتهية.');
            return;
        }

        const action = ctx.match[1];
        if (action === 'next') session.data.page++;
        if (action === 'prev' && session.data.page > 1) session.data.page--;

        await saveBotSession(ctx.db, user.user_id, 'global_search', session.data);
        await executeGlobalSearch(ctx, user.user_id, session);
        await ctx.answerCallbackQuery();
    });

    bot.on('message:text', async (ctx, next) => {
        const handled = await handleGlobalSearchInput(ctx, ctx.message.text);
        if (!handled) {
            await next();
        }
    });
}

export async function handleGlobalSearchInput(ctx: BotContext, text: string): Promise<boolean> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!user) return false;

    const session = await getBotSession<GlobalSearchSession>(ctx.db, user.user_id, 'global_search');
    if (!session || !session.data.searchType) return false;

    if (session.data.searchType === 'in_collection' && !session.data.collectionId) {
        return false; // Still waiting for collection selection
    }

    const cleanText = text.trim();
    if (!cleanText) {
        await ctx.reply('⚠️ لا يمكن أن يكون نص البحث فارغاً.');
        return true;
    }

    if (cleanText.length > 80) {
        await ctx.reply('⚠️ نص البحث طويل جداً (أقصى حد 80 حرف).');
        return true;
    }

    // Normalize safely without crashing
    let hasValidChars = false;
    try {
        const testG = normalizeGermanSearch(cleanText);
        const testA = normalizeArabicSearch(cleanText);
        if (testG.length > 0 || testA.length > 0) hasValidChars = true;
    } catch {
        hasValidChars = false;
    }

    if (!hasValidChars && session.data.searchType !== 'user' && session.data.searchType !== 'collection') {
        await ctx.reply('⚠️ النص لا يحتوي على حروف قابلة للبحث. الرجاء كتابة حروف عربية أو ألمانية.');
        return true;
    }

    session.data.query = cleanText;
    session.data.page = 1;
    await saveBotSession(ctx.db, user.user_id, 'global_search', session.data);
    
    await executeGlobalSearch(ctx, user.user_id, session);
    return true;
}

async function executeGlobalSearch(ctx: BotContext, userId: number, session: BotSession<GlobalSearchSession>): Promise<void> {
    const query = session.data.query!;
    const offset = (session.data.page - 1) * PAGE_LIMIT;
    let resultsMessage = `🔎 *نتائج البحث عن:* ${query}\n\n`;
    const kb = new InlineKeyboard();

    try {
        if (session.data.searchType === 'my_words') {
            const words = await searchUserWords(ctx.db, userId, query, PAGE_LIMIT + 1, offset);
            const hasNext = words.length > PAGE_LIMIT;
            const displayWords = words.slice(0, PAGE_LIMIT);

            if (displayWords.length === 0) {
                resultsMessage = `ما لكيت نتائج عن "${query}". جرّب تكتب جزء من الكلمة أو بدون تشكيل.`;
            } else {
                displayWords.forEach((w, i) => {
                    const ex = w.example ? `\n   _${w.example}_` : '';
                    resultsMessage += `${offset + i + 1}. *${w.german}* — ${w.arabic}${ex}\n\n`;
                });
            }
            buildPaginationKeyboard(kb, session.data.page, hasNext);
        }
        else if (session.data.searchType === 'in_collection') {
            const words = await searchCollectionWords(ctx.db, session.data.collectionId!, userId, query, PAGE_LIMIT + 1, offset);
            const hasNext = words.length > PAGE_LIMIT;
            const displayWords = words.slice(0, PAGE_LIMIT);

            if (displayWords.length === 0) {
                resultsMessage = `ما لكيت نتائج عن "${query}" في هذه المجموعة.`;
            } else {
                displayWords.forEach((w, i) => {
                    const ex = w.example ? `\n   _${w.example}_` : '';
                    resultsMessage += `${offset + i + 1}. *${w.german}* — ${w.arabic}${ex}\n\n`;
                });
                kb.text('📂 فتح المجموعة', `collection:view:${session.data.collectionId}:page:1`).row();
                kb.text('⚔️ تحدي على المجموعة', `challenge:collection:${session.data.collectionId}`).row();
            }
            buildPaginationKeyboard(kb, session.data.page, hasNext);
        }
        else if (session.data.searchType === 'collection') {
            const cols = await searchCollections(ctx.db, userId, query, PAGE_LIMIT + 1, offset);
            const hasNext = cols.length > PAGE_LIMIT;
            const displayCols = cols.slice(0, PAGE_LIMIT);

            if (displayCols.length === 0) {
                resultsMessage = `لم يتم العثور على مجموعات تطابق "${query}".`;
            } else {
                displayCols.forEach((c, i) => {
                    const owner = c.owner_user_id === userId ? '(أنت المالك)' : `(المالك: ${c.owner_name ?? 'مجهول'})`;
                    const vis = c.visibility === 'public' ? '🌍 عام' : '🔒 خاص';
                    resultsMessage += `${offset + i + 1}. 📚 *${c.title}*\n   الوصف: ${c.description ?? 'بدون وصف'}\n   ${vis} | ${owner}\n\n`;
                    kb.text(`🗂 فتح: ${c.title}`, `collection:view:${c.id}:page:1`).row();
                });
            }
            buildPaginationKeyboard(kb, session.data.page, hasNext);
        }
        else if (session.data.searchType === 'user') {
            const normalized = normalizeUserSearchText(query);
            if (!normalized || normalized.length < 2) {
                await ctx.reply('اكتب حرفين على الأقل للبحث عن مستخدم.');
                return;
            }

            const isAdmin = isAdminTelegramId(ctx.env, ctx.from?.id);
            const users = await searchUsers(ctx.db, query, PAGE_LIMIT + 1, offset, isAdmin);
            const hasNext = users.length > PAGE_LIMIT;
            const displayUsers = users.slice(0, PAGE_LIMIT);

            if (displayUsers.length === 0) {
                resultsMessage = `ما لكيت نتائج. جرّب تكتب جزء من الاسم.`;
            } else {
                resultsMessage = `نتائج البحث عن مستخدمين:\n\n`;
                if (isAdmin) {
                    resultsMessage = `🔐 وضع الأدمن\n` + resultsMessage;
                }
                
                displayUsers.forEach((u, i) => {
                    const safeName = u.display_name || u.name || [u.first_name, u.last_name].filter(Boolean).join(' ') || "مستخدم بدون اسم";
                    if (isAdmin) {
                        resultsMessage += `${offset + i + 1}. ${safeName} (@${u.username ?? '-'}, ID: ${u.telegram_id ?? '-'}, UID: ${u.user_id})\n`;
                    } else {
                        resultsMessage += `${offset + i + 1}. ${safeName}\n   عضو\n\n`;
                    }
                });
            }
            buildPaginationKeyboard(kb, session.data.page, hasNext);
        }

        kb.row().text('🔎 بحث جديد', 'global_search_start').text('🏠 الرئيسية', 'menu_main');
        
        const isUserSearch = session.data.searchType === 'user';
        await ctx.reply(resultsMessage, { reply_markup: kb, ...(isUserSearch ? {} : { parse_mode: 'Markdown' }) });

    } catch (e) {
        console.error('Search error', e);
        await ctx.reply('حدث خطأ أثناء البحث.');
    }
}

function buildPaginationKeyboard(kb: InlineKeyboard, page: number, hasNext: boolean) {
    if (page > 1 || hasNext) {
        if (page > 1) kb.text('⬅️ السابق', 'gsearch_page:prev');
        kb.text(`صفحة ${page}`, 'ignore');
        if (hasNext) kb.text('التالي ➡️', 'gsearch_page:next');
        kb.row();
    }
}
