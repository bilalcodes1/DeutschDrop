import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import { getWordById } from '../repositories/wordRepository';
import {
    createImageAsset,
    excludeWordFromImageMode,
    getActiveWordImage,
    getCollectionImageReadiness,
    getCollectionWordForImage,
    getWordImageState,
    listExcludedImageWords,
    listUserImageLibrary,
    listMissingImageWords,
    removeWordImage,
    restoreExcludedWord,
    selectWordImage,
    type MissingImageWord,
} from '../repositories/wordImageRepository';
import {
    createGameChallenge,
    createGameSession,
    GAME_UI_VERSION,
    type GameChallengeSourceType,
    countOwnGameCollections,
    countOpponentPublicGameCollections,
    countPlayableGameCollections,
    getOpponentPublicGameCollections,
    getPlayableGameCollections,
    ImageModeNotReadyError,
    startGameChallengeForUser,
    type CollectionGameMode,
} from '../services/gameSessionService';
import { ADVENTURE_DIFFICULTIES, ADVENTURE_MODES, type AdventureDifficulty } from '../services/adventureGame';
import { upsertManualVisual, validateManualVisual } from '../services/gameVisualService';
import { downloadImageBytes } from '../services/imageSearch/imageDownloadService';
import { extensionForMime } from '../services/imageSearch/imageValidationService';
import { downloadTelegramPhoto, getTelegramImageMaxBytes, imageUploadErrorDetails, selectBestTelegramPhotoSize } from '../services/imageSearch/manualUploadImageService';
import { searchWordImages } from '../services/imageSearch/imageSearchRouter';
import type { NormalizedImageResult } from '../services/imageSearch/imageSearchTypes';
import type { WordImageProvider } from '../repositories/wordImageRepository';
import { displayUserName, sendTelegramMessage } from '../services/notifications';
import { isAdminTelegramId } from '../services/adminAccess';
import { replaceWithText, showWordDetailPanel } from './wordPanel';

const GAME_COLLECTION_PAGE_SIZE = 8;

interface WordVisualEditSession {
    wordId: number;
    collectionId?: number;
}

interface GameChallengeUserSearchSession {
    searching: true;
}

interface WordImageSearchSession {
    collectionId: number;
    wordId: number;
}

interface WordImageUploadSession {
    collectionId: number;
    wordId: number;
}

interface WordImageResultsSession {
    collectionId: number;
    wordId: number;
    query: string;
    provider: WordImageProvider;
    page: number;
    currentIndex?: number;
    hasNextPage?: boolean;
    results: NormalizedImageResult[];
}

