export async function fetchJsonWithTimeout<T>(
    url: string,
    init: RequestInit = {},
    timeoutMs = 8000
): Promise<{ response: Response; data?: T; malformed?: boolean }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        if (!response.ok) return { response };
        try {
            return { response, data: await response.json<T>() };
        } catch {
            return { response, malformed: true };
        }
    } finally {
        clearTimeout(timer);
    }
}
