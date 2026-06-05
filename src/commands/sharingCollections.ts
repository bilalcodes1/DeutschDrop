import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import { getChallengeCandidates, getUserByTelegramId } from '../repositories/userRepository';
import { copyWordToUser, countSearchWordsByUser, countWordsByUser, getWordById, getWordsByUserPaginated, searchDuplicateWordForUser } from '../repositories/wordRepository';
import {
    addWordsToCollection,
    countIncomingSharedWordOffers,
    copyWordsToUser,
    countCollectionsByUser,
    countPublicCollections,
    countPublicWordUsers,
    createSharedWordOffer,
    createWordCollection,
    getCollectionById,
    getCollectionsByUser,
    getCollectionWords,
    getIncomingSharedWordOffers,
    getPublicCollections,
    getPublicWordOwner,
    getPublicWordUsers,
    getSharedWordOffer,
    isSharedWordOfferExpired,
    searchOtherUserWords,
    updateSharedWordOfferStatus,
} from '../repositories/wordSharingRepository';
import { displayUserName, sendTelegramMessage } from '../services/notifications';
import { replaceWithText } from './wordPanel';
import { mainMenuKeyboard } from './menu';

const PAGE_SIZE = 10;

interface ShareSelectionSession {
    sourceUserId: number;
    targetUserId: number;
    selectedWordIds: number[];
    page: number;
    createdAt: string;
}

interface CollectionCreateSession {
    step: 'title' | 'description' | 'select_words';
    title?: string;
    description?: string | null;
    selectedIds?: number[];
    page?: number;
}

interface ShareSearchSession {
    ownerUserId?: number;
    collectionSearch?: boolean;
    userSearch?: boolean;
}

interface SharedSourceUserStatus {
    user_id: number;
    display_name: string | null;
    name: string | null;
    is_banned: number;
    is_deleted: number;
    words_count: number;
}

interface SharedSelectionDiagnostics {
    targetUserId: number;
    sourceUserId: number;
    parsedSourceUserId: number | null;
    page: number;
    parsedPage: number;
    callbackData?: string;
    step: 'parse_callback' | 'load_source_user' | 'count_source_words' | 'load_source_words' | 'create_selection_session' | 'render_selection' | 'edit_message';
    sourceUserFound?: boolean;
    sourceUserBanned?: boolean;
    sourceUserDeleted?: boolean;
    wordsCount?: number;
    sessionCreated?: boolean;
}

