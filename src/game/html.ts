export function renderCollectionGameHtml(): string {
    return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>تحدي الصور والكلمات</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; overflow: hidden; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #fff;
      background:
        radial-gradient(circle at 16% 18%, rgba(255,255,255,.45), transparent 12%),
        radial-gradient(circle at 82% 11%, rgba(255,255,255,.34), transparent 10%),
        linear-gradient(180deg, #193489 0%, #397de4 46%, #87d9ff 100%);
    }
    .stars {
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        radial-gradient(circle, rgba(255,255,255,.9) 0 1px, transparent 1.5px),
        radial-gradient(circle, rgba(255,255,255,.55) 0 1px, transparent 1.5px);
      background-size: 58px 58px, 95px 95px;
      opacity: .58;
      animation: drift 16s linear infinite;
    }
    @keyframes drift { from { transform: translateY(0); } to { transform: translateY(70px); } }
    .app {
      width: 100vw;
      min-height: 100dvh;
      position: relative;
      overflow: hidden;
      padding: env(safe-area-inset-top) 16px env(safe-area-inset-bottom);
    }
    .screen {
      min-height: 100dvh;
      display: grid;
      place-items: center;
      text-align: center;
      text-shadow: 0 3px 12px rgba(0, 30, 80, .42);
    }
    .panel {
      width: min(520px, 94vw);
      display: grid;
      justify-items: center;
      gap: 16px;
    }
    h1 { margin: 0; font-size: clamp(34px, 9vw, 58px); line-height: 1.05; }
    .sub { margin: 0; font-size: 18px; font-weight: 850; opacity: .96; }
    .notice {
      padding: 10px 14px;
      border-radius: 16px;
      background: rgba(7, 20, 64, .32);
      font-weight: 850;
      line-height: 1.45;
    }
    button {
      border: 0;
      min-height: 54px;
      border-radius: 999px;
      padding: 10px 22px;
      font: inherit;
      font-weight: 950;
      color: #102033;
      background: linear-gradient(180deg, #fff9d1, #ffcb48);
      box-shadow: 0 7px 0 #b8651a, 0 15px 24px rgba(0,0,0,.2);
      cursor: pointer;
    }
    .flight {
      position: relative;
      width: min(520px, 100vw);
      height: 100dvh;
      margin: 0 auto;
    }
    .hud {
      position: absolute;
      top: calc(env(safe-area-inset-top) + 12px);
      left: 50%;
      transform: translateX(-50%);
      width: min(480px, 92vw);
      display: grid;
      gap: 6px;
      justify-items: center;
      z-index: 4;
      font-weight: 950;
    }
    .meters { font-size: clamp(34px, 11vw, 72px); line-height: .95; }
    .prompt {
      padding: 8px 13px;
      border-radius: 999px;
      background: rgba(6, 22, 68, .34);
      font-size: 15px;
    }
    .obstacle {
      position: absolute;
      left: 50%;
      top: 24%;
      transform: translate(-50%, -50%);
      display: grid;
      justify-items: center;
      gap: 9px;
      z-index: 3;
      transition: transform .5s ease, opacity .35s ease;
    }
    .obstacle.cleared { transform: translate(-50%, -50%) scale(.05) rotate(30deg); opacity: 0; }
    .obstacle.crash { animation: shake .32s linear 3; }
    @keyframes shake {
      0%,100% { transform: translate(-50%, -50%); }
      25% { transform: translate(calc(-50% - 12px), -52%); }
      75% { transform: translate(calc(-50% + 12px), -48%); }
    }
    .visual {
      min-width: 118px;
      min-height: 118px;
      display: grid;
      place-items: center;
      font-size: clamp(76px, 24vw, 136px);
      line-height: 1;
      filter: drop-shadow(0 18px 20px rgba(0,0,0,.26));
    }
    .visual img {
      width: min(190px, 54vw);
      height: min(190px, 54vw);
      object-fit: contain;
      border-radius: 18px;
      background: rgba(255,255,255,.76);
      padding: 10px;
    }
    .rocket {
      position: absolute;
      left: 50%;
      bottom: 11%;
      transform: translateX(-50%);
      font-size: clamp(82px, 24vw, 142px);
      z-index: 2;
      filter: drop-shadow(0 20px 22px rgba(0,0,0,.28));
      transition: bottom .65s cubic-bezier(.2,.8,.22,1), transform .25s ease;
    }
    .rocket.listening { animation: float 1.2s ease-in-out infinite; }
    .rocket.crash { transform: translateX(-50%) rotate(-18deg) scale(.92); }
    @keyframes float {
      0%,100% { transform: translateX(-50%) translateY(0) rotate(-3deg); }
      50% { transform: translateX(-50%) translateY(-10px) rotate(3deg); }
    }
    .controls {
      position: absolute;
      left: 50%;
      bottom: calc(env(safe-area-inset-bottom) + 18px);
      transform: translateX(-50%);
      width: min(460px, 92vw);
      display: grid;
      gap: 10px;
      justify-items: center;
      z-index: 5;
    }
    .mic {
      min-width: min(310px, 84vw);
      font-size: 22px;
    }
    .status {
      min-height: 30px;
      padding: 7px 12px;
      border-radius: 999px;
      background: rgba(5, 20, 60, .3);
      font-weight: 850;
    }
    .hidden { display: none; }
    .result-visual { font-size: clamp(80px, 24vw, 140px); }
    .result-visual img {
      width: min(190px, 54vw);
      height: min(190px, 54vw);
      object-fit: contain;
      border-radius: 18px;
      background: rgba(255,255,255,.76);
      padding: 10px;
    }
    .danger { background: rgba(97, 9, 34, .38); }
  </style>
</head>
<body>
  <div class="stars"></div>
  <main class="app" id="app"></main>
  <script>
    const token = new URLSearchParams(location.search).get('token') || '';
    const app = document.getElementById('app');
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let state = null;
    let recognition = null;
    let attempts = 0;
    let listening = false;
    let timer = null;
    const maxAttempts = 2;

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'": '&#39;'}[c]));
    }
    function renderVisual(visual, className = 'visual') {
      if (!visual) return '<div class="' + className + '">🔤</div>';
      if (visual.type === 'image_url') {
        return '<div class="' + className + '"><img src="' + escapeHtml(visual.value) + '" alt=""></div>';
      }
      return '<div class="' + className + '">' + escapeHtml(visual.value) + '</div>';
    }
    async function api(path, options) {
      const res = await fetch(path, options);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'request_failed');
      return json;
    }
    function isSpeechSupported() {
      return Boolean(Recognition);
    }
    async function load() {
      if (!token) return renderError('رابط اللعبة غير صالح. افتح اللعبة من داخل البوت.');
      try {
        state = await api('/game/api/session?token=' + encodeURIComponent(token));
        renderStart();
      } catch (error) {
        renderError(error.message === 'expired_token' ? 'انتهت صلاحية جلسة اللعبة. افتح لعبة جديدة من البوت.' : 'تعذر فتح اللعبة حالياً.');
      }
    }
    function renderStart() {
      app.innerHTML = '<section class="screen"><div class="panel">' +
        '<div class="visual">🚀</div>' +
        '<h1>تحدي الصور والكلمات</h1>' +
        '<p class="sub">' + escapeHtml(state.collectionTitle) + '</p>' +
        '<p class="notice">إذا المايكروفون أو الصوت لا يعمل، افتح الصفحة في Safari أو Chrome.</p>' +
        '<p class="sub">انطق اسم الشيء بالألماني. اللغة: de-DE</p>' +
        '<button id="startBtn">ابدأ الصعود</button>' +
        '</div></section>';
      document.getElementById('startBtn').onclick = () => {
        if (!isSpeechSupported()) {
          renderError('متصفحك لا يدعم التعرف على الصوت. افتح اللعبة في Chrome أو Safari حديث.');
          return;
        }
        renderFlight();
      };
    }
    function renderFlight(message = 'انطق اسم الشيء بالألماني') {
      if (!state.question) return finish();
      attempts = 0;
      app.innerHTML = '<section class="flight">' +
        '<div class="hud"><div class="meters">' + state.heightMeters + 'm</div><div class="prompt">السؤال ' + (state.currentIndex + 1) + ' / ' + state.totalQuestions + ' · ✅ ' + state.correctCount + '</div></div>' +
        '<div class="obstacle" id="obstacle">' + renderVisual(state.question.visual) + '</div>' +
        '<div class="rocket" id="rocket">🚀</div>' +
        '<div class="controls"><button class="mic" id="micBtn">🎙 انطق الكلمة</button><div class="status" id="status">' + escapeHtml(message) + '</div></div>' +
        '</section>';
      document.getElementById('micBtn').onclick = listen;
    }
    function listen() {
      if (listening || !state.question) return;
      if (!isSpeechSupported()) return renderError('متصفحك لا يدعم التعرف على الصوت. افتح اللعبة في Chrome أو Safari حديث.');
      attempts += 1;
      listening = true;
      setStatus('أسمعك الآن...');
      document.getElementById('rocket').classList.add('listening');
      recognition = new Recognition();
      recognition.lang = 'de-DE';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 3;
      recognition.onresult = event => {
        const result = event.results && event.results[0];
        const alternatives = result ? Array.from(result).map(item => item.transcript).filter(Boolean) : [];
        const transcript = alternatives[0] || '';
        stopListening();
        submitSpeech(transcript, alternatives);
      };
      recognition.onerror = event => {
        stopListening();
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setStatus('فعّل المايكروفون حتى تلعب.');
          return;
        }
        retryOrCrash('ما سمعتك، جرّب مرة ثانية بسرعة');
      };
      recognition.onend = () => {
        if (listening) {
          stopListening();
          retryOrCrash('ما سمعتك، جرّب مرة ثانية بسرعة');
        }
      };
      try {
        recognition.start();
        timer = setTimeout(() => {
          stopListening();
          retryOrCrash('انتهى الوقت، جرّب بسرعة');
        }, 6500);
      } catch {
        stopListening();
        retryOrCrash('تعذر تشغيل المايكروفون. حاول مرة ثانية.');
      }
    }
    function stopListening() {
      listening = false;
      clearTimeout(timer);
      timer = null;
      document.getElementById('rocket')?.classList.remove('listening');
      try { recognition && recognition.stop(); } catch {}
      recognition = null;
    }
    function retryOrCrash(message) {
      if (attempts < maxAttempts) {
        setStatus(message + ' · محاولة ' + (attempts + 1) + ' من ' + maxAttempts);
        return;
      }
      submitSpeech('', []);
    }
    async function submitSpeech(transcript, alternatives) {
      setStatus(transcript ? 'سمعت: ' + transcript : 'لم أسمع إجابة واضحة');
      try {
        const result = await api('/game/api/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, questionIndex: state.question.questionIndex, transcript, alternatives })
        });
        state = result;
        if (result.correct) {
          document.getElementById('obstacle')?.classList.add('cleared');
          const rocket = document.getElementById('rocket');
          if (rocket) rocket.style.bottom = Math.min(72, 11 + state.correctCount * 8) + '%';
          setTimeout(() => result.finished ? finish() : renderFlight('صح! كمل الصعود'), 620);
          return;
        }
        document.getElementById('obstacle')?.classList.add('crash');
        document.getElementById('rocket')?.classList.add('crash');
        setTimeout(() => finish(), 650);
      } catch {
        renderError('تعذر تسجيل النطق. افتح اللعبة مرة ثانية من البوت.');
      }
    }
    async function finish() {
      try {
        state = await api('/game/api/finish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });
        renderGameOver();
      } catch {
        renderError('تعذر إنهاء الجولة حالياً.');
      }
    }
    function renderGameOver() {
      const failed = state.failedQuestion;
      const visual = failed ? renderVisual(failed.visual, 'result-visual') : '<div class="result-visual">🏁</div>';
      const title = failed ? 'خسرت بسبب' : 'وصلت للنهاية';
      const answer = failed ? '<p class="sub" dir="ltr">' + escapeHtml(failed.correctAnswer) + '</p>' : '';
      app.innerHTML = '<section class="screen"><div class="panel">' +
        visual +
        '<h1>' + title + '</h1>' +
        answer +
        '<p class="notice">' + state.heightMeters + ' meters above the ground</p>' +
        '<p class="sub">✅ صحيح: ' + state.correctCount + ' · ❌ خطأ: ' + state.wrongCount + ' · XP: +' + (state.xpGained || 0) + '</p>' +
        (failed ? '<button id="speakBtn">🔊 استمع للنطق الصحيح</button>' : '') +
        '<button onclick="location.reload()">إعادة اللعب</button>' +
        '<button onclick="history.back()">رجوع للبوت</button>' +
        '</div></section>';
      const speak = document.getElementById('speakBtn');
      if (speak && failed) speak.onclick = () => speakGerman(failed.correctAnswer);
    }
    function speakGerman(text) {
      if (!('speechSynthesis' in window)) return;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'de-DE';
      utterance.rate = .86;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    }
    function setStatus(message) {
      const status = document.getElementById('status');
      if (status) status.textContent = message;
    }
    function renderError(message) {
      app.innerHTML = '<section class="screen"><div class="panel">' +
        '<div class="visual">🛰️</div><h1>تحدي الصور والكلمات</h1>' +
        '<p class="notice danger">' + escapeHtml(message) + '</p>' +
        '<button onclick="location.reload()">حاول مرة ثانية</button>' +
        '<button onclick="history.back()">رجوع للبوت</button>' +
        '</div></section>';
    }
    load();
  </script>
</body>
</html>`;
}
