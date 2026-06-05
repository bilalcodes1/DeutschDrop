import { renderYouglishHtml } from '../services/youglish';

export function handleYouglishPage(request: Request): Response {
    const url = new URL(request.url);
    const word = url.searchParams.get('word') ?? '';
    const lang = url.searchParams.get('lang') ?? 'german';

    return new Response(renderYouglishHtml(word, lang), {
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
        },
    });
}