export function registerSharingCollectionsCommand(bot: Bot<BotContext>): void {
    bot.on('message:text', async (ctx, next) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return next();

        const collectionSession = await getBotSession<CollectionCreateSession>(ctx.db, user.user_id, 'collection_create');
        if (collectionSession) {
            await handleCollectionCreateText(ctx, user.user_id, collectionSession.data, ctx.message.text.trim());
            return;
        }

        const search = await getBotSession<ShareSearchSession>(ctx.db, user.user_id, 'shared_word_search');
        if (search) {
            const query = ctx.message.text.trim();
            await deleteBotSession(ctx.db, user.user_id, 'shared_word_search');
            if (search.data.collectionSearch) {
                await showPublicCollections(ctx, user.user_id, 1, query);
            } else if (search.data.userSearch) {
                await showPublicUsers(ctx, user.user_id, 1, query);
            } else if (search.data.ownerUserId) {
                await showOtherUserWords(ctx, user.user_id, search.data.ownerUserId, 1, query);
            }
            return;
        }

        return next();
    });

    bot.callbackQuery(/^shared_users:page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showPublicUsers(ctx, user.user_id, Number(ctx.match[1]));
    });

    bot.callbackQuery('shared_users_search', async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await saveBotSession<ShareSearchSession>(ctx.db, user.user_id, 'shared_word_search', { userSearch: true }, 30);
        await replaceWithText(ctx, '🔍 اكتب اسم المستخدم الذي تريد البحث عنه:', backHomeKeyboard('shared_users:page:1'));
    });

    bot.callbackQuery(/^shared_user:(\d+):page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showOtherUserWords(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]));
    });

    bot.callbackQuery(/^shared_word:(\d+):owner:(\d+):page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showOtherWordDetails(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]), Number(ctx.match[3]));
    });

    bot.callbackQuery(/^shared_word_copy:(\d+):owner:(\d+):page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await copySingleSharedWord(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]), Number(ctx.match[3]));
    });

    bot.callbackQuery(/^shared_user_copy_all:(\d+):page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        const ownerUserId = Number(ctx.match[1]);
        const words = await getWordsByUserPaginated(ctx.db, ownerUserId, 100, 0);
        const result = await copyWordsToUser(ctx.db, words.map(word => word.word_id), user.user_id);
        await replaceWithText(ctx, `✅ تم نسخ ${result.copied} كلمة.\n⏭ تم تخطي ${result.skipped} كلمة لأنها موجودة عندك.`, copySummaryKeyboard(ownerUserId, Number(ctx.match[2])));
    });

    bot.callbackQuery(/^shared_words:select:start:(\d+):page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await startSharedWordSelection(ctx, user.user_id, ctx.match[1], ctx.match[2], 'start');
    });

    bot.callbackQuery(/^shared_select:start:(\d+):page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await startSharedWordSelection(ctx, user.user_id, ctx.match[1], ctx.match[2], 'start_alias');
    });

    bot.callbackQuery(/^shared_words:select:start:([^:]+)(?::page:([^:]+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await startSharedWordSelection(ctx, user.user_id, ctx.match[1], ctx.match[2], 'start_loose');
    });

    bot.callbackQuery(/^shared_select:start(?::([^:]+))?(?::page:([^:]+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        if (!ctx.match[1]) {
            await showPublicUsers(ctx, user.user_id, 1);
            return;
        }
        await startSharedWordSelection(ctx, user.user_id, ctx.match[1], ctx.match[2], 'start_legacy_loose');
    });

    bot.callbackQuery(/^(?:shared_words_select|copy_select)(?::([^:]+))?(?::page:([^:]+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        if (!ctx.match[1]) {
            await showPublicUsers(ctx, user.user_id, 1);
            return;
        }
        await startSharedWordSelection(ctx, user.user_id, ctx.match[1], ctx.match[2], 'start_old_alias');
    });

    bot.callbackQuery(/^shared_words:select:page:(\d+):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showSharedSelectionSafely(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]), 'page');
    });

    bot.callbackQuery(/^shared_words:select:toggle:(\d+):(\d+):page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await toggleSharedWordSelection(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]), Number(ctx.match[3]), 'toggle');
    });

    bot.callbackQuery(/^shared_select:toggle:(\d+):owner:(\d+):page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await toggleSharedWordSelection(ctx, user.user_id, Number(ctx.match[2]), Number(ctx.match[1]), Number(ctx.match[3]), 'toggle_alias');
    });

    bot.callbackQuery(/^shared_words:select:all:(\d+):page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await selectAllSharedWordsOnPage(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]), 'select_all');
    });

    bot.callbackQuery(/^shared_select:all:(\d+):page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await selectAllSharedWordsOnPage(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]), 'select_all_alias');
    });

    bot.callbackQuery(/^shared_words:select:clear:(\d+):page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await clearSharedWordSelection(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]), 'clear');
    });

    bot.callbackQuery(/^shared_select:clear:(\d+):page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await clearSharedWordSelection(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]), 'clear_alias');
    });

    bot.callbackQuery(/^shared_words:select:copy:(\d+):page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await copySelectedSharedWords(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]), 'copy');
    });

    bot.callbackQuery(/^shared_select:copy:(\d+):page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await copySelectedSharedWords(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]), 'copy_alias');
    });

    bot.callbackQuery(/^shared_words:select:back:(\d+):page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await deleteBotSession(ctx.db, user.user_id, 'shared_word_copy_selection');
        await showOtherUserWords(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]));
    });

    bot.callbackQuery(/^shared_search:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await saveBotSession<ShareSearchSession>(ctx.db, user.user_id, 'shared_word_search', { ownerUserId: Number(ctx.match[1]) }, 30);
        await replaceWithText(ctx, '🔍 اكتب كلمة للبحث داخل كلمات هذا المستخدم:', backHomeKeyboard(`shared_user:${ctx.match[1]}:page:1`));
    });

    bot.callbackQuery(/^collections:mine:page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showMyCollections(ctx, user.user_id, Number(ctx.match[1]));
    });

    bot.callbackQuery('collections:menu', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showCollectionsMenu(ctx);
    });

    bot.callbackQuery(/^shared_offers:page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showSharedOffers(ctx, user.user_id, Number(ctx.match[1]));
    });

    bot.callbackQuery('collections:create', async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await saveBotSession<CollectionCreateSession>(ctx.db, user.user_id, 'collection_create', { step: 'title', selectedIds: [] }, 60);
        await replaceWithText(ctx, '➕ اكتب اسم المجموعة:\n\nمثال:\nGerman Toon A1.1 - Video 2', cancelHomeKeyboard('collections:create_cancel'));
    });

    bot.callbackQuery('collections:create_skip_desc', async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        const session = await getBotSession<CollectionCreateSession>(ctx.db, user.user_id, 'collection_create');
        if (!session) return;
        await saveBotSession<CollectionCreateSession>(ctx.db, user.user_id, 'collection_create', { ...session.data, description: null, step: 'select_words', page: 1 }, 120);
        await showCollectionWordPicker(ctx, user.user_id, 1);
    });

    bot.callbackQuery('collections:create_cancel', async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (user) await deleteBotSession(ctx.db, user.user_id, 'collection_create');
        await showMyCollections(ctx, user?.user_id ?? 0, 1);
    });

    bot.callbackQuery(/^collections:create:toggle:(\d+):page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        const wordId = Number(ctx.match[1]);
        const page = Number(ctx.match[2]);
        const session = await getBotSession<CollectionCreateSession>(ctx.db, user.user_id, 'collection_create');
        if (!session) return;
        const selected = new Set(session.data.selectedIds ?? []);
        if (selected.has(wordId)) selected.delete(wordId); else selected.add(wordId);
        await saveBotSession<CollectionCreateSession>(ctx.db, user.user_id, 'collection_create', { ...session.data, selectedIds: [...selected], page }, 120);
        await showCollectionWordPicker(ctx, user.user_id, page);
    });

    bot.callbackQuery(/^collections:create:page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showCollectionWordPicker(ctx, user.user_id, Number(ctx.match[1]));
    });

    bot.callbackQuery('collections:create_save', async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        const session = await getBotSession<CollectionCreateSession>(ctx.db, user.user_id, 'collection_create');
        if (!session?.data.title) return;
        const collectionId = await createWordCollection(ctx.db, user.user_id, session.data.title, session.data.description ?? null, 'public');
        const added = await addWordsToCollection(ctx.db, collectionId, user.user_id, session.data.selectedIds ?? []);
        await deleteBotSession(ctx.db, user.user_id, 'collection_create');
        await replaceWithText(ctx, `✅ تم إنشاء المجموعة.\nتمت إضافة ${added} كلمة.`, new InlineKeyboard()
            .text('➕ إضافة كلمات', `collection:add_words:${collectionId}:page:1`).row()
            .text('👁 عرض المجموعة', `collection:view:${collectionId}:page:1`).row()
            .text('📤 مشاركة المجموعة', `share_collection:${collectionId}`).row()
            .text('🏠 الرئيسية', 'menu_main'));
    });

    bot.callbackQuery(/^collection:view:(\d+):page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showCollection(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]));
    });

    bot.callbackQuery(/^collections:public:page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showPublicCollections(ctx, user.user_id, Number(ctx.match[1]));
    });

    bot.callbackQuery('collections:public_search', async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await saveBotSession<ShareSearchSession>(ctx.db, user.user_id, 'shared_word_search', { collectionSearch: true }, 30);
        await replaceWithText(ctx, '🔍 اكتب اسم المجموعة أو جزءاً من الوصف:', backHomeKeyboard('collections:mine:page:1'));
    });

    bot.callbackQuery(/^collection:copy_prompt:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await replaceWithText(ctx, 'هل تريد إنشاء مجموعة عندك أيضاً؟', new InlineKeyboard()
            .text('✅ نعم، انسخ الكلمات وأنشئ مجموعة', `collection:copy:${ctx.match[1]}:with`).row()
            .text('📥 فقط انسخ الكلمات', `collection:copy:${ctx.match[1]}:words`).row()
            .text('❌ إلغاء', `collection:view:${ctx.match[1]}:page:1`));
    });

    bot.callbackQuery(/^collection:copy:(\d+):(with|words)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await copyCollection(ctx, user.user_id, Number(ctx.match[1]), ctx.match[2] === 'with');
    });

    bot.callbackQuery(/^share_word:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showShareTargetUsers(ctx, user.user_id, 'word', Number(ctx.match[1]));
    });

    bot.callbackQuery(/^share_collection:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showShareTargetUsers(ctx, user.user_id, 'collection', Number(ctx.match[1]));
    });

    bot.callbackQuery(/^share_to:(word|collection):(\d+):user:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await createOfferAndNotify(ctx, user.user_id, ctx.match[1] as 'word' | 'collection', Number(ctx.match[2]), Number(ctx.match[3]));
    });

    bot.callbackQuery(/^offer:(accept|ignore):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await handleOffer(ctx, user.user_id, ctx.match[1] as 'accept' | 'ignore', Number(ctx.match[2]));
    });
}

