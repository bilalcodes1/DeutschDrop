import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId, getUserSettings, updateUserSettings } from '../repositories/userRepository';
import { mainMenuKeyboard } from './menu';

export function registerSettingsCommand(bot: Bot<BotContext>): void {
    bot.command('settings', async (ctx) => {
        await showSettings(ctx);
    });

    bot.callbackQuery('menu_settings', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showSettings(ctx);
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
        await ctx.editMessageText(
            '🔔 *اختر أوقات الإشعارات:*',
            {
                parse_mode: 'Markdown',
                reply_markup: new InlineKeyboard()
                    .text('☀️ صباحاً فقط', 'notify_morning').row()
                    .text('☀️ صباحاً + 🌙 مساءً', 'notify_both').row()
                    .text('⏰ طوال اليوم', 'notify_all').row()
                    .text('⬅️ رجوع', 'menu_settings')
            }
        );
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^notify_(morning|both|all)$/, async (ctx) => {
        const mode = ctx.match[1];
        const modeMap: Record<string, string> = {
            morning: 'morning',
            both: 'morning_evening',
            all: 'all_day',
        };
        const telegramId = ctx.from?.id ?? 0;
        const user = await getUserByTelegramId(ctx.db, telegramId);

        if (user) {
            await updateUserSettings(ctx.db, user.user_id, {
                notification_mode: modeMap[mode] as 'morning' | 'morning_evening' | 'all_day',
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
        morning: '☀️ صباحاً فقط',
        morning_evening: '☀️ صباحاً + 🌙 مساءً',
        all_day: '⏰ طوال اليوم',
    };

    const text = `⚙️ *الإعدادات*\n\n` +
        `🎯 الهدف اليومي: *${settings?.daily_goal ?? 10}* كلمات\n` +
        `🔔 الإشعارات: *${modeLabels[settings?.notification_mode ?? 'morning']}*\n` +
        `🕰️ وقت الصباح: *${settings?.morning_time ?? '08:00'}*\n` +
        `🕰️ وقت المساء: *${settings?.evening_time ?? '18:00'}*`;

    await ctx.reply(text, {
        parse_mode: 'Markdown',
        reply_markup: settingsNavigationKeyboard(),
    });
}

function settingsNavigationKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('🎯 تغيير الهدف', 'set_goal')
        .text('🔔 الإشعارات', 'set_notifications').row()
        .text('⬅️ رجوع للقائمة', 'menu_main');
}
