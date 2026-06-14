export function renderCollectionGameHtml(): string {
    return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>تحدي الصور والكلمات</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #fff;
      background: #55b4f5;
      overscroll-behavior: none;
      touch-action: manipulation;
    }
    button {
      border: 0;
      font: inherit;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .sky {
      position: fixed;
      inset: 0;
      overflow: hidden;
      background:
        radial-gradient(circle at 12% 18%, rgba(255,255,255,.18) 0 1px, transparent 2px),
        radial-gradient(circle at 78% 16%, rgba(255,255,255,.18) 0 1px, transparent 2px),
        radial-gradient(circle at 50% 108%, rgba(255,255,255,.28), transparent 20%),
        linear-gradient(180deg, #58b6f7 0%, #53b2f3 45%, #66c1ff 100%);
    }
    .particle {
      position: absolute;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: rgba(255,255,255,.46);
      animation: particle-float linear infinite;
    }
    .particle.p1 { left: 14%; top: 18%; animation-duration: 8s; }
    .particle.p2 { left: 75%; top: 42%; animation-duration: 11s; animation-delay: -4s; }
    .particle.p3 { left: 35%; top: 72%; animation-duration: 9s; animation-delay: -2s; }
    @keyframes particle-float {
      0% { translate: 0 16px; opacity: .2; }
      50% { opacity: .7; }
      100% { translate: 0 -34px; opacity: .05; }
    }
    .cloud {
      position: absolute;
      width: 170px;
      height: 58px;
      opacity: .8;
      filter: blur(.2px) drop-shadow(0 8px 8px rgba(45, 115, 172, .12));
      animation: cloud-drift linear infinite;
    }
    .cloud::before,
    .cloud::after,
    .cloud span {
      content: "";
      position: absolute;
      background: rgba(255,255,255,.88);
      border-radius: 999px;
    }
    .cloud::before { width: 86px; height: 48px; left: 28px; top: 5px; }
    .cloud::after { width: 58px; height: 38px; left: 82px; top: 16px; }
    .cloud span { width: 105px; height: 34px; left: 6px; top: 24px; }
    .cloud.c1 { left: -180px; top: 9%; animation-duration: 34s; }
    .cloud.c2 { left: -220px; top: 30%; transform: scale(.72); animation-duration: 42s; animation-delay: -13s; }
    .cloud.c3 { left: -260px; top: 64%; transform: scale(1.15); animation-duration: 52s; animation-delay: -24s; }
    .cloud.c4 { left: -180px; top: 83%; transform: scale(.55); animation-duration: 37s; animation-delay: -5s; }
    @keyframes cloud-drift {
      from { translate: -20vw 0; }
      to { translate: 135vw 0; }
    }
    .app {
      position: relative;
      width: 100vw;
      height: 100dvh;
      overflow: hidden;
      padding: env(safe-area-inset-top) 18px env(safe-area-inset-bottom);
    }
    .screen {
      min-height: 100dvh;
      display: grid;
      place-items: center;
      text-align: center;
      text-shadow: 0 4px 12px rgba(20, 74, 120, .42);
    }
    .panel {
      width: min(520px, 92vw);
      display: grid;
      justify-items: center;
      gap: 18px;
      transform: translateY(-2vh);
    }
    h1 { margin: 0; font-size: clamp(38px, 10vw, 64px); line-height: 1.05; letter-spacing: 0; }
    .sub { margin: 0; font-size: clamp(17px, 4.4vw, 23px); font-weight: 900; opacity: .98; line-height: 1.45; }
    .notice {
      margin: 0;
      padding: 11px 16px;
      border-radius: 18px;
      background: rgba(17, 73, 126, .28);
      font-size: 15px;
      font-weight: 850;
      line-height: 1.55;
      max-width: 390px;
    }
    .primary {
      min-width: min(330px, 84vw);
      min-height: 66px;
      border-radius: 999px;
      padding: 12px 24px;
      color: #16385e;
      background: rgba(255,255,255,.95);
      box-shadow: 0 8px 0 rgba(37, 101, 156, .18), 0 14px 28px rgba(22, 78, 130, .22);
      font-size: clamp(22px, 6vw, 32px);
      font-weight: 950;
    }
    .secondary {
      min-height: 50px;
      border-radius: 999px;
      padding: 10px 18px;
      color: #fff;
      background: rgba(16, 70, 124, .36);
      font-size: 17px;
      font-weight: 900;
    }
    .flight {
      position: relative;
      width: min(540px, 100vw);
      height: 100dvh;
      margin: 0 auto;
      overflow: hidden;
    }
    .hud {
      position: absolute;
      top: calc(env(safe-area-inset-top) + 18px);
      left: 50%;
      translate: -50% 0;
      width: min(480px, 92vw);
      display: grid;
      justify-items: center;
      gap: 8px;
      z-index: 7;
      pointer-events: none;
      text-shadow: 0 4px 10px rgba(21, 88, 150, .38);
    }
    .meters {
      font-size: clamp(46px, 16vw, 86px);
      font-weight: 1000;
      line-height: .9;
    }
    .hud-label {
      font-size: 15px;
      font-weight: 900;
      opacity: .96;
    }
    .timer {
      width: min(260px, 54vw);
      height: 8px;
      border-radius: 999px;
      background: rgba(255,255,255,.28);
      overflow: hidden;
    }
    .timer-fill {
      height: 100%;
      width: 100%;
      border-radius: inherit;
      background: rgba(255,255,255,.92);
      transform-origin: right center;
    }
    .obstacle {
      position: absolute;
      left: 50%;
      top: 32%;
      translate: -50% -50%;
      display: grid;
      justify-items: center;
      gap: 8px;
      z-index: 5;
      transition: top .56s ease, scale .24s ease, opacity .24s ease;
      filter: drop-shadow(0 18px 20px rgba(35, 93, 146, .28));
    }
    .obstacle-emoji {
      font-size: clamp(90px, 28vw, 156px);
      line-height: 1;
      animation: obstacle-bob 1.9s ease-in-out infinite;
    }
    @keyframes obstacle-bob {
      0%, 100% { translate: 0 0; }
      50% { translate: 0 -10px; }
    }
    .obstacle.explosion {
      animation: pop-explosion .42s ease-out forwards;
    }
    @keyframes pop-explosion {
      0% { opacity: 1; scale: 1; rotate: 0deg; }
      45% { opacity: 1; scale: 1.45; rotate: 10deg; filter: drop-shadow(0 0 30px rgba(255,255,255,.85)); }
      100% { opacity: 0; scale: .12; rotate: -30deg; }
    }
    .obstacle.collision {
      animation: collision-shake .34s linear 3;
    }
    @keyframes collision-shake {
      0%,100% { translate: -50% -50%; }
      25% { translate: calc(-50% - 14px) calc(-50% + 4px); }
      75% { translate: calc(-50% + 14px) calc(-50% - 4px); }
    }
    .rocket-wrap {
      position: absolute;
      left: 50%;
      bottom: 8%;
      translate: -50% 0;
      width: 126px;
      height: 226px;
      z-index: 4;
      transition: bottom .62s cubic-bezier(.18,.82,.2,1), rotate .2s ease, scale .2s ease;
      filter: drop-shadow(0 22px 22px rgba(28, 85, 138, .32));
    }
    .rocket-wrap.launch { animation: rocket-float 1.25s ease-in-out infinite; }
    .rocket-wrap.boost { animation: rocket-boost .48s ease-out; }
    .rocket-wrap.drop-back { animation: rocket-drop-back .46s ease-out; }
    .rocket-wrap.collision { rotate: -16deg; scale: .94; animation: rocket-hit .36s linear 2; }
    @keyframes rocket-float {
      0%, 100% { transform: translateY(0) rotate(-1deg); }
      50% { transform: translateY(-12px) rotate(1.5deg); }
    }
    @keyframes rocket-hit {
      0%,100% { translate: -50% 0; }
      35% { translate: calc(-50% - 16px) 8px; }
      70% { translate: calc(-50% + 12px) -4px; }
    }
    @keyframes rocket-boost {
      0% { transform: translateY(0) scale(1); }
      45% { transform: translateY(-34px) scale(1.08); }
      100% { transform: translateY(0) scale(1); }
    }
    @keyframes rocket-drop-back {
      0% { transform: translateY(0) scale(1); }
      50% { transform: translateY(28px) scale(.96); }
      100% { transform: translateY(0) scale(1); }
    }
    .rocket-body {
      position: absolute;
      left: 50%;
      top: 8px;
      translate: -50% 0;
      width: 78px;
      height: 158px;
      border-radius: 48% 48% 42% 42%;
      background: linear-gradient(90deg, #d7ecff 0%, #fff 32%, #eef8ff 62%, #9fd4ff 100%);
      border: 4px solid rgba(52, 119, 176, .55);
    }
    .rocket-body::before {
      content: "";
      position: absolute;
      left: 50%;
      top: -34px;
      translate: -50% 0;
      width: 0;
      height: 0;
      border-left: 38px solid transparent;
      border-right: 38px solid transparent;
      border-bottom: 54px solid #ff563e;
      filter: drop-shadow(0 3px 0 rgba(161,49,37,.34));
    }
    .window {
      position: absolute;
      left: 50%;
      top: 50px;
      translate: -50% 0;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: radial-gradient(circle at 36% 34%, #84d6ff 0 26%, #1b78bf 28% 70%, #124e93 72%);
      border: 5px solid #7cbff2;
    }
    .stripe {
      position: absolute;
      left: 50%;
      bottom: 26px;
      translate: -50% 0;
      width: 20px;
      height: 42px;
      border-radius: 8px;
      background: #e8503f;
    }
    .fin {
      position: absolute;
      bottom: 44px;
      width: 36px;
      height: 68px;
      background: #e84837;
      border: 4px solid rgba(52,119,176,.45);
      z-index: -1;
    }
    .fin.left { left: 8px; transform: skewY(-25deg); border-radius: 10px 4px 18px 10px; }
    .fin.right { right: 8px; transform: skewY(25deg); border-radius: 4px 10px 10px 18px; }
    .flame {
      position: absolute;
      left: 50%;
      bottom: -18px;
      translate: -50% 0;
      width: 40px;
      height: 72px;
      border-radius: 0 0 50% 50%;
      background: linear-gradient(180deg, #ffeb3b 0%, #ff9d1c 42%, #ff4a1c 72%, transparent 100%);
      transform-origin: top center;
      animation: flame-flicker .16s ease-in-out infinite alternate;
      z-index: -2;
    }
    @keyframes flame-flicker {
      from { scale: .86 1; opacity: .88; }
      to { scale: 1.08 1.16; opacity: 1; }
    }
    .controls {
      position: absolute;
      left: 50%;
      bottom: calc(env(safe-area-inset-bottom) + 20px);
      translate: -50% 0;
      width: min(430px, 92vw);
      display: grid;
      justify-items: center;
      gap: 10px;
      z-index: 8;
    }
    .mic {
      width: min(150px, 38vw);
      height: min(150px, 38vw);
      min-height: 94px;
      min-width: 94px;
      border-radius: 50%;
      background: rgba(255,255,255,.94);
      color: #184069;
      font-size: clamp(44px, 12vw, 64px);
      box-shadow: 0 10px 0 rgba(37,101,156,.16), 0 18px 26px rgba(30,82,130,.24);
      display: grid;
      place-items: center;
    }
    .mic.listening {
      animation: mic-pulse .72s ease-in-out infinite;
    }
    @keyframes mic-pulse {
      0%, 100% { scale: 1; box-shadow: 0 0 0 0 rgba(255,255,255,.48), 0 10px 0 rgba(37,101,156,.16); }
      50% { scale: 1.08; box-shadow: 0 0 0 20px rgba(255,255,255,.12), 0 10px 0 rgba(37,101,156,.16); }
    }
    .status {
      min-height: 32px;
      padding: 8px 14px;
      border-radius: 999px;
      background: rgba(14, 77, 137, .34);
      font-size: 16px;
      font-weight: 900;
      text-shadow: 0 3px 8px rgba(20,74,120,.36);
    }
    .spinner {
      display: inline-block;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 3px solid rgba(255,255,255,.45);
      border-top-color: #fff;
      animation: spin .7s linear infinite;
      vertical-align: -4px;
      margin-inline-end: 6px;
    }
    @keyframes spin { to { rotate: 360deg; } }
    .shake-screen { animation: screen-shake .36s linear 2; }
    @keyframes screen-shake {
      0%,100% { transform: translate(0,0); }
      25% { transform: translate(-5px,3px); }
      75% { transform: translate(5px,-3px); }
    }
    .result-emoji {
      font-size: clamp(96px, 30vw, 170px);
      line-height: 1;
      filter: drop-shadow(0 18px 20px rgba(35, 93, 146, .28));
    }
    .answer-line {
      display: inline-grid;
      grid-auto-flow: column;
      align-items: center;
      gap: 12px;
      direction: ltr;
    }
    .correct-word {
      font-size: clamp(40px, 11vw, 72px);
      font-weight: 1000;
      line-height: 1;
    }
    .sound {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: #21476b;
      background: rgba(255,255,255,.92);
      font-size: 28px;
      box-shadow: 0 8px 18px rgba(31, 90, 143, .22);
    }
    .danger { background: rgba(121, 20, 44, .38); }
    .tiny { font-size: 14px; opacity: .9; }
    @media (max-height: 720px) {
      .rocket-wrap { scale: .84; bottom: 5%; }
      .obstacle { top: 30%; }
      .controls { bottom: calc(env(safe-area-inset-bottom) + 12px); }
      .mic { width: 96px; height: 96px; font-size: 42px; }
    }
  </style>
</head>
<body>
  <div class="sky" aria-hidden="true">
    <div class="particle p1"></div>
    <div class="particle p2"></div>
    <div class="particle p3"></div>
    <div class="cloud c1"><span></span></div>
    <div class="cloud c2"><span></span></div>
    <div class="cloud c3"><span></span></div>
    <div class="cloud c4"><span></span></div>
  </div>
  <main class="app" id="app"></main>
  <script>
    let token = new URLSearchParams(location.search).get('token') || '';
    const app = document.getElementById('app');
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let state = null;
    let activeRecognition = null;
    let isListening = false;
    let isChecking = false;
    let isGameOver = false;
    let isRestarting = false;
    let microphoneEnabled = false;
    let speechTimer = null;
    let activeTimerId = null;
    let autoListenTimer = null;
    let roundClosed = false;
    let requestBusy = false;
    let finishBusy = false;
    let restartBusy = false;
    let gameState = 'loading';
    let currentQuestionIndex = -1;

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'": '&#39;'}[c]));
    }
    function emoji(value) {
      return escapeHtml(value || '❓');
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
    function rocketMarkup() {
      return '<div class="rocket-wrap launch" id="rocket">' +
        '<div class="rocket-body"><div class="window"></div><div class="stripe"></div></div>' +
        '<div class="fin left"></div><div class="fin right"></div><div class="flame"></div>' +
        '</div>';
    }
    function setGameState(next) {
      gameState = next;
      app.dataset.state = next;
    }
    function renderStart() {
      stopListening();
      clearTimers();
      isGameOver = false;
      isChecking = false;
      isRestarting = false;
      setGameState('ready');
      const totalWords = state.totalWords || state.totalQuestions || 0;
      app.innerHTML = '<section class="screen"><div class="panel">' +
        '<div class="result-emoji">🚀</div>' +
        '<h1>تحدي الصور والكلمات</h1>' +
        '<p class="sub">' + escapeHtml(state.collectionTitle) + '</p>' +
        '<p class="sub">عدد الكلمات: ' + totalWords + '</p>' +
        '<p class="notice">إذا المايكروفون لا يعمل، افتح الرابط في Safari أو Chrome.</p>' +
        '<p class="sub">اللعبة ستستخدم كلمات هذه المجموعة. ماكو اختيارات؛ شوف الإيموجي وانطق بالألماني.</p>' +
        '<button class="primary" id="startBtn">🎙 تفعيل المايكروفون وابدأ</button>' +
        '</div></section>';
      document.getElementById('startBtn').onclick = () => {
        if (!isSpeechSupported()) {
          renderError('متصفحك لا يدعم التعرف على الصوت. افتح اللعبة في Chrome أو Safari حديث.');
          return;
        }
        microphoneEnabled = true;
        renderFlight('انطق بالألماني', true);
      };
    }
    function renderFlight(message = 'انطق بالألماني', autoStart = false) {
      const question = state.currentQuestion;
      if (!question) return finish();
      setGameState('obstacle');
      roundClosed = false;
      requestBusy = false;
      isChecking = false;
      isGameOver = false;
      currentQuestionIndex = question.questionIndex;
      clearTimers();
      app.classList.remove('shake-screen');
      const totalWords = state.totalWords || state.totalQuestions || 0;
      const completedWords = state.completedWords ?? state.correctCount ?? 0;
      const attemptsLeft = question.attemptsLeft ?? 3;
      app.innerHTML = '<section class="flight">' +
        '<div class="hud"><div class="meters">' + state.heightMeters + '</div><div class="hud-label">meters above the ground</div><div class="hud-label">التقدم: ' + (completedWords + 1) + ' / ' + totalWords + ' · المنجزة: ' + completedWords + ' · محاولات: ' + attemptsLeft + '</div><div class="timer"><div class="timer-fill" id="timerFill"></div></div></div>' +
        '<div class="obstacle" id="obstacle"><div class="obstacle-emoji">' + emoji(question.visualEmoji) + '</div></div>' +
        rocketMarkup() +
        '<div class="controls"><button class="mic" id="micBtn" aria-label="انطق الكلمة">🎙</button><div class="status" id="status">' + escapeHtml(message) + '</div><div class="tiny">المايك يعمل تلقائياً بعد التفعيل · de-DE</div></div>' +
        '</section>';
      document.getElementById('micBtn').onclick = enableMicrophoneAndListen;
      startQuestionTimer(question.timeLimit || 10);
      if (autoStart || microphoneEnabled) scheduleAutoListen(420);
    }
    function startQuestionTimer(seconds) {
      clearTimeout(activeTimerId);
      const fill = document.getElementById('timerFill');
      if (fill) {
        fill.style.transition = 'none';
        fill.style.transform = 'scaleX(1)';
        requestAnimationFrame(() => {
          fill.style.transition = 'transform ' + seconds + 's linear';
          fill.style.transform = 'scaleX(0)';
        });
      }
      activeTimerId = setTimeout(() => {
        if (roundClosed) return;
        setStatus('انتهى الوقت!');
        submitSpeech('', [], 'timeout');
      }, seconds * 1000);
    }
    function enableMicrophoneAndListen() {
      microphoneEnabled = true;
      if (!activeTimerId && state.currentQuestion && gameState === 'obstacle') startQuestionTimer(state.currentQuestion.timeLimit || 10);
      listen();
    }
    function scheduleAutoListen(delay = 500) {
      clearTimeout(autoListenTimer);
      if (!microphoneEnabled || isGameOver || isRestarting || gameState !== 'obstacle') return;
      autoListenTimer = setTimeout(() => listen(), delay);
    }
    function listen() {
      if (isListening || requestBusy || isChecking || roundClosed || isGameOver || isRestarting || !state.currentQuestion) return;
      if (!isSpeechSupported()) return renderError('متصفحك لا يدعم التعرف على الصوت. افتح اللعبة في Chrome أو Safari حديث.');
      setGameState('listening');
      isListening = true;
      setStatus('أسمعك...');
      document.getElementById('rocket')?.classList.add('launch');
      document.getElementById('micBtn')?.classList.add('listening');
      activeRecognition = new Recognition();
      activeRecognition.lang = 'de-DE';
      activeRecognition.continuous = false;
      activeRecognition.interimResults = false;
      if ('maxAlternatives' in activeRecognition) activeRecognition.maxAlternatives = 5;
      activeRecognition.onresult = event => {
        const result = event.results && event.results[0];
        const alternatives = result ? Array.from(result).map(item => item.transcript).filter(Boolean) : [];
        const transcript = alternatives[0] || '';
        stopListening();
        if (!transcript) return noSpeech('no_speech');
        submitSpeech(transcript, alternatives, 'speech');
      };
      activeRecognition.onerror = event => {
        stopListening();
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          microphoneEnabled = false;
          showMicrophoneRecovery('المتصفح منع المايكروفون. فعّله حتى تكمل.');
          return;
        }
        if (event.error === 'no-speech') return noSpeech('no_speech');
        noSpeech('speech_error');
      };
      activeRecognition.onend = () => {
        if (isListening) {
          stopListening();
          noSpeech('no_speech');
        }
      };
      try {
        activeRecognition.lang = 'de-DE';
        if (activeRecognition.lang !== 'de-DE') activeRecognition.lang = 'de-DE';
        activeRecognition.start();
        speechTimer = setTimeout(() => {
          stopListening();
          noSpeech('no_speech');
        }, 5200);
      } catch {
        stopListening();
        showMicrophoneRecovery('تعذر تشغيل المايكروفون تلقائياً. اضغط للتفعيل.');
      }
    }
    function noSpeech(reason = 'no_speech') {
      if (roundClosed) return;
      submitSpeech('', [], reason);
    }
    function stopListening() {
      isListening = false;
      clearTimeout(speechTimer);
      speechTimer = null;
      document.getElementById('micBtn')?.classList.remove('listening');
      try { activeRecognition && activeRecognition.stop(); } catch {}
      activeRecognition = null;
    }
    function clearTimers() {
      clearTimeout(speechTimer);
      clearTimeout(activeTimerId);
      clearTimeout(autoListenTimer);
      speechTimer = null;
      activeTimerId = null;
      autoListenTimer = null;
    }
    async function submitSpeech(transcript, alternatives, reason = 'speech') {
      if (requestBusy || roundClosed || !state.currentQuestion) return;
      requestBusy = true;
      isChecking = true;
      roundClosed = true;
      clearTimers();
      stopListening();
      setGameState('checking');
      setStatus('<span class="spinner"></span> أتحقق...');
      try {
        const result = await api('/game/api/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, questionIndex: state.currentQuestion.questionIndex, transcript, alternatives, reason })
        });
        state = result;
        isChecking = false;
        if (result.correct) {
          setGameState('correct');
          const obstacle = document.getElementById('obstacle');
          obstacle?.classList.add('explosion');
          const rocket = document.getElementById('rocket');
          if (rocket) {
            rocket.classList.add('boost');
            rocket.style.bottom = Math.min(74, 8 + state.correctCount * 8) + '%';
          }
          setTimeout(() => result.finished ? finish() : renderFlight('صح! الصاروخ صعد 🚀'), 680);
          return;
        }
        if (result.tryAgain && state.currentQuestion) {
          setGameState('obstacle');
          requestBusy = false;
          roundClosed = false;
          currentQuestionIndex = state.currentQuestion.questionIndex;
          applyPartialWrong(result.attemptsLeft);
          startQuestionTimer(state.currentQuestion.timeLimit || 8);
          scheduleAutoListen(700);
          return;
        }
        crashAndFinish();
      } catch {
        renderError('تعذر تسجيل النطق. افتح اللعبة مرة ثانية من البوت.');
      }
    }
    function applyPartialWrong(attemptsLeft) {
      app.classList.add('shake-screen');
      const rocket = document.getElementById('rocket');
      const obstacle = document.getElementById('obstacle');
      rocket?.classList.remove('drop-back');
      obstacle?.classList.remove('collision');
      void rocket?.offsetWidth;
      rocket?.classList.add('drop-back');
      obstacle?.classList.add('collision');
      const totalWords = state.totalWords || state.totalQuestions || 0;
      const completedWords = state.completedWords ?? state.correctCount ?? 0;
      const label = document.querySelectorAll('.hud .hud-label')[1];
      if (label) label.textContent = 'التقدم: ' + (completedWords + 1) + ' / ' + totalWords + ' · المنجزة: ' + completedWords + ' · محاولات: ' + attemptsLeft;
      setStatus('غلط، حاول مرة ثانية — باقي ' + attemptsLeft);
      setTimeout(() => {
        app.classList.remove('shake-screen');
        rocket?.classList.remove('drop-back');
        obstacle?.classList.remove('collision');
      }, 460);
    }
    function crashAndFinish() {
      setGameState('gameOver');
      isGameOver = true;
      stopListening();
      clearTimers();
      document.getElementById('obstacle')?.classList.add('collision');
      document.getElementById('rocket')?.classList.add('collision');
      app.classList.add('shake-screen');
      setTimeout(() => finish(), 760);
    }
    async function finish() {
      if (finishBusy) return;
      finishBusy = true;
      clearTimers();
      stopListening();
      try {
        state = await api('/game/api/finish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });
        state.failedQuestion ? renderGameOver() : renderWin();
      } catch {
        renderError('تعذر إنهاء الجولة حالياً.');
      } finally {
        finishBusy = false;
      }
    }
    function renderGameOver() {
      setGameState('gameOver');
      isGameOver = true;
      const failed = state.failedQuestion;
      const totalWords = state.totalWords || state.totalQuestions || 0;
      const completedWords = state.completedWords ?? state.correctCount ?? 0;
      app.innerHTML = '<section class="screen game-over"><div class="panel">' +
        '<h1>خسرت بسبب</h1>' +
        '<div class="result-emoji">' + emoji(failed.failedVisualEmoji) + '</div>' +
        '<div class="answer-line"><strong class="correct-word">' + escapeHtml(failed.correctAnswer) + '</strong><button class="sound" id="speakBtn" aria-label="استمع للنطق الصحيح">🔊</button></div>' +
        '<p class="sub">وصلت إلى ' + state.heightMeters + ' متر</p>' +
        '<p class="notice">أنجزت ' + completedWords + ' من ' + totalWords + ' · XP: +' + (state.xpGained || 0) + '</p>' +
        '<button class="primary" id="restartBtn">إعادة اللعب</button>' +
        '<button class="secondary" onclick="history.back()">رجوع للبوت</button>' +
        '</div></section>';
      document.getElementById('speakBtn')?.addEventListener('click', () => speakGerman(failed.correctPronunciationText || failed.correctAnswer));
      document.getElementById('restartBtn')?.addEventListener('click', restartGame);
    }
    function renderWin() {
      setGameState('finished');
      isGameOver = true;
      const totalWords = state.totalWords || state.totalQuestions || 0;
      const completedWords = state.completedWords ?? state.correctCount ?? 0;
      app.innerHTML = '<section class="screen"><div class="panel">' +
        '<div class="result-emoji">🏆</div>' +
        '<h1>ممتاز 🚀</h1>' +
        '<p class="sub">أكملت كل كلمات المجموعة</p>' +
        '<p class="notice">✅ ' + completedWords + ' / ' + totalWords + ' · الارتفاع: ' + state.heightMeters + ' متر · XP: +' + (state.xpGained || 0) + '</p>' +
        '<button class="primary" id="restartBtn">إعادة اللعب</button>' +
        '<button class="secondary" onclick="history.back()">رجوع للبوت</button>' +
        '</div></section>';
      document.getElementById('restartBtn')?.addEventListener('click', restartGame);
    }
    async function restartGame() {
      if (restartBusy) return;
      restartBusy = true;
      isRestarting = true;
      isGameOver = false;
      setGameState('restarting');
      clearTimers();
      stopListening();
      app.innerHTML = '<section class="screen"><div class="panel">' +
        '<div class="result-emoji">🚀</div><h1>جولة جديدة...</h1>' +
        '<p class="notice"><span class="spinner"></span> أجهز صاروخ جديد</p>' +
        '</div></section>';
      try {
        const next = await api('/game/api/restart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });
        token = next.token;
        history.replaceState(null, '', next.gameUrl || ('/game?token=' + encodeURIComponent(token)));
        state = await api('/game/api/session?token=' + encodeURIComponent(token));
        microphoneEnabled = false;
        renderStart();
      } catch {
        renderError('تعذر بدء جولة جديدة. افتح اللعبة من البوت مرة ثانية.');
      } finally {
        restartBusy = false;
        isRestarting = false;
      }
    }
    function speakGerman(text) {
      if (!('speechSynthesis' in window)) return;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'de-DE';
      utterance.rate = .86;
      utterance.pitch = 1;
      utterance.volume = 1;
      const voice = getGermanVoice();
      if (voice) utterance.voice = voice;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    }
    function getGermanVoice() {
      if (!('speechSynthesis' in window)) return null;
      const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
      return voices.find(voice => String(voice.lang || '').toLowerCase().startsWith('de-de'))
        || voices.find(voice => String(voice.lang || '').toLowerCase().startsWith('de'))
        || null;
    }
    if ('speechSynthesis' in window && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = () => getGermanVoice();
    }
    function setStatus(message) {
      const status = document.getElementById('status');
      if (status) status.innerHTML = message;
    }
    function showMicrophoneRecovery(message) {
      setGameState('obstacle');
      clearTimers();
      requestBusy = false;
      isChecking = false;
      roundClosed = false;
      setStatus(escapeHtml(message));
      const mic = document.getElementById('micBtn');
      if (mic) {
        mic.textContent = '🎙';
        mic.classList.remove('listening');
        mic.onclick = enableMicrophoneAndListen;
      }
    }
    function renderError(message) {
      setGameState('error');
      clearTimers();
      stopListening();
      app.innerHTML = '<section class="screen"><div class="panel">' +
        '<div class="result-emoji">🛰️</div><h1>تحدي الصور والكلمات</h1>' +
        '<p class="notice danger">' + escapeHtml(message) + '</p>' +
        '<button class="primary" onclick="location.reload()">حاول مرة ثانية</button>' +
        '<button class="secondary" onclick="history.back()">رجوع للبوت</button>' +
        '</div></section>';
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopListening();
        clearTimers();
      } else if (microphoneEnabled && gameState === 'obstacle' && !requestBusy && !roundClosed && !isGameOver) {
        if (!activeTimerId && state.currentQuestion) startQuestionTimer(state.currentQuestion.timeLimit || 10);
        scheduleAutoListen(500);
      }
    });
    window.addEventListener('pagehide', () => {
      stopListening();
      clearTimers();
    });
    window.addEventListener('pageshow', () => {
      if (microphoneEnabled && gameState === 'obstacle' && !requestBusy && !roundClosed && !isGameOver) {
        if (!activeTimerId && state.currentQuestion) startQuestionTimer(state.currentQuestion.timeLimit || 10);
        scheduleAutoListen(500);
      }
    });
    load();
  </script>
</body>
</html>`;
}
