import type { Env } from '../../models';

export type AiTaskType = 'generate_example_and_pronunciation' | 'generate_pronunciation' | 'explain_answer' | 'classify_level';
export type AiProviderName = 'gemini' | 'kimi' | 'grok';
export type AiStatus = 'ok' | 'AI_DISABLED' | 'RATE_LIMITED' | 'AI_UNAVAILABLE';

export interface GenerateExampleInput {
    german: string;
    arabic: string;
    currentExample?: string | null;
}

export interface GeneratePronunciationInput {
    german: string;
}

export interface ExplainAnswerInput {
    questionType: string;
    german: string;
    arabic: string;
    userAnswer: string;
    correctAnswer: string;
    example?: string | null;
}

export interface ClassifyLevelInput {
    german: string;
    arabic: string;
    example?: string | null;
}

export type AiTaskInput = GenerateExampleInput | GeneratePronunciationInput | ExplainAnswerInput | ClassifyLevelInput;

export interface AiTaskResult<T = unknown> {
    status: AiStatus;
    result?: T;
    provider?: AiProviderName | 'cache';
    model?: string | null;
}

export interface AiProvider {
    name: AiProviderName;
    run(env: Env, prompt: string): Promise<{ text: string; model: string | null }>;
}

export interface RunAiOptions {
    userId: number;
    bypassCache?: boolean;
}