async function currentUser(ctx: BotContext) {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!user) await ctx.reply('يرجى استخدام /start أولاً.');
    return user;
}

async function showPublicUsers(ctx: BotContext, currentUserId: number, page: number, query?: string): Promise<void> {
    const total = await countPublicWordUsers(ctx.db, currentUserId, query);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const users = await getPublicWordUsers(ctx.db, currentUserId, PAGE_SIZE, (safePage - 1) * PAGE_SIZE, query);
    const text = users.length === 0
        ? '👥 كلمات المستخدمين\n\nلا يوجد مستخدمون لديهم كلمات عامة حالياً.'
        : `👥 كلمات المستخدمين\n\nاختر مستخدم حتى تشوف كلماته وتنسخ منها.\n\nالصفحة: ${safePage}/${totalPages}\n\n` + users.map(user =>
            `• ${user.display_name}\nكلمات: ${user.word_count}${user.german_level ? ` | مستوى: ${user.german_level}` : ''}${user.last_active_at ? `\nآخر نشاط: ${formatRelativeDate(user.last_active_at)}` : ''}`
        ).join('\n\n');
    const keyboard = new InlineKeyboard();
    for (const user of users) keyboard.text(`👤 ${user.display_name} — ${user.word_count} كلمة`, `shared_user:${user.user_id}:page:1`).row();
    if (safePage > 1) keyboard.text('⬅️ السابق', `shared_users:page:${safePage - 1}`);
    if (safePage < totalPages) keyboard.text('التالي ➡️', `shared_users:page:${safePage + 1}`);
    if (safePage > 1 || safePage < totalPages) keyboard.row();
    keyboard.text('🔍 بحث عن مستخدم', 'shared_users_search').row();
    keyboard.text('⬅️ رجوع', 'list_words').text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, text, keyboard);
}

async function showOtherUserWords(ctx: BotContext, currentUserId: number, ownerUserId: number, page: number, query?: string): Promise<void> {
    const owner = await getPublicWordOwner(ctx.db, ownerUserId);
    if (!owner) {
        await replaceWithText(ctx, 'هذا المستخدم غير متاح أو لا يملك كلمات عامة.', backHomeKeyboard('shared_users:page:1'));
        return;
    }
    const total = query ? await countSearchWordsByUser(ctx.db, ownerUserId, query) : await countWordsByUser(ctx.db, ownerUserId);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const words = query
        ? await searchOtherUserWords(ctx.db, ownerUserId, query, PAGE_SIZE, (safePage - 1) * PAGE_SIZE)
        : await getWordsByUserPaginated(ctx.db, ownerUserId, PAGE_SIZE, (safePage - 1) * PAGE_SIZE);
    const text = `👤 كلمات ${owner.display_name}\n\nعدد الكلمات: ${total}\nالصفحة: ${safePage}/${totalPages}\n\n` +
        (words.length ? words.map((word, index) => `${index + 1}. 🇩🇪 ${word.german}\n   🇮🇶 ${word.arabic}`).join('\n\n') : 'لا توجد نتائج.');
    const keyboard = new InlineKeyboard();
    for (const word of words) keyboard.text(`${word.german} — ${word.arabic}`, `shared_word:${word.word_id}:owner:${ownerUserId}:page:${safePage}`).row();
    if (safePage > 1) keyboard.text('⬅️ السابق', `shared_user:${ownerUserId}:page:${safePage - 1}`);
    if (safePage < totalPages) keyboard.text('التالي ➡️', `shared_user:${ownerUserId}:page:${safePage + 1}`);
    if (safePage > 1 || safePage < totalPages) keyboard.row();
    keyboard.text('☑️ تحديد للنسخ', `shared_words:select:start:${ownerUserId}:page:${safePage}`).row()
        .text('📥 نسخ كل كلمات هذا المستخدم', `shared_user_copy_all:${ownerUserId}:page:${safePage}`).row()
        .text('🔍 بحث داخل كلمات هذا المستخدم', `shared_search:${ownerUserId}`).row()
        .text('⬅️ رجوع', 'shared_users:page:1').text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, text, keyboard);
}

async function showOtherWordDetails(ctx: BotContext, currentUserId: number, wordId: number, ownerUserId: number, page: number): Promise<void> {
    const word = await getWordById(ctx.db, wordId);
    if (!word || word.added_by !== ownerUserId || ownerUserId === currentUserId) {
        await replaceWithText(ctx, 'لم أجد هذه الكلمة للعرض.', backHomeKeyboard(`shared_user:${ownerUserId}:page:${page}`));
        return;
    }
    const text = `👁 قراءة فقط\n\n🇩🇪 ${word.german}\n🇮🇶 ${word.arabic}` +
        (word.example ? `\n💬 ${word.example}` : '') +
        (word.example_ar ? `\n🇮🇶 ${word.example_ar}` : '') +
        (word.level ? `\n📊 ${word.level}` : '') +
        '\n\nلا يمكنك تعديل أو حذف كلمات مستخدم آخر.';
    await replaceWithText(ctx, text, new InlineKeyboard()
        .text('📥 نسخ هذه الكلمة', `shared_word_copy:${wordId}:owner:${ownerUserId}:page:${page}`).row()
        .text('📤 مشاركة', `share_word:${wordId}`).row()
        .text('⬅️ رجوع', `shared_user:${ownerUserId}:page:${page}`).text('🏠 الرئيسية', 'menu_main'));
}

async function copySingleSharedWord(ctx: BotContext, userId: number, wordId: number, ownerUserId: number, page: number): Promise<void> {
    const source = await getWordById(ctx.db, wordId);
    if (!source || source.added_by !== ownerUserId || ownerUserId === userId) {
        await replaceWithText(ctx, 'لم أجد هذه الكلمة للنسخ.', backHomeKeyboard(`shared_user:${ownerUserId}:page:${page}`));
        return;
    }
    const existing = await searchDuplicateWordForUser(ctx.db, userId, source.german);
    if (existing) {
        await replaceWithText(ctx, 'هذه الكلمة موجودة عندك مسبقاً.', new InlineKeyboard()
            .text('👁 عرض كلمتي', `word_detail_${existing.word_id}`).row()
            .text('⬅️ رجوع', `shared_user:${ownerUserId}:page:${page}`));
        return;
    }
    await copyWordToUser(ctx.db, wordId, userId);
    await replaceWithText(ctx, '✅ تم نسخ الكلمة إلى كلماتك.', copySummaryKeyboard(ownerUserId, page));
}

