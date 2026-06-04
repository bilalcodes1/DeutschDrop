import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { createLearningSource, getAllLearningSources, getLearningSourceById, getLearningSourcesByLevel, setLearningSourceActive, updateLearningSource } from '../repositories/sourceRepository';
import { deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import { getUserByTelegramId, getUserSettings } from '../repositories/userRepository';
import { isAdminTelegramId } from '../services/adminAccess';
import { replaceWithText } from './wordPanel';

interface AdminSourceSession {
    step: 'title' | 'url' | 'level' | 'description' | 'preview' | 'edit_title' | 'edit_url' | 'edit_description';
    sourceId?: number;
    title?: string;
    url?: string;
    level?: SourceLevel;
    description?: string | null;
}

type GermanLevel = 'A1' | 'A2' | 'B1';
type SourceLevel = GermanLevel | 'General';

export function registerSourcesCommand(bot: Bot<BotContext>): void {
    bot.command('sources', async (ctx) => {
        await showSources(ctx);
    });

    bot.callbackQuery('menu_sources', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showSources(ctx);
    });

    bot.callbackQuery(/^sources_level_(A1|A2|B1)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await showSources(ctx, ctx.match[1] as GermanLevel);
    });

    bot.callbackQuery('admin_sources', async (ctx) => {
        if (!await requireSourceAdmin(ctx)) return;
        await showAdminSources(ctx);
    });

    bot.callbackQuery('admin_source_add', async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!await requireSourceAdmin(ctx)) return;
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        await deleteBotSession(ctx.db, user.user_id, 'admin_source');
        await saveBotSession<AdminSourceSession>(ctx.db, user.user_id, 'admin_source_add', { step: 'title' }, 30);
        await replaceWithText(
            ctx,
            `📚 إضافة مصدر\n\n` +
            `أرسل عنوان المصدر:\n\n` +
            `مثال:\nGerman Toon A1.1 Playlist`,
            sourceCancelKeyboard()
        );
    });

    bot.callbackQuery(/^admin_source_edit_(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!await requireSourceAdmin(ctx)) return;
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        const source = await getLearningSourceById(ctx.db, Number(ctx.match[1]));
        if (!source) return replaceWithText(ctx, 'لم أجد هذا المصدر.', await adminSourcesKeyboard(ctx));
        await saveBotSession<AdminSourceSession>(ctx.db, user.user_id, 'admin_source_edit', {
            step: 'title',
            sourceId: source.id,
            title: source.title,
            url: source.url,
            level: source.level,
            description: source.description,
        }, 30);
        await replaceWithText(ctx, formatSourcePreview({ title: source.title, url: source.url, level: source.level, description: source.description }, '✏️ تعديل مصدر'), editSourceKeyboard(source.id));
    });

    bot.callbackQuery(/^admin_source_(disable|enable)_(\d+)$/, async (ctx) => {
        if (!await requireSourceAdmin(ctx)) return;
        await setLearningSourceActive(ctx.db, Number(ctx.match[2]), ctx.match[1] === 'enable');
        await ctx.answerCallbackQuery(ctx.match[1] === 'enable' ? 'تم تفعيل المصدر' : 'تم تعطيل المصدر');
        await showAdminSources(ctx);
    });

    bot.callbackQuery(/^admin_source_level_(A1|A2|B1|General)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!await requireSourceAdmin(ctx)) return;
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        const session = await getSourceSession(ctx, user.user_id);
        if (!session) return replaceWithText(ctx, 'لا توجد عملية مصدر نشطة.', await adminSourcesKeyboard(ctx));
        const isEditingLevel = session.type === 'admin_source_edit' && session.data.step === 'level';
        session.data.level = ctx.match[1] as SourceLevel;
        session.data.step = isEditingLevel ? 'preview' : 'description';
        await saveSourceSession(ctx, user.user_id, session.type, session.data);
        if (isEditingLevel) {
            await replaceWithText(ctx, formatSourcePreview(session.data), sourcePreviewKeyboard());
            return;
        }
        await replaceWithText(ctx, 'أرسل وصفاً قصيراً للمصدر، أو اضغط تخطي الوصف.', skipDescriptionKeyboard());
    });

    bot.callbackQuery('admin_source_skip_description', async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!await requireSourceAdmin(ctx)) return;
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        const session = await getSourceSession(ctx, user.user_id);
        if (!session) return;
        session.data.description = null;
        session.data.step = 'preview';
        await saveSourceSession(ctx, user.user_id, session.type, session.data);
        await replaceWithText(ctx, formatSourcePreview(session.data), sourcePreviewKeyboard());
    });

    bot.callbackQuery('admin_source_save', async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!await requireSourceAdmin(ctx)) return;
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        const session = await getSourceSession(ctx, user.user_id);
        if (!session || !isCompleteSourceSession(session.data)) return replaceWithText(ctx, 'المعاينة غير مكتملة.', await adminSourcesKeyboard(ctx));
        if (session.data.sourceId) {
            await updateLearningSource(ctx.db, session.data.sourceId, session.data);
        } else {
            await createLearningSource(ctx.db, user.user_id, session.data);
        }
        await deleteSourceSessions(ctx, user.user_id);
        await replaceWithText(
            ctx,
            session.data.sourceId ? '✅ تم تعديل المصدر بنجاح.' : '✅ تم حفظ المصدر بنجاح.',
            sourceSavedKeyboard()
        );
    });

    bot.callbackQuery('admin_source_edit_restart', async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!await requireSourceAdmin(ctx)) return;
        await replaceWithText(ctx, '✏️ اختر الحقل الذي تريد تعديله:', sourceEditFieldsKeyboard());
    });

    bot.callbackQuery('admin_source_edit_title', async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!await requireSourceAdmin(ctx)) return;
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        const session = await getSourceSession(ctx, user.user_id);
        if (!session) return;
        session.data.step = 'edit_title';
        await saveSourceSession(ctx, user.user_id, session.type, session.data);
        await replaceWithText(ctx, `أرسل عنوان المصدر:\n\nالعنوان الحالي:\n${session.data.title ?? '-'}`, sourceCancelKeyboard());
    });

    bot.callbackQuery('admin_source_edit_url', async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!await requireSourceAdmin(ctx)) return;
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        const session = await getSourceSession(ctx, user.user_id);
        if (!session) return;
        session.data.step = 'edit_url';
        await saveSourceSession(ctx, user.user_id, session.type, session.data);
        await replaceWithText(ctx, `أرسل رابط المصدر:\n\nالرابط الحالي:\n${session.data.url ?? '-'}`, sourceCancelKeyboard());
    });

    bot.callbackQuery('admin_source_edit_level', async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!await requireSourceAdmin(ctx)) return;
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        const session = await getSourceSession(ctx, user.user_id);
        if (!session) return;
        session.data.step = 'level';
        await saveSourceSession(ctx, user.user_id, session.type, session.data);
        await replaceWithText(ctx, 'اختر المستوى:', sourceLevelKeyboard());
    });

    bot.callbackQuery('admin_source_edit_description', async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!await requireSourceAdmin(ctx)) return;
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        const session = await getSourceSession(ctx, user.user_id);
        if (!session) return;
        session.data.step = 'edit_description';
        await saveSourceSession(ctx, user.user_id, session.type, session.data);
        await replaceWithText(ctx, `أرسل وصفاً قصيراً للمصدر، أو اضغط تخطي الوصف.\n\nالوصف الحالي:\n${session.data.description ?? 'بدون وصف'}`, skipDescriptionKeyboard());
    });

    bot.callbackQuery('admin_source_preview_back', async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!await requireSourceAdmin(ctx)) return;
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        const session = await getSourceSession(ctx, user.user_id);
        if (!session) return;
        session.data.step = 'preview';
        await saveSourceSession(ctx, user.user_id, session.type, session.data);
        await replaceWithText(ctx, formatSourcePreview(session.data), sourcePreviewKeyboard());
    });

    bot.callbackQuery('admin_source_cancel', async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!await requireSourceAdmin(ctx)) return;
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (user) await deleteSourceSessions(ctx, user.user_id);
        await replaceWithText(ctx, 'تم إلغاء إضافة المصدر.', sourceCancelledKeyboard());
    });

    bot.on('message:text', async (ctx, next) => {
        if (!isAdminTelegramId(ctx.env, ctx.from?.id)) return next();
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return next();
        if (await getBotSession(ctx.db, user.user_id, 'train')) return next();
        if (await getBotSession(ctx.db, user.user_id, 'challenge')) return next();
        const session = await getSourceSession(ctx, user.user_id);
        if (!session) return next();
        await handleSourceText(ctx, user.user_id, session.type, session.data, ctx.message.text.trim());
    });
}

