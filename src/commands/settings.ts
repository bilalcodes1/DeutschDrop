import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId, getUserSettings, markOnboardingSeen, updateUserSettings } from '../repositories/userRepository';
import { countWordsByUser } from '../repositories/wordRepository';
import { createDailyReviewPlan } from '../repositories/reviewPlanRepository';
import { levelSelectionKeyboard, mainMenuKeyboard, showOnboarding } from './menu';
import { replaceWithText } from './wordPanel';

export function registerSettingsCommand(bot: Bot<BotContext>): void {
    bot.command('settings', async (ctx) => {
        await showSettings(ctx);
    });

    bot.callbackQuery('menu_settings', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showSettings(ctx);
    });

    bot.callbackQuery('menu_notifications', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showNotificationSettings(ctx);
    });

    bot.callbackQuery('set_goal', async (ctx) => {
        await ctx.editMessageText(
            '🎯 *اختر الهدف اليومي:*',
            {
                parse_mode: 'Markdown',
                reply_markup: new InlineKeyboard()
                    .text('3 كلمات', 'goal_set_3')
                    .text('5 كلمات', 'goal_set_5')
                    .text('10 كلمات', 'goal_set_10')
                    .text('20 كلمة', 'goal_set_20').row()
                    .text('⬅️ رجوع', 'menu_settings')
            }
        );
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^goal_set_(\d+)$/, async (ctx) => {
        const goal = parseInt(ctx.match[1], 10);
        const telegramId = ctx.from?.id ?? 0;
        const user = await getUserByTelegramId(ctx.db, telegramId);

        if (user) {
            await updateUserSettings(ctx.db, user.user_id, {
                daily_goal: goal,
                new_words_per_day: goal,
            });
        }

        await ctx.editMessageText(
            `✅ تم تحديث الهدف اليومي إلى *${goal}* كلمات.`,
            { parse_mode: 'Markdown', reply_markup: settingsNavigationKeyboard() }
        );
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery('set_notifications', async (ctx) => {
        await showNotificationSettings(ctx);
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^reminders_(on|off)$/, async (ctx) => {
        const enabled = ctx.match[1] === 'on';
        await updateBooleanSetting(ctx, { reminders_enabled: enabled });
        await ctx.editMessageText(
            enabled ? '✅ تم تشغيل التذكيرات.' : '✅ تم إيقاف التذكيرات.',
            { reply_markup: settingsNavigationKeyboard() }
        );
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^competition_notify_(on|off)$/, async (ctx) => {
        const enabled = ctx.match[1] === 'on';
        await updateBooleanSetting(ctx, { competition_notifications_enabled: enabled });
        await ctx.editMessageText(
            enabled ? '✅ تم تشغيل إشعارات المنافسة.' : '✅ تم إيقاف إشعارات المنافسة.',
            { reply_markup: settingsNavigationKeyboard() }
        );
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^notify_(morning|both|all)$/, async (ctx) => {
        const mode = ctx.match[1];
        const modeMap: Record<string, string> = {
            morning: 'light',
            both: 'normal',
            all: 'intensive',
        };
        const telegramId = ctx.from?.id ?? 0;
        const user = await getUserByTelegramId(ctx.db, telegramId);

        if (user) {
            await updateUserSettings(ctx.db, user.user_id, {
                notification_mode: modeMap[mode] as 'light' | 'normal' | 'intensive',
                notification_intensity: modeMap[mode] as 'light' | 'normal' | 'intensive',
            });
        }

        const modeLabels: Record<string, string> = {
            morning: '☀️ صباحاً فقط',
            both: '☀️ صباحاً + 🌙 مساءً',
            all: '⏰ طوال اليوم',
        };

        await ctx.editMessageText(
            `✅ تم تحديث الإشعارات إلى: *${modeLabels[mode]}*`,
            { parse_mode: 'Markdown', reply_markup: settingsNavigationKeyboard() }
        );
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^level_set_(A1|A2|B1)$/, async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        await updateUserSettings(ctx.db, user.user_id, { german_level: ctx.match[1] as 'A1' | 'A2' | 'B1' });
        await ctx.answerCallbackQuery('تم حفظ المستوى');
        if (!user.onboarding_seen) {
            await markOnboardingSeen(ctx.db, user.user_id);
            await showOnboarding(ctx);
            return;
        }
        await replaceWithText(ctx, `تم حفظ مستواك: ${ctx.match[1]} ✅`, mainMenuKeyboard(), 'Markdown');
    });

    bot.callbackQuery('change_level', async (ctx) => {
        await ctx.answerCallbackQuery();
        await replaceWithText(ctx, '🎚 *تغيير المستوى*\n\nحدد مستواك:', levelSelectionKeyboard('menu_settings'), 'Markdown');
    });

    bot.callbackQuery('notification_toggle', async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        const settings = await getUserSettings(ctx.db, user.user_id);
        await updateUserSettings(ctx.db, user.user_id, { reminders_enabled: !isEnabled(settings?.reminders_enabled) });
        await showNotificationSettings(ctx);
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^notification_mode_(light|normal|intensive|custom|off)$/, async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        const mode = ctx.match[1] as 'light' | 'normal' | 'intensive' | 'custom' | 'off';
        await updateUserSettings(ctx.db, user.user_id, {
            notification_mode: mode,
            notification_intensity: mode === 'custom' ? 'custom' : mode,
            reminders_enabled: mode !== 'off',
        });
        await showNotificationSettings(ctx);
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^notification_intensity_(light|normal|intensive)$/, async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        const mode = ctx.match[1] as 'light' | 'normal' | 'intensive';
        await updateUserSettings(ctx.db, user.user_id, { notification_mode: mode, notification_intensity: mode, reminders_enabled: true });
        await showNotificationSettings(ctx);
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^notification_interval_(1|2|3)$/, async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        await updateUserSettings(ctx.db, user.user_id, {
            notification_mode: 'custom',
            notification_intensity: 'custom',
            notification_interval_hours: Number(ctx.match[1]),
            reminders_enabled: true,
        });
        await showNotificationSettings(ctx);
        await ctx.answerCallbackQuery('تم ضبط الفاصل');
    });

    bot.callbackQuery(/^review_plan_(none|all_words_day|all_words_week)$/, async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        const plan = ctx.match[1] as 'none' | 'all_words_day' | 'all_words_week';
        const totalWords = await countWordsByUser(ctx.db, user.user_id);
        await updateUserSettings(ctx.db, user.user_id, { review_plan: plan });
        if (plan !== 'none' && totalWords > 0) {
            await createDailyReviewPlan(ctx.db, user.user_id, plan, totalWords, 10);
        }
        await showNotificationSettings(ctx);
        await ctx.answerCallbackQuery(plan === 'none' ? 'تم إلغاء الخطة' : 'تم إنشاء الخطة');
    });

    bot.callbackQuery('leaderboard_notify_toggle', async (ctx) => {
        const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
        if (!user) return;
        const settings = await getUserSettings(ctx.db, user.user_id);
        await updateUserSettings(ctx.db, user.user_id, {
            leaderboard_notifications_enabled: !isEnabled(settings?.leaderboard_notifications_enabled),
        });
        await showNotificationSettings(ctx);
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^notification_time_(morning|afternoon|evening)$/, async (ctx) => {
        await ctx.editMessageText(
            'تغيير وقت الإشعار من داخل البوت TODO.\nحالياً استخدم الأوقات الافتراضية أو إعدادات Wrangler لاحقاً.',
            { reply_markup: settingsNavigationKeyboard() }
        );
        await ctx.answerCallbackQuery();
    });
}

async function showSettings(ctx: BotContext): Promise<void> {
    const telegramId = ctx.from?.id ?? 0;
    const user = await getUserByTelegramId(ctx.db, telegramId);

    if (!user) {
        await ctx.reply('يرجى استخدام /start أولاً.');
        return;
    }

    const settings = await getUserSettings(ctx.db, user.user_id);

    const modeLabels: Record<string, string> = {
        light: '🌱 خفيف',
        normal: '⚖️ عادي',
        intensive: '🔥 مكثف',
        custom: '🎛 مخصص',
        off: '🔕 متوقف',
    };

    const text = `⚙️ *الإعدادات*\n\n` +
        `🎯 الهدف اليومي: *${settings?.daily_goal ?? 10}* كلمات\n` +
        `🎚 المستوى الألماني: *${settings?.german_level ?? 'غير محدد'}*\n` +
        `🔔 الإشعارات: *${modeLabels[settings?.notification_mode ?? 'normal']}*\n` +
        `🕰️ وقت الصباح: *${settings?.morning_time ?? '08:00'}*\n` +
        `🕰️ وقت المساء: *${settings?.evening_time ?? '18:00'}*\n` +
        `🔔 التذكيرات: *${isEnabled(settings?.reminders_enabled) ? 'مفعلة' : 'متوقفة'}*\n` +
        `⚔️ إشعارات المنافسة: *${isEnabled(settings?.competition_notifications_enabled) ? 'مفعلة' : 'متوقفة'}*`;

    await replaceWithText(ctx, text, settingsNavigationKeyboard(), 'Markdown');
}

async function showNotificationSettings(ctx: BotContext): Promise<void> {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!user) {
        await ctx.reply('يرجى استخدام /start أولاً.');
        return;
    }

    const settings = await getUserSettings(ctx.db, user.user_id);
    const wordCount = await countWordsByUser(ctx.db, user.user_id);
    const modeLabels: Record<string, string> = {
        light: 'خفيف',
        normal: 'عادي',
        intensive: 'مكثف',
        custom: 'مخصص',
        off: 'متوقف',
    };
    const mode = settings?.notification_mode ?? settings?.notification_intensity ?? 'normal';
    const interval = settings?.notification_interval_hours;
    const plan = settings?.review_plan ?? 'none';
    const planLabel = plan === 'all_words_day'
        ? 'راجع كل كلماتي خلال يوم'
        : plan === 'all_words_week'
            ? 'راجع كل كلماتي خلال أسبوع'
            : 'لا توجد خطة مراجعة شاملة';
    const cadence = mode === 'custom' && interval
        ? `كل ${interval === 1 ? 'ساعة' : interval === 2 ? 'ساعتين' : '3 ساعات'}`
        : mode === 'light'
            ? 'إشعار واحد يومياً'
            : mode === 'intensive'
                ? '3 إشعارات يومياً'
                : mode === 'off'
                    ? 'متوقفة'
                    : 'إشعاران يومياً';

    await replaceWithText(
        ctx,
        `🔔 *الإشعارات*\n\n` +
        `الحالة: *${isEnabled(settings?.reminders_enabled) ? 'مفعلة' : 'متوقفة'}*\n` +
        `النمط: *${modeLabels[mode] ?? 'عادي'}*\n` +
        `عدد الكلمات: *${wordCount}*\n` +
        `الخطة الحالية: *${cadence}، جلسة ${settings?.notification_batch_size ?? 10} كلمات*\n` +
        `خطة المراجعة: *${planLabel}*\n` +
        `إشعارات الصدارة: *${isEnabled(settings?.leaderboard_notifications_enabled) ? 'مفعلة' : 'متوقفة'}*`,
        notificationSettingsKeyboard(),
        'Markdown'
    );
}

async function updateBooleanSetting(ctx: BotContext, settings: { reminders_enabled?: boolean; competition_notifications_enabled?: boolean }): Promise<void> {
    const telegramId = ctx.from?.id ?? 0;
    const user = await getUserByTelegramId(ctx.db, telegramId);
    if (user) {
        await updateUserSettings(ctx.db, user.user_id, settings);
    }
}

function settingsNavigationKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('🎯 تغيير الهدف', 'set_goal')
        .text('🔔 الإشعارات', 'set_notifications').row()
        .text('🎚 تغيير المستوى', 'change_level').row()
        .text('🤖 الذكاء الاصطناعي', 'ai_settings').row()
        .text('⬅️ رجوع', 'menu_more')
        .text('🏠 الرئيسية', 'menu_main');
}

function notificationSettingsKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('🌱 خفيف', 'notification_mode_light')
        .text('⚖️ عادي', 'notification_mode_normal')
        .text('🔥 مكثف', 'notification_mode_intensive').row()
        .text('🎛 مخصص', 'notification_mode_custom')
        .text('⏱ كل ساعة', 'notification_interval_1').row()
        .text('⏱ كل ساعتين', 'notification_interval_2')
        .text('⏱ كل 3 ساعات', 'notification_interval_3').row()
        .text('📦 راجع كل كلماتي خلال يوم', 'review_plan_all_words_day').row()
        .text('📦 راجع كل كلماتي خلال أسبوع', 'review_plan_all_words_week').row()
        .text('🏆 إشعارات الصدارة تشغيل/إيقاف', 'leaderboard_notify_toggle').row()
        .text('🔕 إيقاف', 'notification_mode_off').row()
        .text('⬅️ رجوع', 'menu_more')
        .text('🏠 الرئيسية', 'menu_main');
}

function isEnabled(value: boolean | number | undefined): boolean {
    return value !== false && value !== 0;
}