export function registerGameCommand(bot: Bot<BotContext>): void {
    bot.command('game', async (ctx) => {
        const user = await currentUser(ctx);
        if (!user) return;
        await showGameMenu(ctx);
    });

    bot.on('message:text', async (ctx, next) => {
        const telegramId = ctx.from?.id;
        if (!telegramId) return next();
        const user = await getUserByTelegramId(ctx.db, telegramId);
        if (!user) return next();

        if (await getBotSession(ctx.db, user.user_id, 'train')) return next();
        if (await getBotSession(ctx.db, user.user_id, 'challenge')) return next();

        const imageSearch = await getBotSession<WordImageSearchSession>(ctx.db, user.user_id, 'word_image_search');
        if (imageSearch) {
            await deleteBotSession(ctx.db, user.user_id, 'word_image_search');
            await showWordImageResults(ctx, user.user_id, imageSearch.data.collectionId, imageSearch.data.wordId, 'pexels', 1, ctx.message.text.trim());
            return;
        }

        const imageUpload = await getBotSession<WordImageUploadSession>(ctx.db, user.user_id, 'awaiting_manual_word_image_upload');
        if (imageUpload) {
            await ctx.reply('أرسل صورة فقط بصيغة JPEG أو PNG أو WebP، أو اضغط إلغاء من لوحة الكلمة.');
            return;
        }

        const session = await getBotSession<WordVisualEditSession>(ctx.db, user.user_id, 'word_visual_edit');
        if (session) {
            await handleManualVisualText(ctx, user.user_id, session.data.wordId, ctx.message.text, session.data.collectionId);
            return;
        }

        const search = await getBotSession<GameChallengeUserSearchSession>(ctx.db, user.user_id, 'game_challenge_user_search');
        if (!search) return next();
        await deleteBotSession(ctx.db, user.user_id, 'game_challenge_user_search');
        await showGameChallengeUsers(ctx, user.user_id, 1, ctx.message.text.trim());
    });

    bot.on('message:photo', async (ctx, next) => {
        const telegramId = ctx.from?.id;
        if (!telegramId) return next();
        const user = await getUserByTelegramId(ctx.db, telegramId);
        if (!user) return next();
        const session = await getBotSession<WordImageUploadSession>(ctx.db, user.user_id, 'awaiting_manual_word_image_upload');
        if (!session) return next();
        const maxBytes = getTelegramImageMaxBytes(ctx.env);
        const photo = selectBestTelegramPhotoSize(ctx.message.photo ?? [], maxBytes);
        if (!photo?.file_id) {
            await replyImageUploadError(ctx, 'WORD_IMAGE_UPLOAD_TOO_LARGE', user.user_id, session.data.collectionId, session.data.wordId);
            return;
        }
        await handleManualImageUpload(ctx, user.user_id, session.data.collectionId, session.data.wordId, photo.file_id);
    });

    bot.on('message:document', async (ctx, next) => {
        const telegramId = ctx.from?.id;
        if (!telegramId) return next();
        const user = await getUserByTelegramId(ctx.db, telegramId);
        if (!user) return next();
        const session = await getBotSession<WordImageUploadSession>(ctx.db, user.user_id, 'awaiting_manual_word_image_upload');
        if (!session) return next();
        await ctx.reply('هذا الملف غير مدعوم. أرسل صورة Telegram مباشرة بصيغة JPEG أو PNG أو WebP.');
    });

    bot.callbackQuery('game:menu', async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showGameMenu(ctx);
    });

    bot.callbackQuery('game:solo', async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showGameCollections(ctx, user.user_id, 1);
    });

    bot.callbackQuery(/^game:collections:page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showGameCollections(ctx, user.user_id, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^game:start:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showGameModePicker(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^game:start_collection:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showGameModePicker(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^game:mode:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showGameModePicker(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^game:limit:(\d+):(speech_rocket|image_speech|arabic_speech|smart_mix|hard_words|boss)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showGameLimitPicker(ctx, Number(ctx.match[1]), ctx.match[2] as CollectionGameMode);
    });

    bot.callbackQuery(/^game:difficulty:(\d+):(speech_rocket|image_speech|arabic_speech|smart_mix|hard_words|boss):(-?\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showGameDifficultyPicker(ctx, Number(ctx.match[1]), ctx.match[2] as CollectionGameMode, Number(ctx.match[3]));
    });

    bot.callbackQuery(/^game:launch:(\d+):(speech_rocket|image_speech|arabic_speech|smart_mix|hard_words|boss):(-?\d+):(easy|normal|hard)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await startGameForCollection(ctx, user.user_id, Number(ctx.match[1]), ctx.match[2] as CollectionGameMode, Number(ctx.match[3]), ctx.match[4] as AdventureDifficulty);
    });

    bot.callbackQuery(/^game_challenge:users:page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showGameChallengeUsers(ctx, user.user_id, Number(ctx.match[1]));
    });

    bot.callbackQuery('game_challenge:search', async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await saveBotSession<GameChallengeUserSearchSession>(ctx.db, user.user_id, 'game_challenge_user_search', { searching: true }, 10);
        await replaceWithText(ctx, '🔍 اكتب اسم المستخدم الذي تريد تحديه:', backHomeKeyboard('game_challenge:users:page:1'));
    });

    bot.callbackQuery(/^game_challenge:opponent:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showGameChallengeSources(ctx, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^game_challenge:source:(mine|opponent|mixed):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showGameChallengeCollections(ctx, user.user_id, Number(ctx.match[2]), ctx.match[1] as GameChallengeSourceType, 1);
    });

    bot.callbackQuery(/^game_challenge:collections:(mine|opponent|mixed):(\d+):page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showGameChallengeCollections(ctx, user.user_id, Number(ctx.match[2]), ctx.match[1] as GameChallengeSourceType, Number(ctx.match[3]));
    });

    bot.callbackQuery(/^game_challenge:create:(mine|opponent|mixed):(\d+):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await createGameChallengeFromSelection(ctx, user.user_id, ctx.match[1] as GameChallengeSourceType, Number(ctx.match[2]), Number(ctx.match[3]));
    });

    bot.callbackQuery(/^game_challenge:start:(\d+):(creator|opponent)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await openGameChallenge(ctx, user.user_id, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^wi:dash:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showWordImageDashboard(ctx, user.user_id, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^wi:missing:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await openNextMissingImageWord(ctx, user.user_id, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^wi:missing_list:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showMissingImageWords(ctx, user.user_id, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^wi:excluded:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showExcludedImageWords(ctx, user.user_id, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^wi:review:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showImageReviewList(ctx, user.user_id, Number(ctx.match[1]));
    });

    bot.callbackQuery(/^wi:word:(\d+):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showWordImageWordMenu(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]));
    });

    bot.callbackQuery(/^wi:auto:(\d+):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showWordImageResults(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]), undefined, 1);
    });

    bot.callbackQuery(/^wi:src:(\d+):(\d+):(legacy|pexels|pixabay|unsplash):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showWordImageResults(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]), ctx.match[3] as WordImageProvider, Number(ctx.match[4]));
    });

    bot.callbackQuery(/^wi:pick:(\d+):(\d+):(legacy|pexels|pixabay|unsplash):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await selectImageSearchResult(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]), ctx.match[3] as WordImageProvider, Number(ctx.match[4]));
    });

    bot.callbackQuery(/^wi:nav:(prev|next):(\d+):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await navigateWordImageResult(ctx, user.user_id, Number(ctx.match[2]), Number(ctx.match[3]), ctx.match[1] as 'prev' | 'next');
    });

    bot.callbackQuery(/^wi:use_current:(\d+):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        const session = await getBotSession<WordImageResultsSession>(ctx.db, user.user_id, 'word_image_results');
        await selectImageSearchResult(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]), session?.data.provider ?? 'pexels', session?.data.currentIndex ?? 0);
    });

    bot.callbackQuery(/^wi:providers:(\d+):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        const collectionId = Number(ctx.match[1]);
        const wordId = Number(ctx.match[2]);
        await replaceWithText(ctx, '🗂 اختر مصدر الصور:', new InlineKeyboard()
            .text('Legacy', `wi:src:${collectionId}:${wordId}:legacy:1`)
            .text('Pexels', `wi:src:${collectionId}:${wordId}:pexels:1`).row()
            .text('Pixabay', `wi:src:${collectionId}:${wordId}:pixabay:1`)
            .text('Unsplash', `wi:src:${collectionId}:${wordId}:unsplash:1`).row()
            .text('⬅️ رجوع', `wi:word:${collectionId}:${wordId}`)
            .text('🏠 الرئيسية', 'menu_main'));
    });

    bot.callbackQuery(/^wi:search:(\d+):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        const collectionId = Number(ctx.match[1]);
        const wordId = Number(ctx.match[2]);
        const word = await getCollectionWordForImage(ctx.db, user.user_id, collectionId, wordId);
        if (!word) {
            await replaceWithText(ctx, 'لم أجد هذه الكلمة داخل مجموعتك.', backHomeKeyboard(`wi:dash:${collectionId}`));
            return;
        }
        await saveBotSession<WordImageSearchSession>(ctx.db, user.user_id, 'word_image_search', { collectionId, wordId }, 15);
        await replaceWithText(ctx, `🔎 بحث يدوي عن صورة\n\n🇩🇪 ${word.german}\n🇮🇶 ${word.arabic}\n\nاكتب كلمة بحث قصيرة مثل:\ncar\nbarber haircut\nduck animal`, new InlineKeyboard()
            .text('❌ إلغاء', `wi:word:${collectionId}:${wordId}`).row()
            .text('🏠 الرئيسية', 'menu_main'));
    });

    bot.callbackQuery(/^wi:upload:(\d+):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        const collectionId = Number(ctx.match[1]);
        const wordId = Number(ctx.match[2]);
        if (!await getCollectionWordForImage(ctx.db, user.user_id, collectionId, wordId)) {
            await replaceWithText(ctx, 'لم أجد هذه الكلمة داخل مجموعتك.', backHomeKeyboard(`wi:dash:${collectionId}`));
            return;
        }
        await saveBotSession<WordImageUploadSession>(ctx.db, user.user_id, 'awaiting_manual_word_image_upload', { collectionId, wordId }, 15);
        await replaceWithText(ctx, '📤 ارفع صورة واضحة لهذه الكلمة.\n\nأقبل JPEG / PNG / WebP فقط، وحجم صغير مناسب للتعلم.', new InlineKeyboard()
            .text('❌ إلغاء', `wi:word:${collectionId}:${wordId}`).row()
            .text('🏠 الرئيسية', 'menu_main'));
    });

    bot.callbackQuery(/^wi:library:(\d+):(\d+):page:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await showUserImageLibrary(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]), Number(ctx.match[3]));
    });

    bot.callbackQuery(/^wi:libpick:(\d+):(\d+):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        const collectionId = Number(ctx.match[1]);
        const wordId = Number(ctx.match[2]);
        await selectWordImage(ctx.db, user.user_id, collectionId, wordId, Number(ctx.match[3]), {
            isAdminDefault: isAdminTelegramId(ctx.env, ctx.from?.id),
        });
        await continueAfterImageDecision(ctx, user.user_id, collectionId, 'تم استخدام صورة محفوظة ✅');
    });

    bot.callbackQuery(/^wi:exclude:(\d+):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await excludeWordFromImageMode(ctx.db, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]), 'manual_exclude');
        await showWordImageDashboard(ctx, user.user_id, Number(ctx.match[1]), 'تم استبعاد الكلمة من مود الصور.');
    });

    bot.callbackQuery(/^wi:restore:(\d+):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await restoreExcludedWord(ctx.db, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]));
        await showWordImageWordMenu(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]), 'تم إرجاع الكلمة إلى قائمة الصور.');
    });

    bot.callbackQuery(/^wi:remove:(\d+):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        const collectionId = Number(ctx.match[1]);
        const wordId = Number(ctx.match[2]);
        await replaceWithText(ctx, 'هل تريد إزالة صورة هذه الكلمة؟\n\nالكلمة نفسها لن تُحذف، وستعود إلى حالة تحتاج صورة.', new InlineKeyboard()
            .text('🗑 نعم، إزالة الصورة', `wi:remove_confirm:${collectionId}:${wordId}`).row()
            .text('⬅️ رجوع', `wi:word:${collectionId}:${wordId}`)
            .text('🏠 الرئيسية', 'menu_main'));
    });

    bot.callbackQuery(/^wi:remove_confirm:(\d+):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await removeWordImage(ctx.db, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]));
        await showWordImageWordMenu(ctx, user.user_id, Number(ctx.match[1]), Number(ctx.match[2]), 'تم حذف صورة هذه الكلمة.');
    });

    bot.callbackQuery(/^word_visual_edit:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        const wordId = Number(ctx.match[1]);
        const word = await getWordById(ctx.db, wordId);
        if (!word || word.added_by !== user.user_id) {
            await replaceWithText(ctx, 'ما قدرت أفتح تعديل الرمز لهذه الكلمة.', backHomeKeyboard('list_words'));
            return;
        }
        await saveBotSession<WordVisualEditSession>(ctx.db, user.user_id, 'word_visual_edit', { wordId }, 30);
        await replaceWithText(
            ctx,
            `🎨 تعديل الإيموجي\n\n🇩🇪 ${word.german}\n🇮🇶 ${word.arabic}\n\nأرسل إيموجي واحد أو إيموجيين يوضحون المعنى.\n\nالصور والروابط غير مقبولة داخل اللعبة.`,
            new InlineKeyboard()
                .text('❌ إلغاء', `word_visual_cancel:${wordId}`).row()
                .text('⬅️ رجوع للكلمة', `word_detail_${wordId}`)
                .text('🏠 الرئيسية', 'menu_main')
        );
    });

    bot.callbackQuery(/^word_visual_cancel:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await currentUser(ctx);
        if (!user) return;
        await deleteBotSession(ctx.db, user.user_id, 'word_visual_edit');
        await showWordDetailPanel(ctx, Number(ctx.match[1]), 'تم إلغاء تعديل الرمز.');
    });
}