async function showSources(ctx: BotContext, forcedLevel?: GermanLevel): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    const settings = user ? await getUserSettings(ctx.db, user.user_id) : null;
    const level = forcedLevel ?? settings?.german_level ?? 'A1';
    const sources = await getLearningSourcesByLevel(ctx.db, level);
    const text = sources.length === 0
        ? `📚 *مصادر مستواك ${level}*\n\nلا توجد مصادر مفعلة لهذا المستوى حالياً.`
        : `📚 *مصادر مستواك ${level}*\n\n` + sources.map((source, index) =>
            `${index + 1}. 📚 *${source.title}*\n` +
            (source.description ? `${source.description}\n` : '') +
            `المستوى: ${source.level === 'General' ? 'عام' : source.level}`
        ).join('\n\n');
    await replaceWithText(ctx, text, sourcesKeyboard(sources), 'Markdown');
}

async function showAdminSources(ctx: BotContext, notice?: string): Promise<void> {
    const sources = await getAllLearningSources(ctx.db);
    const list = sources.length === 0
        ? 'لا توجد مصادر بعد.'
        : sources.slice(0, 8).map(source =>
            `${source.id}. ${source.is_active ? '✅' : '▫️'} [${source.level}] ${source.title}`
        ).join('\n');
    await replaceWithText(
        ctx,
        (notice ? `${notice}\n\n` : '') +
        `📚 *إدارة المصادر*\n\n` +
        `${list}\n\n` +
        `يمكنك إضافة مصدر، تعديل مصدر، أو تعطيله.`,
        await adminSourcesKeyboard(ctx),
        'Markdown'
    );
}

