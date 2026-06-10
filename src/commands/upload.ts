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
    '📥 *رفع ملف CSV*\n\n' +
    'أرسل ملف CSV بإحدى الصيغ التالية:\n\n' +
    '`German,Arabic`\n' +
    '`Haus,بيت`\n' +
    '`Auto,سيارة`\n\n' +
    'أو مع أمثلة:\n' +
    '`German,Arabic,Example,ExampleArabic`\n' +
    '`Haus,بيت,Das Haus ist groß.,البيت كبير.`\n\n' +
    '💡 *ملاحظة:* إذا أردت إضافة ترجمة للمثال بدون كتابة المثال بالألمانية، اترك عمود المثال فارغاً (فاصلتين متتاليتين):\n' +
    '`Haus,بيت,,البيت كبير.`';

const CSV_ONLY_ERROR =
    '⚠️ يرجى إرسال ملف CSV فقط.\n\n' +
    'الصيغة المطلوبة:\n' +
    'German,Arabic\n' +
    'أو:\n' +
    'German,Arabic,Example,ExampleArabic\n' +
    '(لإضافة ترجمة للمثال فقط، اترك عمود المثال فارغاً: Haus,بيت,,البيت كبير.)';

export function registerUploadCommand(bot: Bot<BotContext>): void {
    bot.callbackQuery('upload_csv', async (ctx) => {
        await ctx.editMessageText(CSV_UPLOAD_INSTRUCTIONS, { parse_mode: 'Markdown' });
        await ctx.answerCallbackQuery();
    });

    bot.command('upload', async (ctx) => {
        await ctx.reply(CSV_UPLOAD_INSTRUCTIONS, { parse_mode: 'Markdown' });
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
            await handleCollectionCsvUpload(ctx, user.user_id, collectionCsvSession.data, doc.file_id, doc.file_unique_id);
            return;
        }

        if (extension !== 'csv') {
            await ctx.reply(CSV_ONLY_ERROR);
            return;
        }

        const { createImportJob, createImportItemsChunked, checkJobExistsByFileUniqueId, markJobAsFailed } = await import('../repositories/csvImportRepository');

        // Idempotency check
        if (doc.file_unique_id) {
            const existingStatus = await checkJobExistsByFileUniqueId(ctx.db, user.user_id, doc.file_unique_id);
            if (existingStatus === 'pending' || existingStatus === 'processing') {
                await ctx.reply('ℹ️ هذا الملف قيد المعالجة حالياً. سأخبرك عند الانتهاء.');
                return;
            } else if (existingStatus === 'completed') {
                await ctx.reply('ℹ️ هذا الملف تمت معالجته مسبقاً.');
                return;
            } else if (existingStatus === 'failed') {
                // If it failed, allow re-processing. We will create a new job.
            }
        }

        const file = await ctx.api.getFile(doc.file_id);
        if (!file.file_path) {
            await ctx.reply('⚠️ تعذر تحميل الملف.');
            return;
        }

        if (file.file_size && file.file_size > 5 * 1024 * 1024) {
            await ctx.reply('⚠️ حجم الملف كبير جداً (أكبر من 5MB). يرجى تقسيمه إلى ملفات أصغر.');
            return;
        }

        const fileUrl = `https://api.telegram.org/file/bot${ctx.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
        const response = await fetch(fileUrl);
        const content = await response.text();

        const parsed = parseWordCsv(content);
        if (parsed.words.length === 0) {
            await ctx.reply(
                '⚠️ صيغة الملف غير صحيحة.\n\nالصيغة المطلوبة:\n`German,Arabic`\n\nأو:\n`German,Arabic,Example,ExampleArabic`\n\n(لإضافة ترجمة للمثال فقط، اترك عمود المثال فارغاً: `Haus,بيت,,البيت كبير.`)',
                { reply_markup: mainMenuKeyboard(), parse_mode: 'Markdown' }
            );
            return;
        }

        const MAX_CSV_ROWS = 5000;
        if (parsed.words.length > MAX_CSV_ROWS) {
            await ctx.reply(`⚠️ الملف يحتوي على عدد كلمات كبير جداً (${parsed.words.length} كلمة).\nيرجى تقسيمه إلى ملفات أصغر بحد أقصى ${MAX_CSV_ROWS} كلمة لكل ملف.`);
            return;
        }

        const msg = await ctx.reply(`📥 تم استلام الملف (يحتوي على ${parsed.words.length} كلمة).\nجاري تهيئة المهمة...`);

        // Create list for import
        const listId = await createUploadedList(ctx.db, user.user_id, `Imported ${new Date().toLocaleDateString()}`);
        
        let jobId = 0;
        try {
            // Create job
            jobId = await createImportJob(
                ctx.db, 
                user.user_id, 
                null, // no collection
                listId, 
                parsed.words.length, 
                msg.chat.id, 
                msg.message_id,
                doc.file_unique_id || null
            );

            // Prepare items
            const items = parsed.words.map((w, index) => ({
                rowNumber: index + 1,
                german: w.german,
                arabic: w.arabic,
                example: w.example,
                example_ar: w.example_ar
            }));

            // Insert items in chunks
            await createImportItemsChunked(ctx.db, jobId, items);

            await ctx.api.editMessageText(
                msg.chat.id,
                msg.message_id,
                `📥 *تم استلام ملف CSV*\n📊 يحتوي على *${items.length}* كلمة\n⏳ جاري إضافة الكلمات في الخلفية...\nسيتم تنبيهك عند الانتهاء.`,
                { parse_mode: 'Markdown' }
            );

            // Process immediately in background
            if (ctx.executionCtx) {
                const { processCsvImportJob } = await import('../services/csvImportBackground');
                ctx.executionCtx.waitUntil(
                    processCsvImportJob(ctx.env, ctx.api, jobId).catch(e => console.error("Immediate processing error:", e))
                );
            }
        } catch (e) {
            console.error('Failed to initialize CSV import job:', e);
            if (jobId) {
                await markJobAsFailed(ctx.db, jobId);
            }
            await ctx.api.editMessageText(
                msg.chat.id,
                msg.message_id,
                '⚠️ فشل تهيئة ملف CSV. يرجى المحاولة مرة أخرى أو تقسيم الملف.'
            );
        }
    });
}

interface CollectionCsvImportResult {
    created: number;
    reused: number;
    linked: number;
    skippedInCollection: number;
    errors: number;
}

async function handleCollectionCsvUpload(ctx: BotContext, userId: number, session: CollectionCsvUploadSession, fileId: string, fileUniqueId: string): Promise<void> {
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

    if (file.file_size && file.file_size > 5 * 1024 * 1024) {
        await ctx.reply('⚠️ حجم الملف كبير جداً (أكبر من 5MB). يرجى تقسيمه إلى ملفات أصغر.');
        return;
    }

    const fileUrl = `https://api.telegram.org/file/bot${ctx.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const content = await response.text();
    await importCsvToCollection(ctx, content, userId, session.collectionId, fileUniqueId);
    await deleteBotSession(ctx.db, userId, 'collection_csv_upload');
}

async function importCsvToCollection(ctx: BotContext, content: string, userId: number, collectionId: number, fileUniqueId: string): Promise<void> {
    const { createImportJob, createImportItemsChunked, checkJobExistsByFileUniqueId, markJobAsFailed } = await import('../repositories/csvImportRepository');

    // Idempotency check
    if (fileUniqueId) {
        const existingStatus = await checkJobExistsByFileUniqueId(ctx.db, userId, fileUniqueId);
        if (existingStatus === 'pending' || existingStatus === 'processing') {
            await ctx.reply('ℹ️ هذا الملف قيد المعالجة حالياً. سأخبرك عند الانتهاء.');
            return;
        } else if (existingStatus === 'completed') {
            await ctx.reply('ℹ️ هذا الملف تمت معالجته مسبقاً.');
            return;
        } else if (existingStatus === 'failed') {
            // Allow re-processing
        }
    }

    const parsed = parseWordCsv(content);
    if (parsed.words.length === 0) {
        await ctx.reply(
            '⚠️ صيغة الملف غير صحيحة.\n\nالصيغة المطلوبة:\n`German,Arabic`\n\nأو:\n`German,Arabic,Example,ExampleArabic`\n\n(لإضافة ترجمة للمثال فقط، اترك عمود المثال فارغاً: `Haus,بيت,,البيت كبير.`)',
            { reply_markup: mainMenuKeyboard(), parse_mode: 'Markdown' }
        );
        return;
    }

    const MAX_CSV_ROWS = 5000;
    if (parsed.words.length > MAX_CSV_ROWS) {
        await ctx.reply(`⚠️ الملف يحتوي على عدد كلمات كبير جداً (${parsed.words.length} كلمة).\nيرجى تقسيمه إلى ملفات أصغر بحد أقصى ${MAX_CSV_ROWS} كلمة لكل ملف.`);
        return;
    }

    const msg = await ctx.reply(`📥 تم استلام الملف (يحتوي على ${parsed.words.length} كلمة).\nجاري تهيئة المهمة للمجموعة...`);

    let jobId = 0;
    try {
        jobId = await createImportJob(
            ctx.db, 
            userId, 
            collectionId, 
            null, 
            parsed.words.length, 
            msg.chat.id, 
            msg.message_id,
            fileUniqueId || null
        );

        const items = parsed.words.map((w, index) => ({
            rowNumber: index + 1,
            german: w.german,
            arabic: w.arabic,
            example: w.example,
            example_ar: w.example_ar
        }));

        await createImportItemsChunked(ctx.db, jobId, items);

        await ctx.api.editMessageText(
            msg.chat.id,
            msg.message_id,
            `📥 *تم استلام ملف CSV*\n📊 يحتوي على *${items.length}* كلمة\n⏳ جاري تحديث الكلمات في الخلفية...\nسيتم تنبيهك عند الانتهاء.`,
            { parse_mode: 'Markdown' }
        );

        // Process immediately in background
        if (ctx.executionCtx) {
            const { processCsvImportJob } = await import('../services/csvImportBackground');
            ctx.executionCtx.waitUntil(
                processCsvImportJob(ctx.env, ctx.api, jobId).catch(e => console.error("Immediate processing error:", e))
            );
        }
    } catch (e) {
        console.error('Failed to initialize CSV collection import job:', e);
        if (jobId) {
            await markJobAsFailed(ctx.db, jobId);
        }
        await ctx.api.editMessageText(
            msg.chat.id,
            msg.message_id,
            '⚠️ فشل تهيئة ملف CSV. يرجى المحاولة مرة أخرى أو تقسيم الملف.'
        );
    }
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

