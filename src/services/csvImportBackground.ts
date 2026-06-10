import { Bot, InlineKeyboard } from 'grammy';
import type { Env, CsvImportJob } from '../models';
import { 
    lockAndGetPendingJob,
    lockJobById,
    getPendingItemsForJob, 
    updateImportItemsStatus, 
    updateJobProgress, 
    getDuplicatesForJob 
} from '../repositories/csvImportRepository';
import { batchCreateWords } from '../repositories/wordRepository';
import { addWordsToCollection } from '../repositories/wordSharingRepository';
import { mainMenuKeyboard } from '../commands/menu';

export async function processPendingImports(env: Env, bot?: Bot): Promise<void> {
    const db = env.DB;
    // Lock the oldest pending/stuck job
    const job = await lockAndGetPendingJob(db);
    if (!job) return;

    await processCsvImportJobLogic(env, bot, job, 5); // Cron loop up to 5 batches (250 items max)
}

export async function processCsvImportJob(env: Env, bot: Bot | any, jobId: number): Promise<void> {
    const db = env.DB;
    // Explicitly lock this specific job
    const job = await lockJobById(db, jobId);
    if (!job) return; // Already locked or not pending/processing

    // For immediate background execution, do up to 4 batches (200 items) to return quickly.
    // The rest will be picked up by the next cron.
    await processCsvImportJobLogic(env, bot, job, 4);
}

async function processCsvImportJobLogic(env: Env, bot: Bot | any, job: CsvImportJob, maxBatches: number): Promise<void> {
    const db = env.DB;
    let batchesProcessed = 0;

    try {
        while (batchesProcessed < maxBatches) {
            batchesProcessed++;
            const items = await getPendingItemsForJob(db, job.job_id, 50);
            
            if (items.length === 0) {
                // If there are no pending items, but we haven't processed all total rows
                if (job.total_rows > 0 && job.processed_rows === 0) {
                    console.error(`Job ${job.job_id} is corrupt. Total rows: ${job.total_rows}, but 0 items found.`);
                    await updateJobProgress(db, job.job_id, 0, 0, 0, 0, 0, 0, 'failed');
                    const api = bot?.api || bot;
                    if (job.telegram_message_id && api) {
                        try {
                            await api.editMessageText(
                                job.telegram_chat_id,
                                job.telegram_message_id,
                                '⚠️ فشل تهيئة ملف CSV. يرجى المحاولة مرة أخرى أو تقسيم الملف.'
                            );
                        } catch (e) {
                            console.error('Failed to send corrupt job message', e);
                        }
                    }
                    return;
                }
                
                // No more items, finish the job
                await finishJob(env, db, job, bot);
                return;
            }

            // Process items
            const inputItems = items.map(item => ({
                itemId: item.item_id,
                german: item.german,
                arabic: item.arabic,
                example: item.example,
                example_ar: (item as any).example_ar
            }));

            const results = await batchCreateWords(db, job.user_id, job.list_id, inputItems);
            
            let newImported = 0;
            let newDuplicates = 0;
            let newErrors = 0;
            const collectionCandidateWordIds: number[] = [];
            
            const updates = results.map(r => {
                if (r.status === 'imported') {
                    newImported++;
                    if (r.wordId) collectionCandidateWordIds.push(r.wordId);
                }
                else if (r.status === 'duplicate') {
                    newDuplicates++;
                    if (r.wordId) collectionCandidateWordIds.push(r.wordId);
                }
                else newErrors++;
                
                return {
                    itemId: r.itemId,
                    status: r.status,
                    errorMessage: r.errorMessage
                };
            });

            // Link to collection if collection_id exists
            let newLinked = 0;
            let newSkippedInCollection = 0;
            if (job.collection_id && collectionCandidateWordIds.length > 0) {
                newLinked = await addWordsToCollection(db, job.collection_id, job.user_id, collectionCandidateWordIds);
                newSkippedInCollection = collectionCandidateWordIds.length - newLinked;
            }

            // Update items status
            await updateImportItemsStatus(db, updates);

            // Update job progress
            const newProcessed = items.length;
            const totalProcessed = job.processed_rows + newProcessed;
            
            // Check if finished
            const isFinished = totalProcessed >= job.total_rows;

            await updateJobProgress(
                db, 
                job.job_id, 
                newProcessed, 
                newImported, 
                newDuplicates, 
                newErrors,
                newLinked,
                newSkippedInCollection,
                isFinished ? 'processing' : 'processing' // Keep processing during the loop
            );

            // Update job object in memory for next loop or finish
            job.processed_rows = totalProcessed;
            job.imported_count += newImported;
            job.duplicate_count += newDuplicates;
            job.error_count += newErrors;
            job.linked_count = (job.linked_count || 0) + newLinked;
            job.skipped_in_collection_count = (job.skipped_in_collection_count || 0) + newSkippedInCollection;

            // Update telegram message every 100 items or if finished
            const api = bot?.api || bot;
            if (job.telegram_message_id && api) {
                const previousThreshold = Math.floor((totalProcessed - newProcessed) / 100);
                const currentThreshold = Math.floor(totalProcessed / 100);
                
                if (currentThreshold > previousThreshold || isFinished) {
                    try {
                        await api.editMessageText(
                            job.telegram_chat_id,
                            job.telegram_message_id,
                            `⏳ تمت معالجة ${totalProcessed} / ${job.total_rows} كلمة...`
                        );
                    } catch (e) {
                        console.error('Failed to update telegram message', e);
                    }
                }
            }

            // If all processed, finish job
            if (isFinished) {
                await finishJob(env, db, job, bot);
                return;
            }
        }
        
        // If we reach here, we hit maxBatches but still have items.
        // We must revert status to pending so the next cron picks it up immediately.
        if (job.processed_rows < job.total_rows) {
            await updateJobProgress(db, job.job_id, 0, 0, 0, 0, 0, 0, 'pending');
        }
    } catch (e: any) {
        console.error('Job processing failed', e);
        await updateJobProgress(db, job.job_id, 0, 0, 0, 0, 0, 0, 'pending');
    }
}