function sourcesKeyboard(sources: Array<{ id: number; title: string; url: string }>): InlineKeyboard {
    const keyboard = new InlineKeyboard()
        .text('A1', 'sources_level_A1')
        .text('A2', 'sources_level_A2')
        .text('B1', 'sources_level_B1').row();
    for (const source of sources.slice(0, 6)) {
        keyboard.url(`🔗 ${source.title.slice(0, 24)}`, source.url).row();
    }
    return keyboard
        .text('⬅️ رجوع', 'menu_more')
        .text('🏠 الرئيسية', 'menu_main');
}

async function adminSourcesKeyboard(ctx?: BotContext): Promise<InlineKeyboard> {
    const keyboard = new InlineKeyboard()
        .text('➕ إضافة مصدر', 'admin_source_add').row();
    if (ctx) {
        const sources = await getAllLearningSources(ctx.db);
        for (const source of sources.slice(0, 4)) {
            keyboard
                .text(`✏️ ${source.id}`, `admin_source_edit_${source.id}`)
                .text(source.is_active ? `🗑 ${source.id}` : `✅ ${source.id}`, `admin_source_${source.is_active ? 'disable' : 'enable'}_${source.id}`).row();
        }
    }
    return keyboard
        .text('⬅️ رجوع', 'admin_panel')
        .text('🏠 الرئيسية', 'menu_main');
}

async function requireSourceAdmin(ctx: BotContext): Promise<boolean> {
    if (isAdminTelegramId(ctx.env, ctx.from?.id)) return true;
    await ctx.reply('غير مصرح لك باستخدام هذا الأمر.');
    return false;
}

async function handleSourceText(ctx: BotContext, userId: number, type: 'admin_source_add' | 'admin_source_edit', data: AdminSourceSession, text: string): Promise<void> {
    if (data.step === 'title' || data.step === 'edit_title') {
        if (!isValidSourceTitle(text)) {
            await ctx.reply('العنوان يجب أن يكون بين 2 و 100 حرف.', { reply_markup: sourceCancelKeyboard() });
            return;
        }
        data.title = text;
        data.step = data.step === 'edit_title' ? 'preview' : 'url';
        await saveSourceSession(ctx, userId, type, data);
        if (data.step === 'preview') {
            await ctx.reply(formatSourcePreview(data), { reply_markup: sourcePreviewKeyboard() });
            return;
        }
        await ctx.reply('أرسل رابط المصدر:', { reply_markup: sourceCancelKeyboard() });
        return;
    }
    if (data.step === 'url' || data.step === 'edit_url') {
        if (!isValidSourceUrl(text)) {
            await ctx.reply('الرابط غير صالح. أرسل رابط يبدأ بـ https://', { reply_markup: sourceCancelKeyboard() });
            return;
        }
        data.url = text;
        data.step = data.step === 'edit_url' ? 'preview' : 'level';
        await saveSourceSession(ctx, userId, type, data);
        if (data.step === 'preview') {
            await ctx.reply(formatSourcePreview(data), { reply_markup: sourcePreviewKeyboard() });
            return;
        }
        await ctx.reply('اختر المستوى:', { reply_markup: sourceLevelKeyboard() });
        return;
    }
    if (data.step === 'description' || data.step === 'edit_description') {
        if (text.length > 500) {
            await ctx.reply('الوصف طويل جداً. الحد الأقصى 500 حرف.', { reply_markup: skipDescriptionKeyboard() });
            return;
        }
        data.description = text || null;
        data.step = 'preview';
        await saveSourceSession(ctx, userId, type, data);
        await ctx.reply(formatSourcePreview(data), { reply_markup: sourcePreviewKeyboard() });
    }
}