async function startSharedWordSelection(ctx: BotContext, targetUserId: number, rawSourceUserId: string | number | undefined, rawPage: string | number | undefined, action: string): Promise<void> {
    const parsedSourceUserId = Number(rawSourceUserId);
    const sourceUserId = Number.isInteger(parsedSourceUserId) && parsedSourceUserId > 0 ? parsedSourceUserId : 0;
    const parsedPage = Number(rawPage);
    const safePage = normalizeSharedPage(parsedPage);
    const diagnostics: SharedSelectionDiagnostics = {
        targetUserId,
        sourceUserId,
        parsedSourceUserId: Number.isFinite(parsedSourceUserId) ? parsedSourceUserId : null,
        page: safePage,
        parsedPage: Number.isFinite(parsedPage) ? parsedPage : 1,
        callbackData: ctx.callbackQuery?.data,
        step: 'parse_callback',
        sessionCreated: false,
    };

    try {
        if (!sourceUserId) {
            logSharedSelectionOpenFailed(diagnostics, new Error('missing_source_user_id'));
            await showPublicUsers(ctx, targetUserId, 1);
            return;
        }

        diagnostics.step = 'load_source_user';
        const sourceUser = await loadSharedSourceUserStatus(ctx, sourceUserId);
        diagnostics.sourceUserFound = Boolean(sourceUser);
        diagnostics.sourceUserBanned = Boolean(sourceUser?.is_banned);
        diagnostics.sourceUserDeleted = Boolean(sourceUser?.is_deleted);
        if (!sourceUser || sourceUser.is_banned || sourceUser.is_deleted) {
            logSharedSelectionOpenFailed(diagnostics);
            await showSharedSelectionError(ctx, sourceUserId, safePage, 'هذا المستخدم غير متاح حالياً.');
            return;
        }

        diagnostics.step = 'count_source_words';
        diagnostics.wordsCount = sourceUser.words_count;

        diagnostics.step = 'create_selection_session';
        await deleteBotSession(ctx.db, targetUserId, 'shared_word_copy_selection').catch(() => {});
        await saveShareSelection(ctx, {
            sourceUserId,
            targetUserId,
            selectedWordIds: [],
            page: safePage,
            createdAt: new Date().toISOString(),
        });
        diagnostics.sessionCreated = true;

        diagnostics.step = 'render_selection';
        await showSharedSelection(ctx, targetUserId, sourceUserId, safePage, diagnostics);
    } catch (error) {
        logSharedSelectionOpenFailed(diagnostics, error);
        await showSharedSelectionError(ctx, sourceUserId, safePage);
    }
}

async function showSharedSelectionSafely(ctx: BotContext, targetUserId: number, sourceUserId: number, page: number, action: string): Promise<void> {
    await runSharedSelectionAction(ctx, targetUserId, sourceUserId, page, action, () => showSharedSelection(ctx, targetUserId, sourceUserId, page));
}

async function toggleSharedWordSelection(ctx: BotContext, targetUserId: number, sourceUserId: number, wordId: number, page: number, action: string): Promise<void> {
    await runSharedSelectionAction(ctx, targetUserId, sourceUserId, page, action, async () => {
        const safePage = normalizeSharedPage(page);
        const word = await getWordById(ctx.db, wordId);
        if (!word || word.added_by !== sourceUserId) {
            await showSharedSelectionError(ctx, sourceUserId, safePage, 'لم أجد هذه الكلمة ضمن كلمات المستخدم المحدد.');
            return;
        }
        const session = await getShareSelection(ctx, targetUserId, sourceUserId, safePage);
        const selected = new Set(session.selectedWordIds);
        if (selected.has(wordId)) selected.delete(wordId);
        else selected.add(wordId);
        await saveShareSelection(ctx, { ...session, selectedWordIds: [...selected], page: safePage });
        await showSharedSelection(ctx, targetUserId, sourceUserId, safePage);
    });
}

async function selectAllSharedWordsOnPage(ctx: BotContext, targetUserId: number, sourceUserId: number, page: number, action: string): Promise<void> {
    await runSharedSelectionAction(ctx, targetUserId, sourceUserId, page, action, async () => {
        const safePage = normalizeSharedPage(page);
        const owner = await loadSharedSourceUserStatus(ctx, sourceUserId);
        if (!owner || owner.is_banned || owner.is_deleted) {
            await showSharedSelectionError(ctx, sourceUserId, safePage, 'هذا المستخدم غير متاح للنسخ.');
            return;
        }
        const visible = await getWordsByUserPaginated(ctx.db, sourceUserId, PAGE_SIZE, (safePage - 1) * PAGE_SIZE);
        const session = await getShareSelection(ctx, targetUserId, sourceUserId, safePage);
        const selected = new Set(session.selectedWordIds);
        for (const word of visible) selected.add(word.word_id);
        await saveShareSelection(ctx, { ...session, selectedWordIds: [...selected], page: safePage });
        await showSharedSelection(ctx, targetUserId, sourceUserId, safePage);
    });
}

async function clearSharedWordSelection(ctx: BotContext, targetUserId: number, sourceUserId: number, page: number, action: string): Promise<void> {
    await runSharedSelectionAction(ctx, targetUserId, sourceUserId, page, action, async () => {
        const safePage = normalizeSharedPage(page);
        const session = await getShareSelection(ctx, targetUserId, sourceUserId, safePage);
        await saveShareSelection(ctx, { ...session, selectedWordIds: [], page: safePage });
        await showSharedSelection(ctx, targetUserId, sourceUserId, safePage);
    });
}

