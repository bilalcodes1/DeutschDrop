import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot/context';
import { getUserByTelegramId } from '../repositories/userRepository';
import { claimQuestReward, formatDailyQuestsMessage, getDailyQuests, type DailyQuest } from '../services/dailyQuests';
import { replaceWithText } from './wordPanel';

type DailyQuestTier = 'bronze' | 'silver' | 'gold';

export function registerDailyQuestsCommand(bot: Bot<BotContext>): void {
    bot.callbackQuery('daily_quests', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showDailyQuests(ctx);
    });

    bot.callbackQuery(/^daily_quest_claim:(bronze|silver|gold)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const user = await getCurrentUser(ctx);
        if (!user) return;

        const tier = ctx.match[1] as DailyQuestTier;
        const result = await claimQuestReward(ctx.db, user.user_id, tier);
        if (result.success) {
            await ctx.answerCallbackQuery(`تم استلام +${result.rewardXp} XP ✅`).catch(() => {});
        } else {
            await ctx.answerCallbackQuery('هذه المهمة غير مكتملة أو تم استلامها مسبقاً.').catch(() => {});
        }
        await showDailyQuests(ctx);
    });
}

async function showDailyQuests(ctx: BotContext): Promise<void> {
    const user = await getCurrentUser(ctx);
    if (!user) return;

    const quests = await getDailyQuests(ctx.db, user.user_id);
    await replaceWithText(ctx, formatDailyQuestsMessage(quests), dailyQuestsKeyboard(quests), 'Markdown');
}

async function getCurrentUser(ctx: BotContext) {
    const user = await getUserByTelegramId(ctx.db, ctx.from?.id ?? 0);
    if (!user) await ctx.reply('يرجى استخدام /start أولاً.');
    return user;
}

function dailyQuestsKeyboard(quests: DailyQuest[]): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    for (const quest of quests) {
        if (quest.is_completed && !quest.is_claimed) {
            keyboard.text(`🎁 استلام ${tierLabel(quest.tier)} +${quest.reward_xp} XP`, `daily_quest_claim:${quest.tier}`).row();
        }
    }
    keyboard.text('🏋️ تدريب', 'menu_train')
        .text('📚 راجع الآن', 'menu_learn').row()
        .text('🏠 الرئيسية', 'menu_main');
    return keyboard;
}

function tierLabel(tier: DailyQuestTier): string {
    if (tier === 'bronze') return 'Bronze';
    if (tier === 'silver') return 'Silver';
    return 'Gold';
}
