import type { BotContext } from './context';
import { getBotSession, saveBotSession } from '../repositories/sessionRepository';

export const START_BUTTON_TEXT = '🚀 START';
export const START_KEYBOARD_SESSION_TYPE = 'start_keyboard';
const START_KEYBOARD_TTL_MINUTES = 60 * 24 * 30;
const START_KEYBOARD_READY_TEXT = '🚀 زر الرجوع السريع جاهز';

interface EnsurePersistentStartKeyboardOptions {
    force?: boolean;
}

export function persistentStartKeyboard() {
    return {
        keyboard: [[{ text: START_BUTTON_TEXT }]],
        resize_keyboard: true,
        is_persistent: true,
        one_time_keyboard: false,
        input_field_placeholder: 'اضغط START للعودة للقائمة',
    };
}

export async function ensurePersistentStartKeyboard(
    ctx: BotContext,
    userId?: number,
    options: EnsurePersistentStartKeyboardOptions = {}
): Promise<boolean> {
    if (userId && !options.force) {
        const existing = await getBotSession(ctx.db, userId, START_KEYBOARD_SESSION_TYPE);
        if (existing) return false;
    }

    const message = await ctx.reply(START_KEYBOARD_READY_TEXT, {
        reply_markup: persistentStartKeyboard(),
    });

    if (userId) {
        await saveBotSession(
            ctx.db,
            userId,
            START_KEYBOARD_SESSION_TYPE,
            {
                messageId: message.message_id,
                installedAt: new Date().toISOString(),
            },
            START_KEYBOARD_TTL_MINUTES
        );
    }

    return true;
}