async function copySelectedSharedWords(ctx: BotContext, targetUserId: number, sourceUserId: number, page: number, action: string): Promise<void> {
    await runSharedSelectionAction(ctx, targetUserId, sourceUserId, page, action, async () => {
        const safePage = normalizeSharedPage(page);
        const owner = await loadSharedSourceUserStatus(ctx, sourceUserId);
        if (!owner || owner.is_banned || owner.is_deleted) {
            await showSharedSelectionError(ctx, sourceUserId, safePage, 'هذا المستخدم غير متاح للنسخ.');
            return;
        }
        const session = await getShareSelection(ctx, targetUserId, sourceUserId, safePage);
        if (session.selectedWordIds.length === 0) {
            await replaceWithText(ctx, 'لم تحدد أي كلمة بعد.', sharedSelectionActionsKeyboard(sourceUserId, safePage));
            return;
        }
        const ownedIds = await getOwnedSharedWordIds(ctx, sourceUserId, session.selectedWordIds);
        const result = await copyWordsToUser(ctx.db, ownedIds, targetUserId);
        const invalid = session.selectedWordIds.length - ownedIds.length;
        await deleteBotSession(ctx.db, targetUserId, 'shared_word_copy_selection');
        await replaceWithText(
            ctx,
            `✅ تم نسخ ${result.copied} كلمة.\n⏭ تم تخطي ${result.skipped + invalid} كلمة لأنها موجودة عندك مسبقاً.`,
            copySummaryKeyboard(sourceUserId, safePage)
        );
    });
}

async function getShareSelection(ctx: BotContext, targetUserId: number, sourceUserId: number, page: number): Promise<ShareSelectionSession> {
    const safePage = normalizeSharedPage(page);
    const session = await getBotSession<ShareSelectionSession>(ctx.db, targetUserId, 'shared_word_copy_selection');
    if (session?.data.sourceUserId === sourceUserId && session.data.targetUserId === targetUserId) {
        return { ...session.data, page: safePage };
    }
    return {
        sourceUserId,
        targetUserId,
        selectedWordIds: [],
        page: safePage,
        createdAt: new Date().toISOString(),
    };
}

async function saveShareSelection(ctx: BotContext, data: ShareSelectionSession): Promise<void> {
    await saveBotSession(ctx.db, data.targetUserId, 'shared_word_copy_selection', data, 120);
}

async function showSharedSelection(ctx: BotContext, targetUserId: number, sourceUserId: number, page: number, diagnostics?: SharedSelectionDiagnostics): Promise<void> {
    const safePage = normalizeSharedPage(page);
    const owner = await loadSharedSourceUserStatus(ctx, sourceUserId);
    if (diagnostics) {
        diagnostics.step = 'load_source_user';
        diagnostics.sourceUserFound = Boolean(owner);
        diagnostics.sourceUserBanned = Boolean(owner?.is_banned);
        diagnostics.sourceUserDeleted = Boolean(owner?.is_deleted);
    }
    if (!owner || owner.is_banned || owner.is_deleted) {
        await showSharedSelectionError(ctx, sourceUserId, safePage, 'هذا المستخدم غير متاح حالياً.');
        return;
    }
    const session = await getShareSelection(ctx, targetUserId, sourceUserId, safePage);
    if (diagnostics) diagnostics.step = 'count_source_words';
    const total = owner.words_count;
    if (diagnostics) diagnostics.wordsCount = total;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const currentPage = Math.max(1, Math.min(safePage, totalPages));
    if (diagnostics) diagnostics.step = 'load_source_words';
    const words = await getWordsByUserPaginated(ctx.db, sourceUserId, PAGE_SIZE, (currentPage - 1) * PAGE_SIZE);
    const selected = new Set(session.selectedWordIds);
    if (words.length === 0) {
        if (diagnostics) diagnostics.step = 'edit_message';
        await replaceSharedSelectionText(ctx, '☑️ تحديد كلمات للنسخ\n\nلا توجد كلمات لدى هذا المستخدم حالياً.', backHomeKeyboard('shared_users:page:1'));
        return;
    }
    const text = `☑️ تحديد كلمات للنسخ\n\nاختر الكلمات التي تريد نسخها من ${owner.display_name ?? owner.name ?? 'المستخدم'}:\n\nالصفحة: ${currentPage}/${totalPages}\n\n` +
        words.map(word => `${selected.has(word.word_id) ? '☑' : '☐'} 🇩🇪 ${word.german}`).join('\n') +
        `\n\nالمحدد: ${selected.size}`;
    if (diagnostics) diagnostics.step = 'edit_message';
    await replaceSharedSelectionText(ctx, text, sharedSelectionKeyboard(words, selected, sourceUserId, currentPage, totalPages));
}

function sharedSelectionKeyboard(
    words: Array<{ word_id: number; german: string }>,
    selected: Set<number>,
    sourceUserId: number,
    page: number,
    totalPages: number
): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    for (const word of words) {
        keyboard.text(`${selected.has(word.word_id) ? '☑' : '☐'} 🇩🇪 ${word.german}`, `shared_words:select:toggle:${sourceUserId}:${word.word_id}:page:${page}`).row();
    }
    keyboard.text('✅ نسخ المحدد', `shared_words:select:copy:${sourceUserId}:page:${page}`).row()
        .text('☑️ تحديد الكل في الصفحة', `shared_words:select:all:${sourceUserId}:page:${page}`).row()
        .text('🧹 إلغاء التحديد', `shared_words:select:clear:${sourceUserId}:page:${page}`).row();
    if (page > 1) keyboard.text('⬅️ السابق', `shared_words:select:page:${sourceUserId}:${page - 1}`);
    if (page < totalPages) keyboard.text('التالي ➡️', `shared_words:select:page:${sourceUserId}:${page + 1}`);
    if (page > 1 || page < totalPages) keyboard.row();
    keyboard.text('⬅️ رجوع لكلمات المستخدم', `shared_words:select:back:${sourceUserId}:page:${page}`).row()
        .text('🏠 الرئيسية', 'menu_main');
    return keyboard;
}

function sharedSelectionActionsKeyboard(sourceUserId: number, page: number): InlineKeyboard {
    if (!sourceUserId) {
        return new InlineKeyboard()
            .text('🔄 إعادة المحاولة', 'shared_users:page:1').row()
            .text('⬅️ رجوع', 'shared_users:page:1')
            .text('🏠 الرئيسية', 'menu_main');
    }
    return new InlineKeyboard()
        .text('🔄 إعادة المحاولة', `shared_words:select:start:${sourceUserId}:page:${page}`).row()
        .text('⬅️ رجوع', `shared_user:${sourceUserId}:page:${page}`)
        .text('🏠 الرئيسية', 'menu_main');
}

async function showSharedSelectionError(ctx: BotContext, sourceUserId: number, page: number, message = 'تعذر فتح وضع التحديد حالياً.'): Promise<void> {
    await replaceSharedSelectionText(ctx, message, sharedSelectionActionsKeyboard(sourceUserId, normalizeSharedPage(page)));
}

