export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = 10000): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(input, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function retryDelayMs(): number {
    return 800 + Math.floor(Math.random() * 401);
}
