import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import {
    createWordAndAssignToUser,
    createUploadedList,
    searchDuplicateWordForUser,
    updateExistingWordFieldsForUser,
} from '../repositories/wordRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import { addWordsToCollection, getCollectionById } from '../repositories/wordSharingRepository';
import { addXp } from '../services/xpLevels';
import { parseWordCsv, type ParsedWordRow } from '../services/csvParser';
import { checkAchievements, unlockAchievement } from '../services/achievements';
import { incrementDailyTask } from '../services/dailyTasks';
import { mainMenuKeyboard } from './menu';

interface CsvUpdateSession {
    duplicates: ParsedWordRow[];
}

interface CollectionCsvUploadSession {
    collectionId: number;
    userId: number;
    step: 'waiting_csv';
}

const CSV_UPLOAD_INSTRUCTIONS =
    'ارسل ملف CSV فقط بالصيغة التالية:\n' +
    'German,Arabic\n' +
    'Haus,بيت\n' +
    'Auto,سيارة';

const CSV_ONLY_ERROR =
    '⚠️ يرجى إرسال ملف CSV فقط.\n\n' +
    'الصيغة المطلوبة:\n' +
    'German,Arabic\n' +
    'Haus,بيت\n' +
    'Auto,سيارة';

export function registerUploadCommand(bot: Bot<BotContext>): void {
    bot.callbackQuery('upload_csv', async (ctx) => {
        await ctx.editMessageText(
            `📤 *رفع ملف CSV*\n\n${CSV_UPLOAD_INSTRUCTIONS}`,
            { parse_mode: 'Markdown' }
        );
        await ctx.answerCallbackQuery();
    });

    bot.command('upload', async (ctx) => {
        await ctx.reply(
            `📤 *رفع ملف CSV*\n\n${CSV_UPLOAD_INSTRUCTIONS}`,
            { parse_mode: 'Markdown' }
        );
    });

    bot.callbackQuery('upload_update_existing', async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) {
            await ctx.answerCallbackQuery('يرجى استخدام /start أولاً.');
            return;
        }

        const session = await getBotSession<CsvUpdateSession>(ctx.db, user.user_id, 'csv_update');
        if (!session || session.data.duplicates.length === 0) {
            await ctx.answerCallbackQuery();
            await ctx.editMessageText('لا توجد كلمات مكررة جاهزة للتحديث.', { reply_markup: mainMenuKeyboard() });
            return;
        }

        let updated = 0;
        for (const word of session.data.duplicates) {
            if (await updateExistingWordFieldsForUser(ctx.db, user.user_id, word.german, word.arabic, word.example)) {
                updated++;
            }
        }
        await deleteBotSession(ctx.db, user.user_id, 'csv_update');
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(`تم تحديث ${updated} كلمة ✅`, { reply_markup: mainMenuKeyboard() });
    });

    // Handle document uploads
    bot.on('message:document', async (ctx) => {
        const telegramId = ctx.from?.id ?? 0;
        const user = await getUserByTelegramId(ctx.db, telegramId);

        if (!user) {
            await ctx.reply('يرجى استخدام /start أولاً.');
            return;
        }

        const doc = ctx.message.document;
        const fileName = doc?.file_name ?? '';
        const extension = getFileExtension(fileName);

        const collectionCsvSession = await getBotSession<CollectionCsvUploadSession>(ctx.db, user.user_id, 'collection_csv_upload');
        if (collectionCsvSession) {
            if (extension !== 'csv') {
                await ctx.reply('⚠️ الصيغة المدعومة حالياً هي CSV فقط.\nرجاءً ارفع ملف بصيغة .csv فقط.', {
                    reply_markup: collectionCsvKeyboard(collectionCsvSession.data.collectionId),
                });
                return;
            }
            await handleCollectionCsvUpload(ctx, user.user_id, collectionCsvSession.data, doc.file_id);
            return;
        }

        if (extension !== 'csv') {
            await ctx.reply(CSV_ONLY_ERROR);
            return;
        }

        // Get file content via Telegram API
        const file = await ctx.api.getFile(doc.file_id);
        if (!file.file_path) {
            await ctx.reply('⚠️ تعذر تحميل الملف.');
            return;
        }

        const fileUrl = `https://api.telegram.org/file/bot${ctx.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
        const response = await fetch(fileUrl);
        const content = await response.text();

        const result = await parseCsvAndImport(ctx.db, content, user.user_id);
        if (result.imported > 0) {
            await incrementDailyTask(ctx, user.user_id, 'learn_words', result.imported);
            await unlockAchievement(ctx, user.user_id, 'first_csv');
            await checkAchievements(ctx, user.user_id);
        }

        if (result.duplicateRows.length > 0) {
            await saveBotSession<CsvUpdateSession>(ctx.db, user.user_id, 'csv_update', { duplicates: result.duplicateRows }, 60);
        } else {
            await deleteBotSession(ctx.db, user.user_id, 'csv_update');
        }

        await ctx.reply(formatUploadSummary(result), {
            parse_mode: 'Markdown',
            reply_markup: uploadSummaryKeyboard(result.duplicateRows.length > 0),
        });
    });
}

interface CollectionCsvImportResult {
    created: number;
    reused: number;
    linked: number;
    skippedInCollection: number;
    errors: number;
}

async function handleCollectionCsvUpload(ctx: BotContext, userId: number, session: CollectionCsvUploadSession, fileId: string): Promise<void> {
    const collection = await getCollectionById(ctx.db, session.collectionId);
    if (!collection || collection.owner_user_id !== userId || session.userId !== userId) {
        await deleteBotSession(ctx.db, userId, 'collection_csv_upload');
        await ctx.reply('لا يمكنك رفع CSV إلى هذه المجموعة.', { reply_markup: mainMenuKeyboard() });
        return;
    }

    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) {
        await ctx.reply('⚠️ تعذر تحميل الملف.', { reply_markup: collectionCsvKeyboard(session.collectionId) });
        return;
    }

    const fileUrl = `https://api.telegram.org/file/bot${ctx.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const content = await response.text();
    const result = await importCsvToCollection(ctx, content, userId, session.collectionId);
    await deleteBotSession(ctx.db, userId, 'collection_csv_upload');

    await ctx.reply(formatCollectionCsvSummary(result), {
        reply_markup: collectionCsvSummaryKeyboard(session.collectionId),
    });
}

async function importCsvToCollection(ctx: BotContext, content: string, userId: number, collectionId: number): Promise<CollectionCsvImportResult> {
    const parsed = parseWordCsv(content);
    const result: CollectionCsvImportResult = {
        created: 0,
        reused: 0,
        linked: 0,
        skippedInCollection: 0,
        errors: parsed.errors,
    };
    const listId = await createUploadedList(ctx.db, userId, `Collection import ${new Date().toLocaleDateString()}`);

    for (const row of parsed.words) {
        try {
            const existing = await searchDuplicateWordForUser(ctx.db, userId, row.german);
            let wordId = existing?.word_id ?? 0;
            if (existing) {
                result.reused++;
            } else {
                wordId = await createWordAndAssignToUser(ctx.db, row.german, row.arabic, row.example, userId, listId);
                result.created++;
                await addXp(ctx.db, userId, 5, 'new_word');
            }
            const linked = await addWordsToCollection(ctx.db, collectionId, userId, [wordId]);
            if (linked > 0) result.linked++;
            else result.skippedInCollection++;
        } catch {
            result.errors++;
        }
    }

    if (result.created > 0) {
        await incrementDailyTask(ctx, userId, 'learn_words', result.created);
        await checkAchievements(ctx, userId);
    }
    return result;
}

function formatCollectionCsvSummary(result: CollectionCsvImportResult): string {
    return `✅ تم رفع الملف وإضافة الكلمات للمجموعة.\n\n` +
        `الكلمات الجديدة: ${result.created}\n` +
        `الكلمات الموجودة مسبقاً في حسابك: ${result.reused}\n` +
        `تم ربطها بالمجموعة: ${result.linked}\n` +
        `تخطينا داخل المجموعة: ${result.skippedInCollection}\n` +
        `الأخطاء: ${result.errors}`;
}

function collectionCsvKeyboard(collectionId: number): InlineKeyboard {
    return new InlineKeyboard()
        .text('⬅️ رجوع للمجموعة', `collection:view:${collectionId}:page:1`)
        .text('🏠 الرئيسية', 'menu_main');
}

function collectionCsvSummaryKeyboard(collectionId: number): InlineKeyboard {
    return new InlineKeyboard()
        .text('👁 عرض المجموعة', `collection:view:${collectionId}:page:1`).row()
        .text('➕ إضافة كلمة للمجموعة', `collection:add_direct:${collectionId}`).row()
        .text('📤 رفع CSV آخر', `collection:csv_upload:${collectionId}`).row()
        .text('📚 راجع الآن', 'menu_learn').row()
        .text('🏠 الرئيسية', 'menu_main');
}

function getFileExtension(fileName: string): string {
    const dotIndex = fileName.lastIndexOf('.');
    return dotIndex === -1 ? '' : fileName.slice(dotIndex + 1).toLowerCase();
}

interface ParseResult {
    imported: number;
    duplicates: number;
    errors: number;
    duplicateExamples: string[];
    duplicateRows: ParsedWordRow[];
}

async function parseCsvAndImport(
    db: D1Database,
    content: string,
    userId: number
): Promise<ParseResult> {
    const parsed = parseWordCsv(content);
    return importWords(db, parsed.words, parsed.errors, userId);
}

async function importWords(
    db: D1Database,
    words: ParsedWordRow[],
    initialErrors: number,
    userId: number
): Promise<ParseResult> {
    const result: ParseResult = { imported: 0, duplicates: 0, errors: initialErrors, duplicateExamples: [], duplicateRows: [] };

    // Create a list for this upload
    const listId = await createUploadedList(db, userId, `Imported ${new Date().toLocaleDateString()}`);

    // Import words
    for (const w of words) {
        try {
            const duplicate = await searchDuplicateWordForUser(db, userId, w.german);
            if (duplicate) {
                result.duplicates++;
                result.duplicateRows.push(w);
                if (result.duplicateExamples.length < 5) result.duplicateExamples.push(duplicate.german);
                continue;
            }

            await createWordAndAssignToUser(db, w.german, w.arabic, w.example, userId, listId);
            result.imported++;
            await addXp(db, userId, 5, 'new_word');
        } catch {
            result.duplicates++;
        }
    }

    return result;
}

function formatUploadSummary(result: ParseResult): string {
    let text =
        `📊 *ملخص الرفع*\n\n` +
        `✅ مستوردة: *${result.imported}*\n` +
        `⚠️ موجودة مسبقاً: *${result.duplicates}*\n` +
        `❌ أخطاء: *${result.errors}*`;

    if (result.duplicateExamples.length > 0) {
        text += '\n\nأمثلة على كلمات موجودة مسبقاً:\n' +
            result.duplicateExamples.map(word => `- ${word}`).join('\n');
    }

    if (result.imported === 0 && result.duplicates > 0) {
        text += '\n\nلم تتم إضافة كلمات جديدة لأن هذه الكلمات موجودة مسبقاً في حسابك.';
    } else {
        text += '\n\nتم رفع الكلمات ✅ يمكنك تعيين رمز تعليمي لكل كلمة من 📂 إدارة الكلمات.';
    }

    return text;
}

function uploadSummaryKeyboard(hasDuplicates: boolean): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    if (hasDuplicates) keyboard.text('🔄 تحديث الكلمات الموجودة', 'upload_update_existing').row();
    keyboard.text('📚 راجع الآن', 'menu_learn')
        .text('🏋️ تدريب', 'menu_train').row()
        .text('📂 عرض الكلمات', 'list_words').row()
        .text('🏠 الرئيسية', 'menu_main');
    return keyboard;
}
