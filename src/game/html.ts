export function renderCollectionGameHtml(): string {
    return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Underwater Worm Speaking Game</title>
  <style>
    :root {
      --safe-top: env(safe-area-inset-top, 0px);
      --safe-bottom: env(safe-area-inset-bottom, 0px);
      --ink: #063a5d;
      --deep: #075a8c;
      --water: #18a4d8;
      --water-light: #76ddff;
      --foam: rgba(255,255,255,.88);
      --panel-width: min(520px, 92vw);
      --hud-top: calc(var(--safe-top) + clamp(10px, 2.2dvh, 22px));
      --controls-bottom: calc(var(--safe-bottom) + clamp(16px, 3.2dvh, 38px));
      --bubble-size: clamp(178px, 47vw, 270px);
      --worm-scale: clamp(.82, 2.4vw, 1.08);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #fff;
      background: #0d96c4;
      overscroll-behavior: none;
      touch-action: manipulation;
    }
    button {
      border: 0;
      font: inherit;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .underwater {
      position: fixed;
      inset: 0;
      overflow: hidden;
      background:
        radial-gradient(circle at 50% -12%, rgba(255,255,255,.44), transparent 28%),
        radial-gradient(circle at 88% 20%, rgba(157,239,255,.18), transparent 22%),
        linear-gradient(180deg, #6bdcff 0%, #1ea9d9 42%, #0873a8 100%);
    }
    .underwater::before {
      content: "";
      position: absolute;
      inset: -8% -18% auto;
      height: 55dvh;
      background:
        linear-gradient(112deg, transparent 0 15%, rgba(255,255,255,.20) 16% 18%, transparent 20% 100%),
        linear-gradient(78deg, transparent 0 28%, rgba(255,255,255,.13) 29% 31%, transparent 33% 100%),
        linear-gradient(96deg, transparent 0 58%, rgba(255,255,255,.16) 59% 61%, transparent 63% 100%);
      opacity: .72;
      transform-origin: top center;
      animation: ray-sway 8s ease-in-out infinite alternate;
    }
    @keyframes ray-sway {
      from { transform: translateX(-2%) skewX(-4deg); }
      to { transform: translateX(3%) skewX(4deg); }
    }
    .bubble-dot {
      position: absolute;
      width: var(--size, 12px);
      height: var(--size, 12px);
      left: var(--left, 50%);
      bottom: -40px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,.54);
      background: rgba(255,255,255,.16);
      box-shadow: inset 5px 6px 8px rgba(255,255,255,.28);
      animation: bubble-rise var(--duration, 9s) linear infinite;
      animation-delay: var(--delay, 0s);
    }
    @keyframes bubble-rise {
      0% { translate: 0 0; opacity: 0; }
      12% { opacity: .78; }
      100% { translate: var(--drift, 18px) -112dvh; opacity: 0; }
    }
    .seaweed {
      position: absolute;
      bottom: calc(var(--safe-bottom) - 10px);
      width: 36px;
      height: 140px;
      border-radius: 70% 70% 12px 12px;
      background: linear-gradient(180deg, #48d879, #0a8a65);
      transform-origin: bottom center;
      opacity: .76;
      animation: weed-sway 3.6s ease-in-out infinite alternate;
    }
    .seaweed.w1 { left: 7%; height: 118px; rotate: -8deg; }
    .seaweed.w2 { right: 10%; height: 152px; animation-delay: -1.2s; }
    .seaweed.w3 { left: 28%; width: 24px; height: 86px; animation-delay: -.7s; opacity: .48; }
    @keyframes weed-sway {
      from { transform: skewX(-5deg); }
      to { transform: skewX(7deg); }
    }
    .coral {
      position: absolute;
      bottom: calc(var(--safe-bottom) + 4px);
      right: 24%;
      width: 82px;
      height: 46px;
      border-radius: 42px 42px 12px 12px;
      background:
        radial-gradient(circle at 22% 28%, #ff9bb5 0 13px, transparent 14px),
        radial-gradient(circle at 54% 12%, #ff7899 0 14px, transparent 15px),
        radial-gradient(circle at 78% 34%, #ffb05d 0 12px, transparent 13px);
      opacity: .76;
    }
    .app {
      position: relative;
      width: 100vw;
      height: 100dvh;
      overflow: hidden;
      padding: var(--safe-top) 16px var(--safe-bottom);
    }
    .screen {
      min-height: 100dvh;
      display: grid;
      place-items: center;
      text-align: center;
      text-shadow: 0 4px 14px rgba(3, 47, 86, .42);
    }
    .panel {
      width: var(--panel-width);
      display: grid;
      justify-items: center;
      gap: 16px;
      transform: translateY(-1.5dvh);
    }
    h1 {
      margin: 0;
      font-size: clamp(32px, 8.8vw, 58px);
      line-height: 1.08;
      letter-spacing: 0;
    }
    .sub {
      margin: 0;
      font-size: clamp(16px, 4.2vw, 22px);
      font-weight: 900;
      line-height: 1.5;
    }
    .notice {
      margin: 0;
      padding: 12px 16px;
      border: 1px solid rgba(255,255,255,.24);
      border-radius: 20px;
      background: rgba(3, 71, 112, .32);
      font-size: 15px;
      font-weight: 850;
      line-height: 1.6;
      max-width: 410px;
      backdrop-filter: blur(8px);
    }
    .primary {
      min-width: min(330px, 84vw);
      min-height: 64px;
      border-radius: 999px;
      padding: 12px 24px;
      color: var(--ink);
      background: rgba(255,255,255,.96);
      box-shadow: 0 8px 0 rgba(5, 74, 111, .18), 0 14px 28px rgba(3, 48, 83, .22);
      font-size: clamp(21px, 5.5vw, 30px);
      font-weight: 950;
    }
    .secondary {
      min-height: 50px;
      border-radius: 999px;
      padding: 10px 18px;
      color: #fff;
      background: rgba(2, 61, 100, .38);
      font-size: 17px;
      font-weight: 900;
    }
    .game {
      position: relative;
      width: min(560px, 100vw);
      height: 100dvh;
      margin: 0 auto;
      overflow: hidden;
    }
    .hud {
      position: absolute;
      top: var(--hud-top);
      left: 50%;
      translate: -50% 0;
      width: min(520px, 94vw);
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      z-index: 8;
      text-shadow: none;
      direction: rtl;
    }
    .hud-pill {
      min-height: 46px;
      display: grid;
      place-items: center;
      gap: 1px;
      padding: 6px 8px;
      border: 1px solid rgba(255,255,255,.23);
      border-radius: 18px;
      background: rgba(4, 76, 117, .30);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.20), 0 8px 18px rgba(4, 57, 91, .14);
      backdrop-filter: blur(8px);
    }
    .hud-value {
      font-size: clamp(16px, 4.6vw, 22px);
      font-weight: 1000;
      line-height: 1;
    }
    .hud-label {
      font-size: 11px;
      font-weight: 850;
      opacity: .86;
      white-space: nowrap;
    }
    .listening-chip {
      grid-column: span 1;
    }
    .listening-chip.active .hud-value {
      color: #bffff8;
    }
    .timer {
      position: absolute;
      top: calc(var(--hud-top) + 58px);
      left: 50%;
      translate: -50% 0;
      width: min(330px, 72vw);
      height: 7px;
      border-radius: 999px;
      background: rgba(255,255,255,.25);
      overflow: hidden;
      z-index: 8;
    }
    .timer-fill {
      height: 100%;
      width: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #a9fff5, #ffffff);
      transform-origin: right center;
    }
    .playfield {
      position: absolute;
      inset: calc(var(--safe-top) + 92px) 0 calc(var(--safe-bottom) + 112px);
      z-index: 4;
    }
    .meaning-bubble {
      position: absolute;
      top: clamp(82px, 17dvh, 150px);
      right: clamp(18px, 7vw, 54px);
      width: var(--bubble-size);
      min-height: var(--bubble-size);
      display: grid;
      place-items: center;
      padding: clamp(20px, 5vw, 34px);
      border-radius: 50%;
      color: #06466d;
      background:
        radial-gradient(circle at 34% 24%, rgba(255,255,255,.98) 0 9%, transparent 10%),
        radial-gradient(circle at 52% 48%, rgba(255,255,255,.94), rgba(206,250,255,.74) 58%, rgba(123,224,246,.45) 100%);
      border: 2px solid rgba(255,255,255,.64);
      box-shadow:
        inset 14px 18px 28px rgba(255,255,255,.42),
        inset -18px -20px 34px rgba(34, 155, 190, .28),
        0 24px 44px rgba(4, 61, 95, .22);
      text-shadow: none;
      animation: bubble-float 2.8s ease-in-out infinite;
    }
    .meaning-bubble::after {
      content: "";
      position: absolute;
      right: 17%;
      top: 16%;
      width: 18%;
      height: 9%;
      border-radius: 50%;
      background: rgba(255,255,255,.78);
      rotate: -28deg;
      filter: blur(.2px);
    }
    .meaning-text {
      max-width: 100%;
      font-size: clamp(25px, 7vw, 42px);
      font-weight: 1000;
      line-height: 1.16;
      overflow-wrap: anywhere;
    }
    @keyframes bubble-float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-10px); }
    }
    .meaning-bubble.bubble-pop {
      animation: bubble-pop .5s ease-out forwards;
    }
    @keyframes bubble-pop {
      0% { opacity: 1; transform: scale(1); }
      48% { opacity: 1; transform: scale(1.08); filter: brightness(1.1); }
      100% { opacity: 0; transform: scale(.18); }
    }
    .meaning-bubble.bubble-shake {
      animation: bubble-shake .34s linear 3;
      background:
        radial-gradient(circle at 34% 24%, rgba(255,255,255,.98) 0 9%, transparent 10%),
        radial-gradient(circle at 52% 48%, rgba(255,255,255,.94), rgba(255,213,220,.80) 58%, rgba(255,115,132,.44) 100%);
    }
    @keyframes bubble-shake {
      0%, 100% { transform: translate(0, 0); }
      25% { transform: translate(-13px, 4px); }
      75% { transform: translate(13px, -3px); }
    }
    .pop-particles {
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: 0;
    }
    .pop-particles.active {
      opacity: 1;
    }
    .pop-particles i {
      position: absolute;
      left: 52%;
      top: 46%;
      width: 13px;
      height: 13px;
      border: 2px solid rgba(255,255,255,.84);
      border-radius: 50%;
      animation: pop-particle .62s ease-out forwards;
      transform: rotate(var(--angle)) translateX(0);
    }
    @keyframes pop-particle {
      to {
        opacity: 0;
        transform: rotate(var(--angle)) translateX(var(--distance)) scale(.5);
      }
    }
    .worm {
      position: absolute;
      left: clamp(18px, 8vw, 62px);
      top: clamp(245px, 43dvh, 390px);
      width: clamp(190px, 52vw, 300px);
      height: 112px;
      transform: scale(var(--worm-scale));
      transform-origin: 28% 60%;
      filter: drop-shadow(0 22px 24px rgba(0, 47, 76, .24));
      animation: worm-swim 2.1s ease-in-out infinite;
    }
    @keyframes worm-swim {
      0%, 100% { translate: 0 0; rotate: -2deg; }
      50% { translate: 0 -9px; rotate: 2deg; }
    }
    .worm.worm-munch {
      animation: worm-munch .58s ease-out;
    }
    @keyframes worm-munch {
      0% { transform: scale(var(--worm-scale)) translateX(0); }
      45% { transform: scale(calc(var(--worm-scale) * 1.05)) translateX(42px); }
      100% { transform: scale(var(--worm-scale)) translateX(0); }
    }
    .worm.worm-retreat {
      animation: worm-retreat .48s ease-out;
    }
    @keyframes worm-retreat {
      0% { transform: scale(var(--worm-scale)) translateX(0); }
      48% { transform: scale(calc(var(--worm-scale) * .96)) translateX(-28px) rotate(-7deg); }
      100% { transform: scale(var(--worm-scale)) translateX(0); }
    }
    .worm-svg {
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .controls {
      position: absolute;
      left: 50%;
      bottom: var(--controls-bottom);
      translate: -50% 0;
      width: min(440px, 92vw);
      display: grid;
      justify-items: center;
      gap: 8px;
      z-index: 9;
    }
    .voice-action {
      min-height: 48px;
      border-radius: 999px;
      padding: 10px 18px;
      background: rgba(255,255,255,.95);
      color: var(--ink);
      font-size: 17px;
      font-weight: 950;
      box-shadow: 0 8px 0 rgba(4,73,111,.14), 0 14px 24px rgba(3,55,87,.18);
    }
    .voice-action.hidden {
      display: none;
    }
    .status {
      min-height: 34px;
      max-width: min(390px, 90vw);
      padding: 8px 15px;
      border-radius: 18px;
      background: rgba(3, 65, 106, .34);
      border: 1px solid rgba(255,255,255,.18);
      font-size: 16px;
      font-weight: 900;
      line-height: 1.4;
      text-shadow: 0 3px 8px rgba(3,45,78,.34);
      backdrop-filter: blur(8px);
    }
    .hint {
      font-size: 13px;
      font-weight: 850;
      opacity: .92;
    }
    .bottom-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
    }
    .mini-action {
      min-height: 36px;
      border-radius: 999px;
      padding: 7px 12px;
      background: rgba(3, 59, 95, .34);
      color: #fff;
      font-size: 13px;
      font-weight: 900;
    }
    .voice-waves {
      display: inline-grid;
      grid-auto-flow: column;
      align-items: end;
      gap: 3px;
      height: 18px;
      margin-inline-start: 4px;
      vertical-align: -2px;
    }
    .voice-waves i {
      width: 4px;
      height: 8px;
      border-radius: 999px;
      background: rgba(190,255,248,.95);
      animation: voice-wave .62s ease-in-out infinite alternate;
    }
    .voice-waves i:nth-child(2) { animation-delay: .1s; height: 15px; }
    .voice-waves i:nth-child(3) { animation-delay: .2s; height: 11px; }
    @keyframes voice-wave {
      from { scale: 1 .55; opacity: .45; }
      to { scale: 1 1.18; opacity: 1; }
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
    .screen-shake { animation: screen-shake .36s linear 2; }
    @keyframes screen-shake {
      0%,100% { transform: translate(0,0); }
      25% { transform: translate(-5px,3px); }
      75% { transform: translate(5px,-3px); }
    }
    .result-worm {
      width: min(330px, 78vw);
      min-height: 112px;
      display: grid;
      place-items: center;
    }
    .answer-line {
      display: inline-grid;
      grid-auto-flow: column;
      align-items: center;
      gap: 12px;
      direction: ltr;
    }
    .correct-word {
      font-size: clamp(34px, 9.5vw, 62px);
      font-weight: 1000;
      line-height: 1;
    }
    .sound {
      width: 62px;
      height: 62px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: #075079;
      background: rgba(255,255,255,.93);
      font-size: 27px;
      box-shadow: 0 8px 18px rgba(3, 60, 98, .22);
    }
    .danger { background: rgba(117, 18, 45, .40); }
    .small-bubble {
      min-width: min(340px, 88vw);
      padding: 18px 20px;
      border-radius: 28px;
      color: var(--ink);
      background: rgba(223,252,255,.82);
      border: 1px solid rgba(255,255,255,.66);
      text-shadow: none;
      font-size: clamp(22px, 6vw, 34px);
      font-weight: 1000;
      line-height: 1.25;
    }
    @media (max-height: 720px) {
      :root {
        --bubble-size: clamp(150px, 39vw, 220px);
        --controls-bottom: calc(var(--safe-bottom) + 8px);
        --worm-scale: .78;
      }
      .playfield { inset: calc(var(--safe-top) + 78px) 0 calc(var(--safe-bottom) + 84px); }
      .meaning-bubble { top: clamp(64px, 14dvh, 110px); }
      .worm { top: clamp(205px, 40dvh, 320px); }
      .status { font-size: 14px; }
      .hint { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: .001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: .001ms !important;
        scroll-behavior: auto !important;
      }
    }
  </style>
</head>
<body>
  <div class="underwater" aria-hidden="true">
    <span class="bubble-dot" style="--left:10%;--size:11px;--duration:8s;--delay:-2s;--drift:18px"></span>
    <span class="bubble-dot" style="--left:24%;--size:18px;--duration:11s;--delay:-6s;--drift:-16px"></span>
    <span class="bubble-dot" style="--left:42%;--size:9px;--duration:7s;--delay:-1s;--drift:10px"></span>
    <span class="bubble-dot" style="--left:68%;--size:15px;--duration:10s;--delay:-4s;--drift:-22px"></span>
    <span class="bubble-dot" style="--left:86%;--size:12px;--duration:9s;--delay:-3s;--drift:14px"></span>
    <div class="seaweed w1"></div>
    <div class="seaweed w2"></div>
    <div class="seaweed w3"></div>
    <div class="coral"></div>
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
    let latestInterimTranscript = '';
    let latestAlternatives = [];
    let latestConfidence = undefined;
    let exitFinishSent = false;
    let roundClosed = false;
    let requestBusy = false;
    let finishBusy = false;
    let restartBusy = false;
    let gameState = 'loading';
    let currentQuestionIndex = -1;

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'": '&#39;'}[c]));
    }
    function isSpeechSupported() {
      return Boolean(Recognition);
    }
    function meaning(value) {
      return escapeHtml(String(value || 'المعنى').trim() || 'المعنى');
    }
    async function api(path, options) {
      const res = await fetch(path, options);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'request_failed');
      return json;
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
    function setGameState(next) {
      gameState = next;
      app.dataset.state = next;
    }
    function wormMarkup(extraClass = '', length = 0, crowned = false) {
      const growth = Math.min(5, Math.max(0, Number(length || 0)));
      const tailOffset = growth * 18;
      const crown = crowned ? '<text x="202" y="-9" font-size="38" text-anchor="middle">👑</text>' : '';
      return '<div class="worm ' + extraClass + '" id="worm" style="width: calc(clamp(190px, 52vw, 300px) + ' + (growth * 14) + 'px)">' +
        '<svg class="worm-svg" viewBox="' + (-tailOffset) + ' -34 ' + (310 + tailOffset) + ' 156" role="img" aria-label="دودة بحرية">' +
        '<defs><linearGradient id="wormGrad" x1="0" x2="1"><stop offset="0%" stop-color="#ffd66b"/><stop offset="45%" stop-color="#ff9cc9"/><stop offset="100%" stop-color="#8be7ff"/></linearGradient></defs>' +
        '<g>' +
        Array.from({ length: 4 + growth }, (_, i) => {
          const x = 34 + i * 34 - tailOffset;
          const y = 68 + Math.sin(i) * 9;
          return '<circle cx="' + x + '" cy="' + y + '" r="31" fill="url(#wormGrad)" stroke="rgba(255,255,255,.48)" stroke-width="4"/>';
        }).join('') +
        '<ellipse cx="196" cy="58" rx="47" ry="41" fill="#ffb0d7" stroke="rgba(255,255,255,.55)" stroke-width="4"/>' +
        '<circle cx="183" cy="47" r="6" fill="#073556"/><circle cx="209" cy="47" r="6" fill="#073556"/>' +
        '<circle cx="181" cy="45" r="2" fill="#fff"/><circle cx="207" cy="45" r="2" fill="#fff"/>' +
        '<path d="M184 69 Q197 78 211 69" fill="none" stroke="#7b3157" stroke-width="5" stroke-linecap="round"/>' +
        '<path d="M214 33 Q244 16 251 48 Q231 44 214 58" fill="#8be7ff" stroke="rgba(255,255,255,.45)" stroke-width="3"/>' +
        '<path d="M170 33 Q146 13 136 44 Q156 43 171 57" fill="#8be7ff" stroke="rgba(255,255,255,.45)" stroke-width="3"/>' +
        crown +
        '</g></svg></div>';
    }
    function renderStart() {
      stopListening();
      clearTimers();
      isGameOver = false;
      isChecking = false;
      isRestarting = false;
      exitFinishSent = false;
      setGameState('ready');
      const totalWords = state.totalWords || state.totalQuestions || 0;
      app.innerHTML = '<section class="screen"><div class="panel">' +
        '<div class="result-worm">' + wormMarkup('', 1) + '</div>' +
        '<h1>Underwater Worm Speaking Game</h1>' +
        '<p class="sub">' + escapeHtml(state.collectionTitle) + '</p>' +
        '<p class="sub">عدد الكلمات: ' + totalWords + '</p>' +
        '<p class="notice">ستظهر فقاعة فيها المعنى العربي فقط. انطق الكلمة الألمانية حتى تأكل الدودة الفقاعة.</p>' +
        '<p class="notice">إذا المايكروفون لا يعمل، افتح الرابط في Safari أو Chrome.</p>' +
        '<button class="primary" id="startBtn">🎙 تفعيل المايكروفون وابدأ</button>' +
        '</div></section>';
      document.getElementById('startBtn').onclick = () => {
        if (!isSpeechSupported()) {
          renderError('متصفحك لا يدعم التعرف على الصوت. افتح اللعبة في Chrome أو Safari حديث.');
          return;
        }
        microphoneEnabled = true;
        renderPlay('انطق الكلمة الألمانية', true);
      };
    }
    function renderPlay(message = 'انطق الكلمة الألمانية', autoStart = false) {
      const question = state.currentQuestion;
      if (!question) return finish();
      setGameState('bubble');
      roundClosed = false;
      requestBusy = false;
      isChecking = false;
      isGameOver = false;
      currentQuestionIndex = question.questionIndex;
      clearTimers();
      app.classList.remove('screen-shake');
      const totalWords = state.totalWords || state.totalQuestions || 0;
      const completedWords = state.completedWords ?? state.correctCount ?? 0;
      const attemptsLeft = question.attemptsLeft ?? 3;
      app.innerHTML = '<section class="game">' +
        '<div class="hud">' +
        '<div class="hud-pill"><div class="hud-value">⭐ ' + state.score + '</div><div class="hud-label">النقاط</div></div>' +
        '<div class="hud-pill"><div class="hud-value">🐚 ' + (completedWords + 1) + ' / ' + totalWords + '</div><div class="hud-label">المجموعة</div></div>' +
        '<div class="hud-pill"><div class="hud-value">❤️ ' + attemptsLeft + '</div><div class="hud-label">المحاولات</div></div>' +
        '<div class="hud-pill listening-chip" id="listenChip"><div class="hud-value">🎙 de-DE</div><div class="hud-label">يستمع بالألمانية</div></div>' +
        '</div>' +
        '<div class="timer"><div class="timer-fill" id="timerFill"></div></div>' +
        '<div class="playfield">' +
        '<div class="meaning-bubble" id="meaningBubble"><div class="meaning-text">' + meaning(question.arabicMeaning) + '</div><div class="pop-particles" id="popParticles">' + Array.from({ length: 8 }, (_, i) => '<i style="--angle:' + (i * 45) + 'deg;--distance:' + (52 + i * 5) + 'px"></i>').join('') + '</div></div>' +
        wormMarkup('', completedWords) +
        '</div>' +
        '<div class="controls"><div class="status" id="status">' + escapeHtml(message) + '</div><div class="bottom-actions"><button class="voice-action hidden" id="micRecoverBtn">🎙 فعّل المايكروفون</button><button class="mini-action" id="leaveBtn">حفظ وخروج</button></div><div class="hint">قل الكلمة المناسبة للمعنى · يستمع بالألمانية <span id="listeningIndicator" aria-hidden="true"></span></div></div>' +
        '</section>';
      document.getElementById('micRecoverBtn').onclick = enableMicrophoneAndListen;
      document.getElementById('leaveBtn').onclick = leaveGame;
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
      if (!activeTimerId && state.currentQuestion && gameState === 'bubble') startQuestionTimer(state.currentQuestion.timeLimit || 10);
      listen();
    }
    function scheduleAutoListen(delay = 500) {
      clearTimeout(autoListenTimer);
      if (!microphoneEnabled || isGameOver || isRestarting || gameState !== 'bubble') return;
      autoListenTimer = setTimeout(() => listen(), delay);
    }
    function listen() {
      if (isListening || requestBusy || isChecking || roundClosed || isGameOver || isRestarting || !state.currentQuestion) return;
      if (!isSpeechSupported()) return renderError('متصفحك لا يدعم التعرف على الصوت. افتح اللعبة في Chrome أو Safari حديث.');
      stopListening();
      setGameState('preparing');
      latestInterimTranscript = '';
      latestAlternatives = [];
      latestConfidence = undefined;
      setGameState('listening');
      isListening = true;
      setStatus('يستمع بالألمانية...');
      document.getElementById('listenChip')?.classList.add('active');
      renderVoiceWaves(true);
      setRecoveryButton(false);
      activeRecognition = new Recognition();
      activeRecognition.lang = 'de-DE';
      activeRecognition.continuous = false;
      activeRecognition.interimResults = true;
      if ('maxAlternatives' in activeRecognition) activeRecognition.maxAlternatives = 5;
      activeRecognition.onresult = event => {
        let finalTranscript = '';
        let finalAlternatives = [];
        let finalConfidence = undefined;
        let interimBest = '';
        for (let index = event.resultIndex || 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          const alternatives = Array.from(result).map(item => item.transcript).filter(Boolean);
          if (result.isFinal) {
            finalAlternatives = alternatives;
            finalTranscript = alternatives[0] || '';
            finalConfidence = typeof result[0]?.confidence === 'number' ? result[0].confidence : undefined;
          } else if (alternatives[0]) {
            interimBest = alternatives[0];
          }
        }
        if (interimBest) {
          latestInterimTranscript = interimBest;
          setStatus('سمعت: ' + escapeHtml(interimBest));
        }
        if (finalTranscript || finalAlternatives.length > 0) {
          latestAlternatives = finalAlternatives;
          latestConfidence = finalConfidence;
          stopListening();
          submitSpeech(finalTranscript, finalAlternatives, 'speech', finalConfidence, latestInterimTranscript);
        }
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
          if (latestInterimTranscript) {
            submitSpeech('', latestAlternatives, 'speech', latestConfidence, latestInterimTranscript);
          } else {
            noSpeech('no_speech');
          }
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
      renderVoiceWaves(false);
      document.getElementById('listenChip')?.classList.remove('active');
      try { activeRecognition && activeRecognition.abort && activeRecognition.abort(); } catch {}
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
    async function submitSpeech(transcript, alternatives, reason = 'speech', confidence, interimTranscript = '') {
      if (requestBusy || roundClosed || !state.currentQuestion) return;
      requestBusy = true;
      isChecking = true;
      roundClosed = true;
      clearTimers();
      stopListening();
      setGameState('checking');
      setStatus('<span class="spinner"></span> أتحقق...');
      const previousAttemptsLeft = state.currentQuestion.attemptsLeft ?? 3;
      try {
        const result = await api('/game/api/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, questionIndex: state.currentQuestion.questionIndex, transcript, alternatives, reason, confidence, interimTranscript })
        });
        state = result;
        isChecking = false;
        if (result.correct) {
          setGameState('correct');
          document.getElementById('meaningBubble')?.classList.add('bubble-pop');
          document.getElementById('popParticles')?.classList.add('active');
          document.getElementById('worm')?.classList.add('worm-munch');
          setStatus('صحيح! +' + Math.max(1, Math.min(4, state.correctCount)) + ' XP');
          setTimeout(() => result.finished ? finish() : renderPlay('صحيح! فقاعة جديدة 🫧'), 680);
          return;
        }
        if (result.tryAgain && state.currentQuestion) {
          setGameState('bubble');
          requestBusy = false;
          roundClosed = false;
          currentQuestionIndex = state.currentQuestion.questionIndex;
          const technicalRetry = (reason === 'no_speech' || reason === 'speech_error') && result.attemptsLeft >= previousAttemptsLeft;
          applyPartialWrong(result.attemptsLeft, technicalRetry);
          startQuestionTimer(state.currentQuestion.timeLimit || 8);
          scheduleAutoListen(700);
          return;
        }
        failAndFinish();
      } catch {
        renderError('تعذر تسجيل النطق. افتح اللعبة مرة ثانية من البوت.');
      }
    }
    function applyPartialWrong(attemptsLeft, technicalRetry = false) {
      if (!technicalRetry) app.classList.add('screen-shake');
      const worm = document.getElementById('worm');
      const bubble = document.getElementById('meaningBubble');
      worm?.classList.remove('worm-retreat');
      bubble?.classList.remove('bubble-shake');
      void worm?.offsetWidth;
      if (!technicalRetry) {
        worm?.classList.add('worm-retreat');
        bubble?.classList.add('bubble-shake');
      }
      const attempts = document.querySelectorAll('.hud .hud-value')[2];
      if (attempts) attempts.textContent = '❤️ ' + attemptsLeft;
      setStatus(technicalRetry ? 'ما سمعتك بوضوح، أسمعك مرة ثانية...' : 'حاول مرة ثانية — باقي ' + attemptsLeft + ' محاولات');
      setTimeout(() => {
        app.classList.remove('screen-shake');
        worm?.classList.remove('worm-retreat');
        bubble?.classList.remove('bubble-shake');
      }, 520);
    }
    function failAndFinish() {
      setGameState('gameOver');
      isGameOver = true;
      stopListening();
      clearTimers();
      document.getElementById('meaningBubble')?.classList.add('bubble-shake');
      document.getElementById('worm')?.classList.add('worm-retreat');
      app.classList.add('screen-shake');
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
          body: JSON.stringify({ token, reason: 'round_finished' })
        });
        exitFinishSent = true;
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
        '<div class="result-worm">' + wormMarkup('worm-retreat', Math.max(0, completedWords - 1)) + '</div>' +
        '<h1>انتهت المحاولة</h1>' +
        '<p class="sub">للأسف، فقدت هذه الكلمة.</p>' +
        '<div class="small-bubble">🫧 ' + meaning(failed.failedArabicMeaning) + '</div>' +
        '<div class="answer-line"><strong class="correct-word">' + escapeHtml(failed.correctAnswer) + '</strong><button class="sound" id="speakBtn" aria-label="استمع للنطق الصحيح">🔊</button></div>' +
        '<button class="secondary" id="speakTextBtn">🔊 اسمع النطق الصحيح</button>' +
        '<p class="notice">الكلمات المكتملة: ' + completedWords + ' / ' + totalWords + '<br>النقاط المكتسبة: ' + state.score + '<br>XP المكتسب: +' + (state.xpGained || 0) + '</p>' +
        '<button class="primary" id="restartBtn">إعادة المحاولة</button>' +
        '<button class="secondary" id="leaveResultBtn">العودة إلى البوت</button>' +
        '</div></section>';
      document.getElementById('speakBtn')?.addEventListener('click', () => speakGerman(failed.correctPronunciationText || failed.correctAnswer));
      document.getElementById('speakTextBtn')?.addEventListener('click', () => speakGerman(failed.correctPronunciationText || failed.correctAnswer));
      document.getElementById('restartBtn')?.addEventListener('click', restartGame);
      document.getElementById('leaveResultBtn')?.addEventListener('click', leaveGame);
    }
    function renderWin() {
      setGameState('finished');
      isGameOver = true;
      const totalWords = state.totalWords || state.totalQuestions || 0;
      const completedWords = state.completedWords ?? state.correctCount ?? 0;
      app.innerHTML = '<section class="screen"><div class="panel">' +
        '<div class="result-worm">' + wormMarkup('', 5, true) + '</div>' +
        '<h1>ممتاز! أكلت كل الفقاعات</h1>' +
        '<p class="sub">الدودة خلصت مجموعة الكلمات بنجاح.</p>' +
        '<p class="notice">أكملت: ' + completedWords + ' / ' + totalWords + '<br>النقاط: ' + state.score + '<br>XP: +' + (state.xpGained || 0) + '</p>' +
        '<button class="primary" id="restartBtn">العب مرة ثانية</button>' +
        '<button class="secondary" id="leaveResultBtn">العودة إلى البوت</button>' +
        '</div></section>';
      document.getElementById('restartBtn')?.addEventListener('click', restartGame);
      document.getElementById('leaveResultBtn')?.addEventListener('click', leaveGame);
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
        '<div class="result-worm">' + wormMarkup('', 1) + '</div><h1>جولة جديدة...</h1>' +
        '<p class="notice"><span class="spinner"></span> أجهز فقاعات جديدة</p>' +
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
    function finishPayload(reason = 'exit') {
      return JSON.stringify({ token, reason });
    }
    async function finishOnExit(waitForResponse) {
      if (!token || isRestarting) return state;
      stopListening();
      clearTimers();
      setGameState('leaving');
      if (exitFinishSent || state?.xpAwarded) return state;
      if (waitForResponse) {
        state = await api('/game/api/finish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: finishPayload('button_exit')
        });
        exitFinishSent = true;
        return state;
      }
      exitFinishSent = true;
      const payload = finishPayload('page_exit');
      try {
        if (navigator.sendBeacon) {
          const blob = new Blob([payload], { type: 'application/json' });
          if (navigator.sendBeacon('/game/api/finish', blob)) return state;
        }
      } catch {}
      try {
        fetch('/game/api/finish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        }).catch(() => {});
      } catch {}
      return state;
    }
    async function leaveGame() {
      if (finishBusy || isRestarting) return;
      finishBusy = true;
      try {
        const saved = await finishOnExit(true);
        renderExitSaved(saved?.xpGained || 0);
      } catch {
        renderExitSaved(state?.xpGained || 0);
      } finally {
        finishBusy = false;
      }
    }
    function renderExitSaved(xpGained) {
      app.innerHTML = '<section class="screen"><div class="panel">' +
        '<div class="result-worm">' + wormMarkup('', 2) + '</div>' +
        '<h1>تم حفظ تقدمك</h1>' +
        '<p class="notice">ربحت ' + Number(xpGained || 0) + ' XP.</p>' +
        '<button class="primary" onclick="history.back()">العودة إلى البوت</button>' +
        '<button class="secondary" id="restartBtn">العب مرة ثانية</button>' +
        '</div></section>';
      document.getElementById('restartBtn')?.addEventListener('click', restartGame);
    }
    function setStatus(message) {
      const status = document.getElementById('status');
      if (status) status.innerHTML = message;
    }
    function renderVoiceWaves(active) {
      const indicator = document.getElementById('listeningIndicator');
      if (!indicator) return;
      indicator.innerHTML = active ? '<span class="voice-waves"><i></i><i></i><i></i></span>' : '';
    }
    function setRecoveryButton(visible) {
      const button = document.getElementById('micRecoverBtn');
      if (!button) return;
      button.classList.toggle('hidden', !visible);
    }
    function showMicrophoneRecovery(message) {
      setGameState('bubble');
      clearTimers();
      requestBusy = false;
      isChecking = false;
      roundClosed = false;
      setStatus(escapeHtml(message));
      renderVoiceWaves(false);
      setRecoveryButton(true);
    }
    function renderError(message) {
      setGameState('error');
      clearTimers();
      stopListening();
      app.innerHTML = '<section class="screen"><div class="panel">' +
        '<div class="result-worm">' + wormMarkup('worm-retreat', 0) + '</div><h1>Underwater Worm Speaking Game</h1>' +
        '<p class="notice danger">' + escapeHtml(message) + '</p>' +
        '<button class="primary" onclick="location.reload()">حاول مرة ثانية</button>' +
        '<button class="secondary" onclick="history.back()">العودة إلى البوت</button>' +
        '</div></section>';
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        finishOnExit(false);
      } else if (microphoneEnabled && gameState === 'bubble' && !requestBusy && !roundClosed && !isGameOver) {
        if (!activeTimerId && state.currentQuestion) startQuestionTimer(state.currentQuestion.timeLimit || 10);
        scheduleAutoListen(500);
      }
    });
    window.addEventListener('pagehide', () => {
      finishOnExit(false);
    });
    window.addEventListener('beforeunload', () => {
      finishOnExit(false);
    });
    window.addEventListener('pageshow', () => {
      if (microphoneEnabled && gameState === 'bubble' && !requestBusy && !roundClosed && !isGameOver) {
        if (!activeTimerId && state.currentQuestion) startQuestionTimer(state.currentQuestion.timeLimit || 10);
        scheduleAutoListen(500);
      }
    });
    load();
  </script>
</body>
</html>`;
}