async function replaceSharedSelectionText(ctx: BotContext, text: string, keyboard: InlineKeyboard): Promise<void> {
    try {
        await replaceWithText(ctx, text, keyboard);
    } catch {
        await ctx.reply(text, { reply_markup: keyboard });
    }
}

async function loadSharedSourceUserStatus(ctx: BotContext, sourceUserId: number): Promise<SharedSourceUserStatus | null> {
    return ctx.db.prepare(
        `SELECT u.user_id, u.display_name, u.name,
                COALESCE(u.is_banned, 0) AS is_banned,
                COALESCE(u.is_deleted, 0) AS is_deleted,
                COUNT(w.word_id) AS words_count
         FROM users u
         LEFT JOIN words w ON w.added_by = u.user_id
         WHERE u.user_id = ?
           AND u.display_name IS NOT NULL
         GROUP BY u.user_id`
    ).bind(sourceUserId).first<SharedSourceUserStatus>();
}

function logSharedSelectionOpenFailed(diagnostics: SharedSelectionDiagnostics, error?: unknown): void {
    const err = error instanceof Error ? error : error ? new Error(String(error)) : null;
    console.warn('shared_word_selection_open_failed', {
        targetUserId: diagnostics.targetUserId,
        sourceUserId: diagnostics.sourceUserId,
        parsedSourceUserId: diagnostics.parsedSourceUserId,
        page: diagnostics.page,
        parsedPage: diagnostics.parsedPage,
        callbackData: diagnostics.callbackData,
        step: diagnostics.step,
        sourceUserFound: diagnostics.sourceUserFound,
        sourceUserBanned: diagnostics.sourceUserBanned,
        sourceUserDeleted: diagnostics.sourceUserDeleted,
        wordsCount: diagnostics.wordsCount,
        sessionCreated: diagnostics.sessionCreated,
        errorName: err?.name,
        errorMessage: err?.message.slice(0, 160),
    });
}

async function getOwnedSharedWordIds(ctx: BotContext, sourceUserId: number, wordIds: number[]): Promise<number[]> {
    const uniqueIds = [...new Set(wordIds)].filter(id => Number.isInteger(id) && id > 0).slice(0, 100);
    if (uniqueIds.length === 0) return [];
    const placeholders = uniqueIds.map(() => '?').join(',');
    const rows = await ctx.db.prepare(
        `SELECT word_id FROM words
         WHERE added_by = ? AND word_id IN (${placeholders})`
    ).bind(sourceUserId, ...uniqueIds).all<{ word_id: number }>();
    return (rows.results ?? []).map(row => row.word_id);
}

async function runSharedSelectionAction(
    ctx: BotContext,
    targetUserId: number,
    sourceUserId: number,
    page: number,
    action: string,
    fn: () => Promise<void>
): Promise<void> {
    const safePage = normalizeSharedPage(page);
    try {
        await fn();
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.warn('shared_word_selection_failed', {
            targetUserId,
            sourceUserId,
            page: safePage,
            callbackData: ctx.callbackQuery?.data,
            action,
            errorName: err.name,
            errorMessage: err.message.slice(0, 160),
        });
        await showSharedSelectionError(ctx, sourceUserId, safePage);
    }
}

function normalizeSharedPage(page: number): number {
    const value = Number(page);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

async function showMyCollections(ctx: BotContext, userId: number, page: number): Promise<void> {
    const total = await countCollectionsByUser(ctx.db, userId);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const collections = await getCollectionsByUser(ctx.db, userId, PAGE_SIZE, (safePage - 1) * PAGE_SIZE);
    const text = `🗂 مجموعات الكلمات\n\nمثل Playlist، لكن للكلمات.\n\n` +
        (collections.length ? collections.map(item => `• ${item.title}\nكلمات: ${item.word_count ?? 0}`).join('\n\n') : 'لا توجد مجموعات بعد.');
    const keyboard = new InlineKeyboard()
        .text('➕ إنشاء مجموعة', 'collections:create').row()
        .text('🌍 مجموعات المستخدمين', 'collections:public:page:1').row()
        .text('🔍 بحث عن مجموعة', 'collections:public_search').row();
    for (const item of collections) keyboard.text(`🗂 ${item.title}`, `collection:view:${item.id}:page:1`).row();
    if (safePage > 1) keyboard.text('⬅️ السابق', `collections:mine:page:${safePage - 1}`);
    if (safePage < totalPages) keyboard.text('التالي ➡️', `collections:mine:page:${safePage + 1}`);
    if (safePage > 1 || safePage < totalPages) keyboard.row();
    keyboard.text('⬅️ رجوع', 'collections:menu').text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, text, keyboard);
}

async function showCollectionsMenu(ctx: BotContext): Promise<void> {
    await replaceWithText(ctx, '🗂 مجموعات الكلمات\n\nالمجموعة مثل Playlist، لكن للكلمات.', new InlineKeyboard()
        .text('📚 مجموعاتي', 'collections:mine:page:1').row()
        .text('➕ إنشاء مجموعة', 'collections:create').row()
        .text('🌍 مجموعات المستخدمين', 'collections:public:page:1').row()
        .text('🔍 بحث عن مجموعة', 'collections:public_search').row()
        .text('📥 مجموعات شاركوها معي', 'shared_offers:page:1').row()
        .text('⬅️ رجوع إلى كلماتي', 'menu_words')
        .text('🏠 الرئيسية', 'menu_main'));
}

async function handleCollectionCreateText(ctx: BotContext, userId: number, data: CollectionCreateSession, text: string): Promise<void> {
    if (data.step === 'title') {
        if (text.length < 2 || text.length > 100) {
            await ctx.reply('اسم المجموعة يجب أن يكون بين 2 و100 حرف.');
            return;
        }
        await saveBotSession<CollectionCreateSession>(ctx.db, userId, 'collection_create', { ...data, title: text, step: 'description' }, 60);
        await ctx.reply('اكتب وصفاً اختيارياً للمجموعة، أو اضغط تخطي الوصف.', { reply_markup: new InlineKeyboard().text('تخطي الوصف', 'collections:create_skip_desc').text('❌ إلغاء', 'collections:create_cancel') });
        return;
    }
    if (data.step === 'description') {
        await saveBotSession<CollectionCreateSession>(ctx.db, userId, 'collection_create', { ...data, description: text.slice(0, 500), step: 'select_words', page: 1 }, 120);
        await showCollectionWordPicker(ctx, userId, 1);
    }
}

