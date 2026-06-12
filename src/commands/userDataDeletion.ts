import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { deleteAllWordsForUser } from '../repositories/wordRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import { getUserByTelegramId } from '../repositories/userRepository';
import {
    deleteAllCollectionsForUser,
    deleteCollection,
    deleteCollectionWordsForUser,
    getCollectionById,
} from '../repositories/wordSharingRepository';
import { replaceWithText } from './wordPanel';

type DeleteConfirmationAction =
    | 'all_words'
    | 'all_collections'
    | 'collection_words'
    | 'collection'
    | 'all_words_collections';

interface DeleteConfirmationSession {
    action: DeleteConfirmationAction;
    expectedText: string;
    collectionId?: number;
    createdAt: string;
}

const DELETE_SESSION_TYPE = 'delete_confirmation' as const;

const EXPECTED_CONFIRMATION: Record<DeleteConfirmationAction, string> = {
    all_words: 'احذف كلماتي',
    all_collections: 'احذف مجموعاتي',
    collection_words: 'احذف كلمات المجموعة',
    collection: 'احذف المجموعة',
    all_words_collections: 'احذف بياناتي',
};

const CONFIRMATION_PROMPT: Record<DeleteConfirmationAction, string> = {
    all_words: '⚠️ هذا الإجراء سيحذف كل كلماتك نهائياً. للتأكيد اكتب: احذف كلماتي',
    all_collections: '⚠️ هذا الإجراء سيحذف كل مجموعاتك نهائياً. للتأكيد اكتب: احذف مجموعاتي',
    collection_words: '⚠️ هذا الإجراء سيحذف كل الكلمات داخل هذه المجموعة فقط. للتأكيد اكتب: احذف كلمات المجموعة',
    collection: '⚠️ هذا الإجراء سيحذف هذه المجموعة بالكامل. للتأكيد اكتب: احذف المجموعة',
    all_words_collections: '⚠️ هذا الإجراء سيحذف كل كلماتك وكل مجموعاتك نهائياً. لن يتم حذف حسابك أو XP. للتأكيد اكتب: احذف بياناتي',
};

export function registerUserDataDeletionCommand(bot: Bot<BotContext>): void {
    bot.on('message:text', async (ctx, next) => {
        const user = await currentUser(ctx, false);
        if (!user) return next();

        if (await getBotSession(ctx.db, user.user_id, 'train')) return next();
        if (await getBotSession(ctx.db, user.user_id, 'challenge')) return next();

        const session = await getBotSession<DeleteConfirmationSession>(ctx.db, user.user_id, DELETE_SESSION_TYPE);
        if (!session) return next();

        await handleDeleteConfirmationText(ctx, user.user_id, session.data, ctx.message.text.trim());
    });

    bot.command('delete_my_words', async (ctx) => {
        await startDeleteConfirmation(ctx, 'all_words');
    });

    bot.command('delete_my_collections', async (ctx) => {
        await startDeleteConfirmation(ctx, 'all_collections');
    });

    bot.command('delete_my_data', async (ctx) => {
        await startDeleteConfirmation(ctx, 'all_words_collections');
    });

    bot.callbackQuery('user_delete:words', async (ctx) => {
        await ctx.answerCallbackQuery();
        await startDeleteConfirmation(ctx, 'all_words');
    });

    bot.callbackQuery(/^(?:word_delete_all|word_delete_all_confirm)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await startDeleteConfirmation(ctx, 'all_words');
    });

    bot.callbackQuery('user_delete:collections', async (ctx) => {
        await ctx.answerCallbackQuery();
        await startDeleteConfirmation(ctx, 'all_collections');
    });

    bot.callbackQuery('user_delete:data', async (ctx) => {
        await ctx.answerCallbackQuery();
        await startDeleteConfirmation(ctx, 'all_words_collections');
    });

    bot.callbackQuery(/^user_delete:collection_words:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await startDeleteConfirmation(ctx, 'collection_words', Number(ctx.match[1]));
    });

    bot.callbackQuery(/^user_delete:collection:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await startDeleteConfirmation(ctx, 'collection', Number(ctx.match[1]));
    });

    bot.callbackQuery(/^collection:(?:delete|confirm_delete):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await startDeleteConfirmation(ctx, 'collection', Number(ctx.match[1]));
    });

    bot.callbackQuery(/^user_delete:cancel(?::(\d+))?$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await deleteBotSession(ctx.db, user.user_id, DELETE_SESSION_TYPE);
        const collectionId = Number(ctx.match?.[1] ?? 0);
        await replaceWithText(
            ctx,
            'تم إلغاء عملية الحذف.',
            new InlineKeyboard()
                .text('⬅️ رجوع', collectionId > 0 ? `collection:view:${collectionId}:page:1` : 'menu_words')
                .text('🏠 الرئيسية', 'menu_main')
        );
    });
}

async function startDeleteConfirmation(
    ctx: BotContext,
    action: DeleteConfirmationAction,
    collectionId?: number
): Promise<void> {
    const user = await currentUser(ctx);
    if (!user) return;

    if ((action === 'collection' || action === 'collection_words') && collectionId) {
        const collection = await getCollectionById(ctx.db, collectionId);
        if (!collection || collection.owner_user_id !== user.user_id) {
            await replaceOrReply(ctx, 'لم أجد هذه المجموعة أو ليست تابعة لحسابك.', backKeyboard('collections:mine:page:1'));
            return;
        }
    }

    await saveBotSession<DeleteConfirmationSession>(
        ctx.db,
        user.user_id,
        DELETE_SESSION_TYPE,
        {
            action,
            expectedText: EXPECTED_CONFIRMATION[action],
            collectionId,
            createdAt: new Date().toISOString(),
        },
        5
    );

    await replaceOrReply(ctx, CONFIRMATION_PROMPT[action], deleteConfirmationKeyboard(action, collectionId));
}