export async function showGameCollections(ctx: BotContext, userId: number, page: number): Promise<void> {
    const ownTotal = await countOwnGameCollections(ctx.db, userId);
    if (ownTotal === 0) {
        await replaceWithText(
            ctx,
            '🫧 لعبة دودة البحر والكلمات\n\nما عندك مجموعة كلمات حتى تبدأ اللعبة. سوّي مجموعة كلمات وأضف كلمات، بعدها ترجع تلعب.',
            new InlineKeyboard()
                .text('➕ إنشاء مجموعة', 'collections:create').row()
                .text('🏠 الرئيسية', 'menu_main')
        );
        return;
    }

    const total = await countPlayableGameCollections(ctx.db, userId);
    if (total === 0) {
        await replaceWithText(
            ctx,
            '🫧 لعبة دودة البحر والكلمات\n\nمجموعاتك موجودة، لكن تحتاج تضيف كلمات حتى تبدأ اللعبة.',
            new InlineKeyboard()
                .text('📚 مجموعاتي', 'collections:mine:page:1').row()
                .text('🏠 الرئيسية', 'menu_main')
        );
        return;
    }

    const totalPages = Math.max(1, Math.ceil(total / GAME_COLLECTION_PAGE_SIZE));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const collections = await getPlayableGameCollections(
        ctx.db,
        userId,
        GAME_COLLECTION_PAGE_SIZE,
        (safePage - 1) * GAME_COLLECTION_PAGE_SIZE
    );

    const text = `🫧 العب وحدك\n\nاختر مجموعة من مجموعاتك حتى تبدأ لعبة دودة البحر والكلمات.\n\nالصفحة: ${safePage} / ${totalPages}`;
    const keyboard = new InlineKeyboard();
    for (const collection of collections) {
        keyboard.text(`📚 ${collection.title} — ${collection.word_count} كلمة`, `game:start:${collection.id}`).row();
    }
    if (safePage > 1) keyboard.text('⬅️ السابق', `game:collections:page:${safePage - 1}`);
    if (safePage < totalPages) keyboard.text('التالي ➡️', `game:collections:page:${safePage + 1}`);
    if (safePage > 1 || safePage < totalPages) keyboard.row();
    keyboard.text('⬅️ رجوع', 'game:menu').text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, text, keyboard);
}

async function showGameModePicker(ctx: BotContext, collectionId: number): Promise<void> {
    const keyboard = new InlineKeyboard();
    keyboard.text('🫧 كلاسيك دودة البحر', `game:limit:${collectionId}:speech_rocket`).row();
    for (const mode of ADVENTURE_MODES) {
        keyboard.text(mode.label, `game:limit:${collectionId}:${mode.mode}`).row();
    }
    keyboard.text('🔙 رجوع للمجموعة', `collection:view:${collectionId}:page:1`)
        .text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, '🎮 DeutschDrop Adventure\n\nاختر مود اللعبة:', keyboard);
}

async function showGameLimitPicker(ctx: BotContext, collectionId: number, mode: CollectionGameMode): Promise<void> {
    const keyboard = new InlineKeyboard()
        .text('⚡ قصيرة — 10 كلمات', `game:difficulty:${collectionId}:${mode}:10`).row()
        .text('🎯 عادية — 20 كلمة', `game:difficulty:${collectionId}:${mode}:20`).row()
        .text('🏆 كل الكلمات المتاحة', `game:difficulty:${collectionId}:${mode}:-1`).row()
        .text('🔙 رجوع', `game:mode:${collectionId}`)
        .text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, `🎮 إعداد الجولة\n\nالمود: ${gameModeLabel(mode)}\n\nاختر حجم الجولة:`, keyboard);
}

async function showGameDifficultyPicker(ctx: BotContext, collectionId: number, mode: CollectionGameMode, limit: number): Promise<void> {
    const keyboard = new InlineKeyboard();
    for (const difficulty of Object.values(ADVENTURE_DIFFICULTIES)) {
        keyboard.text(difficultyLabel(difficulty.difficulty), `game:launch:${collectionId}:${mode}:${limit}:${difficulty.difficulty}`).row();
    }
    keyboard.text('🔙 رجوع', `game:limit:${collectionId}:${mode}`)
        .text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, `⚔️ الصعوبة\n\nالمود: ${gameModeLabel(mode)}\nعدد الكلمات: ${limit === -1 ? 'كل الكلمات المتاحة' : limit}\n\nاختر الصعوبة:`, keyboard);
}

function gameModeLabel(mode: CollectionGameMode): string {
    if (mode === 'speech_rocket') return '🫧 كلاسيك دودة البحر';
    return ADVENTURE_MODES.find(item => item.mode === mode)?.label ?? mode;
}

function difficultyLabel(difficulty: AdventureDifficulty): string {
    if (difficulty === 'easy') return '🌱 سهل';
    if (difficulty === 'hard') return '🔥 صعب';
    return '⚔️ عادي';
}

async function showGameMenu(ctx: BotContext): Promise<void> {
    await replaceWithText(
        ctx,
        '🎮 DeutschDrop Adventure\nانطق، قاتل، وتعلّم\n\nمصدر الكلمات:',
        new InlineKeyboard()
            .text('📚 مجموعة محددة', 'game:solo').row()
            .text('🔥 الكلمات الصعبة', 'game:solo')
            .text('🔁 المستحقة للمراجعة', 'game:solo').row()
            .text('🎲 خليط ذكي', 'game:solo').row()
            .text('⚔️ تحدي شخص', 'game_challenge:users:page:1').row()
            .text('🏠 الرئيسية', 'menu_main')
    );
}

