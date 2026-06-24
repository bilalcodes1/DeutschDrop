export const START_BUTTON_TEXT = '🚀 START';

export function persistentStartKeyboard() {
    return {
        keyboard: [[{ text: START_BUTTON_TEXT }]],
        resize_keyboard: true,
        is_persistent: true,
        one_time_keyboard: false,
        input_field_placeholder: 'اضغط START للعودة للقائمة',
    };
}
