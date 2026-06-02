import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId, createUser, updateUserSettings } from '../repositories/userRepository';

const GOAL_OPTIONS = [3, 5, 10, 20];

export function registerStartCommand(bot: Bot<BotContext>): void {
    bot.command('start', async (ctx) => {
        const telegramId = ctx.from?.id ?? 0;
        const name = ctx.from?.first_name ?? 'User';
        const username = ctx.from?.username ?? null;

        let user = await getUserByTelegramId(ctx.db, telegramId);
        let isNewUser = false;

        if (!user) {
            const userId = await createUser(ctx.db, name, telegramId, username);
            user = {
                user_id: userId,
                name,
                telegram_id: telegramId,
                telegram_username: username,
                created_at: new Date().toISOString(),
            };
            isNewUser = true;
        }

        if (isNewUser) {
            await ctx.reply(
                `مرحباً ${name}! 👋\n\nمرحباً بك في *DeutschDrop* — رحلتك لتعلم المفردات الألمانية.\n\nلنبدأ بتحديد هدفك اليومي:`,
                { parse_mode: 'Markdown' }
            );
            await showGoalSelection(ctx);
        } else {
            await ctx.reply(
                `مرحباً مجدداً ${name}! 👋\n\nاستخدم القائمة أدناه للبدء.`,
                { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
            );
        }
    });

    // Handle goal selection callback
    bot.callbackQuery(/^goal_(\d+)$/, async (ctx) => {
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
            `تم! هدفك اليومي: *${goal}* كلمات يومياً.\n\nلنبدأ التعلم! 🎉`,
            { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
        );
        await ctx.answerCallbackQuery();
    });
}

async function showGoalSelection(ctx: BotContext): Promise<void> {
    const keyboard = new InlineKeyboard();
    for (const g of GOAL_OPTIONS) {
        keyboard.text(`${g} كلمات`, `goal_${g}`).row();
    }
    await ctx.reply('اختر هدفك اليومي:', { reply_markup: keyboard });
}

function mainMenuKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text('📚 تعلم', 'menu_learn')
        .text('🏋️ تدريب', 'menu_train').row()
        .text('⚔️ تحدي', 'menu_challenge')
        .text('🏆 الترتيب', 'menu_leaderboard').row()
        .text('📂 إدارة الكلمات', 'menu_words')
        .text('📊 الإحصائيات', 'menu_stats').row()
        .text('⚙️ الإعدادات', 'menu_settings');
}