async function handleDeleteConfirmationText(
    ctx: BotContext,
    userId: number,
    session: DeleteConfirmationSession,
    text: string
): Promise<void> {
    if (text !== session.expectedText) {
        await deleteBotSession(ctx.db, userId, DELETE_SESSION_TYPE);
        await ctx.reply('تم إلغاء عملية الحذف.', { reply_markup: new InlineKeyboard().text('🏠 الرئيسية', 'menu_main') });
        return;
    }

    if ((session.action === 'collection' || session.action === 'collection_words') && !session.collectionId) {
        await deleteBotSession(ctx.db, userId, DELETE_SESSION_TYPE);
        await ctx.reply('لم أجد هذه المجموعة أو ليست تابعة لحسابك.', { reply_markup: backKeyboard('collections:mine:page:1') });
        return;
    }

    const result = await executeConfirmedDeletion(ctx, userId, session);
    await deleteBotSession(ctx.db, userId, DELETE_SESSION_TYPE);
    await ctx.reply(result.message, { reply_markup: result.keyboard });
}

async function executeConfirmedDeletion(
    ctx: BotContext,
    userId: number,
    session: DeleteConfirmationSession
): Promise<{ message: string; keyboard: InlineKeyboard }> {
    if (session.action === 'all_words') {
        await deleteAllWordsForUser(ctx.db, userId);
        return { message: '✅ تم حذف كل كلماتك بنجاح.', keyboard: wordsDoneKeyboard() };
    }

    if (session.action === 'all_collections') {
        await deleteAllCollectionsForUser(ctx.db, userId);
        return { message: '✅ تم حذف كل مجموعاتك بنجاح.', keyboard: collectionsDoneKeyboard() };
    }

    if (session.action === 'collection_words') {
        const deleted = await deleteCollectionWordsForUser(ctx.db, session.collectionId!, userId);
        if (deleted === null) return { message: 'لم أجد هذه المجموعة أو ليست تابعة لحسابك.', keyboard: collectionsDoneKeyboard() };
        return {
            message: '✅ تم حذف كل كلمات هذه المجموعة بنجاح.',
            keyboard: new InlineKeyboard()
                .text('👁 عرض المجموعة', `collection:view:${session.collectionId}:page:1`).row()
                .text('🏠 الرئيسية', 'menu_main'),
        };
    }

    if (session.action === 'collection') {
        const deleted = await deleteCollection(ctx.db, session.collectionId!, userId);
        if (!deleted) return { message: 'لم أجد هذه المجموعة أو ليست تابعة لحسابك.', keyboard: collectionsDoneKeyboard() };
        return { message: '✅ تم حذف المجموعة بنجاح.', keyboard: collectionsDoneKeyboard() };
    }

    await deleteAllCollectionsForUser(ctx.db, userId);
    await deleteAllWordsForUser(ctx.db, userId);
    return { message: '✅ تم حذف كل كلماتك وكل مجموعاتك بنجاح.', keyboard: new InlineKeyboard().text('🏠 الرئيسية', 'menu_main') };
}

async function currentUser(ctx: BotContext, reply = true) {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
        if (reply) await safeReply(ctx, 'تعذر تحديد حسابك. أرسل /start ثم جرّب مرة ثانية.');
        return null;
    }
    const user = await getUserByTelegramId(ctx.db, telegramId);
    if (!user && reply) await safeReply(ctx, 'يرجى استخدام /start أولاً.');
    return user;
}

async function replaceOrReply(ctx: BotContext, text: string, keyboard: InlineKeyboard): Promise<void> {
    if (ctx.callbackQuery?.message) {
        await replaceWithText(ctx, text, keyboard);
        return;
    }
    await ctx.reply(text, { reply_markup: keyboard });
}

async function safeReply(ctx: BotContext, text: string): Promise<void> {
    await ctx.reply(text).catch(() => {});
}

function deleteConfirmationKeyboard(action: DeleteConfirmationAction, collectionId?: number): InlineKeyboard {
    return new InlineKeyboard()
        .text('❌ إلغاء', collectionId ? `user_delete:cancel:${collectionId}` : 'user_delete:cancel').row()
        .text('⬅️ رجوع', backCallbackFor(action, collectionId))
        .text('🏠 الرئيسية', 'menu_main');
}

function backCallbackFor(action: DeleteConfirmationAction, collectionId?: number): string {
    if ((action === 'collection' || action === 'collection_words') && collectionId) {
        return `collection:view:${collectionId}:page:1`;
    }
    if (action === 'all_collections') return 'collections:menu';
    if (action === 'all_words_collections') return 'menu_more';
    return 'menu_words';
}

function backKeyboard(backCallback: string): InlineKeyboard {
    return new InlineKeyboard()
        .text('⬅️ رجوع', backCallback)
        .text('🏠 الرئيسية', 'menu_main');
}

function wordsDoneKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('📂 كلماتي', 'menu_words')
        .text('🏠 الرئيسية', 'menu_main');
}

function collectionsDoneKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('🗂 مجموعات الكلمات', 'collections:menu')
        .text('🏠 الرئيسية', 'menu_main');
}