export async function showWordImageDashboard(ctx: BotContext, userId: number, collectionId: number, notice?: string): Promise<void> {
    const readiness = await getCollectionImageReadiness(ctx.db, userId, collectionId);
    const collection = await ctx.db.prepare('SELECT title FROM word_collections WHERE id = ? AND owner_user_id = ? AND is_deleted = 0')
        .bind(collectionId, userId)
        .first<{ title: string }>();
    const missing = await listMissingImageWords(ctx.db, userId, collectionId, 8, 0);
    const lines = [
        notice ? `${notice}\n` : '',
        '🖼 صور المجموعة',
        '',
        `📚 المجموعة: ${collection?.title ?? `#${collectionId}`}`,
        `📝 مجموع الكلمات: ${readiness.totalWords}`,
        `✅ لديها صور: ${readiness.selectedWords}`,
        `⏳ تحتاج صوراً: ${readiness.missingWords}`,
        `⏭ مستبعدة من مود الصور: ${readiness.excludedWords}`,
        `📊 الجاهزية: ${readiness.selectedWords + readiness.excludedWords}/${readiness.totalWords}`,
        '',
        readiness.isReady
            ? '✅ المجموعة جاهزة للعب بالصور.'
            : 'اختر صورة لكل كلمة، أو استبعد الكلمات التي لا تملك صورة واضحة.',
    ].filter(Boolean);
    if (missing.length > 0) {
        lines.push('', 'كلمات تحتاج صورة:');
        for (const word of missing) lines.push(`• ${word.german} — ${word.arabic}`);
    }
    const keyboard = new InlineKeyboard()
        .text('▶️ تجهيز الصور الناقصة', `wi:missing:${collectionId}`).row()
        .text('🔎 اختيار كلمة', `wi:missing_list:${collectionId}`)
        .text('👁 مراجعة الصور', `wi:review:${collectionId}`).row()
        .text('⏭ الكلمات المستبعدة', `wi:excluded:${collectionId}`).row()
        .text('🎮 العب بالصور', `game:limit:${collectionId}:image_speech`).row()
        .text('🔙 رجوع', `collection:view:${collectionId}:page:1`)
        .text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, lines.join('\n'), keyboard);
}

async function showWordImageWordMenu(
    ctx: BotContext,
    userId: number,
    collectionId: number,
    wordId: number,
    notice?: string
): Promise<void> {
    const word = await getCollectionWordForImage(ctx.db, userId, collectionId, wordId);
    if (!word) {
        await replaceWithText(ctx, 'لم أجد هذه الكلمة داخل مجموعتك.', backHomeKeyboard(`wi:dash:${collectionId}`));
        return;
    }
    const active = await getActiveWordImage(ctx.db, userId, collectionId, wordId);
    const state = await getWordImageState(ctx.db, userId, collectionId, wordId);
    const status = active
        ? `✅ صورة محفوظة\nالمصدر: ${active.provider ?? '-'}\n${active.attribution_text ? `النسبة: ${active.attribution_text}` : ''}`
        : state?.state === 'excluded'
            ? `⏭ مستبعدة من مود الصور\nالسبب: ${state.excluded_reason ?? '-'}`
            : 'لا توجد صورة محفوظة لهذه الكلمة.';
    const text = [
        notice ? `${notice}\n` : '',
        '🖼 صورة الكلمة',
        '',
        `🇩🇪 ${word.german}`,
        `🇮🇶 ${word.arabic}`,
        word.example ? `مثال: ${word.example}` : '',
        '',
        status,
    ].filter(Boolean).join('\n');
    const keyboard = new InlineKeyboard();
    if (active) {
        keyboard.text('👁 عرض الصورة', `wi:word:${collectionId}:${wordId}`).row()
            .text('🔄 تغيير الصورة', `wi:auto:${collectionId}:${wordId}`)
            .text('🗂 اختيار مصدر آخر', `wi:providers:${collectionId}:${wordId}`).row()
            .text('📤 رفع بديلة', `wi:upload:${collectionId}:${wordId}`)
            .text('📁 صوري المحفوظة', `wi:library:${collectionId}:${wordId}:page:1`).row()
            .text('🗑 إزالة الصورة', `wi:remove:${collectionId}:${wordId}`).row();
    } else if (state?.state === 'excluded') {
        keyboard.text('🖼 إضافة صورة وإرجاعها للمود', `wi:auto:${collectionId}:${wordId}`).row()
            .text('🔎 البحث يدوياً', `wi:search:${collectionId}:${wordId}`)
            .text('📤 رفع صورة', `wi:upload:${collectionId}:${wordId}`).row()
            .text('📁 صوري المحفوظة', `wi:library:${collectionId}:${wordId}:page:1`).row();
    } else {
        keyboard.text('➕ اختيار صورة', `wi:auto:${collectionId}:${wordId}`).row()
            .text('📤 رفع صورة', `wi:upload:${collectionId}:${wordId}`)
            .text('📁 صوري المحفوظة', `wi:library:${collectionId}:${wordId}:page:1`).row()
            .text('⏭ استبعادها من مود الصور', `wi:exclude:${collectionId}:${wordId}`).row();
    }
    if (state?.state === 'excluded') {
        keyboard.text('↩️ إلغاء الاستبعاد', `wi:restore:${collectionId}:${wordId}`).row();
    }
    keyboard.text('🔙 رجوع', `wi:dash:${collectionId}`).text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, text, keyboard);
}

async function showWordImageResults(
    ctx: BotContext,
    userId: number,
    collectionId: number,
    wordId: number,
    provider?: WordImageProvider,
    page = 1,
    query?: string
): Promise<void> {
    const word = await getCollectionWordForImage(ctx.db, userId, collectionId, wordId);
    if (!word) {
        await replaceWithText(ctx, 'لم أجد هذه الكلمة داخل مجموعتك.', backHomeKeyboard(`wi:dash:${collectionId}`));
        return;
    }
    const response = await searchWordImages(ctx.db, ctx.env, {
        german: word.german,
        arabic: word.arabic,
        query,
        page,
        perPage: 5,
    }, provider);
    if (response.results.length === 0) {
        await replaceWithText(ctx, `ℹ️ هذه الكلمة لا تملك صورة تعليمية واضحة.\n\nيمكنك:\n🔎 البحث يدوياً\n📤 رفع صورة\n⏭ استبعادها من مود الصور`, new InlineKeyboard()
            .text('🔎 البحث يدوياً', `wi:search:${collectionId}:${wordId}`).row()
            .text('📤 رفع صورة', `wi:upload:${collectionId}:${wordId}`).row()
            .text('⏭ استبعادها من مود الصور', `wi:exclude:${collectionId}:${wordId}`).row()
            .text('🔙 رجوع', `wi:word:${collectionId}:${wordId}`)
            .text('🏠 الرئيسية', 'menu_main'));
        return;
    }
    await saveBotSession<WordImageResultsSession>(
        ctx.db,
        userId,
        'word_image_results',
        { collectionId, wordId, query: response.query, provider: response.provider, page: response.page, currentIndex: 0, hasNextPage: response.hasNextPage, results: response.results },
        20
    );
    await renderWordImagePicker(ctx, userId, word, {
        collectionId,
        wordId,
        query: response.query,
        provider: response.provider,
        page: response.page,
        currentIndex: 0,
        hasNextPage: response.hasNextPage,
        results: response.results,
    });
}

async function selectImageSearchResult(
    ctx: BotContext,
    userId: number,
    collectionId: number,
    wordId: number,
    provider: WordImageProvider,
    index: number
): Promise<void> {
    const session = await getBotSession<WordImageResultsSession>(ctx.db, userId, 'word_image_results');
    const result = session?.data.collectionId === collectionId
        && session.data.wordId === wordId
        && session.data.provider === provider
        ? session.data.results[index]
        : null;
    if (!result) {
        await showWordImageWordMenu(ctx, userId, collectionId, wordId, 'انتهت نتائج البحث. ابدأ البحث مرة ثانية.');
        return;
    }
    const query = session?.data.query ?? '';
    let created: CreatedImageAsset | null = null;
    try {
        created = await createAssetFromSearchResult(ctx, userId, collectionId, wordId, result, query);
        await selectWordImage(ctx.db, userId, collectionId, wordId, created.assetId, {
            isAdminDefault: isAdminTelegramId(ctx.env, ctx.from?.id),
        });
        await deleteBotSession(ctx.db, userId, 'word_image_results');
        await continueAfterImageDecision(ctx, userId, collectionId, 'تم حفظ صورة الكلمة ✅');
    } catch (error) {
        if (created?.r2Key && ctx.env.WORD_IMAGES) {
            await ctx.env.WORD_IMAGES.delete(created.r2Key).catch(() => undefined);
        }
        throw error;
    }
}

