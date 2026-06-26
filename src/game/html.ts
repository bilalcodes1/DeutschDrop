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
      --play-top: calc(var(--safe-top) + clamp(92px, 12dvh, 124px));
      --play-bottom: calc(var(--safe-bottom) + clamp(118px, 17dvh, 158px));
      --bubble-left: 64%;
      --bubble-top: 34%;
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
        radial-gradient(circle at 50% -12%, rgba(255,255,255,.50), transparent 28%),
        radial-gradient(circle at 88% 20%, rgba(157,239,255,.20), transparent 22%),
        radial-gradient(circle at 15% 78%, rgba(68, 224, 202, .18), transparent 26%),
        linear-gradient(180deg, #78e0ff 0%, #20acd9 38%, #0870a4 100%);
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
    .underwater::after {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, transparent, rgba(255,255,255,.08), transparent),
        radial-gradient(circle at 52% 58%, rgba(255,255,255,.08), transparent 36%);
      opacity: .38;
      mix-blend-mode: screen;
      animation: water-current 9s ease-in-out infinite alternate;
    }
    @keyframes ray-sway {
      from { transform: translateX(-2%) skewX(-4deg); }
      to { transform: translateX(3%) skewX(4deg); }
    }
    @keyframes water-current {
      from { transform: translate3d(-4%, -1%, 0) scale(1.02); }
      to { transform: translate3d(4%, 1%, 0) scale(1.06); }
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
      will-change: transform, opacity;
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
      will-change: transform;
      animation: weed-sway 3.6s ease-in-out infinite alternate;
    }
    .seaweed::before,
    .seaweed::after {
      content: "";
      position: absolute;
      bottom: 10px;
      width: 20px;
      height: 92px;
      border-radius: 80% 80% 12px 12px;
      background: linear-gradient(180deg, #6bf09b, #07845f);
      opacity: .68;
      transform-origin: bottom center;
    }
    .seaweed::before { left: -18px; rotate: -18deg; }
    .seaweed::after { right: -17px; rotate: 19deg; }
    .seaweed.w1 { left: 7%; height: 118px; rotate: -8deg; }
    .seaweed.w2 { right: 10%; height: 152px; animation-delay: -1.2s; }
    .seaweed.w3 { left: 28%; width: 24px; height: 86px; animation-delay: -.7s; opacity: .48; }
    body.celebrating .seaweed {
      animation-duration: 1.8s;
    }
    body.celebrating .coral::after {
      animation-duration: .9s;
      opacity: .95;
    }
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
    .coral::after {
      content: "";
      position: absolute;
      inset: -18px -12px auto auto;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: rgba(255,255,255,.88);
      box-shadow: -28px 16px 0 rgba(255,255,255,.52), -10px 34px 0 rgba(255,255,255,.48);
      opacity: .72;
      animation: coral-sparkle 2.4s ease-in-out infinite;
    }
    @keyframes coral-sparkle {
      0%, 100% { opacity: .28; transform: scale(.72); }
      50% { opacity: .92; transform: scale(1.15); }
    }
    .fish {
      position: absolute;
      top: var(--top, 50%);
      left: -90px;
      width: var(--w, 54px);
      height: calc(var(--w, 54px) * .42);
      border-radius: 55% 45% 45% 55%;
      background: rgba(210, 250, 255, .28);
      filter: blur(.15px);
      opacity: .42;
      animation: fish-swim var(--speed, 18s) linear infinite;
      animation-delay: var(--delay, 0s);
    }
    .fish::after {
      content: "";
      position: absolute;
      left: -13px;
      top: 50%;
      translate: 0 -50%;
      border-top: 9px solid transparent;
      border-bottom: 9px solid transparent;
      border-right: 16px solid rgba(210, 250, 255, .26);
    }
    @keyframes fish-swim {
      from { transform: translate3d(-12vw, 0, 0); }
      to { transform: translate3d(126vw, -2dvh, 0); }
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
      inset: var(--play-top) 0 var(--play-bottom);
      z-index: 4;
      pointer-events: none;
    }
    .meaning-bubble {
      position: absolute;
      left: var(--bubble-left);
      top: var(--bubble-top);
      translate: -50% -50%;
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
      transform-origin: 48% 52%;
      will-change: transform, opacity, filter;
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
    .meaning-bubble.has-image {
      padding: clamp(13px, 4vw, 22px);
    }
    .question-image {
      position: relative;
      z-index: 1;
      width: min(82%, 188px);
      aspect-ratio: 1 / 1;
      object-fit: cover;
      display: block;
      border-radius: 28px;
      margin: 0 auto 9px;
      background: rgba(255,255,255,.75);
      border: 5px solid rgba(255,255,255,.7);
      box-shadow: 0 16px 28px rgba(4, 61, 95, .2);
    }
    .image-caption {
      position: relative;
      z-index: 1;
      max-width: 100%;
      font-size: clamp(15px, 4.2vw, 22px);
      font-weight: 1000;
      line-height: 1.12;
      overflow-wrap: anywhere;
    }
    .image-attribution {
      position: absolute;
      left: 16px;
      right: 16px;
      bottom: 10px;
      z-index: 1;
      color: rgba(6, 70, 109, .72);
      font-size: 10px;
      font-weight: 900;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    @keyframes bubble-float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-10px); }
    }
    .meaning-bubble.bubble-spawn {
      animation: bubble-spawn .42s ease-out, bubble-float 2.8s ease-in-out .42s infinite;
    }
    @keyframes bubble-spawn {
      from { opacity: 0; transform: translateY(16px) scale(.82); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .meaning-bubble.bubble-pop {
      animation: bubble-pop .62s ease-out forwards;
    }
    .meaning-bubble.final-pop {
      animation: final-bubble-pop .94s cubic-bezier(.15,.86,.25,1.08) forwards;
    }
    .meaning-bubble.bubble-bite {
      animation: bubble-bite .42s ease-in-out forwards;
    }
    @keyframes bubble-pop {
      0% { opacity: 1; transform: scale(1); }
      36% { opacity: 1; transform: scale(1.08) rotate(-2deg); filter: brightness(1.1); }
      64% { opacity: .82; transform: scale(.78) translateX(-18px); clip-path: circle(44% at 44% 52%); }
      100% { opacity: 0; transform: scale(.14) translateX(-38px); clip-path: circle(12% at 34% 52%); }
    }
    @keyframes bubble-bite {
      0%, 100% { transform: scale(1); }
      35% { transform: scale(1.035) rotate(2deg); }
      70% { transform: scale(.96) translateX(-10px); }
    }
    @keyframes final-bubble-pop {
      0% { opacity: 1; transform: scale(1); filter: brightness(1); }
      22% { opacity: 1; transform: scale(1.16) rotate(-3deg); filter: brightness(1.18); }
      52% { opacity: .88; transform: scale(.92) translateX(-24px); clip-path: circle(46% at 42% 52%); }
      100% { opacity: 0; transform: scale(.12) translateX(-60px); clip-path: circle(8% at 30% 50%); }
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
    .success-sparkle {
      position: absolute;
      left: 54%;
      top: 44%;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: rgba(255,255,255,.98);
      box-shadow: 0 0 12px rgba(255,255,255,.9);
      opacity: 0;
      animation: sparkle-pop .7s ease-out forwards;
      animation-delay: var(--delay, 0s);
    }
    .win-burst {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
      z-index: 3;
    }
    .win-burst i {
      position: absolute;
      left: var(--x);
      bottom: -30px;
      width: var(--s, 12px);
      height: var(--s, 12px);
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,.74);
      background: rgba(190,255,248,.28);
      box-shadow: 0 0 16px rgba(255,255,255,.42);
      animation: win-bubble-rise var(--d, 3s) ease-out infinite;
      animation-delay: var(--delay, 0s);
    }
    @keyframes win-bubble-rise {
      0% { opacity: 0; transform: translate3d(0, 0, 0) scale(.7); }
      15% { opacity: .95; }
      100% { opacity: 0; transform: translate3d(var(--drift, 12px), -112dvh, 0) scale(1.25); }
    }
    @keyframes pop-particle {
      to {
        opacity: 0;
        transform: rotate(var(--angle)) translateX(var(--distance)) scale(.5);
      }
    }
    @keyframes sparkle-pop {
      0% { opacity: 0; transform: translate(0,0) scale(.4); }
      28% { opacity: 1; }
      100% { opacity: 0; transform: translate(var(--x), var(--y)) scale(1.3); }
    }
    .worm {
      position: absolute;
      left: 0;
      top: 0;
      width: clamp(190px, 52vw, 300px);
      height: 112px;
      transform: translate3d(var(--worm-x, 22px), var(--worm-y, 48%), 0) scaleX(var(--worm-facing, 1));
      transform-origin: center;
      transition: transform 1.7s cubic-bezier(.35,.84,.26,1);
      will-change: transform;
      z-index: 2;
    }
    .worm-body {
      width: 100%;
      height: 100%;
      transform: scale(var(--worm-scale));
      transform-origin: 28% 60%;
      filter: drop-shadow(0 22px 24px rgba(0, 47, 76, .24));
      will-change: transform, filter;
      animation: worm-swim 2.1s ease-in-out infinite, worm-breathe 3.4s ease-in-out infinite;
    }
    .worm.worm-listening .worm-body {
      animation-duration: 1.9s, 3.1s;
    }
    .worm.worm-chasing {
      transition-duration: .72s;
      transition-timing-function: cubic-bezier(.18,.86,.16,1);
    }
    @keyframes worm-swim {
      0%, 100% { translate: 0 0; rotate: -2deg; }
      50% { translate: 0 -9px; rotate: 2deg; }
    }
    @keyframes worm-breathe {
      0%, 100% { filter: drop-shadow(0 22px 24px rgba(0, 47, 76, .24)); }
      50% { filter: drop-shadow(0 26px 28px rgba(0, 47, 76, .19)); }
    }
    .worm.worm-chomp .worm-body,
    .worm.worm-eating .worm-body {
      animation: worm-chomp .82s cubic-bezier(.18,.88,.22,1.04) forwards;
    }
    .worm.worm-grow .worm-body {
      animation: worm-chomp .82s cubic-bezier(.18,.88,.22,1.04) forwards, worm-grow .92s ease-out forwards;
    }
    @keyframes worm-chomp {
      0% { transform: scale(var(--worm-scale)) translateX(0); }
      38% { transform: scale(calc(var(--worm-scale) * 1.05)) translateX(clamp(58px, 20vw, 118px)); }
      54% { transform: scale(calc(var(--worm-scale) * 1.08)) translateX(clamp(70px, 23vw, 136px)); }
      78% { transform: scale(calc(var(--worm-scale) * 1.04)) translateX(clamp(24px, 10vw, 58px)); }
      100% { transform: scale(var(--worm-scale)) translateX(0); }
    }
    @keyframes worm-grow {
      0%, 58% { filter: drop-shadow(0 22px 24px rgba(0, 47, 76, .24)); }
      72% { filter: drop-shadow(0 26px 30px rgba(220, 255, 255, .34)); }
      100% { filter: drop-shadow(0 22px 24px rgba(0, 47, 76, .24)); }
    }
    .worm.worm-retreat .worm-body {
      animation: worm-retreat .48s ease-out;
    }
    .worm.worm-celebrate .worm-body {
      animation: worm-celebrate 1.05s ease-in-out infinite;
      filter: drop-shadow(0 0 20px rgba(215,255,255,.72)) drop-shadow(0 24px 28px rgba(0, 47, 76, .18));
    }
    @keyframes worm-celebrate {
      0%, 100% { transform: scale(calc(var(--worm-scale) * 1.16)) rotate(-4deg); }
      30% { transform: scale(calc(var(--worm-scale) * 1.24)) translateY(-12px) rotate(7deg); }
      62% { transform: scale(calc(var(--worm-scale) * 1.19)) translateY(4px) rotate(-8deg); }
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
    .worm-segment {
      transform-box: fill-box;
      transform-origin: center;
      animation: segment-wiggle 1.65s ease-in-out infinite;
      animation-delay: calc(var(--i, 0) * -90ms);
    }
    @keyframes segment-wiggle {
      0%, 100% { transform: translateY(0) scale(1); }
      50% { transform: translateY(calc(var(--wave, 1) * -5px)) scale(1.025); }
    }
    .worm-tail {
      transform-box: fill-box;
      transform-origin: right center;
      animation: tail-wave 1.1s ease-in-out infinite;
    }
    @keyframes tail-wave {
      0%, 100% { transform: rotate(-7deg); }
      50% { transform: rotate(11deg); }
    }
    .worm-eye {
      transform-box: fill-box;
      transform-origin: center;
      animation: worm-blink 4.2s ease-in-out infinite;
    }
    @keyframes worm-blink {
      0%, 92%, 100% { transform: scaleY(1); }
      95% { transform: scaleY(.12); }
    }
    .worm-mouth {
      transition: d .2s ease;
    }
    .worm.worm-chomp .worm-mouth,
    .worm.worm-eating .worm-mouth {
      stroke-width: 9;
    }
    .worm.worm-happy .worm-mouth {
      stroke: #7b3157;
    }
    .worm.worm-celebrate .worm-mouth {
      stroke-width: 7;
    }
    .worm.worm-confused .worm-mouth {
      d: path("M184 72 Q197 64 211 72");
    }
    .score-pulse {
      animation: score-pulse .52s ease-out;
    }
    @keyframes score-pulse {
      0% { transform: scale(1); }
      48% { transform: scale(1.13); color: #dffff9; }
      100% { transform: scale(1); }
    }
    .attempts-hit {
      animation: attempts-hit .48s ease-out;
    }
    @keyframes attempts-hit {
      0% { transform: scale(1); }
      45% { transform: scale(1.18); color: #ffd6df; }
      100% { transform: scale(1); }
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
    .result-worm .worm {
      position: relative;
      transform: none;
      left: auto;
      top: auto;
      transition: none;
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
    .summary-grid {
      width: min(390px, 90vw);
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    .summary-card {
      min-height: 70px;
      display: grid;
      place-items: center;
      gap: 4px;
      padding: 10px 8px;
      border-radius: 18px;
      background: rgba(224, 252, 255, .20);
      border: 1px solid rgba(255,255,255,.24);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.16);
      backdrop-filter: blur(8px);
    }
    .summary-card strong {
      font-size: clamp(18px, 5vw, 25px);
      line-height: 1;
    }
    .summary-card span {
      font-size: 12px;
      font-weight: 850;
      opacity: .9;
    }
    .win-celebration .panel {
      gap: 14px;
      transform: translateY(-.8dvh);
    }
    .win-celebration h1 {
      text-shadow: 0 5px 16px rgba(0, 54, 91, .45);
    }
    .win-celebration .result-worm {
      width: min(390px, 86vw);
      min-height: 148px;
    }
    @media (max-height: 720px) {
      :root {
        --bubble-size: clamp(142px, 38vw, 210px);
        --controls-bottom: calc(var(--safe-bottom) + 6px);
        --worm-scale: .78;
        --play-top: calc(var(--safe-top) + 78px);
        --play-bottom: calc(var(--safe-bottom) + 92px);
      }
      .status { font-size: 14px; }
      .hint { display: none; }
    }
    @media (max-width: 390px) {
      .hud { gap: 5px; width: 96vw; }
      .hud-pill { min-height: 42px; padding: 5px 4px; border-radius: 15px; }
      .hud-value { font-size: clamp(14px, 4vw, 18px); }
      .hud-label { font-size: 9px; }
      .summary-grid { grid-template-columns: 1fr; }
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
    <span class="bubble-dot" style="--left:56%;--size:7px;--duration:6s;--delay:-5s;--drift:20px"></span>
    <span class="bubble-dot" style="--left:73%;--size:22px;--duration:13s;--delay:-8s;--drift:-18px"></span>
    <span class="fish" style="--top:24%;--w:46px;--speed:19s;--delay:-7s"></span>
    <span class="fish" style="--top:62%;--w:34px;--speed:24s;--delay:-13s"></span>
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
    let audioCtx = null;
    let masterGain = null;
    let ambientOsc = null;
    let ambientLfo = null;
    let lastListenCueAt = 0;
    let bubblePositions = {};
    let currentBubblePosition = null;
    let wormPosition = { x: 26, y: 180 };
    let wormDirection = 1;
    let wormMoveTimer = null;
    let soundEnabled = true;

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'": '&#39;'}[c]));
    }
    function escapeAttr(value) {
      return escapeHtml(value);
    }
    function isSpeechSupported() {
      return Boolean(Recognition);
    }
    function meaning(value) {
      return escapeHtml(String(value || 'المعنى').trim() || 'المعنى');
    }
    function initAudio() {
      if (audioCtx) return;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      audioCtx = new AudioContext();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.035;
      masterGain.connect(audioCtx.destination);
      startAmbientWater();
    }
    function resumeAudio() {
      try {
        initAudio();
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      } catch {}
    }
    function startAmbientWater() {
      if (!audioCtx || !masterGain || ambientOsc) return;
      ambientOsc = audioCtx.createOscillator();
      ambientLfo = audioCtx.createOscillator();
      const ambientGain = audioCtx.createGain();
      const lfoGain = audioCtx.createGain();
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      ambientOsc.type = 'sine';
      ambientOsc.frequency.value = 96;
      ambientLfo.type = 'sine';
      ambientLfo.frequency.value = 0.08;
      ambientGain.gain.value = 0.009;
      lfoGain.gain.value = 0.004;
      ambientLfo.connect(lfoGain);
      lfoGain.connect(ambientGain.gain);
      ambientOsc.connect(filter);
      filter.connect(ambientGain);
      ambientGain.connect(masterGain);
      ambientOsc.start();
      ambientLfo.start();
    }
    function playTone(freq, duration, gain = 0.04, type = 'sine', delay = 0) {
      if (!audioCtx || !masterGain) return;
      const now = audioCtx.currentTime + delay;
      const osc = audioCtx.createOscillator();
      const env = audioCtx.createGain();
      const filter = audioCtx.createBiquadFilter();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.72), now + duration);
      filter.type = 'lowpass';
      filter.frequency.value = 1400;
      env.gain.setValueAtTime(0.0001, now);
      env.gain.exponentialRampToValueAtTime(gain, now + 0.018);
      env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(filter);
      filter.connect(env);
      env.connect(masterGain);
      osc.start(now);
      osc.stop(now + duration + 0.04);
    }
    function playNoise(duration, gain = 0.025, delay = 0) {
      if (!audioCtx || !masterGain) return;
      const now = audioCtx.currentTime + delay;
      const buffer = audioCtx.createBuffer(1, Math.max(1, Math.floor(audioCtx.sampleRate * duration)), audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const source = audioCtx.createBufferSource();
      const env = audioCtx.createGain();
      const filter = audioCtx.createBiquadFilter();
      source.buffer = buffer;
      filter.type = 'bandpass';
      filter.frequency.value = 620;
      filter.Q.value = 0.9;
      env.gain.setValueAtTime(gain, now);
      env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      source.connect(filter);
      filter.connect(env);
      env.connect(masterGain);
      source.start(now);
    }
    function playSound(kind) {
      if (!soundEnabled) return;
      resumeAudio();
      if (!audioCtx) return;
      if (kind === 'listen') {
        const now = Date.now();
        if (now - lastListenCueAt < 2400) return;
        lastListenCueAt = now;
        playTone(520, .12, .018, 'sine');
        playTone(780, .16, .012, 'sine', .05);
      } else if (kind === 'correct') {
        playNoise(.16, .035);
        playTone(260, .11, .034, 'triangle', .02);
        playTone(620, .15, .028, 'sine', .08);
        playTone(920, .18, .020, 'sine', .16);
      } else if (kind === 'wrong') {
        playTone(230, .16, .030, 'triangle');
        playTone(145, .22, .018, 'sine', .08);
      } else if (kind === 'gameover') {
        playTone(260, .22, .028, 'sine');
        playTone(170, .32, .022, 'sine', .18);
      } else if (kind === 'win') {
        playNoise(.12, .020);
        playTone(420, .11, .026, 'sine');
        playTone(620, .11, .026, 'sine', .10);
        playTone(840, .14, .024, 'triangle', .20);
        playTone(1120, .20, .020, 'sine', .34);
        playNoise(.16, .018, .46);
      } else if (kind === 'tap') {
        playTone(640, .08, .012, 'sine');
      }
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
        '<div class="worm-body">' +
        '<svg class="worm-svg" viewBox="' + (-tailOffset) + ' -34 ' + (310 + tailOffset) + ' 156" role="img" aria-label="دودة بحرية">' +
        '<defs><linearGradient id="wormGrad" x1="0" x2="1"><stop offset="0%" stop-color="#ffd66b"/><stop offset="45%" stop-color="#ff9cc9"/><stop offset="100%" stop-color="#8be7ff"/></linearGradient></defs>' +
        '<g>' +
        '<path class="worm-tail" d="M' + (8 - tailOffset) + ' 68 Q' + (-22 - tailOffset) + ' 38 ' + (-38 - tailOffset) + ' 78 Q' + (-8 - tailOffset) + ' 80 ' + (14 - tailOffset) + ' 92 Z" fill="#8be7ff" stroke="rgba(255,255,255,.45)" stroke-width="3"/>' +
        Array.from({ length: 4 + growth }, (_, i) => {
          const x = 34 + i * 34 - tailOffset;
          const y = 68 + Math.sin(i) * 9;
          const wave = i % 2 === 0 ? 1 : -1;
          return '<circle class="worm-segment" style="--i:' + i + ';--wave:' + wave + '" cx="' + x + '" cy="' + y + '" r="31" fill="url(#wormGrad)" stroke="rgba(255,255,255,.48)" stroke-width="4"/>';
        }).join('') +
        '<ellipse cx="196" cy="58" rx="47" ry="41" fill="#ffb0d7" stroke="rgba(255,255,255,.55)" stroke-width="4"/>' +
        '<circle class="worm-eye" cx="183" cy="47" r="6" fill="#073556"/><circle class="worm-eye" cx="209" cy="47" r="6" fill="#073556"/>' +
        '<circle cx="181" cy="45" r="2" fill="#fff"/><circle cx="207" cy="45" r="2" fill="#fff"/>' +
        '<path class="worm-mouth" d="M184 69 Q197 78 211 69" fill="none" stroke="#7b3157" stroke-width="5" stroke-linecap="round"/>' +
        '<path d="M214 33 Q244 16 251 48 Q231 44 214 58" fill="#8be7ff" stroke="rgba(255,255,255,.45)" stroke-width="3"/>' +
        '<path d="M170 33 Q146 13 136 44 Q156 43 171 57" fill="#8be7ff" stroke="rgba(255,255,255,.45)" stroke-width="3"/>' +
        crown +
        '</g></svg></div></div>';
    }
    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }
    function getPlayfield() {
      return document.querySelector('.playfield');
    }
    function randomBetween(min, max) {
      return min + Math.random() * (max - min);
    }
    function randomBubblePosition(questionIndex) {
      const baseX = randomBetween(28, 72);
      const baseY = randomBetween(24, 66);
      const stagger = Number(questionIndex || 0) % 4;
      return {
        x: clamp(baseX + (stagger === 1 ? -7 : stagger === 2 ? 6 : 0), 24, 76),
        y: clamp(baseY + (stagger === 3 ? -8 : stagger === 0 ? 4 : 0), 20, 70),
      };
    }
    function getBubblePosition(questionIndex) {
      const key = String(questionIndex);
      if (!bubblePositions[key]) bubblePositions[key] = randomBubblePosition(questionIndex);
      currentBubblePosition = bubblePositions[key];
      return currentBubblePosition;
    }
    function bubblePositionStyle(questionIndex) {
      const position = getBubblePosition(questionIndex);
      return '--bubble-left:' + position.x.toFixed(2) + '%;--bubble-top:' + position.y.toFixed(2) + '%;';
    }
    function applyWormPosition(className = 'worm-idle') {
      const worm = document.getElementById('worm');
      if (!worm) return;
      worm.classList.remove('worm-idle', 'worm-listening', 'worm-chasing', 'worm-eating');
      if (className) worm.classList.add(className);
      worm.style.setProperty('--worm-x', Math.round(wormPosition.x) + 'px');
      worm.style.setProperty('--worm-y', Math.round(wormPosition.y) + 'px');
      worm.style.setProperty('--worm-facing', String(wormDirection));
    }
    function safeWormTarget() {
      const field = getPlayfield();
      const worm = document.getElementById('worm');
      if (!field || !worm) return { x: 26, y: 180 };
      const bounds = field.getBoundingClientRect();
      const wormWidth = Math.max(160, worm.getBoundingClientRect().width || 220);
      const wormHeight = Math.max(90, worm.getBoundingClientRect().height || 112);
      return {
        x: randomBetween(12, Math.max(12, bounds.width - wormWidth - 8)),
        y: randomBetween(20, Math.max(22, bounds.height - wormHeight - 10)),
      };
    }
    function startWormIdleMovement(mode = 'worm-idle') {
      clearTimeout(wormMoveTimer);
      const worm = document.getElementById('worm');
      const field = getPlayfield();
      if (!worm || !field || isGameOver || isRestarting) return;
      const tick = () => {
        if (!document.getElementById('worm') || !['bubble', 'listening', 'preparing'].includes(gameState)) return;
        const next = safeWormTarget();
        wormDirection = next.x >= wormPosition.x ? 1 : -1;
        wormPosition = next;
        applyWormPosition(gameState === 'listening' ? 'worm-listening' : mode);
        wormMoveTimer = setTimeout(tick, 1450 + Math.random() * 1150);
      };
      if (!Number.isFinite(wormPosition.y) || wormPosition.y < 10) wormPosition = safeWormTarget();
      applyWormPosition(mode);
      wormMoveTimer = setTimeout(tick, 180);
    }
    function stopWormMovement() {
      clearTimeout(wormMoveTimer);
      wormMoveTimer = null;
    }
    function moveWormToBubble(finalWin = false) {
      stopWormMovement();
      const worm = document.getElementById('worm');
      const bubble = document.getElementById('meaningBubble');
      const field = getPlayfield();
      if (!worm || !bubble || !field) return;
      const fieldRect = field.getBoundingClientRect();
      const bubbleRect = bubble.getBoundingClientRect();
      const wormRect = worm.getBoundingClientRect();
      const targetX = bubbleRect.left - fieldRect.left - wormRect.width * .52;
      const targetY = bubbleRect.top - fieldRect.top + bubbleRect.height * .18 - wormRect.height * .48;
      const maxX = Math.max(8, fieldRect.width - wormRect.width - 8);
      const maxY = Math.max(8, fieldRect.height - wormRect.height - 8);
      wormDirection = targetX >= wormPosition.x ? 1 : -1;
      wormPosition = { x: clamp(targetX, 8, maxX), y: clamp(targetY, 8, maxY) };
      applyWormPosition('worm-chasing');
      setTimeout(() => {
        worm.classList.add('worm-eating', 'worm-chomp', 'worm-grow', 'worm-happy');
        if (finalWin) worm.classList.add('worm-celebrate');
      }, 520);
    }
    function winBurstMarkup() {
      return '<div class="win-burst" aria-hidden="true">' + Array.from({ length: 26 }, (_, i) => {
        const x = (8 + (i * 13) % 86).toFixed(1) + '%';
        const size = 7 + (i % 5) * 3;
        const duration = (2.4 + (i % 6) * .22).toFixed(2) + 's';
        const delay = (-1.8 + (i % 8) * .18).toFixed(2) + 's';
        const drift = ((i % 2 === 0 ? 1 : -1) * (10 + i % 9)).toString() + 'px';
        return '<i style="--x:' + x + ';--s:' + size + 'px;--d:' + duration + ';--delay:' + delay + ';--drift:' + drift + '"></i>';
      }).join('') + '</div>';
    }
    function formatDuration(ms) {
      const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
      const minutes = Math.floor(seconds / 60);
      const rest = seconds % 60;
      return minutes > 0 ? minutes + ':' + String(rest).padStart(2, '0') : rest + 's';
    }
    function renderStart() {
      document.body.classList.remove('celebrating');
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
        '<h1>DeutschDrop Adventure</h1>' +
        '<p class="sub">' + escapeHtml(state.collectionTitle) + '</p>' +
        '<p class="sub">عدد الكلمات: ' + totalWords + '</p>' +
        '<p class="notice">انطق، قاتل، وتعلّم. لا يظهر الألماني قبل إجابتك.</p>' +
        '<p class="notice">إذا المايكروفون لا يعمل، افتح الرابط في Safari أو Chrome.</p>' +
        '<button class="primary" id="startBtn">🎙 تفعيل المايكروفون وابدأ</button>' +
        '</div></section>';
      document.getElementById('startBtn').onclick = () => {
        if (!isSpeechSupported()) {
          renderError('متصفحك لا يدعم التعرف على الصوت. افتح اللعبة في Chrome أو Safari حديث.');
          return;
        }
        resumeAudio();
        playSound('tap');
        microphoneEnabled = true;
        renderPlay('انطق الكلمة الألمانية', true);
      };
    }
    function renderPlay(message = 'انطق الكلمة الألمانية', autoStart = false) {
      document.body.classList.remove('celebrating');
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
      const bubbleStyle = bubblePositionStyle(question.questionIndex);
      const hearts = state.hearts ?? attemptsLeft;
      const combo = state.combo ?? state.bestStreak ?? 0;
      const bubbleContent = question.visualType === 'image' && question.imageUrl
        ? '<img class="question-image" src="' + escapeAttr(question.imageUrl) + '" alt="صورة السؤال">' + (state.mode === 'image_speech' ? '' : '<div class="image-caption">' + meaning(question.arabicMeaning) + '</div>') + (question.imageAttribution ? '<div class="image-attribution">' + escapeHtml(question.imageAttribution) + '</div>' : '')
        : '<div class="meaning-text">' + meaning(question.arabicMeaning) + '</div>';
      app.innerHTML = '<section class="game">' +
        '<div class="hud">' +
        '<div class="hud-pill"><div class="hud-value" id="scoreValue">⭐ ' + state.score + '</div><div class="hud-label">النقاط</div></div>' +
        '<div class="hud-pill"><div class="hud-value">📊 ' + (completedWords + 1) + ' / ' + totalWords + '</div><div class="hud-label">التقدم</div></div>' +
        '<div class="hud-pill"><div class="hud-value" id="attemptsValue">❤️ ' + hearts + '</div><div class="hud-label">القلوب</div></div>' +
        '<div class="hud-pill listening-chip" id="listenChip"><div class="hud-value">🔥 ' + combo + '</div><div class="hud-label">Combo</div></div>' +
        '</div>' +
        '<div class="timer"><div class="timer-fill" id="timerFill"></div></div>' +
        '<div class="playfield">' +
        '<div class="meaning-bubble bubble-spawn' + (question.visualType === 'image' ? ' has-image' : '') + '" id="meaningBubble" style="' + bubbleStyle + '">' + bubbleContent + '<div class="pop-particles" id="popParticles">' + Array.from({ length: 12 }, (_, i) => '<i style="--angle:' + (i * 30) + 'deg;--distance:' + (52 + i * 5) + 'px"></i>').join('') + Array.from({ length: 7 }, (_, i) => '<b class="success-sparkle" style="--x:' + ((i - 3) * 22) + 'px;--y:' + (-28 - i * 8) + 'px;--delay:' + (i * .035) + 's"></b>').join('') + '</div></div>' +
        wormMarkup('', completedWords) +
        '</div>' +
        '<div class="controls"><div class="status" id="status">' + escapeHtml(message) + '</div><div class="bottom-actions"><button class="voice-action" id="speakNowBtn">🎙 انطق الآن</button><button class="mini-action" id="hintBtn">💡 تلميح</button><button class="mini-action" id="pauseBtn">⏸ إيقاف مؤقت</button><button class="mini-action" id="leaveBtn">❌ إنهاء الجولة</button><button class="voice-action hidden" id="micRecoverBtn">🎙 فعّل المايكروفون</button></div><div class="hint">يستمع لإجابتك بالألمانية <span id="listeningIndicator" aria-hidden="true"></span></div></div>' +
        '</section>';
      document.getElementById('micRecoverBtn').onclick = enableMicrophoneAndListen;
      document.getElementById('speakNowBtn').onclick = () => listen();
      document.getElementById('hintBtn').onclick = () => setStatus('💡 انظر إلى الصورة أو المعنى، ثم انطق الكلمة بالألمانية.');
      document.getElementById('pauseBtn').onclick = () => { clearTimers(); stopListening(); setStatus('متوقف مؤقتاً. اضغط انطق الآن للمتابعة.'); };
      document.getElementById('leaveBtn').onclick = leaveGame;
      startQuestionTimer(question.timeLimit || 10);
      requestAnimationFrame(() => startWormIdleMovement('worm-idle'));
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
      playSound('listen');
      applyWormPosition('worm-listening');
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
      clearTimeout(wormMoveTimer);
      speechTimer = null;
      activeTimerId = null;
      autoListenTimer = null;
      wormMoveTimer = null;
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
          const finalWin = Boolean(result.finished && result.gameWon && !result.failedQuestion);
          playSound('correct');
          if (finalWin) setTimeout(() => playSound('win'), 560);
          moveWormToBubble(finalWin);
          document.getElementById('meaningBubble')?.classList.add('bubble-bite');
          document.getElementById('popParticles')?.classList.add('active');
          document.getElementById('scoreValue')?.classList.add('score-pulse');
          setStatus(finalWin ? 'ممتاز! أكملت المجموعة 🎉' : 'صحيح! الدودة أكلت الفقاعة');
          setTimeout(() => document.getElementById('meaningBubble')?.classList.add(finalWin ? 'final-pop' : 'bubble-pop'), finalWin ? 520 : 300);
          setTimeout(() => finalWin ? finish('win') : renderPlay('صحيح! فقاعة جديدة 🫧'), finalWin ? 1500 : 1050);
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
      if (!technicalRetry) playSound('wrong');
      const worm = document.getElementById('worm');
      const bubble = document.getElementById('meaningBubble');
      worm?.classList.remove('worm-retreat');
      bubble?.classList.remove('bubble-shake');
      void worm?.offsetWidth;
      if (!technicalRetry) {
        worm?.classList.add('worm-retreat', 'worm-confused');
        bubble?.classList.add('bubble-shake');
      }
      const attempts = document.getElementById('attemptsValue') || document.querySelectorAll('.hud .hud-value')[2];
      if (attempts) attempts.textContent = '❤️ ' + attemptsLeft;
      attempts?.classList.add('attempts-hit');
      setStatus(technicalRetry ? 'ما سمعتك بوضوح، أسمعك مرة ثانية...' : 'حاول مرة ثانية — باقي ' + attemptsLeft + ' محاولات');
      setTimeout(() => {
        app.classList.remove('screen-shake');
        worm?.classList.remove('worm-retreat', 'worm-confused');
        bubble?.classList.remove('bubble-shake');
        attempts?.classList.remove('attempts-hit');
      }, 520);
    }
    function failAndFinish() {
      setGameState('gameOver');
      isGameOver = true;
      stopListening();
      clearTimers();
      playSound('gameover');
      document.getElementById('meaningBubble')?.classList.add('bubble-shake');
      document.getElementById('worm')?.classList.add('worm-retreat', 'worm-confused');
      app.classList.add('screen-shake');
      setTimeout(() => finish(), 760);
    }
    async function finish(reason = 'round_finished') {
      if (finishBusy) return;
      finishBusy = true;
      clearTimers();
      stopListening();
      try {
        state = await api('/game/api/finish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, reason })
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
      document.body.classList.remove('celebrating');
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
        '<div class="summary-grid"><div class="summary-card"><strong>' + completedWords + ' / ' + totalWords + '</strong><span>الكلمات المكتملة</span></div><div class="summary-card"><strong>' + state.score + '</strong><span>النقاط المكتسبة</span></div><div class="summary-card"><strong>+' + (state.xpGained || 0) + '</strong><span>XP المكتسب</span></div></div>' +
        '<button class="primary" id="restartBtn">إعادة المحاولة</button>' +
        '<button class="secondary" id="leaveResultBtn">العودة إلى البوت</button>' +
        '</div></section>';
      document.getElementById('speakBtn')?.addEventListener('click', () => { playSound('tap'); speakGerman(failed.correctPronunciationText || failed.correctAnswer); });
      document.getElementById('speakTextBtn')?.addEventListener('click', () => { playSound('tap'); speakGerman(failed.correctPronunciationText || failed.correctAnswer); });
      document.getElementById('restartBtn')?.addEventListener('click', restartGame);
      document.getElementById('leaveResultBtn')?.addEventListener('click', leaveGame);
    }
    function renderWin() {
      document.body.classList.add('celebrating');
      setGameState('finished');
      isGameOver = true;
      playSound('win');
      const totalWords = state.totalWords || state.totalQuestions || 0;
      const completedWords = state.completedWords ?? state.correctCount ?? 0;
      const challengeCard = state.isChallenge ? '<div class="summary-card"><strong>⚔️</strong><span>تحدي مسجل</span></div>' : '';
      app.innerHTML = '<section class="screen win-celebration">' + winBurstMarkup() + '<div class="panel">' +
        '<div class="result-worm">' + wormMarkup('worm-celebrate worm-happy', Math.max(5, completedWords), true) + '</div>' +
        '<h1>ممتاز! أكملت المجموعة</h1>' +
        '<p class="sub">الدودة أكلت كل الفقاعات بنجاح</p>' +
        '<div class="summary-grid"><div class="summary-card"><strong>' + totalWords + ' / ' + totalWords + '</strong><span>الكلمات المكتملة</span></div><div class="summary-card"><strong>' + state.score + '</strong><span>النقاط المكتسبة</span></div><div class="summary-card"><strong>+' + (state.xpGained || 0) + '</strong><span>XP المكتسب</span></div><div class="summary-card"><strong>' + formatDuration(state.durationMs) + '</strong><span>الوقت</span></div>' + challengeCard + '</div>' +
        '<button class="primary" id="restartBtn">العب مرة ثانية</button>' +
        '<button class="secondary" id="leaveResultBtn">العودة إلى البوت</button>' +
        '</div></section>';
      document.getElementById('restartBtn')?.addEventListener('click', restartGame);
      document.getElementById('leaveResultBtn')?.addEventListener('click', leaveGame);
    }
    async function restartGame() {
      document.body.classList.remove('celebrating');
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
        bubblePositions = {};
        currentBubblePosition = null;
        wormPosition = { x: 26, y: 180 };
        wormDirection = 1;
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
    async function finishOnExit(waitForResponse, reason = 'page_exit') {
      if (!token || isRestarting) return state;
      stopListening();
      clearTimers();
      setGameState('leaving');
      if (exitFinishSent || state?.xpAwarded) return state;
      if (waitForResponse) {
        state = await api('/game/api/finish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: finishPayload(reason)
        });
        exitFinishSent = true;
        return state;
      }
      exitFinishSent = true;
      const payload = finishPayload(reason);
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
        const saved = await finishOnExit(true, 'button_exit');
        renderExitSaved(saved?.xpGained || 0);
      } catch {
        renderExitSaved(state?.xpGained || 0);
      } finally {
        finishBusy = false;
      }
    }
    function renderExitSaved(xpGained) {
      document.body.classList.remove('celebrating');
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
      document.body.classList.remove('celebrating');
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
        finishOnExit(false, 'visibility_hidden');
      } else if (microphoneEnabled && gameState === 'bubble' && !requestBusy && !roundClosed && !isGameOver) {
        if (!activeTimerId && state.currentQuestion) startQuestionTimer(state.currentQuestion.timeLimit || 10);
        scheduleAutoListen(500);
      }
    });
    window.addEventListener('pagehide', () => {
      finishOnExit(false, 'pagehide');
    });
    window.addEventListener('beforeunload', () => {
      finishOnExit(false, 'beforeunload');
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
