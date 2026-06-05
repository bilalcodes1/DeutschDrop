const YOUGLISH_DIRECT_BASE = 'https://youglish.com/pronounce';

export function buildYouglishDirectUrl(word: string, lang = 'german'): string {
    return `${YOUGLISH_DIRECT_BASE}/${encodeURIComponent(word)}/${encodeURIComponent(normalizeYouglishLang(lang))}`;
}

export function buildYouglishWebAppUrl(baseUrl: string, word: string, lang = 'german'): string {
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}word=${encodeURIComponent(word)}&lang=${encodeURIComponent(normalizeYouglishLang(lang))}`;
}

export function normalizeYouglishLang(lang: string | null | undefined): string {
    return lang === 'german' ? 'german' : 'german';
}

export function renderYouglishHtml(wordInput: string, langInput: string | null = 'german'): string {
    const word = sanitizeDisplayWord(wordInput);
    const lang = normalizeYouglishLang(langInput);
    const escapedWord = escapeHtml(word);
    const directUrl = buildYouglishDirectUrl(word, lang);

    return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>YouGlish German - ${escapedWord}</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; padding: 18px; background: #f7f7f5; color: #171717; }
    main { max-width: 820px; margin: 0 auto; }
    h1 { font-size: 24px; margin: 0 0 10px; direction: ltr; text-align: left; }
    p { margin: 0 0 16px; color: #555; line-height: 1.5; }
    .notice { border-radius: 8px; background: white; padding: 16px; }
    .actions { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
    button, a { border: 0; border-radius: 8px; padding: 11px 14px; font: inherit; text-decoration: none; cursor: pointer; }
    button { background: #1473e6; color: white; }
    a { background: #e9e9e6; color: #111; }
    .policy { margin-top: 12px; font-size: 12px; color: #666; }
    @media (prefers-color-scheme: dark) {
      body { background: #111; color: #f4f4f4; }
      p, .policy { color: #c8c8c8; }
      .notice { background: #1c1c1c; }
      a { background: #2b2b2b; color: #f4f4f4; }
    }
  </style>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
</head>
<body>
  <main>
    <h1>🎬 ${escapedWord}</h1>
    <p>أمثلة نطق حقيقية من YouGlish German.</p>
    <div class="notice">
      <p>إذا لم يعمل الفيديو داخل Telegram بسبب WebView أو مشغل YouTube، افتحه مباشرة في YouGlish.</p>
      <p>هذه الصفحة لا تحمّل فيديوهات ولا تخزن بيانات مستخدم.</p>
    </div>
    <div class="actions">
      <button type="button" onclick="closeTelegramWebApp()">✅ خلصت</button>
      <a href="${escapeHtml(directUrl)}" target="_blank" rel="noopener">🔗 فتح في YouGlish</a>
    </div>
    <p class="policy">يفتح الرابط الرسمي لـ YouGlish فقط. لا يتم تخزين أي بيانات مستخدم.</p>
  </main>
  <script>
    function closeTelegramWebApp() {
      if (window.Telegram && window.Telegram.WebApp) {
        window.Telegram.WebApp.close();
        return;
      }
      window.close();
    }
  </script>
</body>
</html>`;
}

function sanitizeDisplayWord(value: string): string {
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'sprechen';
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
