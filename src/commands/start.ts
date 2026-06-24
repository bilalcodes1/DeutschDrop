import { Bot } from 'grammy';
import type { BotContext } from '../bot/context';
import { START_BUTTON_TEXT, ensurePersistentStartKeyboard } from '../bot/startKeyboard';
import { completeUserRegistration, createPendingUser, getUserByTelegramId, getUserSettings, isRegisteredUser, renameUser } from '../repositories/userRepository';
import { deleteAllBotSessionsForUser, deleteBotSession, getBotSession, saveBotSession } from '../repositories/sessionRepository';
import { showLevelSelection, showMainMenu } from './menu';
import { showLifeDisabledPanel } from './disabledLife';

interface NameSessionData {
    mode: 'register' | 'rename';
}

interface StartEntryOptions {
    forceKeyboard?: boolean;
}

export function registerStartCommand(bot: Bot<BotContext>): void {
    bot.command('start', async (ctx) => {
        const payload = ctx.message?.text?.split(/\s+/, 2)[1]?.trim();
        if (payload?.startsWith('life_')) {
            const user = await ensureTelegramUser(ctx);
            if (user) {
                await deleteAllBotSessionsForUser(ctx.db, user.user_id);
                await ensurePersistentStartKeyboard(ctx, user.user_id, { force: true });
            } else {
                await ensurePersistentStartKeyboard(ctx, undefined, { force: true });
            }
            await showLifeDisabledPanel(ctx);
            return;
        }

        await handleStartEntry(ctx, { forceKeyboard: true });
    });

    bot.hears(START_BUTTON_TEXT, async (ctx) => {
        await handleStartEntry(ctx);
    });

    bot.command('rename', async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!isRegisteredUser(user)) {
            await promptForRegistration(ctx);
            return;
        }

        await saveBotSession<NameSessionData>(ctx.db, user.user_id, 'rename', { mode: 'rename' }, 30);
        await ctx.reply('اكتب الاسم الجديد:');
    });

    bot.on('message:text', async (ctx, next) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return next();
        if (await getBotSession(ctx.db, user.user_id, 'train')) return next();
        if (await getBotSession(ctx.db, user.user_id, 'challenge')) return next();

        const registerSession = await getBotSession<NameSessionData>(ctx.db, user.user_id, 'register');
        const renameSession = await getBotSession<NameSessionData>(ctx.db, user.user_id, 'rename');
        const session = registerSession ?? renameSession;
        if (!session) return next();

        const displayName = sanitizeName(ctx.message.text);
        if (!displayName) {
            await ctx.reply('اكتب اسماً واضحاً بين 2 و 40 حرفاً.');
            return;
        }

        if (session.data.mode === 'rename') {
            await renameUser(ctx.db, user.user_id, displayName);
            await deleteBotSession(ctx.db, user.user_id, 'rename');
            await ensurePersistentStartKeyboard(ctx, user.user_id, { force: true });
            await ctx.reply(`تم تغيير الاسم ✅\n${displayName}`);
            await showMainMenu(ctx);
            return;
        }

        await completeUserRegistration(ctx.db, user.user_id, displayName);
        await deleteBotSession(ctx.db, user.user_id, 'register');
        await ensurePersistentStartKeyboard(ctx, user.user_id, { force: true });
        await ctx.reply(`تم تسجيلك ✅ أهلاً ${displayName}`);
        await showLevelSelection(ctx, 'حدد مستواك:');
    });
}

async function handleStartEntry(ctx: BotContext, options: StartEntryOptions = {}): Promise<void> {
    const user = await ensureTelegramUser(ctx);
    if (!user) return;

    await deleteAllBotSessionsForUser(ctx.db, user.user_id);
    await ensurePersistentStartKeyboard(ctx, user.user_id, { force: Boolean(options.forceKeyboard) });

    if (user.is_banned) {
        await ctx.reply('تم إيقاف حسابك من استخدام البوت.');
        return;
    }

    if (!user.display_name?.trim()) {
        await saveBotSession<NameSessionData>(ctx.db, user.user_id, 'register', { mode: 'register' }, 30);
        await ctx.reply('مرحباً بك في DeutschDrop 👋\nاكتب اسمك للانضمام:');
        return;
    }

    const settings = await getUserSettings(ctx.db, user.user_id);
    if (!settings?.german_level) {
        await showLevelSelection(ctx, 'حدد مستواك حتى أضبط لك المصادر والإشعارات:');
        return;
    }

    await showMainMenu(ctx);
}

async function ensureTelegramUser(ctx: BotContext) {
    const telegramId = ctx.from?.id ?? 0;
    if (!telegramId) return null;

    const existing = await getUserByTelegramId(ctx.db, telegramId);
    if (existing) return existing;

    const userId = await createPendingUser(
        ctx.db,
        telegramId,
        ctx.from?.username ?? null,
        ctx.from?.first_name ?? null,
        ctx.from?.last_name ?? null
    );
    return getUserByTelegramId(ctx.db, telegramId) ?? {
        user_id: userId,
        id: userId,
        name: ctx.from?.first_name ?? 'User',
        telegram_id: telegramId,
        telegram_user_id: telegramId,
        telegram_username: ctx.from?.username ?? null,
        username: ctx.from?.username ?? null,
        first_name: ctx.from?.first_name ?? null,
        last_name: ctx.from?.last_name ?? null,
        display_name: null,
        xp: 0,
        level: 1,
        streak: 0,
        is_banned: 0,
        onboarding_seen: 0,
        identity: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
}

async function promptForRegistration(ctx: BotContext): Promise<void> {
    const user = await ensureTelegramUser(ctx);
    if (user) {
        await saveBotSession<NameSessionData>(ctx.db, user.user_id, 'register', { mode: 'register' }, 30);
        await ensurePersistentStartKeyboard(ctx, user.user_id, { force: true });
    } else {
        await ensurePersistentStartKeyboard(ctx, undefined, { force: true });
    }
    await ctx.reply('مرحباً بك في DeutschDrop 👋\nاكتب اسمك للانضمام:');
}

function sanitizeName(value: string): string | null {
    const name = value.trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 40 || name.startsWith('/')) return null;
    return name;
}
