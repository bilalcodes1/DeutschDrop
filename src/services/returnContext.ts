export type ReturnContext = 'word_details' | 'learn_session' | 'training_session' | 'notification_answer' | 'hard_words' | 'review_plan' | 'ai_explanation';

export function normalizeReturnContext(value: string | undefined): ReturnContext {
    const allowed: ReturnContext[] = ['word_details', 'learn_session', 'training_session', 'notification_answer', 'hard_words', 'review_plan', 'ai_explanation'];
    return allowed.includes(value as ReturnContext) ? value as ReturnContext : 'word_details';
}

export function sideFlowBackCallback(wordId: number, context: ReturnContext = 'word_details'): string {
    if (context === 'learn_session') return `learn:back:${wordId}`;
    if (context === 'training_session' || context === 'review_plan') return `train:back:${wordId}`;
    if (context === 'notification_answer') return `word_detail_${wordId}`;
    return `word_detail_${wordId}`;
}
