export function renderCollectionGameHtml(): string {
    return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>تحدي الصور والكلمات</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #fff;
      background:
        radial-gradient(circle at 20% 20%, rgba(255,255,255,.4), transparent 16%),
        radial-gradient(circle at 80% 12%, rgba(255,255,255,.3), transparent 12%),
        linear-gradient(180deg, #4068ff 0%, #6ab5ff 48%, #8ed7ff 100%);
      overflow-x: hidden;
    }
    .app {
      min-height: 100dvh;
      display: grid;
      place-items: center;
      padding: 18px;
      position: relative;
    }
    .stars {
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        radial-gradient(circle, rgba(255,255,255,.85) 0 1px, transparent 1.5px),
        radial-gradient(circle, rgba(255,255,255,.55) 0 1px, transparent 1.5px);
      background-size: 56px 56px, 88px 88px;
      animation: drift 18s linear infinite;
      opacity: .55;
    }
    @keyframes drift { from { transform: translateY(0); } to { transform: translateY(60px); } }
    .panel {
      width: min(520px, 94vw);
      min-height: min(680px, 88dvh);
      display: grid;
      align-content: center;
      justify-items: center;
      gap: 16px;
      text-align: center;
      text-shadow: 0 3px 12px rgba(0,30,80,.38);
    }
    h1 { margin: 0; font-size: clamp(32px, 9vw, 54px); line-height: 1.05; }
    .sub { margin: 0; font-size: 18px; font-weight: 800; opacity: .96; }
    .rocket { font-size: clamp(70px, 22vw, 132px); filter: drop-shadow(0 18px 20px rgba(0,0,0,.22)); }
    .visual {
      min-height: 160px;
      display: grid;
      place-items: center;
      font-size: clamp(78px, 26vw, 150px);
      line-height: 1;
      filter: drop-shadow(0 18px 20px rgba(0,0,0,.2));
    }
    .visual img {
      width: min(210px, 56vw);
      height: min(210px, 56vw);
      object-fit: contain;
      border-radius: 18px;
      background: rgba(255,255,255,.72);
      padding: 10px;
    }
    .progress { font-weight: 950; font-size: 16px; opacity: .96; }
    .prompt {
      min-height: 42px;
      padding: 10px 16px;
      border-radius: 18px;
      background: rgba(5, 21, 60, .26);
      font-weight: 950;
      font-size: clamp(18px, 5vw, 25px);
    }
    .options { width: 100%; display: grid; gap: 10px; }
    button, .link-button {
      border: 0;
      min-height: 52px;
      border-radius: 16px;
      padding: 10px 16px;
      font: inherit;
      font-weight: 950;
      color: #102033;
      background: linear-gradient(180deg, #fff9d1, #ffcb48);
      box-shadow: 0 6px 0 #b8651a, 0 13px 22px rgba(0,0,0,.18);
      cursor: pointer;
      text-decoration: none;
      display: inline-grid;
      place-items: center;
    }
    .option { background: rgba(255,255,255,.95); box-shadow: 0 5px 0 rgba(42,95,160,.34); }
    .option.correct { background: #91f2aa; }
    .option.wrong { background: #ffb0a9; }
    .muted { opacity: .88; font-weight: 800; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
    .hidden { display: none; }
    .error { background: rgba(80,0,30,.34); padding: 12px 14px; border-radius: 16px; font-weight: 850; }
  </style>
</head>
<body>
  <div class="stars"></div>
  <main class="app">
    <section class="panel" id="screen"></section>
  </main>
  <script>
    const token = new URLSearchParams(location.search).get('token') || '';
    const screen = document.getElementById('screen');
    let state = null;
    let locked = false;

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'": '&#39;'}[c]));
    }
    function renderVisual(visual) {
      if (!visual) return '<div class="visual">🔤</div>';
      if (visual.type === 'image_url') {
        return '<div class="visual"><img src="' + escapeHtml(visual.value) + '" alt=""></div>';
      }
      return '<div class="visual">' + escapeHtml(visual.value) + '</div>';
    }
    function botBack() {
      if (window.Telegram && Telegram.WebApp) Telegram.WebApp.close();
    }
    async function api(path, options) {
      const res = await fetch(path, options);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'request_failed');
      return json;
    }
    async function load() {
      if (!token) {
        renderError('رابط اللعبة غير صالح. افتح اللعبة من داخل البوت.');
        return;
      }
      try {
        state = await api('/game/api/session?token=' + encodeURIComponent(token));
        renderStart();
      } catch (error) {
        renderError(error.message === 'expired_token' ? 'انتهت صلاحية جلسة اللعبة. افتح لعبة جديدة من البوت.' : 'تعذر فتح اللعبة حالياً.');
      }
    }
    function renderStart() {
      screen.innerHTML =
        '<div class="rocket">🚀</div>' +
        '<h1>تحدي الصور والكلمات</h1>' +
        '<p class="sub">' + escapeHtml(state.collectionTitle) + '</p>' +
        '<p class="muted">عدد الأسئلة: ' + state.totalQuestions + '</p>' +
        '<button id="startBtn">ابدأ</button>';
      document.getElementById('startBtn').onclick = renderQuestion;
    }
    function renderQuestion() {
      if (!state.question) {
        finish();
        return;
      }
      const q = state.question;
      screen.innerHTML =
        '<div class="progress">السؤال ' + (state.currentIndex + 1) + ' / ' + state.totalQuestions + ' · ✅ ' + state.correctCount + ' · ❌ ' + state.wrongCount + '</div>' +
        renderVisual(q.visual) +
        '<div class="prompt">' + escapeHtml(q.prompt) + '</div>' +
        '<div class="options">' + q.options.map(option => '<button class="option" data-answer="' + escapeHtml(option) + '">' + escapeHtml(option) + '</button>').join('') + '</div>';
      document.querySelectorAll('.option').forEach(btn => {
        btn.addEventListener('click', () => answer(btn.dataset.answer, btn));
      });
    }
    async function answer(answerText, button) {
      if (locked) return;
      locked = true;
      try {
        const result = await api('/game/api/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, questionIndex: state.question.questionIndex, answer: answerText })
        });
        button.classList.add(result.correct ? 'correct' : 'wrong');
        state = result;
        setTimeout(() => {
          locked = false;
          result.finished ? finish() : renderQuestion();
        }, 520);
      } catch {
        locked = false;
        renderError('تعذر تسجيل الإجابة. جرّب فتح اللعبة مرة ثانية من البوت.');
      }
    }
    async function finish() {
      try {
        state = await api('/game/api/finish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });
        screen.innerHTML =
          '<div class="rocket">🏁</div>' +
          '<h1>انتهت الجولة</h1>' +
          '<p class="sub">✅ صحيح: ' + state.correctCount + ' · ❌ خطأ: ' + state.wrongCount + '</p>' +
          '<p class="prompt">XP المكتسبة: +' + (state.xpGained || 0) + '</p>' +
          '<div class="actions"><button onclick="location.reload()">إعادة اللعب</button><button onclick="botBack()">رجوع للبوت</button></div>';
      } catch {
        renderError('تعذر إنهاء الجولة حالياً.');
      }
    }
    function renderError(message) {
      screen.innerHTML = '<div class="rocket">🛰️</div><h1>تحدي الصور والكلمات</h1><div class="error">' + escapeHtml(message) + '</div><button onclick="botBack()">رجوع للبوت</button>';
    }
    load();
  </script>
</body>
</html>`;
}