async function finishJob(env: Env, db: any, job: CsvImportJob, bot?: Bot | any) {
    // Only mark completed if counters match
    const totalProcessed = job.imported_count + job.duplicate_count + job.error_count;
    const finalStatus = totalProcessed === job.total_rows ? 'completed' : 'failed';

    await updateJobProgress(db, job.job_id, 0, 0, 0, 0, 0, 0, finalStatus);
    
    const api = bot?.api || bot;
    if (api && job.telegram_message_id) {
        let text = '';
        if (job.collection_id) {
            const collection = await db.prepare('SELECT title FROM word_collections WHERE id = ?').bind(job.collection_id).first();
            const collectionName = collection ? (collection as {title: string}).title : 'غير معروفة';
            
            text = `✅ *اكتمل استيراد ملف CSV إلى المجموعة*\n\n`;
            text += `📂 المجموعة: *${collectionName}*\n\n`;
            text += `📊 *النتيجة:*\n`;
            text += `• مجموع الصفوف: ${job.total_rows}\n`;
            text += `• كلمات جديدة: ${job.imported_count}\n`;
            text += `• كلمات موجودة مسبقاً بحسابك: ${job.duplicate_count}\n`;
            text += `• تمت إضافتها للمجموعة: ${job.linked_count || 0}\n`;
            text += `• كانت داخل المجموعة مسبقاً: ${job.skipped_in_collection_count || 0}\n`;
            text += `• أخطاء: ${job.error_count}\n`;
        } else {
            text = `✅ *اكتمل استيراد ملف CSV بنجاح*\n\n`;
            text += `📊 *النتيجة:*\n`;
            text += `• مجموع الكلمات: ${job.total_rows}\n`;
            text += `• كلمات جديدة: ${job.imported_count}\n`;
            text += `• كلمات مكررة: ${job.duplicate_count}\n`;
            text += `• أخطاء: ${job.error_count}\n`;
        }
        
        if (job.error_count > 0) {
            const errors = await db.prepare(
                `SELECT row_number, error_message FROM csv_import_items WHERE job_id = ? AND status = 'error' ORDER BY item_id ASC LIMIT 5`
            ).bind(job.job_id).all();
            
            if (errors.results && errors.results.length > 0) {
                text += `\n⚠️ *أمثلة على الأخطاء:*\n`;
                text += errors.results.map((e: any, i: number) => `${i + 1}. السطر ${e.row_number}: ${e.error_message}`).join('\n');
                text += '\n';
            }
        }

        if (job.duplicate_count > 0 && !job.collection_id) {
            const duplicates = await getDuplicatesForJob(db, job.job_id, 5);
            if (duplicates.length > 0) {
                text += `\n🔁 *أمثلة مكررة:*\n` + duplicates.map(d => `${d.german}`).join('\n');
            }
        }
        
        try {
            await api.editMessageText(job.telegram_chat_id, job.telegram_message_id, text, { parse_mode: 'Markdown' });
            
            let keyboard;
            if (job.collection_id) {
                keyboard = new InlineKeyboard()
                    .text('📂 فتح المجموعة', `collection:view:${job.collection_id}:page:1`).row()
                    .text('⚔️ تحدي على هذه المجموعة', `collection_challenge_count_${job.collection_id}`).row()
                    .text('📤 رفع ملف آخر للمجموعة', `collection:csv_upload:${job.collection_id}`).row()
                    .text('🏠 الرئيسية', 'menu_main');
            } else {
                keyboard = new InlineKeyboard()
                    .text('🏠 الرئيسية', 'menu_main').row()
                    .text('📦 جلسة خطة المراجعة', 'train_plan').row()
                    .text('🏋️ تدريب', 'menu_train').row()
                    .text('📂 عرض الكلمات', 'list_words').row()
                    .text('📤 رفع ملف آخر', 'upload_csv');
            }

            await api.sendMessage(
                job.telegram_chat_id,
                `اكتملت العملية! ماذا تريد أن تفعل الآن؟`,
                { reply_markup: keyboard }
            );
        } catch (e) {
            console.error('Failed to send completion message', e);
        }
    }
}