async function renderWordImagePicker(
    ctx: BotContext,
    userId: number,
    word: MissingImageWord,
    session: WordImageResultsSession
): Promise<void> {
    const result = session.results[session.currentIndex ?? 0];
    if (!result) {
        await showWordImageWordMenu(ctx, userId, session.collectionId, session.wordId, 'انتهت نتائج البحث. ابدأ البحث مرة ثانية.');
        return;
    }
    const collection = await ctx.db.prepare('SELECT title FROM word_collections WHERE id = ? AND owner_user_id = ? AND is_deleted = 0')
        .bind(session.collectionId, userId)
        .first<{ title: string }>();
    const current = (session.currentIndex ?? 0) + 1;
    const totalLabel = session.hasNextPage ? `${session.results.length}+` : String(session.results.length);
    const text = [
        '🖼 اختر صورة للكلمة',
        '',
        `🇩🇪 ${word.german}`,
        `🇮🇶 ${word.arabic}`,
        `📚 المجموعة: ${collection?.title ?? `#${session.collectionId}`}`,
        `🔎 البحث: ${session.query}`,
        `🗂 المصدر: ${providerLabel(session.provider)}`,
        `🖼 النتيجة: ${current}/${totalLabel}`,
        '',
        result.title,
        result.attributionText,
    ].join('\n');
    const keyboard = new InlineKeyboard()
        .text('⬅️ السابقة', `wi:nav:prev:${session.collectionId}:${session.wordId}`)
        .text('➡️ التالية', `wi:nav:next:${session.collectionId}:${session.wordId}`).row()
        .text('✅ استخدام هذه الصورة', `wi:use_current:${session.collectionId}:${session.wordId}`).row()
        .text('🗂 تغيير المصدر', `wi:providers:${session.collectionId}:${session.wordId}`)
        .text('🔎 بحث آخر', `wi:search:${session.collectionId}:${session.wordId}`).row()
        .text('✏️ تعديل عبارة البحث', `wi:search:${session.collectionId}:${session.wordId}`)
        .text('📤 رفع صورة', `wi:upload:${session.collectionId}:${session.wordId}`).row()
        .text('📁 صوري المحفوظة', `wi:library:${session.collectionId}:${session.wordId}:page:1`).row()
        .text('⏭ استبعادها من مود الصور', `wi:exclude:${session.collectionId}:${session.wordId}`).row()
        .text('❌ إلغاء', `wi:word:${session.collectionId}:${session.wordId}`);
    await replaceWithText(ctx, text, keyboard);
}

async function navigateWordImageResult(
    ctx: BotContext,
    userId: number,
    collectionId: number,
    wordId: number,
    direction: 'prev' | 'next'
): Promise<void> {
    const session = await getBotSession<WordImageResultsSession>(ctx.db, userId, 'word_image_results');
    if (!session || session.data.collectionId !== collectionId || session.data.wordId !== wordId) {
        await showWordImageWordMenu(ctx, userId, collectionId, wordId, 'انتهت نتائج البحث. ابدأ البحث مرة ثانية.');
        return;
    }
    const word = await getCollectionWordForImage(ctx.db, userId, collectionId, wordId);
    if (!word) {
        await replaceWithText(ctx, 'لم أجد هذه الكلمة داخل مجموعتك.', backHomeKeyboard(`wi:dash:${collectionId}`));
        return;
    }
    let index = session.data.currentIndex ?? 0;
    if (direction === 'prev') {
        index = Math.max(0, index - 1);
    } else if (index + 1 < session.data.results.length) {
        index += 1;
    } else if (session.data.hasNextPage !== false) {
        await showWordImageResults(ctx, userId, collectionId, wordId, session.data.provider, session.data.page + 1, session.data.query);
        return;
    }
    const nextSession = { ...session.data, currentIndex: index };
    await saveBotSession<WordImageResultsSession>(ctx.db, userId, 'word_image_results', nextSession, 20);
    await renderWordImagePicker(ctx, userId, word, nextSession);
}

async function continueAfterImageDecision(ctx: BotContext, userId: number, collectionId: number, notice: string): Promise<void> {
    const missing = await listMissingImageWords(ctx.db, userId, collectionId, 1, 0);
    if (missing[0]) {
        await showWordImageWordMenu(ctx, userId, collectionId, missing[0].word_id, `${notice}\n\nننتقل للكلمة التالية التي تحتاج صورة.`);
        return;
    }
    await showWordImageDashboard(ctx, userId, collectionId, `${notice}\n\n✅ المجموعة جاهزة لمود الصور.`);
}

async function openNextMissingImageWord(ctx: BotContext, userId: number, collectionId: number): Promise<void> {
    const missing = await listMissingImageWords(ctx.db, userId, collectionId, 1, 0);
    if (!missing[0]) {
        await showWordImageDashboard(ctx, userId, collectionId, 'لا توجد كلمات ناقصة حالياً.');
        return;
    }
    await showWordImageWordMenu(ctx, userId, collectionId, missing[0].word_id);
}

async function showMissingImageWords(ctx: BotContext, userId: number, collectionId: number): Promise<void> {
    const words = await listMissingImageWords(ctx.db, userId, collectionId, 10, 0);
    const keyboard = new InlineKeyboard();
    for (const word of words) keyboard.text(`🖼 ${word.german} — ${word.arabic}`, `wi:word:${collectionId}:${word.word_id}`).row();
    keyboard.text('▶️ تجهيز الصور الناقصة', `wi:missing:${collectionId}`).row()
        .text('🔙 رجوع', `wi:dash:${collectionId}`)
        .text('🏠 الرئيسية', 'menu_main');
    const text = words.length
        ? `📋 الكلمات الناقصة\n\n${words.map(word => `• ${word.german} — ${word.arabic}`).join('\n')}`
        : '✅ لا توجد كلمات ناقصة.';
    await replaceWithText(ctx, text, keyboard);
}

async function showExcludedImageWords(ctx: BotContext, userId: number, collectionId: number): Promise<void> {
    const words = await listExcludedImageWords(ctx.db, userId, collectionId, 10, 0);
    const keyboard = new InlineKeyboard();
    for (const word of words) keyboard.text(`↩️ ${word.german} — ${word.arabic}`, `wi:word:${collectionId}:${word.word_id}`).row();
    keyboard.text('🔙 رجوع', `wi:dash:${collectionId}`).text('🏠 الرئيسية', 'menu_main');
    const text = words.length
        ? `⏭ الكلمات المستبعدة\n\n${words.map(word => `• ${word.german} — ${word.arabic}`).join('\n')}`
        : 'لا توجد كلمات مستبعدة حالياً.';
    await replaceWithText(ctx, text, keyboard);
}

async function showImageReviewList(ctx: BotContext, userId: number, collectionId: number): Promise<void> {
    const readiness = await getCollectionImageReadiness(ctx.db, userId, collectionId);
    const words = await ctx.db.prepare(
        `SELECT w.word_id, w.german, w.arabic
         FROM user_word_images uwi
         INNER JOIN words w ON w.word_id = uwi.word_id
         WHERE uwi.user_id = ? AND uwi.collection_id = ? AND uwi.state = 'selected' AND uwi.deleted_at IS NULL
         ORDER BY uwi.updated_at DESC LIMIT 10`
    ).bind(userId, collectionId).all<MissingImageWord>();
    const keyboard = new InlineKeyboard();
    for (const word of words.results ?? []) keyboard.text(`👁 ${word.german} — ${word.arabic}`, `wi:word:${collectionId}:${word.word_id}`).row();
    keyboard.text('🔙 رجوع', `wi:dash:${collectionId}`).text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, `👁 مراجعة الصور\n\n✅ لديها صور: ${readiness.selectedWords}\n\n${(words.results ?? []).map(word => `• ${word.german} — ${word.arabic}`).join('\n') || 'لا توجد صور مختارة بعد.'}`, keyboard);
}