async function showCollectionWordPicker(ctx: BotContext, userId: number, page: number): Promise<void> {
    const session = await getBotSession<CollectionCreateSession>(ctx.db, userId, 'collection_create');
    if (!session) return;
    const total = await countWordsByUser(ctx.db, userId);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const words = await getWordsByUserPaginated(ctx.db, userId, PAGE_SIZE, (safePage - 1) * PAGE_SIZE);
    const selected = new Set(session.data.selectedIds ?? []);
    const text = `اختر كلمات تضيفها إلى المجموعة:\n${session.data.title ?? ''}\n\n` +
        words.map(word => `${selected.has(word.word_id) ? '☑' : '☐'} ${word.german} — ${word.arabic}`).join('\n') +
        `\n\nالمحدد: ${selected.size}`;
    const keyboard = new InlineKeyboard();
    for (const word of words) keyboard.text(`${selected.has(word.word_id) ? '☑' : '☐'} ${word.german}`, `collections:create:toggle:${word.word_id}:page:${safePage}`).row();
    if (safePage > 1) keyboard.text('⬅️ السابق', `collections:create:page:${safePage - 1}`);
    if (safePage < totalPages) keyboard.text('التالي ➡️', `collections:create:page:${safePage + 1}`);
    if (safePage > 1 || safePage < totalPages) keyboard.row();
    keyboard.text('✅ حفظ المجموعة', 'collections:create_save').row()
        .text('❌ إلغاء', 'collections:create_cancel').text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, text, keyboard);
}

async function showCollection(ctx: BotContext, userId: number, collectionId: number, page: number): Promise<void> {
    const collection = await getCollectionById(ctx.db, collectionId);
    if (!collection || (collection.visibility === 'private' && collection.owner_user_id !== userId)) {
        await replaceWithText(ctx, 'لم أجد هذه المجموعة.', backHomeKeyboard('collections:mine:page:1'));
        return;
    }
    const total = collection.word_count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const words = await getCollectionWords(ctx.db, collectionId, PAGE_SIZE, (safePage - 1) * PAGE_SIZE);
    const text = `🗂 ${collection.title}\n\nالمالك:\n${collection.owner_name ?? '-'}\n\nالوصف:\n${collection.description ?? 'بدون وصف'}\n\nعدد الكلمات:\n${total}\n\n` +
        words.map((word, index) => `${index + 1}. 🇩🇪 ${word.german}\n   🇮🇶 ${word.arabic}`).join('\n\n');
    const keyboard = new InlineKeyboard()
        .text('📥 نسخ المجموعة إلى كلماتي', `collection:copy_prompt:${collectionId}`).row()
        .text('📤 مشاركة المجموعة', `share_collection:${collectionId}`).row()
        .text('⚔️ تحدي على هذه المجموعة', `collection_challenge_count_${collectionId}`).row();
    if (collection.owner_user_id === userId) keyboard.text('✏️ تعديل المجموعة', `collection:edit:${collectionId}`).text('🗑 حذف المجموعة', `collection:delete:${collectionId}`).row();
    if (safePage > 1) keyboard.text('⬅️ السابق', `collection:view:${collectionId}:page:${safePage - 1}`);
    if (safePage < totalPages) keyboard.text('التالي ➡️', `collection:view:${collectionId}:page:${safePage + 1}`);
    if (safePage > 1 || safePage < totalPages) keyboard.row();
    keyboard.text('⬅️ رجوع', collection.owner_user_id === userId ? 'collections:mine:page:1' : 'collections:public:page:1').text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, text, keyboard);
}

async function showPublicCollections(ctx: BotContext, userId: number, page: number, query?: string): Promise<void> {
    const total = await countPublicCollections(ctx.db, userId, query);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const collections = await getPublicCollections(ctx.db, userId, PAGE_SIZE, (safePage - 1) * PAGE_SIZE, query);
    const text = `🌍 مجموعات المستخدمين\n\n` + (collections.length ? collections.map(item => `• ${item.title}\nالمالك: ${item.owner_name ?? '-'} | كلمات: ${item.word_count ?? 0}`).join('\n\n') : 'لا توجد مجموعات عامة.');
    const keyboard = new InlineKeyboard();
    for (const item of collections) keyboard.text(`🗂 ${item.title}`, `collection:view:${item.id}:page:1`).row();
    if (safePage > 1) keyboard.text('⬅️ السابق', `collections:public:page:${safePage - 1}`);
    if (safePage < totalPages) keyboard.text('التالي ➡️', `collections:public:page:${safePage + 1}`);
    if (safePage > 1 || safePage < totalPages) keyboard.row();
    keyboard.text('🔍 بحث عن مجموعة', 'collections:public_search').row()
        .text('⬅️ رجوع', 'collections:menu').text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, text, keyboard);
}

async function showSharedOffers(ctx: BotContext, userId: number, page: number): Promise<void> {
    const total = await countIncomingSharedWordOffers(ctx.db, userId);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const offers = await getIncomingSharedWordOffers(ctx.db, userId, PAGE_SIZE, (safePage - 1) * PAGE_SIZE);
    const text = offers.length === 0
        ? '📥 العروض المشتركة\n\nلا توجد عروض كلمات أو مجموعات بانتظارك حالياً.'
        : '📥 العروض المشتركة\n\nهذه كلمات أو مجموعات شاركها مستخدمون آخرون معك:\n\n' + offers.map((offer, index) => {
            const payload = JSON.parse(offer.payload_json) as { wordIds?: number[]; collectionId?: number };
            const kind = offer.offer_type === 'collection' || payload.collectionId ? 'مجموعة كلمات' : 'كلمات';
            return `${index + 1}. ${kind}\nمن: ${offer.sender_name ?? 'مستخدم'}\nتنتهي: ${formatRelativeDate(offer.expires_at)}`;
        }).join('\n\n');
    const keyboard = new InlineKeyboard();
    for (const offer of offers) {
        const payload = JSON.parse(offer.payload_json) as { wordIds?: number[]; collectionId?: number };
        const kind = offer.offer_type === 'collection' || payload.collectionId ? 'مجموعة' : 'كلمات';
        keyboard.text(`📥 قبول ${kind} #${offer.id}`, `offer:accept:${offer.id}`).row()
            .text(`❌ تجاهل #${offer.id}`, `offer:ignore:${offer.id}`).row();
    }
    if (safePage > 1) keyboard.text('⬅️ السابق', `shared_offers:page:${safePage - 1}`);
    if (safePage < totalPages) keyboard.text('التالي ➡️', `shared_offers:page:${safePage + 1}`);
    if (safePage > 1 || safePage < totalPages) keyboard.row();
    keyboard.text('⬅️ رجوع إلى كلماتي', 'menu_words').text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, text, keyboard);
}