async function getSourceSession(ctx: BotContext, userId: number): Promise<{ type: 'admin_source_add' | 'admin_source_edit'; data: AdminSourceSession } | null> {
    const add = await getBotSession<AdminSourceSession>(ctx.db, userId, 'admin_source_add');
    if (add) return { type: 'admin_source_add', data: add.data };
    const edit = await getBotSession<AdminSourceSession>(ctx.db, userId, 'admin_source_edit');
    if (edit) return { type: 'admin_source_edit', data: edit.data };
    return null;
}

async function saveSourceSession(ctx: BotContext, userId: number, type: 'admin_source_add' | 'admin_source_edit', data: AdminSourceSession): Promise<void> {
    await saveBotSession<AdminSourceSession>(ctx.db, userId, type, data, 30);
}

async function deleteSourceSessions(ctx: BotContext, userId: number): Promise<void> {
    await deleteBotSession(ctx.db, userId, 'admin_source');
    await deleteBotSession(ctx.db, userId, 'admin_source_add');
    await deleteBotSession(ctx.db, userId, 'admin_source_edit');
}

function sourceCancelKeyboard(): InlineKeyboard {
    return new InlineKeyboard().text('❌ إلغاء', 'admin_source_cancel').text('🏠 الرئيسية', 'menu_main');
}

function sourceLevelKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('A1', 'admin_source_level_A1')
        .text('A2', 'admin_source_level_A2')
        .text('B1', 'admin_source_level_B1').row()
        .text('عام', 'admin_source_level_General').row()
        .text('❌ إلغاء', 'admin_source_cancel');
}

function skipDescriptionKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('تخطي الوصف', 'admin_source_skip_description').row()
        .text('❌ إلغاء', 'admin_source_cancel')
        .text('🏠 الرئيسية', 'menu_main');
}

function sourcePreviewKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('✅ حفظ المصدر', 'admin_source_save').row()
        .text('✏️ تعديل', 'admin_source_edit_restart')
        .text('❌ إلغاء', 'admin_source_cancel').row()
        .text('⬅️ رجوع', 'admin_sources')
        .text('🏠 الرئيسية', 'menu_main');
}

function editSourceKeyboard(sourceId: number): InlineKeyboard {
    return new InlineKeyboard()
        .text('✏️ تعديل البيانات', 'admin_source_edit_restart').row()
        .text('تعطيل/تفعيل', `admin_source_disable_${sourceId}`).row()
        .text('⬅️ رجوع', 'admin_sources')
        .text('🏠 الرئيسية', 'menu_main');
}

function formatSourcePreview(source: Partial<AdminSourceSession>, title = '📚 معاينة المصدر'): string {
    return `${title}\n\n` +
        `العنوان:\n${source.title ?? '-'}\n\n` +
        `الرابط:\n${source.url ?? '-'}\n\n` +
        `المستوى:\n${source.level === 'General' ? 'عام' : source.level ?? '-'}\n\n` +
        `الوصف:\n${source.description ?? 'بدون وصف'}`;
}

function isCompleteSourceSession(data: AdminSourceSession): data is AdminSourceSession & { title: string; url: string; level: SourceLevel; description: string | null } {
    return Boolean(data.title?.trim() && data.url?.trim() && data.level)
        && isValidSourceTitle(data.title ?? '')
        && isValidSourceUrl(data.url ?? '')
        && isValidSourceLevel(data.level)
        && (data.description?.length ?? 0) <= 500;
}

function sourceEditFieldsKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('✏️ تعديل العنوان', 'admin_source_edit_title').row()
        .text('🔗 تعديل الرابط', 'admin_source_edit_url').row()
        .text('🎚 تعديل المستوى', 'admin_source_edit_level').row()
        .text('📝 تعديل الوصف', 'admin_source_edit_description').row()
        .text('⬅️ رجوع للمعاينة', 'admin_source_preview_back').row()
        .text('❌ إلغاء', 'admin_source_cancel');
}

function sourceSavedKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('➕ إضافة مصدر آخر', 'admin_source_add').row()
        .text('📚 عرض المصادر', 'admin_sources').row()
        .text('🛠 لوحة الأدمن', 'admin_panel').row()
        .text('🏠 الرئيسية', 'menu_main');
}

function sourceCancelledKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('📚 إدارة المصادر', 'admin_sources').row()
        .text('🏠 الرئيسية', 'menu_main');
}

function isValidSourceTitle(title: string): boolean {
    const length = title.trim().length;
    return length >= 2 && length <= 100;
}

function isValidSourceUrl(url: string): boolean {
    return /^https?:\/\//i.test(url.trim());
}

function isValidSourceLevel(level: SourceLevel | undefined): level is SourceLevel {
    return level === 'A1' || level === 'A2' || level === 'B1' || level === 'General';
}