async function showUserImageLibrary(ctx: BotContext, userId: number, collectionId: number, wordId: number, page: number): Promise<void> {
    const limit = 6;
    const safePage = Math.max(1, page);
    const assets = await listUserImageLibrary(ctx.db, userId, limit + 1, (safePage - 1) * limit);
    const visible = assets.slice(0, limit);
    const keyboard = new InlineKeyboard();
    for (const asset of visible) {
        keyboard.text(`📁 ${asset.provider} #${asset.id}`, `wi:libpick:${collectionId}:${wordId}:${asset.id}`).row();
    }
    if (safePage > 1) keyboard.text('⬅️ السابق', `wi:library:${collectionId}:${wordId}:page:${safePage - 1}`);
    if (assets.length > limit) keyboard.text('التالي ➡️', `wi:library:${collectionId}:${wordId}:page:${safePage + 1}`);
    if (safePage > 1 || assets.length > limit) keyboard.row();
    keyboard.text('🔙 رجوع', `wi:word:${collectionId}:${wordId}`).text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, visible.length ? '📁 صوري المحفوظة\n\nاختر صورة محفوظة لإعادة استخدامها.' : '📁 صوري المحفوظة\n\nلا توجد صور محفوظة بعد.', keyboard);
}

async function handleManualImageUpload(ctx: BotContext, userId: number, collectionId: number, wordId: number, fileId: string): Promise<void> {
    let r2Key: string | null = null;
    try {
        const downloaded = await downloadTelegramPhoto(ctx.env, fileId);
        if (!ctx.env.WORD_IMAGES) throw new Error('WORD_IMAGE_UPLOAD_R2_FAILED');
        r2Key = wordImageR2Key(userId, collectionId, wordId, downloaded.mimeType);
        try {
            await ctx.env.WORD_IMAGES.put(r2Key, downloaded.bytes, {
                httpMetadata: { contentType: downloaded.mimeType },
                customMetadata: { user_id: String(userId), collection_id: String(collectionId), word_id: String(wordId), provider: 'manual_upload' },
            });
        } catch {
            throw new Error('WORD_IMAGE_UPLOAD_R2_FAILED');
        }
        const assetId = await createImageAsset(ctx.db, {
            ownerUserId: userId,
            provider: 'manual_upload',
            providerImageId: fileId,
            storageType: 'r2',
            r2Key,
            mimeType: downloaded.mimeType,
            fileSize: downloaded.size,
            sha256: downloaded.sha256,
            telegramFileId: fileId,
            attributionText: 'User uploaded image',
        });
        await selectWordImage(ctx.db, userId, collectionId, wordId, assetId, {
            isAdminDefault: isAdminTelegramId(ctx.env, ctx.from?.id),
        });
        await deleteBotSession(ctx.db, userId, 'awaiting_manual_word_image_upload');
        await continueAfterImageDecision(ctx, userId, collectionId, 'تم حفظ الصورة المرفوعة ✅');
    } catch (error) {
        if (r2Key && ctx.env.WORD_IMAGES) {
            await ctx.env.WORD_IMAGES.delete(r2Key).catch(() => undefined);
        }
        await replyImageUploadError(ctx, imageUploadErrorCode(error), userId, collectionId, wordId, imageUploadErrorDetails(error));
    }
}

async function replyImageUploadError(
    ctx: BotContext,
    code: string,
    userId: number,
    collectionId: number,
    wordId: number,
    details: { mimeType?: string | null; byteCount?: number | null } = {}
): Promise<void> {
    const stage = normalizeUploadErrorCode(code);
    console.warn('word_image_upload_failed', {
        userId,
        collectionId,
        wordId,
        stage,
        mimeType: details.mimeType ?? null,
        byteCount: details.byteCount ?? null,
    });

    const text = stage === 'WORD_IMAGE_UPLOAD_TOO_LARGE'
        ? '⚠️ حجم الصورة أكبر من الحد المسموح.\nأرسل نسخة أصغر من الصورة.'
        : stage === 'WORD_IMAGE_UPLOAD_UNSUPPORTED_SIGNATURE'
            ? '⚠️ الصورة ليست بصيغة مدعومة.\nأرسل صورة JPEG أو PNG أو WebP.'
            : '⚠️ تعذر حفظ الصورة حالياً.\nلم يتم تغيير الصورة السابقة، حاول مرة أخرى.';
    await ctx.reply(text, {
        reply_markup: new InlineKeyboard().text('⬅️ رجوع', `wi:word:${collectionId}:${wordId}`).text('🏠 الرئيسية', 'menu_main'),
    });
}

function imageUploadErrorCode(error: unknown): string {
    return error instanceof Error ? error.message : 'WORD_IMAGE_UPLOAD_D1_FAILED';
}

function normalizeUploadErrorCode(code: string): string {
    if (code === 'image_too_large') return 'WORD_IMAGE_UPLOAD_TOO_LARGE';
    if (code === 'empty_image_body' || code === 'unsupported_image_signature' || code === 'unsupported_image_mime' || code === 'image_mime_mismatch') {
        return 'WORD_IMAGE_UPLOAD_UNSUPPORTED_SIGNATURE';
    }
    if (code.startsWith('WORD_IMAGE_UPLOAD_')) return code;
    return 'WORD_IMAGE_UPLOAD_D1_FAILED';
}

interface CreatedImageAsset {
    assetId: number;
    r2Key: string | null;
}

async function createAssetFromSearchResult(
    ctx: BotContext,
    userId: number,
    collectionId: number,
    wordId: number,
    result: NormalizedImageResult,
    query: string
): Promise<CreatedImageAsset> {
    if (result.provider === 'legacy') {
        const assetId = await createImageAsset(ctx.db, {
            ownerUserId: null,
            provider: 'legacy',
            providerImageId: result.providerImageId,
            storageType: 'legacy',
            hotlinkUrl: result.imageUrl,
            previewUrl: result.previewUrl,
            sourcePageUrl: result.sourcePageUrl,
            attributionText: result.attributionText,
            searchQuery: query,
        });
        return { assetId, r2Key: null };
    }
    let r2Key: string | null = null;
    let mimeType: string | null = null;
    let fileSize: number | null = null;
    let sha256: string | null = null;
    if (ctx.env.WORD_IMAGES) {
        const downloaded = await downloadImageBytes(ctx.env, result.imageUrl, { allowedHosts: allowedHostsForProvider(result.provider) });
        r2Key = wordImageR2Key(userId, collectionId, wordId, downloaded.mimeType);
        await ctx.env.WORD_IMAGES.put(r2Key, downloaded.bytes, {
            httpMetadata: { contentType: downloaded.mimeType },
            customMetadata: { user_id: String(userId), collection_id: String(collectionId), word_id: String(wordId), provider: result.provider },
        });
        mimeType = downloaded.mimeType;
        fileSize = downloaded.size;
        sha256 = downloaded.sha256;
    }
    if (result.downloadTrackingUrl) {
        fetch(result.downloadTrackingUrl, { method: 'GET' }).catch(() => undefined);
    }
    const assetId = await createImageAsset(ctx.db, {
        ownerUserId: userId,
        provider: result.provider,
        providerImageId: result.providerImageId,
        storageType: r2Key ? 'r2' : 'hotlink',
        r2Key,
        hotlinkUrl: r2Key ? null : result.imageUrl,
        previewUrl: result.previewUrl,
        sourcePageUrl: result.sourcePageUrl,
        photographerName: result.photographerName,
        photographerUrl: result.photographerUrl,
        attributionText: result.attributionText,
        downloadTrackingUrl: result.downloadTrackingUrl ?? null,
        searchQuery: query,
        width: result.width ?? null,
        height: result.height ?? null,
        mimeType,
        fileSize,
        sha256,
    });
    return { assetId, r2Key };
}