async function copyCollection(ctx: BotContext, userId: number, collectionId: number, createCollectionCopy: boolean): Promise<void> {
    const collection = await getCollectionById(ctx.db, collectionId);
    if (!collection || (collection.visibility === 'private' && collection.owner_user_id !== userId)) return;
    const words = await getCollectionWords(ctx.db, collectionId, 100, 0);
    const result = await copyWordsToUser(ctx.db, words.map(word => word.word_id), userId);
    let collectionCopyText = '';
    if (createCollectionCopy) {
        const copyId = await createWordCollection(ctx.db, userId, `${collection.title} - نسخة`, collection.description, 'public');
        await addWordsToCollection(ctx.db, copyId, userId, result.copiedWordIds);
        collectionCopyText = `\n🗂 تم إنشاء مجموعة عندك: ${collection.title} - نسخة`;
    }
    await replaceWithText(ctx, `✅ تم نسخ ${result.copied} كلمة.${collectionCopyText}\n⏭ تم تخطي ${result.skipped} مكررة.`, new InlineKeyboard()
        .text('📂 كلماتي', 'list_words')
        .text('📚 راجع الآن', 'menu_learn').row()
        .text('⬅️ رجوع', `collection:view:${collectionId}:page:1`)
        .text('🏠 الرئيسية', 'menu_main'));
}

async function showShareTargetUsers(ctx: BotContext, senderUserId: number, type: 'word' | 'collection', id: number): Promise<void> {
    const users = await getChallengeCandidates(ctx.db, senderUserId);
    const keyboard = new InlineKeyboard();
    for (const user of users) keyboard.text(user.display_name ?? user.name, `share_to:${type}:${id}:user:${user.user_id}`).row();
    keyboard.text('⬅️ رجوع', type === 'collection' ? `collection:view:${id}:page:1` : `word_detail_${id}`).text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, 'اختر مستخدم للمشاركة:\n\nملاحظة: الكلمات التي تضيفها قد تظهر للمستخدمين الآخرين داخل البوت حتى يستفيدون منها.', keyboard);
}

async function createOfferAndNotify(ctx: BotContext, senderUserId: number, type: 'word' | 'collection', id: number, receiverUserId: number): Promise<void> {
    const receiver = await ctx.db.prepare('SELECT user_id, telegram_id AS chatId, display_name, name FROM users WHERE user_id = ? AND display_name IS NOT NULL AND COALESCE(is_banned, 0) = 0 AND COALESCE(is_deleted, 0) = 0').bind(receiverUserId).first<{ user_id: number; chatId: number; display_name: string | null; name: string }>();
    const sender = await ctx.db.prepare('SELECT display_name, name FROM users WHERE user_id = ?').bind(senderUserId).first<{ display_name: string | null; name: string }>();
    if (!receiver || !sender) return;
    const payload = type === 'word' ? { wordIds: [id] } : { collectionId: id };
    const offerId = await createSharedWordOffer(ctx.db, senderUserId, receiverUserId, type, payload);
    if (!offerId) {
        await replaceWithText(ctx, 'تم إرسال نفس المشاركة لهذا المستخدم خلال آخر ساعة. انتظر قليلاً حتى لا تصير رسائل مزعجة.', mainMenuKeyboard());
        return;
    }
    await sendTelegramMessage(ctx.env, receiver.chatId, `📤 ${displayUserName(sender)} شارك معك كلمات.`, {
        inline_keyboard: [[
            { text: '👁 عرض الكلمات', callback_data: `offer:accept:${offerId}` },
            { text: '📥 نسخ إلى كلماتي', callback_data: `offer:accept:${offerId}` },
        ], [{ text: '❌ تجاهل', callback_data: `offer:ignore:${offerId}` }]],
    });
    await replaceWithText(ctx, '✅ تم إرسال المشاركة.', mainMenuKeyboard());
}

async function handleOffer(ctx: BotContext, userId: number, action: 'accept' | 'ignore', offerId: number): Promise<void> {
    const offer = await getSharedWordOffer(ctx.db, offerId);
    const expired = offer ? await isSharedWordOfferExpired(ctx.db, offerId) : true;
    if (!offer || offer.receiver_user_id !== userId || offer.status !== 'pending' || expired) {
        if (offer?.status === 'pending' && expired) await updateSharedWordOfferStatus(ctx.db, offerId, 'expired');
        await replaceWithText(ctx, 'هذه المشاركة غير متاحة أو انتهت.', mainMenuKeyboard());
        return;
    }
    if (action === 'ignore') {
        await updateSharedWordOfferStatus(ctx.db, offerId, 'ignored');
        await replaceWithText(ctx, 'تم تجاهل المشاركة.', mainMenuKeyboard());
        return;
    }
    const payload = JSON.parse(offer.payload_json) as { wordIds?: number[]; collectionId?: number };
    const wordIds = payload.collectionId
        ? (await getCollectionWords(ctx.db, payload.collectionId, 100, 0)).map(word => word.word_id)
        : payload.wordIds ?? [];
    const result = await copyWordsToUser(ctx.db, wordIds, userId);
    await updateSharedWordOfferStatus(ctx.db, offerId, 'accepted');
    await replaceWithText(ctx, `✅ تم نسخ ${result.copied} كلمة.\n⏭ تم تخطي ${result.skipped} كلمة موجودة مسبقاً.`, mainMenuKeyboard());
}

function copySummaryKeyboard(ownerUserId: number, page: number): InlineKeyboard {
    return new InlineKeyboard()
        .text('📚 راجع الآن', 'menu_learn').row()
        .text('📂 كلماتي', 'list_words').row()
        .text('⬅️ رجوع لكلمات المستخدم', `shared_user:${ownerUserId}:page:${page}`).row()
        .text('🏠 الرئيسية', 'menu_main');
}

function backHomeKeyboard(back: string): InlineKeyboard {
    return new InlineKeyboard().text('⬅️ رجوع', back).text('🏠 الرئيسية', 'menu_main');
}

function cancelHomeKeyboard(cancel: string): InlineKeyboard {
    return new InlineKeyboard().text('❌ إلغاء', cancel).text('🏠 الرئيسية', 'menu_main');
}

function formatRelativeDate(value: string): string {
    return value.slice(0, 10);
}
