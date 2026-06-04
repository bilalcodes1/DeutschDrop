export type AiErrorType = 'RATE_LIMIT' | 'AUTH' | 'BAD_JSON' | 'NETWORK' | 'UNKNOWN' | 'SKIPPED_NO_KEY';

export class AiProviderFailure extends Error {
    constructor(
        public readonly type: AiErrorType,
        public readonly status?: number
    ) {
        super(type);
    }
}

export function classifyHttpStatus(status: number): AiErrorType {
    if (status === 401 || status === 403) return 'AUTH';
    if (status === 429) return 'RATE_LIMIT';
    return 'UNKNOWN';
}

export function classifyAiError(error: unknown): { type: AiErrorType; status?: number } {
    if (error instanceof AiProviderFailure) return { type: error.type, status: error.status };
    if (error instanceof TypeError) return { type: 'NETWORK' };
    return { type: 'UNKNOWN' };
}

export function safeProviderWarn(provider: string, type: AiErrorType, status?: number): void {
    console.warn(`AI provider failed: provider=${provider} type=${type}${status ? ` status=${status}` : ''}`);
}