function allowedHostsForProvider(provider: WordImageProvider): string[] {
    if (provider === 'pexels') return ['pexels.com', 'images.pexels.com'];
    if (provider === 'pixabay') return ['pixabay.com', 'cdn.pixabay.com'];
    if (provider === 'unsplash') return ['unsplash.com', 'images.unsplash.com'];
    return [];
}

function wordImageR2Key(userId: number, collectionId: number, wordId: number, mimeType: string): string {
    return `word-images/u${userId}/c${collectionId}/w${wordId}/${crypto.randomUUID()}.${extensionForMime(mimeType)}`;
}

function providerLabel(provider: WordImageProvider): string {
    if (provider === 'legacy') return 'Legacy visual';
    if (provider === 'pexels') return 'Pexels';
    if (provider === 'pixabay') return 'Pixabay';
    if (provider === 'unsplash') return 'Unsplash';
    return provider;
}

async function showGameChallengeUsers(ctx: BotContext, currentUserId: number, page: number, query = ''): Promise<void> {
    const limit = 8;
    const safeQuery = query.trim().slice(0, 40);
    const like = `%${safeQuery}%`;
    const offset = (Math.max(1, page) - 1) * limit;
    const users = await ctx.db.prepare(
        `SELECT u.user_id, u.display_name, u.name
         FROM users u
         WHERE u.user_id != ?
           AND u.display_name IS NOT NULL
           AND COALESCE(u.is_banned, 0) = 0
           AND COALESCE(u.is_deleted, 0) = 0
           AND (? = '%%' OR u.display_name LIKE ? OR u.name LIKE ? OR u.username LIKE ?)
           AND EXISTS (SELECT 1 FROM word_collections c WHERE c.owner_user_id = u.user_id AND c.is_deleted = 0)
         ORDER BY COALESCE(u.last_active_at, u.updated_at, u.created_at) DESC
         LIMIT ? OFFSET ?`
    ).bind(currentUserId, like, like, like, like, limit + 1, offset).all<{ user_id: number; display_name: string | null; name: string }>();
    const rows = users.results ?? [];
    const visible = rows.slice(0, limit);
    const safePage = Math.max(1, page);
    const keyboard = new InlineKeyboard();
    for (const candidate of visible) {
        keyboard.text(`👤 ${displayUserName(candidate)}`, `game_challenge:opponent:${candidate.user_id}`).row();
    }
    if (safePage > 1) keyboard.text('⬅️ السابق', `game_challenge:users:page:${safePage - 1}`);
    if (rows.length > limit) keyboard.text('التالي ➡️', `game_challenge:users:page:${safePage + 1}`);
    if (safePage > 1 || rows.length > limit) keyboard.row();
    keyboard.text('🔍 بحث عن مستخدم', 'game_challenge:search').row()
        .text('⬅️ رجوع', 'game:menu')
        .text('🏠 الرئيسية', 'menu_main');
    const text = visible.length === 0
        ? '⚔️ تحدي شخص\n\nلا يوجد مستخدم مناسب للتحدي حالياً.'
        : `⚔️ تحدي شخص\n\nاختر مستخدم حتى ترسل له تحدي لعبة دودة البحر والكلمات.${safeQuery ? `\n\nبحث: ${safeQuery}` : ''}`;
    await replaceWithText(ctx, text, keyboard);
}

async function showGameChallengeSources(ctx: BotContext, opponentUserId: number): Promise<void> {
    await replaceWithText(ctx, 'اختر مصدر كلمات تحدي اللعبة:', new InlineKeyboard()
        .text('📚 من مجموعاتي', `game_challenge:source:mine:${opponentUserId}`).row()
        .text('📚 من مجموعاته', `game_challenge:source:opponent:${opponentUserId}`).row()
        .text('🔀 مختلط', `game_challenge:source:mixed:${opponentUserId}`).row()
        .text('⬅️ رجوع', 'game_challenge:users:page:1')
        .text('🏠 الرئيسية', 'menu_main'));
}

async function showGameChallengeCollections(
    ctx: BotContext,
    currentUserId: number,
    opponentUserId: number,
    sourceType: GameChallengeSourceType,
    page: number
): Promise<void> {
    const total = sourceType === 'opponent'
        ? await countOpponentPublicGameCollections(ctx.db, opponentUserId)
        : await countPlayableGameCollections(ctx.db, currentUserId);
    if (total === 0) {
        const message = sourceType === 'opponent'
            ? 'لا توجد مجموعات متاحة لهذا المستخدم.'
            : 'ما عندك مجموعة قابلة للعب. أنشئ مجموعة وأضف كلمات أولاً.';
        await replaceWithText(ctx, message, backHomeKeyboard(`game_challenge:opponent:${opponentUserId}`));
        return;
    }
    const totalPages = Math.max(1, Math.ceil(total / GAME_COLLECTION_PAGE_SIZE));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const collections = sourceType === 'opponent'
        ? await getOpponentPublicGameCollections(ctx.db, opponentUserId, GAME_COLLECTION_PAGE_SIZE, (safePage - 1) * GAME_COLLECTION_PAGE_SIZE)
        : await getPlayableGameCollections(ctx.db, currentUserId, GAME_COLLECTION_PAGE_SIZE, (safePage - 1) * GAME_COLLECTION_PAGE_SIZE);
    const label = sourceType === 'mine'
        ? 'من مجموعاتي'
        : sourceType === 'opponent'
            ? 'من مجموعاته'
            : 'مختلط من مجموعتي ومجموعاته العامة';
    const keyboard = new InlineKeyboard();
    for (const collection of collections) {
        keyboard.text(`📚 ${collection.title} — ${collection.word_count} كلمة`, `game_challenge:create:${sourceType}:${opponentUserId}:${collection.id}`).row();
    }
    if (safePage > 1) keyboard.text('⬅️ السابق', `game_challenge:collections:${sourceType}:${opponentUserId}:page:${safePage - 1}`);
    if (safePage < totalPages) keyboard.text('التالي ➡️', `game_challenge:collections:${sourceType}:${opponentUserId}:page:${safePage + 1}`);
    if (safePage > 1 || safePage < totalPages) keyboard.row();
    keyboard.text('⬅️ رجوع', `game_challenge:opponent:${opponentUserId}`).text('🏠 الرئيسية', 'menu_main');
    await replaceWithText(ctx, `⚔️ تحدي شخص\n\nالمصدر: ${label}\nاختر مجموعة:\n\nالصفحة: ${safePage} / ${totalPages}`, keyboard);
}

