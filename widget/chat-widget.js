/**
 * chat-widget.js  v3.0  — Full-height slide-out panel
 * AI Chat Widget for TODO_COMPANY_NAME (TODO_SITE.ru)
 * Powered by Claude via Vercel proxy.
 *
 * ── ADAPTED FOR CAR PARTS CLIENT ──
 * TODO: Replace all TODO placeholders before deploying.
 *
 * Usage in index.html:
 *   <script>window.AGENT_URL = 'https://YOUR-PROJECT.vercel.app';</script>
 *   <script src="https://YOUR-PROJECT.vercel.app/widget/chat-widget.js" defer></script>
 *
 * To open programmatically:
 *   window.AutoChat && window.AutoChat.open()
 */
(function () {
  'use strict';

  // ─── CONFIG ─────────────────────────────────────────────────────────────────
  const BASE_URL    = window.AGENT_URL || 'https://TODO-YOUR-PROJECT.vercel.app'; // TODO: set your Vercel URL
  const AGENT_URL   = BASE_URL + '/api/chat';
  const SESSION_URL = BASE_URL + '/api/session';
  const MANAGER_PHONE = 'TODO_PHONE_DIGITS_ONLY'; // TODO: e.g. '+79991234567'

  // TODO: Set your brand colors
  const BRAND_COLOR      = '#1a56db'; // primary (blue works well for auto parts)
  const BRAND_COLOR_HOVER= '#1648c0';
  const BRAND_DARK       = '#111111';

  // ─── PROACTIVE MESSAGES ─────────────────────────────────────────────────────
  // TODO: Adjust to match company name and tone
  const PROACTIVE = [
    'Здравствуйте! 👋 Я ИИ-консультант по автозапчастям компании TODO_COMPANY_NAME.',
    'Помогу подобрать запчасть по марке и модели автомобиля, проверить совместимость, рассчитать стоимость и ответить на вопросы по установке.',
  ];

  const QUICK_BUTTONS = [
    '🔍 Подобрать запчасть',
    '📖 Смотреть каталог',
    '🔧 Вопрос по установке',
    '🚗 Проверить совместимость',
  ];

  const TEASER_BUBBLES = [
    'Здравствуйте! Я ИИ-консультант по запчастям 👋',
    'Подберу деталь по вашему авто быстро и точно',
  ];

  // ─── STYLES ─────────────────────────────────────────────────────────────────
  const STYLES = `
    :root {
      --pc-red:        ${BRAND_COLOR};
      --pc-red-hover:  ${BRAND_COLOR_HOVER};
      --pc-dark:       ${BRAND_DARK};
      --pc-panel-w:    440px;
      --pc-panel-w-xl: 720px;
      --pc-shadow:     -8px 0 48px rgba(0,0,0,0.18);
    }

    /* ── Launcher button (fixed bottom-right) ── */
    #pc-launcher {
      position: fixed;
      bottom: 32px;
      right: 32px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: var(--pc-red);
      color: #fff;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 6px 28px rgba(26,86,219,0.45);
      z-index: 999999;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      transition: transform 0.2s, background 0.2s, box-shadow 0.2s;
    }
    #pc-launcher:hover {
      transform: scale(1.08);
      background: var(--pc-red-hover);
      box-shadow: 0 8px 36px rgba(26,86,219,0.55);
    }
    #pc-launcher.pc-panel-open {
      right: calc(var(--pc-panel-w) + 16px);
    }
    #pc-launcher svg { width: 26px; height: 26px; }

    /* Unread badge */
    #pc-badge {
      position: absolute;
      top: -4px; right: -4px;
      background: #ff3a3a;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      width: 20px; height: 20px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      border: 2px solid #fff;
      animation: pc-bounce 0.35s cubic-bezier(.34,1.56,.64,1);
    }
    @keyframes pc-bounce { from{transform:scale(0)} to{transform:scale(1)} }

    /* ── Backdrop (mobile) ── */
    #pc-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.35);
      z-index: 999998;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }
    #pc-backdrop.pc-open { opacity: 1; pointer-events: auto; }

    /* ── Panel ── */
    #pc-panel {
      position: fixed;
      top: 0;
      right: 0;
      width: var(--pc-panel-w);
      height: 100dvh;
      background: #fafafa;
      box-shadow: var(--pc-shadow);
      display: flex;
      flex-direction: column;
      z-index: 999999;
      overflow: hidden;
      transform: translateX(100%);
      transition: transform 0.36s cubic-bezier(0.4, 0, 0.2, 1),
                  width 0.36s cubic-bezier(0.4, 0, 0.2, 1);
    }
    #pc-panel.pc-open { transform: translateX(0); }
    #pc-panel.pc-wide { width: var(--pc-panel-w-xl); }

    /* Mobile: full screen */
    @media (max-width: 540px) {
      #pc-panel {
        width: 100vw !important;
        top: 0 !important;
        padding-top: env(safe-area-inset-top, 0px);
        box-sizing: border-box;
      }
      #pc-backdrop.pc-open { display: block; }
      #pc-launcher.pc-panel-open { display: none !important; }
    }

    /* ── Header ── */
    #pc-header {
      background: var(--pc-dark);
      color: #fff;
      padding: 0 20px;
      height: 64px;
      display: flex;
      align-items: center;
      gap: 14px;
      flex-shrink: 0;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .pc-avatar {
      width: 40px; height: 40px;
      border-radius: 50%;
      background: #ffffff;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px;
      flex-shrink: 0;
      box-shadow: 0 0 0 3px rgba(26,86,219,0.25);
    }
    .pc-header-info { flex: 1; min-width: 0; }
    .pc-header-name {
      font-size: 15px; font-weight: 700; letter-spacing: 0.1px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .pc-header-status {
      font-size: 12px; opacity: 0.65;
      display: flex; align-items: center; gap: 5px; margin-top: 2px;
    }
    .pc-status-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: #22dd55; animation: pc-pulse 2.5s infinite;
    }
    @keyframes pc-pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }

    .pc-header-actions { display: flex; gap: 6px; }
    .pc-header-btn {
      width: 34px; height: 34px; border-radius: 8px; border: none;
      background: rgba(255,255,255,0.1); color: #fff; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; transition: background 0.15s; flex-shrink: 0;
    }
    .pc-header-btn:hover { background: rgba(255,255,255,0.2); }

    /* ── Messages area ── */
    #pc-messages {
      flex: 1; overflow-y: auto; padding: 20px 18px;
      display: flex; flex-direction: column; gap: 14px;
      scroll-behavior: smooth; background: #f5f5f5;
    }
    #pc-messages::-webkit-scrollbar { width: 4px; }
    #pc-messages::-webkit-scrollbar-track { background: transparent; }
    #pc-messages::-webkit-scrollbar-thumb { background: #d0d0d0; border-radius: 4px; }

    /* Date separator */
    .pc-date-sep {
      text-align: center; font-size: 11px; color: #aaa;
      display: flex; align-items: center; gap: 8px;
    }
    .pc-date-sep::before, .pc-date-sep::after {
      content: ''; flex: 1; height: 1px; background: #e0e0e0;
    }

    /* ── Message rows ── */
    .pc-msg { display: flex; gap: 10px; animation: pc-msg-in 0.22s ease; }
    @keyframes pc-msg-in {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .pc-msg-bot  { align-items: flex-start; }
    .pc-msg-user { align-items: flex-end; flex-direction: row-reverse; }

    .pc-msg-icon {
      width: 32px; height: 32px; border-radius: 50%; background: #ffffff;
      color: #fff; display: flex; align-items: center; justify-content: center;
      font-size: 15px; flex-shrink: 0; margin-top: 2px;
    }

    .pc-bubble {
      max-width: 78%; padding: 11px 15px; border-radius: 16px;
      font-size: 14px; line-height: 1.6; color: var(--pc-dark);
    }
    .pc-msg-bot .pc-bubble {
      background: #fff; border-top-left-radius: 4px;
      box-shadow: 0 1px 6px rgba(0,0,0,0.07);
    }
    .pc-msg-user .pc-bubble {
      background: var(--pc-red); color: #fff;
      border-top-right-radius: 4px; max-width: 72%;
    }

    /* Typing indicator */
    .pc-typing { display: flex; gap: 5px; align-items: center; padding: 14px 16px; }
    .pc-typing span {
      width: 7px; height: 7px; border-radius: 50%; background: #c0c0c0;
      animation: pc-dot 1.3s infinite ease-in-out;
    }
    .pc-typing span:nth-child(2) { animation-delay: 0.18s; }
    .pc-typing span:nth-child(3) { animation-delay: 0.36s; }
    @keyframes pc-dot {
      0%,80%,100% { transform: scale(1); background: #c0c0c0; }
      40% { transform: scale(1.5); background: #999; }
    }

    /* ── Quick action buttons ── */
    .pc-buttons-wrap { display: flex; flex-wrap: wrap; gap: 7px; padding: 2px 0; max-width: 100%; }
    .pc-btn {
      padding: 7px 14px; border-radius: 20px; border: 1.5px solid #ddd;
      background: #fff; font-size: 13px; cursor: pointer; color: var(--pc-dark);
      white-space: nowrap; transition: border-color 0.15s, background 0.15s, color 0.15s, transform 0.1s;
      font-family: inherit;
    }
    .pc-btn:hover { border-color: var(--pc-red); background: #f0f4ff; color: var(--pc-red); transform: translateY(-1px); }
    .pc-btn:active { transform: translateY(0); }

    /* ── Manager CTA button ── */
    .pc-manager-btn-wrap { padding: 4px 0; }
    .pc-manager-btn {
      display: inline-flex; align-items: center; gap: 10px;
      padding: 12px 20px; border-radius: 12px;
      background: linear-gradient(135deg, #1a7a1a 0%, #0f5c0f 100%);
      color: #fff; text-decoration: none; font-size: 14px; font-weight: 700;
      box-shadow: 0 4px 18px rgba(15,92,15,0.35);
      transition: transform 0.15s, box-shadow 0.15s, background 0.15s;
      cursor: pointer; border: none; font-family: inherit;
      animation: pc-msg-in 0.22s ease;
    }
    .pc-manager-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 24px rgba(15,92,15,0.45);
      background: linear-gradient(135deg, #1f8f1f 0%, #126612 100%);
    }
    .pc-manager-btn:active { transform: translateY(0); }
    .pc-manager-btn svg { width: 20px; height: 20px; flex-shrink: 0; }
    .pc-manager-btn-label { display: flex; flex-direction: column; }
    .pc-manager-btn-title { font-size: 14px; font-weight: 700; }
    .pc-manager-btn-sub { font-size: 11px; opacity: 0.8; font-weight: 400; }

    /* ── Product carousel ── */
    .pc-carousel-outer { width: 100%; max-width: 100%; }
    .pc-carousel-wrap { overflow: hidden; position: relative; border-radius: 14px; }
    .pc-carousel-track {
      display: flex; gap: 12px; padding: 4px 2px 8px;
      transition: transform 0.32s cubic-bezier(0.4,0,0.2,1);
      will-change: transform; cursor: grab; user-select: none;
    }
    .pc-carousel-track:active { cursor: grabbing; }
    .pc-product-card {
      flex-shrink: 0; width: 195px; background: #fff; border-radius: 14px;
      overflow: hidden; box-shadow: 0 2px 14px rgba(0,0,0,0.09);
      display: flex; flex-direction: column; border: 1px solid #ebebeb;
      transition: transform 0.18s, box-shadow 0.18s;
    }
    .pc-product-card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,0,0.14); }
    .pc-product-img { width: 100%; aspect-ratio: 1; object-fit: cover; background: #efefef; display: block; }
    .pc-product-img-ph {
      width: 100%; aspect-ratio: 1;
      background: linear-gradient(135deg, #eee 0%, #d8d8d8 100%);
      display: flex; align-items: center; justify-content: center;
      font-size: 30px; color: #bbb;
    }
    .pc-product-body { padding: 10px 12px; flex: 1; display: flex; flex-direction: column; gap: 3px; }
    .pc-product-code { font-size: 10px; color: var(--pc-red); font-weight: 800; letter-spacing: 0.6px; text-transform: uppercase; }
    .pc-product-name { font-size: 12px; font-weight: 700; color: var(--pc-dark); line-height: 1.3; }
    .pc-product-meta { font-size: 11px; color: #888; }
    .pc-product-price { font-size: 15px; font-weight: 800; color: var(--pc-dark); margin-top: 4px; }
    .pc-product-stock { font-size: 11px; color: #1a9a40; }
    .pc-product-bestfor { font-size: 11px; color: #999; font-style: italic; margin-top: 2px; }
    .pc-product-link {
      display: block; margin: 8px 10px 10px; padding: 8px;
      background: var(--pc-red); color: #fff; text-align: center;
      border-radius: 9px; font-size: 12px; font-weight: 700; text-decoration: none;
      transition: background 0.15s; letter-spacing: 0.2px;
    }
    .pc-product-link:hover { background: var(--pc-red-hover); }

    /* Carousel navigation */
    .pc-carousel-nav { display: flex; align-items: center; justify-content: space-between; padding: 8px 2px 0; }
    .pc-carousel-dots { display: flex; gap: 5px; }
    .pc-dot-item { width: 6px; height: 6px; border-radius: 50%; background: #d0d0d0; transition: background 0.2s, transform 0.2s; }
    .pc-dot-item.active { background: var(--pc-red); transform: scale(1.3); }
    .pc-carousel-arrows { display: flex; gap: 6px; }
    .pc-carousel-arrow {
      width: 32px; height: 32px; border-radius: 50%; border: 1.5px solid #e0e0e0;
      background: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center;
      font-size: 14px; color: var(--pc-dark); transition: border-color 0.15s, background 0.15s, color 0.15s;
      font-family: inherit;
    }
    .pc-carousel-arrow:hover { border-color: var(--pc-red); color: var(--pc-red); background: #f0f4ff; }
    .pc-carousel-arrow:disabled { opacity: 0.25; cursor: default; }
    .pc-carousel-arrow:disabled:hover { border-color: #e0e0e0; color: var(--pc-dark); background: #fff; }

    /* ── Input area ── */
    #pc-input-area {
      padding: 14px 16px; background: #fff; border-top: 1px solid #eee;
      display: flex; gap: 10px; align-items: flex-end; flex-shrink: 0;
    }
    #pc-input {
      flex: 1; border: 1.5px solid #e5e5e5; border-radius: 22px;
      padding: 10px 18px; font-size: 14px; resize: none; outline: none;
      max-height: 120px; overflow-y: auto; line-height: 1.5; font-family: inherit;
      background: #fafafa; color: var(--pc-dark); transition: border-color 0.2s, background 0.2s;
    }
    #pc-input:focus { border-color: var(--pc-red); background: #fff; }
    #pc-input::placeholder { color: #b0b0b0; }
    #pc-send {
      width: 42px; height: 42px; border-radius: 50%; background: var(--pc-red);
      border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: background 0.15s, transform 0.15s;
    }
    #pc-send:hover { background: var(--pc-red-hover); transform: scale(1.06); }
    #pc-send:disabled { background: #ccc; transform: none; cursor: default; }
    #pc-send svg { width: 18px; height: 18px; color: #ffffff; }

    /* Powered by */
    .pc-powered { text-align: center; font-size: 10px; color: #c0c0c0; padding: 4px 0 9px; background: #fff; letter-spacing: 0.2px; }
    .pc-powered a { color: inherit; text-decoration: none; }

    /* ── Teaser bubbles (pre-open) ── */
    #pc-teasers {
      position: fixed; bottom: 104px; right: 32px;
      display: flex; flex-direction: column; gap: 8px;
      z-index: 999996; align-items: flex-end;
      pointer-events: none;
    }
    .pc-teaser {
      background: #fff; color: #111; font-size: 14px; line-height: 1.45;
      padding: 10px 10px 10px 16px; border-radius: 16px 16px 4px 16px;
      box-shadow: 0 4px 18px rgba(0,0,0,0.13); max-width: 280px; cursor: pointer;
      opacity: 0; transform: translateY(10px);
      transition: opacity 0.35s ease, transform 0.35s ease, box-shadow 0.2s;
      animation: pc-teaser-in 0.35s ease forwards;
      pointer-events: auto;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
      display: flex; align-items: center; gap: 10px;
    }
    .pc-teaser:hover { box-shadow: 0 6px 24px rgba(0,0,0,0.18); }
    .pc-teaser-text { flex: 1; }
    .pc-teaser-x {
      flex-shrink: 0;
      width: 28px; height: 28px; border-radius: 50%;
      background: #e0e0e0; color: #666;
      font-size: 14px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      pointer-events: auto;
      touch-action: manipulation;
      line-height: 1;
    }
    @keyframes pc-teaser-in { to { opacity: 1; transform: translateY(0); } }
  `;

  // ─── SVG ICONS ───────────────────────────────────────────────────────────────
  const ICON_CHAT  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  const ICON_SEND  = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
  const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  const ICON_CLEAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
  const ICON_PHONE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.38 2 2 0 0 1 3.62 1.19h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.69a16 16 0 0 0 6 6l.86-.86a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.04z"/></svg>`;

  // ─── STATE ───────────────────────────────────────────────────────────────────
  let isOpen        = false;
  let isLoading     = false;
  let messages      = [];
  let unreadCount   = 0;
  let lastUserText  = '';

  // Session tracking
  let sessionId           = null;
  let sessionStartPromise = null;
  let sessionStartTime    = null;
  let userMessageCount    = 0;
  let sessionEnded        = false;

  // ─── SESSION: START ──────────────────────────────────────────────────────────
  function startSession() {
    if (sessionStartPromise) return sessionStartPromise;
    sessionStartTime = Date.now();
    sessionStartPromise = (async () => {
      try {
        const res  = await fetch(`${SESSION_URL}/start`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({}),
        });
        const data = await res.json();
        sessionId = data.session_id;
      } catch (e) {
        sessionId = `s_${Date.now()}_local`;
      }
    })();
    return sessionStartPromise;
  }

  // ─── SESSION: END ────────────────────────────────────────────────────────────
  function endSession(useBeacon) {
    if (sessionEnded || userMessageCount === 0) return;
    sessionEnded = true;

    const doEnd = () => {
      if (!sessionId) return;
      const duration = sessionStartTime ? Math.round((Date.now() - sessionStartTime) / 1000) : null;
      const payload = JSON.stringify({
        session_id:       sessionId,
        duration_seconds: duration,
        message_count:    userMessageCount,
      });

      if (useBeacon) {
        navigator.sendBeacon(`${SESSION_URL}/end`, new Blob([payload], { type: 'application/json' }));
      } else {
        fetch(`${SESSION_URL}/end`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    payload,
          keepalive: true,
        }).catch(() => {
          navigator.sendBeacon(`${SESSION_URL}/end`, new Blob([payload], { type: 'application/json' }));
        });
      }
    };

    if (sessionStartPromise) {
      sessionStartPromise.then(doEnd).catch(doEnd);
    } else {
      doEnd();
    }
  }

  // ─── SESSION: MANAGER ────────────────────────────────────────────────────────
  async function triggerManagerHandoff() {
    if (!sessionId) return;
    try {
      await fetch(`${SESSION_URL}/manager`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          session_id: sessionId,
          messages:   messages.slice(-20),
        }),
      });
    } catch (e) {
      console.warn('Manager handoff error:', e);
    }
  }

  // ─── TEASER BUBBLES ──────────────────────────────────────────────────────────
  function showTeasers() {
    if (isOpen) return;
    const container = document.createElement('div');
    container.id = 'pc-teasers';
    TEASER_BUBBLES.forEach((text, i) => {
      setTimeout(() => {
        const bubble = document.createElement('div');
        bubble.className = 'pc-teaser';
        bubble.style.animationDelay = '0ms';

        const textSpan = document.createElement('span');
        textSpan.className = 'pc-teaser-text';
        textSpan.textContent = text;

        const xBtn = document.createElement('span');
        xBtn.className = 'pc-teaser-x';
        xBtn.innerHTML = '✕';

        bubble.appendChild(textSpan);
        bubble.appendChild(xBtn);

        let dismissed = false;
        const dismiss = () => { if (dismissed) return; dismissed = true; bubble.remove(); };
        bubble.addEventListener('touchend', (e) => { e.preventDefault(); dismiss(); }, { passive: false });
        bubble.addEventListener('click', dismiss);
        container.appendChild(bubble);
      }, i * 400);
    });
    document.body.appendChild(container);
  }

  function removeTeasers() {
    const el = document.getElementById('pc-teasers');
    if (el) el.remove();
  }

  // ─── BUILD DOM ───────────────────────────────────────────────────────────────
  function init() {
    const style = document.createElement('style');
    style.textContent = STYLES;
    document.head.appendChild(style);

    const backdrop = document.createElement('div');
    backdrop.id = 'pc-backdrop';
    backdrop.addEventListener('click', close);
    document.body.appendChild(backdrop);

    const launcher = document.createElement('button');
    launcher.id = 'pc-launcher';
    launcher.innerHTML = ICON_CHAT;
    launcher.setAttribute('aria-label', 'Открыть ИИ-консультанта');
    launcher.addEventListener('click', toggle);
    document.body.appendChild(launcher);

    const panel = document.createElement('div');
    panel.id = 'pc-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'ИИ-Консультант по запчастям');
    panel.innerHTML = `
      <div id="pc-header">
        <div class="pc-avatar"><img src="${BASE_URL}/apple-touch-icon.png" style="width:28px;height:28px;object-fit:contain;border-radius:50%;" onerror="this.parentElement.textContent='🚗'"></div>
        <div class="pc-header-info">
          <div class="pc-header-name">ИИ-Консультант</div>
          <div class="pc-header-status">
            <div class="pc-status-dot"></div>
            <span>Онлайн · TODO_COMPANY_NAME</span>
          </div>
        </div>
        <div class="pc-header-actions">
          <button class="pc-header-btn" id="pc-clear" aria-label="Очистить чат" title="Очистить чат">${ICON_CLEAR}</button>
          <button class="pc-header-btn" id="pc-close" aria-label="Закрыть">${ICON_CLOSE}</button>
        </div>
      </div>
      <div id="pc-messages"></div>
      <div id="pc-input-area">
        <textarea id="pc-input" rows="1" placeholder="Напишите марку авто или название запчасти…" aria-label="Сообщение"></textarea>
        <button id="pc-send" aria-label="Отправить">${ICON_SEND}</button>
      </div>
      <div class="pc-powered">Powered by AI · <a href="https://assistant24.tech" target="_blank">ASSISTANT24</a></div>
    `;
    document.body.appendChild(panel);

    document.getElementById('pc-close').addEventListener('click', close);
    document.getElementById('pc-clear').addEventListener('click', clearChat);
    document.getElementById('pc-send').addEventListener('click', sendMessage);

    const input = document.getElementById('pc-input');
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen) close(); });

    window.addEventListener('pagehide', () => endSession(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') endSession(true);
    });

    setTimeout(() => { if (!isOpen) { showTeasers(); showBadge(2); } }, 2000);
  }

  // ─── OPEN / CLOSE / TOGGLE ───────────────────────────────────────────────────
  function toggle() { isOpen ? close() : open(); }

  function open() {
    if (isOpen) return;
    isOpen = true;
    removeTeasers();
    const panel    = document.getElementById('pc-panel');
    const launcher = document.getElementById('pc-launcher');
    const backdrop = document.getElementById('pc-backdrop');
    panel.classList.add('pc-open');
    launcher.classList.add('pc-panel-open');
    backdrop.style.display = 'block';
    requestAnimationFrame(() => backdrop.classList.add('pc-open'));
    clearBadge();
    if (messages.length === 0) {
      addDateSep('Сегодня');
      PROACTIVE.forEach((text, i) => { setTimeout(() => addBotBubble(text), i * 650 + 200); });
      setTimeout(() => addButtonsBubble(QUICK_BUTTONS), PROACTIVE.length * 650 + 500);
    }
    setTimeout(() => document.getElementById('pc-input').focus(), 380);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    document.getElementById('pc-panel').classList.remove('pc-open');
    document.getElementById('pc-launcher').classList.remove('pc-panel-open');
    const backdrop = document.getElementById('pc-backdrop');
    backdrop.classList.remove('pc-open');
    setTimeout(() => { backdrop.style.display = 'none'; }, 300);
    endSession(false);
  }

  function clearChat() {
    endSession();
    messages         = [];
    sessionId        = null;
    sessionStartTime = null;
    userMessageCount = 0;
    sessionEnded     = false;
    sessionStartPromise = null;
    const container = document.getElementById('pc-messages');
    container.innerHTML = '';
    addDateSep('Сегодня');
    PROACTIVE.forEach((text, i) => { setTimeout(() => addBotBubble(text), i * 650 + 200); });
    setTimeout(() => addButtonsBubble(QUICK_BUTTONS), PROACTIVE.length * 650 + 500);
  }

  // ─── BADGE ───────────────────────────────────────────────────────────────────
  function showBadge(n) {
    unreadCount = n;
    let badge = document.getElementById('pc-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'pc-badge';
      document.getElementById('pc-launcher').appendChild(badge);
    }
    badge.textContent = n;
  }
  function clearBadge() {
    unreadCount = 0;
    const b = document.getElementById('pc-badge');
    if (b) b.remove();
  }

  // ─── CAROUSEL WIDTH MANAGEMENT ───────────────────────────────────────────────
  function setWide(on) {
    const panel = document.getElementById('pc-panel');
    if (on) panel.classList.add('pc-wide');
    else panel.classList.remove('pc-wide');
  }

  // ─── RENDER HELPERS ──────────────────────────────────────────────────────────
  function addDateSep(label) {
    const el = document.createElement('div');
    el.className = 'pc-date-sep';
    el.textContent = label;
    appendMsg(el);
  }

  function addBotBubble(text) {
    const el = document.createElement('div');
    el.className = 'pc-msg pc-msg-bot';
    el.innerHTML = `
      <div class="pc-msg-icon"><img src="${BASE_URL}/apple-touch-icon.png" style="width:20px;height:20px;object-fit:contain;border-radius:50%;" onerror="this.parentElement.textContent='🚗'"></div>
      <div class="pc-bubble">${renderMarkdown(text)}</div>
    `;
    appendMsg(el);
  }

  function renderMarkdown(text) {
    return escHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
  }

  function addUserBubble(text) {
    const el = document.createElement('div');
    el.className = 'pc-msg pc-msg-user';
    el.innerHTML = `<div class="pc-bubble">${escHtml(text).replace(/\n/g, '<br>')}</div>`;
    appendMsg(el);
  }

  function addTypingIndicator() {
    const el = document.createElement('div');
    el.className = 'pc-msg pc-msg-bot';
    el.id = 'pc-typing';
    el.innerHTML = `
      <div class="pc-msg-icon"><img src="${BASE_URL}/apple-touch-icon.png" style="width:20px;height:20px;object-fit:contain;border-radius:50%;" onerror="this.parentElement.textContent='🚗'"></div>
      <div class="pc-bubble" style="padding:0;">
        <div class="pc-typing"><span></span><span></span><span></span></div>
      </div>
    `;
    appendMsg(el);
    return el;
  }

  function removeTypingIndicator() {
    const el = document.getElementById('pc-typing');
    if (el) el.remove();
  }

  function addButtonsBubble(buttons) {
    const el   = document.createElement('div');
    el.className = 'pc-msg pc-msg-bot';
    const wrap = document.createElement('div');
    wrap.className = 'pc-buttons-wrap';
    buttons.forEach(label => {
      const btn = document.createElement('button');
      btn.className = 'pc-btn';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        if (label === '🔄 Повторить запрос') {
          doSend(lastUserText);
        } else {
          doSend(label);
        }
      });
      wrap.appendChild(btn);
    });
    el.appendChild(wrap);
    appendMsg(el);
  }

  // ─── MANAGER BUTTON ──────────────────────────────────────────────────────────
  function addManagerButton() {
    const wrap = document.createElement('div');
    wrap.className = 'pc-manager-btn-wrap';

    const btn = document.createElement('a');
    btn.className  = 'pc-manager-btn';
    btn.href       = `tel:${MANAGER_PHONE}`;
    btn.innerHTML  = `
      ${ICON_PHONE}
      <div class="pc-manager-btn-label">
        <span class="pc-manager-btn-title">Связаться с менеджером</span>
        <span class="pc-manager-btn-sub">${MANAGER_PHONE.replace(/(\+7)(\d{3})(\d{3})(\d{2})(\d{2})/, '$1 $2 $3-$4-$5')}</span>
      </div>
    `;

    btn.addEventListener('click', () => {
      endSession(true);
      triggerManagerHandoff();
    });

    wrap.appendChild(btn);
    appendMsg(wrap);
  }

  // ─── PRODUCT CAROUSEL ────────────────────────────────────────────────────────
  function addProductCarousel(products) {
    if (!products || products.length === 0) return;
    setWide(true);

    const el = document.createElement('div');
    el.className = 'pc-msg pc-msg-bot';
    el.style.flexDirection = 'column';
    el.style.alignItems    = 'stretch';

    const outer = document.createElement('div');
    outer.className = 'pc-carousel-outer';

    const wrap  = document.createElement('div');
    wrap.className = 'pc-carousel-wrap';

    const track = document.createElement('div');
    track.className = 'pc-carousel-track';

    const cardW = 207;
    let currentIndex = 0;

    products.forEach(p => {
      if (p.picture) p.picture = p.picture.replace('http://', 'https://');
      if (p.url)     p.url     = p.url.replace('http://', 'https://');

      const card = document.createElement('div');
      card.className = 'pc-product-card';

      // ── Stock label: car parts use unit count, not m² ──
      const stockLabel = (p.stock > 0)
        ? `В наличии: ${p.stock} шт.`
        : '<span style="color:#c00">Под заказ</span>';

      card.innerHTML = `
        ${p.picture
          ? `<img class="pc-product-img" src="${p.picture}" alt="${escHtml(p.article)}" loading="lazy" onerror="this.style.display='none'">`
          : `<div class="pc-product-img-ph">🔩</div>`
        }
        <div class="pc-product-body">
          <div class="pc-product-code">${escHtml(p.article || '')}</div>
          <div class="pc-product-name">${escHtml(p.name || '')}</div>
          <div class="pc-product-meta">${escHtml(p.brand || '')}${p.category ? ' · ' + escHtml(p.category) : ''}</div>
          ${p.compatibility ? `<div class="pc-product-meta">Подходит: ${escHtml(p.compatibility)}</div>` : ''}
          <div class="pc-product-price">${p.price ? Number(p.price).toLocaleString('ru-RU') + ' ₽' : ''}</div>
          <div class="pc-product-stock">${stockLabel}</div>
          ${p.best_for ? `<div class="pc-product-bestfor">${escHtml(p.best_for)}</div>` : ''}
        </div>
        ${p.url ? `<a class="pc-product-link" href="${p.url}" target="_blank" rel="noopener">Подробнее →</a>` : ''}
      `;
      track.appendChild(card);
    });

    wrap.appendChild(track);
    outer.appendChild(wrap);

    const nav     = document.createElement('div');
    nav.className = 'pc-carousel-nav';

    const dotsEl  = document.createElement('div');
    dotsEl.className = 'pc-carousel-dots';
    const dots = products.map((_, i) => {
      const d = document.createElement('div');
      d.className = 'pc-dot-item' + (i === 0 ? ' active' : '');
      d.addEventListener('click', () => { currentIndex = i; update(); });
      dotsEl.appendChild(d);
      return d;
    });

    const arrowsEl = document.createElement('div');
    arrowsEl.className = 'pc-carousel-arrows';

    const prev = document.createElement('button');
    prev.className = 'pc-carousel-arrow';
    prev.innerHTML = '←';
    prev.disabled  = true;

    const next = document.createElement('button');
    next.className = 'pc-carousel-arrow';
    next.innerHTML = '→';
    if (products.length <= 1) next.disabled = true;

    function update() {
      const maxIdx = products.length - 1;
      currentIndex = Math.max(0, Math.min(currentIndex, maxIdx));
      track.style.transform = `translateX(${-currentIndex * cardW}px)`;
      prev.disabled = currentIndex === 0;
      next.disabled = currentIndex >= maxIdx;
      dots.forEach((d, i) => d.classList.toggle('active', i === currentIndex));
    }

    prev.addEventListener('click', () => { currentIndex--; update(); });
    next.addEventListener('click', () => { currentIndex++; update(); });

    arrowsEl.appendChild(prev);
    arrowsEl.appendChild(next);
    nav.appendChild(dotsEl);
    nav.appendChild(arrowsEl);
    outer.appendChild(nav);

    // Swipe
    let dragStartX = 0, isDragging = false;
    track.addEventListener('mousedown', e => { isDragging = true; dragStartX = e.pageX; });
    document.addEventListener('mouseup', e => {
      if (!isDragging) return;
      isDragging = false;
      const dx = e.pageX - dragStartX;
      if (Math.abs(dx) > 40) { dx < 0 ? currentIndex++ : currentIndex--; update(); }
    });
    track.addEventListener('touchstart', e => { dragStartX = e.touches[0].pageX; }, { passive: true });
    track.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].pageX - dragStartX;
      if (Math.abs(dx) > 40) { dx < 0 ? currentIndex++ : currentIndex--; update(); }
    });

    el.appendChild(outer);
    appendMsg(el);
  }

  function appendMsg(el) {
    const c = document.getElementById('pc-messages');
    c.appendChild(el);
    c.scrollTop = c.scrollHeight;
  }

  // ─── PARSE BOT RESPONSE ──────────────────────────────────────────────────────
  function parseBotResponse(raw) {
    let text      = raw;
    let products  = null;
    let buttons   = null;
    let showManager = false;

    const prodMatch = text.match(/<<<PRODUCTS>>>([\s\S]*?)<<<END_PRODUCTS>>>/);
    if (prodMatch) {
      try { products = JSON.parse(prodMatch[1].trim()); } catch(e) {}
      text = text.replace(/<<<PRODUCTS>>>[\s\S]*?<<<END_PRODUCTS>>>/, '').trim();
    }

    const btnMatch = text.match(/<<<BUTTONS>>>([\s\S]*?)<<<END_BUTTONS>>>/);
    if (btnMatch) {
      try { buttons = JSON.parse(btnMatch[1].trim()); } catch(e) {}
      text = text.replace(/<<<BUTTONS>>>[\s\S]*?<<<END_BUTTONS>>>/, '').trim();
    }

    if (text.includes('<<<MANAGER_BUTTON>>>')) {
      showManager = true;
      text = text.replace(/<<<MANAGER_BUTTON>>>/g, '').trim();
    }

    return { text, products, buttons, showManager };
  }

  // ─── SEND ────────────────────────────────────────────────────────────────────
  function sendMessage() {
    const input = document.getElementById('pc-input');
    const text  = input.value.trim();
    if (!text || isLoading) return;
    input.value = '';
    input.style.height = 'auto';
    doSend(text);
  }

  async function doSend(userText) {
    if (isLoading) return;
    lastUserText = userText;
    userMessageCount++;

    addUserBubble(userText);
    messages.push({ role: 'user', content: userText });

    isLoading = true;
    document.getElementById('pc-send').disabled = true;
    addTypingIndicator();
    setWide(false);

    const trimmedMessages = messages.slice(-10);

    const fetchWithRetry = async (retries = 1) => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60000);
        try {
          const res = await fetch(AGENT_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ messages: trimmedMessages }),
            signal:  controller.signal,
          });
          clearTimeout(timer);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res;
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        if (retries > 0) {
          await new Promise(r => setTimeout(r, 1500));
          return fetchWithRetry(retries - 1);
        }
        throw err;
      }
    };

    try {
      const res  = await fetchWithRetry(1);
      const data = await res.json();
      const raw  = data.reply || '';

      removeTypingIndicator();

      const { text, products, buttons, showManager } = parseBotResponse(raw);

      if (!sessionStartPromise) {
        await startSession();
      }

      if (text) {
        addBotBubble(text);
        const cleanedForHistory = raw
          .replace(/<<<PRODUCTS>>>[\s\S]*?<<<END_PRODUCTS>>>/g, '[запчасти показаны]')
          .replace(/<<<BUTTONS>>>[\s\S]*?<<<END_BUTTONS>>>/g, '')
          .replace(/<<<MANAGER_BUTTON>>>/g, '')
          .trim();
        messages.push({ role: 'assistant', content: cleanedForHistory });
      }
      if (products && products.length > 0) addProductCarousel(products);
      if (buttons  && buttons.length  > 0) addButtonsBubble(buttons);
      if (showManager)                      addManagerButton();

    } catch (err) {
      removeTypingIndicator();
      const isTimeout = err.name === 'AbortError' || err.message.includes('abort') || err.message.includes('fetch');
      if (isTimeout) {
        addBotBubble('Соединение медленное, это может занять немного времени. Попробуйте ещё раз 🔄');
      } else {
        addBotBubble('Ошибка соединения. Попробуйте ещё раз 👇');
      }
      addButtonsBubble(['🔄 Повторить запрос']);
      console.error('AutoChat error:', err);
    } finally {
      isLoading = false;
      document.getElementById('pc-send').disabled = false;
      document.getElementById('pc-input').focus();
    }
  }

  // ─── UTILS ───────────────────────────────────────────────────────────────────
  function escHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── KEEP WARM ───────────────────────────────────────────────────────────────
  setInterval(() => {
    fetch(AGENT_URL, { method: 'GET' }).catch(() => {});
  }, 4 * 60 * 1000);

  // ─── PUBLIC API ──────────────────────────────────────────────────────────────
  window.AutoChat = { open, close, toggle };

  // ─── BOOT ────────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