async function createGameChallengeFromSelection(
    ctx: BotContext,
    userId: number,
    sourceType: GameChallengeSourceType,
    opponentUserId: number,
    collectionId: number
): Promise<void> {
    try {
        const challenge = await createGameChallenge(ctx.db, userId, opponentUserId, sourceType, collectionId);
        const creatorStart = `game_challenge:start:${challenge.challengeId}:creator`;
        const opponentStart = `game_challenge:start:${challenge.challengeId}:opponent`;
        const creator = await ctx.db.prepare('SELECT display_name, name FROM users WHERE user_id = ?').bind(userId).first<{ display_name: string | null; name: string }>();
        await sendTelegramMessage(
            ctx.env,
            challenge.opponent.telegram_id,
            `⚔️ ${displayUserName(creator ?? { name: 'مستخدم', display_name: 'مستخدم' })} تحداك في لعبة دودة البحر والكلمات\n\nالمجموعة: ${challenge.collection.title}\nعدد الكلمات: ${challenge.totalQuestions}`,
            { inline_keyboard: [[{ text: '🫧 ابدأ التحدي', callback_data: opponentStart }, { text: '❌ رفض', callback_data: 'game:menu' }]] }
        ).catch(() => {});
        await replaceWithText(ctx, `تم إرسال التحدي إلى ${displayUserName(challenge.opponent)}.\n\nتقدر تبدأ دورك الآن.`, new InlineKeyboard()
            .text('🫧 ابدأ التحدي', creatorStart).row()
            .text('🏠 الرئيسية', 'menu_main'));
    } catch {
        await replaceWithText(ctx, 'تعذر إنشاء تحدي اللعبة حالياً. تأكد من أن المجموعة متاحة وفيها كلمات.', backHomeKeyboard(`game_challenge:opponent:${opponentUserId}`));
    }
}

async function openGameChallenge(ctx: BotContext, userId: number, challengeId: number): Promise<void> {
    try {
        const session = await startGameChallengeForUser(ctx.db, challengeId, userId);
        const url = `${publicBaseUrl(ctx)}/game?token=${encodeURIComponent(session.token)}&v=${encodeURIComponent(GAME_UI_VERSION)}`;
        await replaceWithText(ctx, `⚔️ تحدي دودة البحر #${challengeId}\n\nالمجموعة: ${session.collectionTitle}\nعدد الكلمات: ${session.totalQuestions}\n\nافتح اللعبة بالمتصفح، والنتيجة تُحسب عند الخروج أو انتهاء الجولة.`, new InlineKeyboard()
            .url('🌐 فتح التحدي بالمتصفح', url).row()
            .text('🏠 الرئيسية', 'menu_main'));
    } catch {
        await replaceWithText(ctx, 'هذا التحدي غير متاح أو تم إكماله مسبقاً.', backHomeKeyboard('game:menu'));
    }
}

export async function startGameForCollection(
    ctx: BotContext,
    userId: number,
    collectionId: number,
    mode: CollectionGameMode = 'speech_rocket',
    limit = -1,
    difficulty: AdventureDifficulty = 'normal'
): Promise<void> {
    try {
        const session = await createGameSession(ctx.db, userId, collectionId, { mode, limit, difficulty, source: 'collection' });
        const url = `${publicBaseUrl(ctx)}/game?token=${encodeURIComponent(session.token)}&v=${encodeURIComponent(GAME_UI_VERSION)}`;
        await replaceWithText(
            ctx,
            `🎮 DeutschDrop Adventure\n\nالمجموعة:\n${session.collection.title}\n\nالمود: ${gameModeLabel(mode)}\nالصعوبة: ${difficultyLabel(difficulty)}\nعدد الكلمات: ${session.totalQuestions}\n\nافتح اللعبة في Safari أو Chrome حتى يعمل المايكروفون والصوت بشكل صحيح.`,
            new InlineKeyboard()
                .url('🌐 فتح اللعبة بالمتصفح', url).row()
                .text('⬅️ رجوع للمجموعة', `collection:view:${collectionId}:page:1`)
                .text('🏠 الرئيسية', 'menu_main')
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        if (message === 'collection_empty') {
            await replaceWithText(ctx, 'هذه المجموعة فارغة. أضف كلمات أولاً.', backHomeKeyboard(`collection:view:${collectionId}:page:1`));
            return;
        }
        if (message === 'collection_not_allowed') {
            await replaceWithText(ctx, 'لا يمكنك تشغيل اللعبة على هذه المجموعة.', backHomeKeyboard('game:menu'));
            return;
        }
        if (error instanceof ImageModeNotReadyError) {
            await showImageModeNotReady(ctx, error);
            return;
        }
        if (message === 'image_mode_not_ready' || message === 'image_mode_empty' || message === 'image_mode_word_missing') {
            await showWordImageDashboard(ctx, userId, collectionId, '⚠️ المجموعة غير جاهزة لمود الصور.');
            return;
        }
        throw error;
    }
}

async function showImageModeNotReady(ctx: BotContext, error: ImageModeNotReadyError): Promise<void> {
    const text = error.selected <= 0 && error.missing === 0
        ? 'ℹ️ لا توجد كلمات مصورة يمكن استخدامها في مود الصور.\n\nلا تبدأ جولة فارغة.'
        : [
            '⚠️ المجموعة غير جاهزة لمود الصور',
            '',
            `📚 المجموعة: ${error.collection.title}`,
            `📝 مجموع الكلمات: ${error.total}`,
            `✅ لديها صور: ${error.selected}`,
            `⏭ مستبعدة: ${error.excluded}`,
            `❌ تحتاج صوراً: ${error.missing}`,
            '',
            `عندك ${error.missing} كلمات ما مختارة إلها صور.`,
            '',
            `ارجعي إلى:\n📚 مجموعاتي ← ${error.collection.title} ← 🖼 صور الكلمات`,
            '',
            'وحطي صور للكلمات الناقصة حتى نبدأ اللعب.',
        ].join('\n');
    await replaceWithText(ctx, text, new InlineKeyboard()
        .text('🖼 تجهيز الصور الناقصة', `wi:missing:${error.collection.id}`).row()
        .text('📋 عرض الكلمات الناقصة', `wi:missing_list:${error.collection.id}`).row()
        .text('⏭ عرض الكلمات المستبعدة', `wi:excluded:${error.collection.id}`).row()
        .text('🎮 اختيار مود آخر', `game:mode:${error.collection.id}`).row()
        .text('🔙 رجوع', `collection:view:${error.collection.id}:page:1`));
}

async function handleManualVisualText(ctx: BotContext, userId: number, wordId: number, text: string, collectionId?: number): Promise<void> {
    const word = await getWordById(ctx.db, wordId);
    if (!word || word.added_by !== userId) {
        await deleteBotSession(ctx.db, userId, 'word_visual_edit');
        await ctx.reply('ما قدرت أحفظ الرمز لهذه الكلمة.');
        return;
    }

    const visual = validateManualVisual(text);
    if (!visual) {
        await ctx.reply(
            'الإيموجي غير صالح.\n\nأرسل إيموجي واحد أو إيموجيين فقط.\nلا ترسل نصاً عادياً أو رابطاً أو صورة.',
            { reply_markup: new InlineKeyboard().text('❌ إلغاء', `word_visual_cancel:${wordId}`) }
        );
        return;
    }

    await upsertManualVisual(ctx.db, wordId, visual);
    await deleteBotSession(ctx.db, userId, 'word_visual_edit');
    await showWordDetailPanel(ctx, wordId, 'تم حفظ الرمز لهذه الكلمة ✅');
}

async function currentUser(ctx: BotContext) {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
        await ctx.reply('تعذر تحديد حسابك. أرسل /start ثم جرّب مرة ثانية.');
        return null;
    }
    const user = await getUserByTelegramId(ctx.db, telegramId);
    if (!user?.display_name) {
        await ctx.reply('اكتب /start وسجل اسمك أولاً.');
        return null;
    }
    return user;
}

function publicBaseUrl(ctx: BotContext): string {
    return (ctx.env as { PUBLIC_BASE_URL?: string }).PUBLIC_BASE_URL?.replace(/\/+$/, '') || 'https://deutschdrop.aque7x.workers.dev';
}

function backHomeKeyboard(backCallback: string): InlineKeyboard {
    return new InlineKeyboard()
        .text('⬅️ رجوع', backCallback)
        .text('🏠 الرئيسية', 'menu_main');
}
