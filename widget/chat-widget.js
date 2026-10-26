/**
 * chat-widget.js  v3.0  — Full-height slide-out panel
 * AI Chat Widget for BMW Club77 (bmwclub77.ru)
 * Served by this app (Express on Coolify); talks to /api/chat and /api/session/*.
 *
 * Embed on the site (both lines; AGENT_URL is required):
 *   <script>window.AGENT_URL = 'https://bmwclub77.assistant24info.ru';</script>
 *   <script src="https://bmwclub77.assistant24info.ru/widget/chat-widget.js" defer></script>
 *
 * To open programmatically:
 *   window.AutoChat && window.AutoChat.open()
 *
 * Inline mode (homepage, session 24): if the page has an element
 *   <div id="bmw-ai-agent"></div>
 * (ABCP infoblock "page_main", top), the chat is built INTO that element
 * instead of the bottom-right bubble: a compact block (title, input, quick
 * buttons) that turns into the full conversation on the first message.
 * Same chat, history and analytics as the bubble. Without the element
 * (every other page, or if it's removed) the bubble works as before.
 */
(function () {
  'use strict';

  // ─── SINGLE-INIT GUARD ───────────────────────────────────────────────────────
  // The widget script can end up executing more than once on the same page
  // load without a full page reload -- e.g. the host site re-injecting the
  // footer info-block this <script> tag lives in during client-side
  // navigation, or (less likely but possible) the tag being included twice.
  // Each execution is its own independent IIFE closure with its own
  // `isOpen`/`greeted` state, but every closure calls
  // document.getElementById('pc-panel') / ('pc-messages'), which always
  // resolves to the SAME first matching element in the DOM regardless of
  // which closure is asking -- so two unaware-of-each-other init() runs can
  // each append their own copy of the greeting into that one shared node.
  // Confirmed real symptom: two full "Сегодня" blocks stacked in one panel.
  // This guard makes a second (or third...) execution a no-op.
  if (window.__pcWidgetInitialized) return;
  window.__pcWidgetInitialized = true;

  // ─── CONFIG ─────────────────────────────────────────────────────────────────
  // Set by the embed snippet. The fallback is the live server, so a missing
  // AGENT_URL still works instead of calling a placeholder address.
  const BASE_URL    = (window.AGENT_URL || 'https://bmwclub77.assistant24info.ru').replace(/\/+$/, '');
  const AGENT_URL   = BASE_URL + '/api/chat';
  const SESSION_URL = BASE_URL + '/api/session';
  const MANAGER_PHONE = '+79675557555'; // BMW Club77 line (tel: link on the manager button), changed 23.10.2026 at the client's request
  const MANAGER_PHONE_LABEL = '+7 (967) 555-7-555'; // shown under the button, written the way the client writes it

  // BMW Club77 brand colors (BMW's well-known blue palette)
  const BRAND_COLOR      = '#0066b1';
  const BRAND_COLOR_HOVER= '#004e87';
  const BRAND_DARK       = '#111111';

  // ─── PROACTIVE MESSAGES ─────────────────────────────────────────────────────
  // Greeting messages shown when the chat panel first opens.
  const PROACTIVE = [
    'Здравствуйте! 👋 Я ИИ-консультант по автозапчастям компании BMW Club77.',
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

  // ─── INLINE MODE (homepage block, see the header comment) ───────────────────
  const INLINE_HOST_ID   = 'bmw-ai-agent';
  // Hero texts (owner's design, approved 26.10). Earlier: 'Подберём запчасти
  // вместе с ИИ-консультантом' (25.10).
  const INLINE_EYEBROW   = 'ИИ-консультант';
  const INLINE_TITLE_1   = 'Найдём нужные запчасти';  // first line (desktop)
  const INLINE_TITLE_2   = 'для вашего';               // + the accent word
  const INLINE_TITLE_ACCENT = 'BMW';
  const INLINE_TEXT      = 'Опишите, что вам нужно, и ИИ подберёт подходящие детали по VIN, модели или номеру запчасти.';
  // Quick buttons -- the SAME on desktop and phones (owner, 26.10: the
  // phone set has the right commands). Each sends its text as typed. The
  // desktop-only set of 26.10 (По VIN / По модели / По номеру детали / Не знаю
  // номер, sending full sentences) was replaced the same day.
  const INLINE_CHIPS     = ['ТО для моей машины', 'Подбор по VIN', 'Подойдёт ли номер?', 'Где мой заказ?'];
  const INLINE_SEND_LABEL = 'Подобрать с ИИ';
  // "Популярные категории" cards on the homepage (ABCP page_main, 26.10):
  // <a href="<normal catalog link>" data-ai-category="brakes">…</a>.
  // A click opens the chat above with an instant follow-up question
  // (no AI call) and sub-choice buttons; a chosen button goes to the AI as a
  // normal question. Without the inline chat the card stays a plain link.
  const CATEGORY_OTHER_BTN = 'Другое — опишу сам'; // focuses the input instead of sending
  const CATEGORY_VIN_ASK = 'Чтобы подобрать точно для вашей машины, пришлите VIN (17 символов из СТС) или модель — например, X5 G05 30d.';
  const CATEGORIES = {
    brakes:     { name: 'Тормозная система', q: 'Что нужно для тормозной системы?',
                  items: ['Тормозные колодки', 'Тормозные диски', 'Тормозной суппорт', 'Датчик износа колодок', 'Тормозная жидкость', CATEGORY_OTHER_BTN] },
    suspension: { name: 'Подвеска', q: 'Что нужно для подвески?',
                  items: ['Амортизаторы', 'Рычаги', 'Стойки стабилизатора', 'Сайлентблоки', 'Шаровые опоры', 'Пружины', CATEGORY_OTHER_BTN] },
    engine:     { name: 'Двигатель', q: 'Что нужно для двигателя?',
                  items: ['Ремень и ролики', 'Прокладки и сальники', 'Помпа', 'Термостат', 'Опоры двигателя', 'Датчики двигателя', CATEGORY_OTHER_BTN] },
    filters:    { name: 'Фильтры', q: 'Какой фильтр нужен?',
                  items: ['Масляный фильтр', 'Воздушный фильтр', 'Салонный фильтр', 'Топливный фильтр', 'Всё для ТО'] },
    electrics:  { name: 'Электрика', q: 'Что нужно из электрики?',
                  items: ['Свечи зажигания', 'Катушки зажигания', 'Лампы', 'Датчики', 'Генератор и стартер', CATEGORY_OTHER_BTN] },
    body:       { name: 'Кузов', q: 'Что нужно для кузова?',
                  items: ['Бампер', 'Фары и фонари', 'Зеркала', 'Капот и крылья', 'Решётки радиатора', 'Молдинги и накладки', CATEGORY_OTHER_BTN] },
    fluids:     { name: 'Масла и жидкости', q: 'Что нужно из масел и жидкостей?',
                  items: ['Моторное масло', 'Масло АКПП', 'Антифриз', 'Тормозная жидкость', 'Жидкость омывателя'] },
    other:      { name: 'Другие', q: 'Опишите, какая деталь нужна — своими словами или номером детали.', items: [] },
  };
  // Phones (<= 767 px) keep the PREVIOUS dark design (owner, 26.10): its texts.
  // Phones: the owner's design of 26.10 (X5 photo, white text, white search card,
  // blue button). Title in normal case here (uppercase on desktop).
  const INLINE_M_TITLE   = 'Найдём нужные запчасти для вашего';
  const INLINE_M_TEXT    = 'Опишите, что вам нужно, и ИИ подберёт подходящие детали по VIN, модели или номеру запчасти.';
  const INLINE_M_PLACEHOLDER = 'Например: колодки на X5 G05';
  const INLINE_M_SEND_LABEL  = 'Подобрать с ИИ';
  const INLINE_PLACEHOLDER       = 'Например: передние колодки на BMW X5 G05 30d';
  const INLINE_PLACEHOLDER_CHAT  = 'Напишите сообщение…';
  const INLINE_MANAGER_TEXT = 'Менеджер поможет с подбором и заказом. Позвоните по кнопке ниже — или напишите здесь свой телефон, и менеджер перезвонит.';
  // Phones: the agent goes ABOVE the icon row (.benefits-block), so it's on
  // the first screen; from 768 px up it stays where the placeholder is.
  const INLINE_MOBILE_QUERY = '(max-width: 767px)'; // below this: a card in the column, not full width
  // Agent avatar on the homepage block (owner, 25.10): "AI" with a single
  // red slash on black, centered (192 px, repo root). Replaced a version with
  // M-style tricolour stripes (BMW trade dress). The bubble on other pages
  // keeps AI_Agent.png.
  const INLINE_AVATAR_URL = BASE_URL + '/agent-avatar.jpg';
  const INLINE_AVATAR_IMG = `<img src="${INLINE_AVATAR_URL}" alt="" class="pc-avatar-img" onerror="this.parentElement.innerHTML = window.__pcIconAgentFallback;">`;

  // ─── STYLES ─────────────────────────────────────────────────────────────────
  const STYLES = `
    :root {
      --pc-red:        ${BRAND_COLOR};
      --pc-red-hover:  ${BRAND_COLOR_HOVER};
      --pc-dark:       ${BRAND_DARK};
      --pc-panel-w:    440px;
      --pc-panel-w-xl: 720px;
      --pc-shadow:     -8px 0 48px rgba(0,0,0,0.18);
      --pc-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                 "Helvetica Neue", Arial, sans-serif;
      /* Background photo behind the message list. Hosted at the repo
         root (same convention as AI_Agent.png -- see the launcher/avatar
         icons below), referenced via BASE_URL since this widget is loaded
         from a different origin (the client's site) than the file itself.
         If the image 404s, the browser just falls back to the plain
         --pc-messages-bg color already layered beneath it -- no JS/onerror
         needed for a CSS background-image, unlike the <img> icons below. */
      --pc-messages-bg-image: url('${BASE_URL}/chat-bg.jpg');
      --pc-messages-bg: #f5f5f5;
      /* Homepage block background (compact state only), repo root like chat-bg.jpg */
      --pc-hero-bg-image: url('${BASE_URL}/agent-hero-mountains.jpg'); /* light hero, desktop */
      --pc-hero-bg-dark: url('${BASE_URL}/agent-hero-bg.jpg');           /* previous dark design (unused since 26.10) */
      --pc-hero-bg-phone: url('${BASE_URL}/agent-hero-phone.jpg');       /* phones: owner's X5 photo, 1024x1536 */
    }

    /* Explicit font reset — without this the widget silently inherits
       whatever font-family/font-size the host site (bmwclub77.ru) happens
       to set on <body>, which varies site to site and is often small/
       generic. Setting it here, at the widget's root containers, means
       every element inside (including ones that already say
       font-family: inherit, like inputs/buttons) gets this stack instead
       of whatever the host page defines. */
    #pc-launcher, #pc-panel, #pc-backdrop {
      font-family: var(--pc-font);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: optimizeLegibility;
    }
    #pc-launcher *, #pc-panel *, #pc-backdrop * {
      font-family: inherit;
      box-sizing: border-box;
    }

    /* ── Launcher button (fixed bottom-right) ── */
    #pc-launcher {
      position: fixed;
      bottom: 32px;
      right: 32px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: transparent;
      color: #fff;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: none;
      z-index: 999999;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      transition: transform 0.2s;
    }
    #pc-launcher:hover {
      transform: scale(1.08);
    }
    #pc-launcher.pc-panel-open {
      right: calc(var(--pc-panel-w) + 16px);
    }
    #pc-launcher svg { width: 30px; height: 30px; }
    #pc-launcher img { width: 56px; height: 56px; object-fit: contain; display: block; }

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
      scroll-behavior: smooth;
      /* Layered: gradient on top (keeps the light-grey date-separator text
         and scrollbar legible against the photo, and stops the image
         competing with the message bubbles) + photo + solid fallback
         color, in that order. Message bubbles themselves are already
         fully opaque (see .pc-bubble below) so this only ever shows in
         the gaps between them, never behind message text. */
      background-image: linear-gradient(180deg, rgba(20,20,20,0.42) 0%, rgba(20,20,20,0.55) 100%), var(--pc-messages-bg-image);
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      background-color: var(--pc-messages-bg); /* shows through if the image itself 404s */
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
      max-width: 78%; padding: 12px 16px; border-radius: 16px;
      font-size: 15px; line-height: 1.65; color: var(--pc-dark);
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
    .pc-typing-wrap { display: flex; align-items: center; gap: 10px; padding: 14px 16px; }
    .pc-typing { display: flex; gap: 5px; align-items: center; flex-shrink: 0; }
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
    /* Status text only appears once the request has been running a while
       (see startTypingStatus) -- fades in so it doesn't flash on fast
       replies, and fades between messages rather than hard-cutting. */
    .pc-typing-status {
      font-size: 13px; color: #999; opacity: 0;
      transition: opacity 0.3s ease;
      white-space: nowrap;
    }
    .pc-typing-status.pc-visible { opacity: 1; }

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

    /* ── Part page button (customer typed a part number) ── */
    .pc-partlink-wrap { padding: 4px 0; display: flex; flex-wrap: wrap; gap: 8px; }
    .pc-partlink-btn {
      display: inline-flex; align-items: center; gap: 10px;
      padding: 12px 18px; border-radius: 12px;
      background: var(--pc-red); color: #fff; text-decoration: none;
      font-size: 14px; font-weight: 700; font-family: inherit;
      box-shadow: 0 4px 16px rgba(0,0,0,0.18);
      transition: transform 0.15s, box-shadow 0.15s, filter 0.15s;
      animation: pc-msg-in 0.22s ease;
    }
    .pc-partlink-btn:hover { transform: translateY(-2px); filter: brightness(1.08); box-shadow: 0 6px 22px rgba(0,0,0,0.25); }
    .pc-partlink-btn:active { transform: translateY(0); }
    .pc-partlink-label { display: flex; flex-direction: column; }
    .pc-partlink-sub { font-size: 11px; opacity: 0.85; font-weight: 400; }

    /* ── Unit diagram (catalog part without a product photo) ── */
    .pc-diagram { background: #fff; border-radius: 14px; padding: 10px; max-width: 340px; box-shadow: 0 2px 12px rgba(0,0,0,0.12); animation: pc-msg-in 0.22s ease; color: #222; }
    .pc-diagram-title { font-size: 12px; font-weight: 700; color: #555; margin: 0 2px 6px; }
    .pc-diagram-frame { position: relative; display: block; cursor: zoom-in; line-height: 0; border-radius: 8px; overflow: hidden; background: #fff; }
    .pc-diagram-frame img { width: 100%; height: auto; display: block; }
    .pc-diagram-mark { position: absolute; border: 2px solid #e30613; border-radius: 4px; background: rgba(227,6,19,0.18); box-shadow: 0 0 0 3px rgba(227,6,19,0.25); pointer-events: none; display: none; }
    .pc-diagram-caption { font-size: 13px; margin: 8px 2px 0; line-height: 1.4; }
    .pc-diagram-caption b { color: #111; }
    .pc-diagram-note { font-size: 11px; color: #888; margin: 4px 2px 0; }
    .pc-kit { margin: 8px 0 2px; border-top: 1px solid #eee; padding-top: 6px; }
    .pc-kit-title { font-size: 12px; font-weight: 700; color: #333; margin: 0 2px 4px; }
    .pc-kit-row { display: flex; gap: 6px; align-items: baseline; padding: 4px 2px; border-bottom: 1px solid #f2f2f2; text-decoration: none; color: #222; font-size: 12px; line-height: 1.3; }
    .pc-kit-row:hover { background: #f7f9fc; }
    .pc-kit-pos { flex: 0 0 18px; color: #c00; font-weight: 700; text-align: right; }
    .pc-kit-name { flex: 1 1 auto; min-width: 0; }
    .pc-kit-price { flex: 0 0 auto; text-align: right; white-space: nowrap; font-weight: 600; }
    .pc-kit-sub { display: block; font-size: 10px; font-weight: 400; color: #888; }
    .pc-kit-name .pc-kit-sub { display: inline; }

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
      padding: 14px 16px; background: var(--pc-dark); border-top: 1px solid rgba(255,255,255,0.08);
      display: flex; gap: 10px; align-items: flex-end; flex-shrink: 0;
    }
    #pc-input {
      flex: 1; border: 1.5px solid rgba(255,255,255,0.14); border-radius: 22px;
      padding: 10px 18px; font-size: 15px; resize: none; outline: none;
      max-height: 120px; overflow-y: hidden; line-height: 1.55; font-family: inherit;
      background: #fff; color: var(--pc-dark); transition: border-color 0.2s, background 0.2s;
    }
    #pc-input:focus { border-color: var(--pc-red); background: #fff; }
    /* One line only: a wrapped placeholder in a one-row box got its first
       line pushed out of view, with a scrollbar (seen on narrow widths). */
    #pc-input::placeholder { color: #999; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #pc-send {
      width: 42px; height: 42px; border-radius: 50%; background: var(--pc-red);
      border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: background 0.15s, transform 0.15s;
    }
    #pc-send:hover { background: var(--pc-red-hover); transform: scale(1.06); }
    #pc-send:disabled { background: #555; transform: none; cursor: default; }
    #pc-send svg { width: 18px; height: 18px; color: #ffffff; }

    /* Powered by */
    .pc-powered { text-align: center; font-size: 10px; color: #999; padding: 4px 0 9px; background: var(--pc-dark); letter-spacing: 0.2px; }
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

    /* ── Inline mode: the agent built into the homepage (#bmw-ai-agent) ── */
    .pc-has-inline #pc-launcher, .pc-has-inline #pc-teasers { display: none !important; }
    #pc-panel.pc-inline {
      position: relative; top: auto; right: auto; transform: none; transition: none;
      width: 100% !important; height: auto;
      /* 0 here (cancels the phone panel's safe-area padding) -- NOT !important:
         that blocked the hero's own top padding (live 26.10: the label sat
         ~12 px from the top edge whatever padding was set) */
      padding-top: 0;
      background: #fff; border: 1px solid #e0e0e0; border-radius: 10px;
      box-shadow: none; z-index: auto; margin: 16px 0 40px; text-align: left;
    }
    #pc-panel.pc-inline #pc-header {
      background: #fff; color: var(--pc-dark); height: 60px;
      border-bottom: 1px solid #ececec; border-radius: 10px 10px 0 0;
    }
    /* Square avatar with rounded corners (owner, 25.10: suits the wide logo) */
    #pc-panel.pc-inline .pc-avatar, #pc-panel.pc-inline .pc-msg-icon, .pc-hero-icon {
      background: #1a1a1a; box-shadow: none; overflow: hidden;
    }
    #pc-panel.pc-inline .pc-avatar { border-radius: 8px; }
    #pc-panel.pc-inline .pc-msg-icon { border-radius: 6px; }
    #pc-panel .pc-avatar-img { width: 100%; height: 100%; object-fit: cover; display: block; }
    #pc-panel.pc-inline #pc-clear, #pc-panel.pc-inline #pc-close { display: none; }
    .pc-inline-btn { display: none; }
    #pc-panel.pc-inline .pc-inline-btn {
      display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 12px;
      border: 1px solid #d6d6d6; border-radius: 8px; background: #fff; color: #33373d;
      font-size: 13px; cursor: pointer; white-space: nowrap;
    }
    #pc-panel.pc-inline .pc-inline-btn:hover { border-color: var(--pc-red); color: var(--pc-red); }
    #pc-panel.pc-inline .pc-inline-btn svg { width: 16px; height: 16px; flex-shrink: 0; }
    #pc-panel.pc-inline #pc-messages {
      flex: none; height: clamp(320px, calc(100vh - 240px), 640px);
      background-image: none; background-color: #f7f9fc;
    }
    #pc-panel.pc-inline #pc-input-area {
      background: #fff; border-top: 1px solid #ececec; padding: 14px 16px; align-items: stretch;
    }
    #pc-panel.pc-inline #pc-input {
      border: 2px solid var(--pc-red); border-radius: 10px; padding: 13px 16px; font-size: 16px;
    }
    #pc-send .pc-send-label { display: none; }
    #pc-panel.pc-inline #pc-send {
      width: auto; height: auto; min-height: 52px; border-radius: 10px; padding: 0 22px; gap: 8px;
      color: #fff; font-size: 15px; font-weight: 700;
    }
    #pc-panel.pc-inline #pc-send:hover { transform: none; }
    #pc-panel.pc-inline #pc-send .pc-send-label { display: inline; }
    #pc-panel.pc-inline .pc-powered { background: #fff; border-radius: 0 0 10px 10px; }

    /* ── Compact state = the homepage hero (owner's design, approved 26.10) ──
       Light: the owner's mountain photo (agent-hero-mountains.jpg, 1872x576,
       car on the right) behind a white fade on the left; dark text, blue
       accents. Desktop (>= 768 px): full window width (.pc-bleed; JS sets
       --pc-page-w and --pc-col-left from the placeholder's column) with the
       content aligned to the site's column. Phones: a card with the photo as
       a band on top -- replaced 26.10 by the previous dark design on phones
       (see the <= 767 px block below). */
    #pc-hero, #pc-hero-m, #pc-chips, #pc-chips-m, #pc-hero-note { display: none; }
    #pc-panel.pc-compact #pc-header, #pc-panel.pc-compact #pc-messages { display: none; }
    /* Desktop and large tablets (>= 768 px): the light hero */
    @media (min-width: 768px) {
      #pc-panel.pc-inline.pc-compact {
        --pc-hero-accent: #0a5cc4;
        background-color: #e9eff5;
        background-image:
          linear-gradient(90deg, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.88) 40%, rgba(255,255,255,0.35) 56%, rgba(255,255,255,0) 66%),
          var(--pc-hero-bg-image);
        background-size: 100% 100%, cover;
        background-position: 0 0, right 70%;
        background-repeat: no-repeat;
        border: 1px solid #e3e8ef;
        min-height: 400px; justify-content: center; padding: 36px 0;
      }
      @media (min-width: 768px) {
        #pc-panel.pc-inline.pc-compact.pc-bleed {
          width: var(--pc-page-w) !important; margin-left: calc(-1 * var(--pc-col-left));
          border-radius: 0; border-left: none; border-right: none;
          min-height: 500px; /* owner, 26.10 (was 440); a minimum, so a wrapped title never gets cut */
          /* more room at the top: the hero now starts right under the header
             and the search tab hangs ~35 px into it (owner, 26.10) */
          padding-top: 64px; padding-bottom: 40px;
        }
      }
      #pc-panel.pc-compact #pc-hero {
        display: block; padding: 0 28px 0 var(--pc-text-left, calc(var(--pc-col-left, 0px) + 28px));
        max-width: calc(var(--pc-text-left, calc(var(--pc-col-left, 0px) + 28px)) + 672px);
      }
      #pc-panel .pc-hero-eyebrow {
        display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
        color: var(--pc-hero-accent); font-family: Montserrat, var(--pc-font);
        font-weight: 700; font-size: 14px; letter-spacing: 1px; text-transform: uppercase;
      }
      .pc-hero-eyebrow svg { width: 20px; height: 20px; flex-shrink: 0; }
      #pc-panel .pc-hero-title {
        margin: 0; font-family: Montserrat, var(--pc-font); font-size: 42px; font-weight: 800;
        line-height: 1.15; color: #0f2440; text-transform: uppercase; letter-spacing: 0.5px; /* owner, 26.10 */
      }
      .pc-hero-title .pc-accent { color: var(--pc-hero-accent); }
      .pc-hero-text { margin: 14px 0 0; font-size: 17px; line-height: 1.5; color: #33404f; max-width: 520px; }
      #pc-panel.pc-compact #pc-input-area {
        /* wider than the title, as in the owner's design (26.10; was 600 px):
           the full placeholder fits; at most 60% of the window, clear of the car */
        margin: 22px 28px 0 var(--pc-text-left, calc(var(--pc-col-left, 0px) + 28px)); max-width: min(820px, 60vw);
        padding: 6px; gap: 6px; align-items: center;
        background: #fff; border: 1.5px solid #c7d6ea; border-radius: 12px;
        box-shadow: 0 6px 24px rgba(15,36,64,0.10);
      }
      #pc-panel.pc-compact #pc-input-area:focus-within { border-color: var(--pc-hero-accent); }
      #pc-panel.pc-compact #pc-input {
        border: none; border-radius: 8px; padding: 13px 12px 13px 40px; font-size: 16px;
        background: transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b7480' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='M20 20l-4-4'/%3E%3C/svg%3E") no-repeat 12px center / 20px 20px;
      }
      #pc-panel.pc-compact #pc-send { background: var(--pc-hero-accent); min-height: 50px; border-radius: 9px; }
      #pc-panel.pc-compact #pc-send:hover { background: #084a9e; }
      #pc-panel.pc-compact #pc-send:focus-visible { outline: 2px solid var(--pc-hero-accent); outline-offset: 2px; }
      #pc-panel.pc-compact #pc-chips {
        display: flex; flex-wrap: wrap; gap: 10px; padding: 18px 28px 0 var(--pc-text-left, calc(var(--pc-col-left, 0px) + 28px));
      }
      #pc-panel .pc-chip {
        min-height: 44px; padding: 0 20px; border-radius: 10px; border: 1px solid #d3dce8;
        background: #fff; color: #1d2b3c; font-size: 14px; font-weight: 500; cursor: pointer;
        box-shadow: 0 2px 8px rgba(15,36,64,0.06); transition: border-color 0.15s, color 0.15s;
      }
      #pc-panel .pc-chip:hover { border-color: var(--pc-hero-accent); color: var(--pc-hero-accent); }
      #pc-panel.pc-compact #pc-hero-note {
        display: block; padding: 16px 28px 0 var(--pc-text-left, calc(var(--pc-col-left, 0px) + 28px)); font-size: 13px; color: #4a5565;
      }
      #pc-hero-note button {
        border: none; background: none; padding: 0; color: var(--pc-hero-accent, #0a5cc4); font-size: inherit;
        text-decoration: underline; cursor: pointer;
      }
      #pc-panel.pc-inline.pc-compact .pc-powered {
        background: transparent; text-align: left; font-size: 11px; color: #5b6573;
        padding: 4px 28px 0 var(--pc-text-left, calc(var(--pc-col-left, 0px) + 28px));
      }
      #pc-panel.pc-inline.pc-compact .pc-powered a { color: var(--pc-hero-accent); }
      #pc-panel.pc-inline.pc-compact .pc-powered a:hover { text-decoration: underline; }
    }

    /* ── Phones and small tablets (<= 767 px): the owner's phone design (26.10,
       board 9 on the design canvas). Edge to edge, the X5 photo
       (agent-hero-phone.jpg, portrait 1024x1536) with a dark fade at the top
       for the white text and at the bottom for the buttons; the car shows
       between the text and the white search card. The ABCP icon row below
       (.benefits-block) overlaps the bottom as a white panel -- that part is
       in page_main. The chat itself (after the first message) is unchanged. */
    @media (max-width: 767px) {
      #pc-panel.pc-inline.pc-compact {
        width: 100vw !important; margin: 0 calc(50% - 50vw); box-sizing: border-box;
        border: none; border-radius: 0; padding: 24px 16px 46px;
        background-color: #0f1926;
        background-image:
          linear-gradient(180deg, rgba(9,24,44,0.82) 0%, rgba(9,24,44,0.55) 24%, rgba(9,24,44,0) 38%, rgba(9,24,44,0) 56%, rgba(9,24,44,0.6) 62%, #0f1926 70%),
          var(--pc-hero-bg-phone);
        background-size: 100% 100%, 136% auto;
        background-position: 0 0, 79% -150px;
        background-repeat: no-repeat;
      }
      #pc-panel.pc-compact #pc-hero-m { display: block; min-height: 446px; } /* the car shows below the text; the card starts under it */
      .pc-hm-eyebrow {
        display: flex; align-items: center; gap: 10px; color: #fff;
        font-family: 'BC Exo 2', Montserrat, var(--pc-font); font-weight: 700; font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase;
      }
      #pc-hero-m .pc-hero-icon { width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0; display: flex; }
      .pc-hm-title { margin: 14px 0 0; font-size: 30px; font-weight: 800; line-height: 1.12; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.35); }
      .pc-hm-title .pc-accent { color: #7cc0ff; }
      .pc-hm-text { margin: 10px 0 0; font-size: 15px; line-height: 1.45; color: rgba(255,255,255,0.92); text-shadow: 0 1px 2px rgba(0,0,0,0.45); }
      /* the white search card */
      #pc-panel.pc-inline.pc-compact #pc-input-area {
        flex-direction: column; gap: 10px; padding: 12px; border: none; border-radius: 14px;
        background: #fff; box-shadow: 0 10px 30px rgba(0,0,0,0.25);
      }
      #pc-panel.pc-inline.pc-compact #pc-input { border: 1.5px solid #c7d6ea; border-radius: 10px; padding: 13px 14px; font-size: 16px; }
      #pc-panel.pc-inline.pc-compact #pc-input:focus { border-color: #0a5cc4; }
      #pc-panel.pc-inline.pc-compact #pc-send {
        width: 100%; min-height: 50px; padding: 0 16px; justify-content: center; border-radius: 10px;
        background: #0a5cc4; font-family: 'BC Exo 2', Montserrat, var(--pc-font); font-size: 16px;
      }
      #pc-panel.pc-inline.pc-compact #pc-send:hover { background: #084a9e; }
      #pc-panel.pc-inline.pc-compact #pc-send:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
      #pc-panel.pc-inline.pc-compact #pc-send .pc-send-label { display: inline; }
      /* quick buttons: the same four as on desktop, 2 x 2 */
      #pc-panel.pc-compact #pc-chips-m { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
      #pc-panel .pc-chip {
        min-height: 44px; padding: 0 8px; border-radius: 10px; border: none;
        background: rgba(255,255,255,0.95); color: #1d2b3c; font-size: 13px; font-weight: 500; cursor: pointer;
      }
      #pc-panel .pc-chip:hover { background: #fff; color: #0a5cc4; }
      #pc-panel.pc-compact #pc-hero-note { display: block; margin-top: 12px; font-size: 12px; line-height: 1.5; color: rgba(255,255,255,0.88); }
      #pc-hero-note button { border: none; background: none; padding: 0; color: #9cc9ff; font-size: inherit; text-decoration: underline; cursor: pointer; }
      #pc-panel.pc-inline.pc-compact .pc-powered { background: transparent; text-align: left; padding: 0; font-size: 12px; color: rgba(255,255,255,0.88); }
      #pc-panel.pc-inline.pc-compact .pc-powered a { color: #9cc9ff; }
      /* small tablets: the photo larger, car still between text and card */
      @media (min-width: 541px) {
        #pc-panel.pc-inline.pc-compact { background-size: 100% 100%, 800px auto; background-position: 0 0, center -400px; }
      }
    }

    /* Full screen ("Во весь экран") */
    #pc-panel.pc-inline.pc-full {
      position: fixed; inset: 0; width: 100vw !important; height: 100dvh;
      margin: 0; border: none; border-radius: 0; z-index: 999999;
    }
    #pc-panel.pc-inline.pc-full #pc-messages { flex: 1; height: auto; }
    #pc-panel.pc-inline.pc-full #pc-header, #pc-panel.pc-inline.pc-full .pc-powered { border-radius: 0; }

    @media (max-width: 540px) {
      #pc-panel.pc-inline .pc-inline-btn-text, #pc-panel.pc-inline .pc-header-status { display: none; }
      #pc-panel.pc-inline #pc-header { padding: 0 12px; }
      #pc-panel.pc-inline #pc-send { width: 52px; padding: 0; justify-content: center; }
      #pc-panel.pc-inline #pc-send .pc-send-label { display: none; }
    }
    /* ── Headings font: Exo 2 (owner, 26.10) ── self-hosted in fonts/ (SIL OFL),
       served with CORS by server.js. Same family name 'BC Exo 2' is declared
       in the ABCP infoblock page_main for "Подбирайте по каталогам*:". */
    @font-face { font-family: 'BC Exo 2'; font-style: normal; font-weight: 700; font-display: swap;
      src: url('${BASE_URL}/fonts/exo-2-cyrillic-700-normal.woff2') format('woff2'); unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
    @font-face { font-family: 'BC Exo 2'; font-style: normal; font-weight: 700; font-display: swap;
      src: url('${BASE_URL}/fonts/exo-2-latin-700-normal.woff2') format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
    @font-face { font-family: 'BC Exo 2'; font-style: normal; font-weight: 800; font-display: swap;
      src: url('${BASE_URL}/fonts/exo-2-cyrillic-800-normal.woff2') format('woff2'); unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
    @font-face { font-family: 'BC Exo 2'; font-style: normal; font-weight: 800; font-display: swap;
      src: url('${BASE_URL}/fonts/exo-2-latin-800-normal.woff2') format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
    #pc-panel .pc-hero-title, #pc-panel .pc-hm-title { font-family: 'BC Exo 2', Montserrat, var(--pc-font); }
  `;

  // ─── SVG ICONS ───────────────────────────────────────────────────────────────
  const ICON_CHAT  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  // Friendly support-agent icon (headset + face) used for the launcher button.
  const ICON_AGENT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="10" r="6.3"/><path d="M8.6 9.6c.5.5 1.3.8 2.1.8s1.6-.3 2.1-.8"/><path d="M8.8 8.4c.15-.3.35-.3.5 0"/><path d="M14.7 8.4c.15-.3.35-.3.5 0"/><path d="M6 9.5V9a6 6 0 0 1 12 0v.5"/><path d="M5.7 9.8h.9a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-.9a1.3 1.3 0 0 1-1.3-1.3v-1.4A1.3 1.3 0 0 1 5.7 9.8z"/><path d="M18.3 9.8h-.9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h.9a1.3 1.3 0 0 0 1.3-1.3v-1.4a1.3 1.3 0 0 0-1.3-1.3z"/><path d="M18.3 13.8v1a3 3 0 0 1-3 3h-1.8"/></svg>`;
  const ICON_SEND  = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
  const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  const ICON_CLEAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
  const ICON_EXPAND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/></svg>`;
  const ICON_SHRINK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10h-6V4M14 10l7-7M4 14h6v6M10 14l-7 7"/></svg>`;
  const ICON_SPARK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z"/></svg>`;
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
  // Set once the phone/email auto-handoff has fired for this session, so
  // mentioning contact info again later in the same conversation doesn't
  // create a second Bitrix lead / re-run the summary.
  let managerAutoTriggered = false;
  // Set once the proactive greeting (PROACTIVE bubbles + quick buttons) has
  // been shown for this session. Deliberately separate from `messages`
  // (the API-facing conversation) -- the greeting is canned UI text, never
  // sent to Claude, so `messages` stays empty if a customer opens the
  // widget, reads the greeting, and closes without typing anything. Using
  // `messages.length` to decide both "should I restore?" and "should I
  // greet again?" meant that exact (very common) case was indistinguishable
  // from a genuinely fresh session, so the greeting repeated every reopen.
  let greeted = false;

  // Inline mode (see INLINE MODE above): the #bmw-ai-agent element, if any.
  let inlineHost   = null;
  let inlineFull   = false;

  // ─── PERSISTENCE ─────────────────────────────────────────────────────────────
  // Fixes: clicking a product's "Подробнее" link opens a NEW TAB
  // (target="_blank" -- intentional, so customers don't lose the chat by
  // navigating away entirely). sessionStorage is scoped per-tab and is
  // NEVER shared with a newly opened tab even on the same origin -- so an
  // earlier attempt using sessionStorage looked like it did nothing,
  // because there was genuinely no prior state for the new tab to see.
  // localStorage IS shared across all tabs of the same origin, which is
  // what's actually needed here. Tradeoff: localStorage doesn't auto-clear
  // when a tab closes, so we track our own expiry (EXPIRY_MS) and treat
  // anything older as stale rather than resurrecting an old conversation
  // days later.
  //
  // displayLog mirrors what's rendered on screen (separately from
  // `messages`, which stores the API-facing conversation history with
  // products/buttons collapsed to placeholder text) so a restore can
  // faithfully rebuild product carousels and button groups, not just text.
  const STORAGE_KEY = 'pc_chat_state_v2';
  const EXPIRY_MS    = 45 * 60 * 1000; // 45 minutes of inactivity -- matches typical "session" semantics
  let displayLog = []; // [{type: 'dateSep'|'bot'|'user'|'products'|'buttons'|'manager'|'partlinks'|'diagram', payload}]

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        sessionId, sessionStartTime, userMessageCount, sessionEnded,
        messages, displayLog, managerAutoTriggered, greeted,
        lastActivityAt: Date.now(),
      }));
    } catch (e) {
      // localStorage can throw in some private-browsing modes -- fine to
      // just skip persistence rather than break the chat over it.
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() - (parsed.lastActivityAt || 0) > EXPIRY_MS) {
        localStorage.removeItem(STORAGE_KEY); // stale -- don't resurrect an old conversation
        return null;
      }
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function clearPersistedState() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  function replayDisplayLog(log) {
    log.forEach(entry => {
      switch (entry.type) {
        case 'dateSep':  addDateSep(entry.payload); break;
        case 'bot':      addBotBubble(entry.payload); break;
        case 'user':     addUserBubble(entry.payload); break;
        case 'products': addProductCarousel(entry.payload); break;
        case 'buttons':  addButtonsBubble(entry.payload); break;
        case 'manager':  addManagerButton(); break;
        case 'partlinks': addPartLinks(entry.payload); break;
        case 'diaglink': addDiagramLink(entry.payload); break;
        case 'diagram':  addDiagram(entry.payload); break;
      }
    });
  }

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
        navigator.sendBeacon(`${SESSION_URL}/end`, new Blob([payload], { type: 'text/plain' }));
      } else {
        fetch(`${SESSION_URL}/end`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    payload,
          keepalive: true,
        }).catch(() => {
          navigator.sendBeacon(`${SESSION_URL}/end`, new Blob([payload], { type: 'text/plain' }));
        });
      }
    };

    if (sessionStartPromise) {
      sessionStartPromise.then(doEnd).catch(doEnd);
    } else {
      doEnd();
    }
  }

  // ─── SESSION: EVENTS (dashboard "Подбор" tab) ───────────────────────────────
  // first message / product cards shown / product card opened -- see
  // api/session/event.js. Fire-and-forget: analytics must never affect the
  // chat. Card clicks use sendBeacon because the click opens a new tab.
  function logEvent(type, data, useBeacon) {
    if (!sessionId) return;
    try {
      const payload = JSON.stringify({ session_id: sessionId, type, data });
      if (useBeacon && navigator.sendBeacon) {
        // text/plain on purpose: an application/json beacon needs a CORS
        // preflight that fails for credentialed requests -> silently dropped.
        navigator.sendBeacon(`${SESSION_URL}/event`, new Blob([payload], { type: 'text/plain' }));
      } else {
        fetch(`${SESSION_URL}/event`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true,
        }).catch(() => {});
      }
    } catch (e) { /* ignore */ }
  }

  const cardInfo = p => ({ article: p.article, name: p.name, brand: p.brand, price: p.price, url: p.url });

  // ─── SESSION: MANAGER ────────────────────────────────────────────────────────
  async function triggerManagerHandoff() {
    if (!sessionId) return;
    try {
      const res = await fetch(`${SESSION_URL}/manager`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          session_id: sessionId,
          messages:   messages.slice(-20),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        addBotBubble('Спасибо! Ваша заявка передана специалисту — он свяжется с вами в ближайшее время.');
      } else {
        addBotBubble('Заявка принята. Если срочно — позвоните нам напрямую по кнопке выше.');
      }
    } catch (e) {
      console.warn('Manager handoff error:', e);
      addBotBubble('Заявка принята. Если срочно — позвоните нам напрямую по кнопке выше.');
    }
  }

  // ─── TEASER BUBBLES ──────────────────────────────────────────────────────────
  // Shown once per VISIT: when the visitor comes to the site after being away
  // for more than TEASER_IDLE_MINUTES. Within a visit they stay hidden -- so
  // product pages opened from cards (new tabs) don't show them again, which
  // was irritating on mobile. "Last seen on the site" is refreshed on every
  // page load, every minute while a page is visible, and on leaving a page.
  // (Oct 19: first "once per 7 days" -- too rare; owner asked for 30 min.)
  const LAST_SEEN_KEY = 'pc_last_seen_at';
  const TEASER_IDLE_MINUTES = 30;

  const isNewVisit = (() => {
    try {
      const last = Number(localStorage.getItem(LAST_SEEN_KEY) || 0);
      return !last || Date.now() - last > TEASER_IDLE_MINUTES * 60 * 1000;
    } catch (e) {
      return false; // storage blocked (private mode): don't risk showing them on every page
    }
  })();

  function touchLastSeen() {
    try { localStorage.setItem(LAST_SEEN_KEY, String(Date.now())); } catch (e) {}
  }
  touchLastSeen();
  setInterval(() => { if (document.visibilityState === 'visible') touchLastSeen(); }, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') touchLastSeen(); });
  window.addEventListener('pagehide', touchLastSeen);

  function teasersAllowed() {
    return isNewVisit;
  }

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
    // Uses the client-provided AI_Agent.png (site root), same icon used in
    // the header avatar and per-message icons; falls back to the inline
    // headset SVG if the file is missing or fails to load.
    window.__pcIconAgentFallback = ICON_AGENT; // used by the inline onerror string below (runs in global scope, can't see closure vars)
    launcher.innerHTML = `<img src="${BASE_URL}/AI_Agent.png" alt="" onerror="this.parentElement.innerHTML = window.__pcIconAgentFallback;">`;
    launcher.setAttribute('aria-label', 'Открыть ИИ-консультанта');
    launcher.addEventListener('click', toggle);
    document.body.appendChild(launcher);

    const panel = document.createElement('div');
    panel.id = 'pc-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'ИИ-Консультант по запчастям');
    panel.innerHTML = `
      <div id="pc-header">
        <div class="pc-avatar"><img src="${BASE_URL}/AI_Agent.png" style="width:28px;height:28px;object-fit:contain;border-radius:50%;" onerror="this.parentElement.textContent='🚗'"></div>
        <div class="pc-header-info">
          <div class="pc-header-name">ИИ-Консультант</div>
          <div class="pc-header-status">
            <div class="pc-status-dot"></div>
            <span>Онлайн · BMW Club77</span>
          </div>
        </div>
        <div class="pc-header-actions">
          <button class="pc-header-btn" id="pc-clear" aria-label="Очистить чат" title="Очистить чат">${ICON_CLEAR}</button>
          <button class="pc-header-btn" id="pc-close" aria-label="Закрыть">${ICON_CLOSE}</button>
          <button class="pc-inline-btn" id="pc-restart" type="button" title="Начать заново" aria-label="Начать заново">${ICON_CLEAR}<span class="pc-inline-btn-text">Начать заново</span></button>
          <button class="pc-inline-btn" id="pc-full" type="button" title="Во весь экран" aria-label="Во весь экран" aria-pressed="false">${ICON_EXPAND}<span class="pc-inline-btn-text">Во весь экран</span></button>
        </div>
      </div>
      <div id="pc-hero">
        <div class="pc-hero-eyebrow">${ICON_SPARK}${escHtml(INLINE_EYEBROW)}</div>
        <h2 class="pc-hero-title">${escHtml(INLINE_TITLE_1)}<br class="pc-hero-br"> ${escHtml(INLINE_TITLE_2)} <span class="pc-accent">${escHtml(INLINE_TITLE_ACCENT)}</span></h2>
        <p class="pc-hero-text">${escHtml(INLINE_TEXT)}</p>
      </div>
      <div id="pc-hero-m">
        <div class="pc-hm-eyebrow"><span class="pc-hero-icon">${INLINE_AVATAR_IMG}</span>${escHtml(INLINE_EYEBROW)}</div>
        <h2 class="pc-hm-title">${escHtml(INLINE_M_TITLE)} <span class="pc-accent">${escHtml(INLINE_TITLE_ACCENT)}</span></h2>
        <p class="pc-hm-text">${escHtml(INLINE_M_TEXT)}</p>
      </div>
      <div id="pc-messages"></div>
      <div id="pc-input-area">
        <textarea id="pc-input" rows="1" placeholder="Марка авто, VIN или запчасть…" aria-label="Сообщение"></textarea>
        <button id="pc-send" aria-label="Отправить"><span class="pc-send-label">Подобрать</span>${ICON_SEND}</button>
      </div>
      <div id="pc-chips"></div>
      <div id="pc-chips-m"></div>
      <div id="pc-hero-note">Ответы готовит ИИ. Если нужен человек — <button type="button" id="pc-hero-manager">позвать менеджера</button>.</div>
      <div class="pc-powered">Powered by AI · <a href="https://assistant24info.ru/" target="_blank" rel="noopener">ASSISTANT24</a></div>
    `;
    // Homepage placeholder present -> build the chat into it (inline mode).
    inlineHost = document.getElementById(INLINE_HOST_ID);
    if (inlineHost) {
      panel.classList.add('pc-inline', 'pc-compact');
      panel.querySelector('.pc-avatar').innerHTML = INLINE_AVATAR_IMG;
      panel.setAttribute('role', 'region');
      document.documentElement.classList.add('pc-has-inline');
      inlineHost.appendChild(panel);
      placeInlineHost();
      updateBleed();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(updateBleed); // button widths change once fonts load
      const mq = window.matchMedia(INLINE_MOBILE_QUERY);
      const onMq = () => { placeInlineHost(); if (panel.classList.contains('pc-compact')) setCompact(true); updateBleed(); };
      let bleedFrame = 0;
      window.addEventListener('resize', () => { cancelAnimationFrame(bleedFrame); bleedFrame = requestAnimationFrame(updateBleed); });
      if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
      // Same quick buttons in both designs (desktop #pc-chips, phones #pc-chips-m).
      ['pc-chips', 'pc-chips-m'].forEach(id => {
        const box = document.getElementById(id);
        INLINE_CHIPS.forEach(label => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'pc-chip';
          b.textContent = label;
          b.addEventListener('click', () => doSend(label));
          box.appendChild(b);
        });
      });
      document.getElementById('pc-hero-manager').addEventListener('click', inlineManager);
      document.addEventListener('click', onCategoryClick);
      document.getElementById('pc-restart').addEventListener('click', clearChat);
      document.getElementById('pc-full').addEventListener('click', () => setFull(!inlineFull));
      isOpen = true; // always visible here; close() only leaves full screen
    } else {
      document.body.appendChild(panel);
    }

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
      // Scrollbar only once the text is taller than the max height.
      input.style.overflowY = input.scrollHeight > 120 ? 'auto' : 'hidden';
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen) close(); });

    window.addEventListener('pagehide', () => endSession(true));
    // NOTE: previously also called endSession() on visibilitychange->hidden,
    // which fires on every tab-switch or same-tab navigation -- meaning a
    // customer briefly glancing at another tab, or clicking a product's
    // "Подробнее" link, was ending their support session. Removed: session
    // end should reflect the customer actually leaving, not momentary
    // navigation. pagehide + sendBeacon above still catches genuine tab
    // close/navigation-away for analytics purposes.

    // ─── RESTORE PERSISTED STATE (see PERSISTENCE section above) ────────────
    // Must happen after the DOM above exists (#pc-messages etc.) so restored
    // bubbles/carousels have somewhere to render into.
    const restored = loadState();
    if (restored && Array.isArray(restored.displayLog) && restored.displayLog.length > 0) {
      sessionId        = restored.sessionId;
      sessionStartTime = restored.sessionStartTime;
      userMessageCount = restored.userMessageCount || 0;
      sessionEnded     = false; // resuming counts as still-active, even if a
                                 // prior pagehide fired an analytics end-call
      messages         = restored.messages || [];
      displayLog       = restored.displayLog || [];
      managerAutoTriggered = restored.managerAutoTriggered || false;
      greeted          = restored.greeted || false;
      // Only skip a future real /api/session/start call if one was
      // actually made before (sessionId present) -- otherwise (e.g. the
      // customer only saw the greeting and closed without typing) leave
      // sessionStartPromise null so startSession() still fires for real
      // once they do send a first message. Setting this unconditionally
      // would permanently short-circuit startSession() with no session
      // ever actually created.
      if (sessionId) {
        sessionStartPromise = Promise.resolve();
      }

      replayDisplayLog(displayLog);

      // Deliberately NOT restoring `isOpen` here. Previously a new page/tab
      // (e.g. from the product carousel's "Подробнее" link, target="_blank")
      // would reopen the panel automatically if it was open on the previous
      // page, which on mobile covers the whole new page the customer just
      // navigated to. The widget should always start closed on a fresh
      // page load; the chat history is still fully restored above and
      // appears the moment the customer taps the launcher.
    }

    if (inlineHost) {
      // A conversation already going (here or in the bubble on another page)
      // shows as the chat; otherwise the compact block.
      setCompact(!displayLog.some(e => e.type === 'user'));
      return; // no launcher, teasers or badge on this page
    }
    setTimeout(() => { if (!isOpen && teasersAllowed()) { showTeasers(); showBadge(2); } }, 2000);
  }

  // ─── INLINE MODE: helpers ────────────────────────────────────────────────────
  // The hero goes directly under the header, ABOVE the icon row
  // (.benefits-block), on every screen size (owner's design, 26.10; before
  // that only on phones). The ABCP placeholder stays where it is.
  function placeInlineHost() {
    if (!inlineHost || !inlineHost.parentNode) return;
    const benefits = document.querySelector('.benefits-block');
    if (benefits && benefits.parentNode && !benefits.contains(inlineHost)
        && (benefits.compareDocumentPosition(inlineHost) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      benefits.parentNode.insertBefore(inlineHost, benefits);
    }
  }

  // Desktop hero = full window width: the panel is stretched from the
  // placeholder's column to the window edges (--pc-col-left = how far the
  // column starts from the window's left edge; --pc-page-w = window width
  // without the scrollbar, so no horizontal scroll), and the content is
  // indented by --pc-col-left to stay aligned with the site's column.
  function updateBleed() {
    if (!inlineHost) return;
    const panel = document.getElementById('pc-panel');
    panel.style.marginTop = ''; // back to the CSS margin before measuring
    const inputArea = document.getElementById('pc-input-area');
    inputArea.style.width = inputArea.style.maxWidth = '';
    if (window.matchMedia(INLINE_MOBILE_QUERY).matches) {
      panel.classList.remove('pc-bleed');
      panel.style.removeProperty('--pc-col-left');
      panel.style.removeProperty('--pc-text-left');
      panel.style.removeProperty('--pc-page-w');
      return;
    }
    const left = Math.max(0, Math.round(inlineHost.getBoundingClientRect().left));
    panel.style.setProperty('--pc-col-left', left + 'px');
    panel.style.setProperty('--pc-text-left', Math.max(16, Math.round(columnLeft())) + 'px'); // text starts at the page column
    panel.style.setProperty('--pc-page-w', document.documentElement.clientWidth + 'px');
    panel.classList.add('pc-bleed');
    if (panel.classList.contains('pc-compact')) {
      pullUnderHeader(panel);
      matchInputToChips(inputArea);
    }
  }

  // Left edge of the page's content column. The hero text lines up with the
  // sections below it (owner, 26.10): the placeholder itself sits in the wider
  // .wPageMain (moved above the icon row), so measure the column of page_main
  // (.mainSectionIn without its padding) when it exists.
  function columnLeft() {
    const col = document.querySelector('.wPageMain .mainSectionIn');
    if (col && !col.contains(inlineHost)) {
      const r = col.getBoundingClientRect();
      if (r.width > 0) return r.left + (parseFloat(getComputedStyle(col).paddingLeft) || 0);
    }
    return inlineHost.getBoundingClientRect().left;
  }

  // Desktop hero: the input box ends exactly where the quick buttons end
  // (right edge of "Где мой заказ?"; owner, 26.10). Measured, because the
  // buttons' width depends on the font the browser renders. CSS max-width
  // (820px / 60vw) stays as the fallback.
  function matchInputToChips(inputArea) {
    const chips = [...document.querySelectorAll('#pc-chips .pc-chip')];
    if (!chips.length) return;
    const right = Math.max(...chips.map(c => c.getBoundingClientRect().right));
    const width = Math.round(right - inputArea.getBoundingClientRect().left);
    if (width < 320) return; // not laid out yet / unexpected: keep the CSS width
    inputArea.style.width = inputArea.style.maxWidth = width + 'px';
  }

  // Desktop hero directly under the site header, so the header's search tab
  // ("Поиск по номеру детали", which hangs below the header) overlaps the top
  // of the photo (owner, 26.10: there was a ~30 px grey strip). The distance
  // is MEASURED (header bottom -> hero top), not a fixed number, so ABCP's own
  // spacing can change. The header is kept above the hero (z-index) so the
  // tab stays visible. Only the compact hero; the chat keeps its spacing.
  function pullUnderHeader(panel) {
    const header = document.querySelector('header');
    if (!header) return;
    const gap = Math.round(panel.getBoundingClientRect().top - header.getBoundingClientRect().bottom);
    if (gap <= 0 || gap > 150) return; // nothing to close, or an unexpected layout: leave it
    const current = parseFloat(getComputedStyle(panel).marginTop) || 0;
    panel.style.marginTop = (current - gap) + 'px';
    const hs = getComputedStyle(header);
    if (!hs.position || hs.position === 'static') header.style.position = 'relative';
    if (!hs.zIndex || hs.zIndex === 'auto') header.style.zIndex = '5';
  }

  function setCompact(on) {
    const panel = document.getElementById('pc-panel');
    panel.classList.toggle('pc-compact', on);
    const phone = window.matchMedia(INLINE_MOBILE_QUERY).matches; // phones: previous dark design
    document.getElementById('pc-input').placeholder = on ? (phone ? INLINE_M_PLACEHOLDER : INLINE_PLACEHOLDER) : INLINE_PLACEHOLDER_CHAT;
    document.querySelector('#pc-send .pc-send-label').textContent = on ? (phone ? INLINE_M_SEND_LABEL : INLINE_SEND_LABEL) : 'Отправить';
    if (!on) {
      const c = document.getElementById('pc-messages');
      c.scrollTop = c.scrollHeight;
    }
    updateBleed(); // the pull-up under the header applies to the hero only
  }

  // Compact block -> conversation (first message, or "позвать менеджера").
  function expandInline() {
    const panel = document.getElementById('pc-panel');
    greeted = true; // the bubble on other pages must not greet in the middle of this chat
    if (!panel.classList.contains('pc-compact')) return;
    if (displayLog.length === 0) {
      addDateSep('Сегодня');
      displayLog.push({ type: 'dateSep', payload: 'Сегодня' });
    }
    setCompact(false);
    const r = panel.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Click on a "Популярные категории" card (see CATEGORIES).
  function onCategoryClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // new-tab clicks stay links
    const card = e.target.closest && e.target.closest('[data-ai-category]');
    if (!card) return;
    const cat = CATEGORIES[card.getAttribute('data-ai-category')];
    if (!cat) return; // unknown key: leave it a normal link
    e.preventDefault();
    if (isLoading) { open(); return; } // an answer is on its way; don't interleave
    startCategory(cat);
  }

  function startCategory(cat) {
    expandInline();
    const panel = document.getElementById('pc-panel');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    addUserBubble(cat.name);
    displayLog.push({ type: 'user', payload: cat.name });
    // Known VIN in this conversation -> don't ask for it again.
    const hasVin = messages.some(m => m.role === 'user' && /\b[A-HJ-NPR-Z0-9]{17}\b/i.test(String(m.content)));
    const text = cat.items.length
      ? `${cat.q} Выберите ниже или напишите своими словами.${hasVin ? '' : '\n\n' + CATEGORY_VIN_ASK}`
      : `${cat.q}${hasVin ? '' : '\n\n' + CATEGORY_VIN_ASK}`;
    // The canned exchange goes into the AI history too, so a VIN or a free
    // text typed next is understood in the context of this category.
    messages.push({ role: 'user', content: cat.name });
    messages.push({ role: 'assistant', content: text });
    addBotBubble(text);
    displayLog.push({ type: 'bot', payload: text });
    if (cat.items.length) {
      addButtonsBubble(cat.items);
      displayLog.push({ type: 'buttons', payload: cat.items });
    }
    saveState();
    setTimeout(() => document.getElementById('pc-input').focus({ preventScroll: true }), 400);
  }

  function inlineManager() {
    expandInline();
    addBotBubble(INLINE_MANAGER_TEXT);
    displayLog.push({ type: 'bot', payload: INLINE_MANAGER_TEXT });
    addManagerButton();
    displayLog.push({ type: 'manager', payload: null });
    saveState();
  }

  function setFull(on) {
    inlineFull = on;
    document.getElementById('pc-panel').classList.toggle('pc-full', on);
    document.documentElement.style.overflow = on ? 'hidden' : '';
    const b = document.getElementById('pc-full');
    const label = on ? 'Свернуть' : 'Во весь экран';
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', label);
    b.title = label;
    b.innerHTML = `${on ? ICON_SHRINK : ICON_EXPAND}<span class="pc-inline-btn-text">${label}</span>`;
    const c = document.getElementById('pc-messages');
    c.scrollTop = c.scrollHeight;
  }

  // ─── OPEN / CLOSE / TOGGLE ───────────────────────────────────────────────────
  function toggle() { inlineHost ? open() : (isOpen ? close() : open()); }

  function open() {
    if (inlineHost) { // AutoChat.open() on the homepage: show the block and put the cursor in it
      const panel = document.getElementById('pc-panel');
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => document.getElementById('pc-input').focus({ preventScroll: true }), 350);
      return;
    }
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
    if (!greeted) {
      greeted = true;
      addDateSep('Сегодня');
      displayLog.push({ type: 'dateSep', payload: 'Сегодня' });
      PROACTIVE.forEach((text, i) => {
        setTimeout(() => addBotBubble(text), i * 650 + 200);
        displayLog.push({ type: 'bot', payload: text });
      });
      setTimeout(() => addButtonsBubble(QUICK_BUTTONS), PROACTIVE.length * 650 + 500);
      displayLog.push({ type: 'buttons', payload: QUICK_BUTTONS });
    }
    saveState();
    setTimeout(() => document.getElementById('pc-input').focus(), 380);
  }

  function close() {
    if (inlineHost) { if (inlineFull) setFull(false); return; }
    if (!isOpen) return;
    isOpen = false;
    document.getElementById('pc-panel').classList.remove('pc-open');
    document.getElementById('pc-launcher').classList.remove('pc-panel-open');
    const backdrop = document.getElementById('pc-backdrop');
    backdrop.classList.remove('pc-open');
    setTimeout(() => { backdrop.style.display = 'none'; }, 300);
    endSession(false);
    saveState();
  }

  function clearChat() {
    endSession();
    messages         = [];
    sessionId        = null;
    sessionStartTime = null;
    userMessageCount = 0;
    sessionEnded     = false;
    managerAutoTriggered = false;
    displayLog       = [];
    greeted          = true; // set immediately (not left false) since the block below shows the greeting right here -- avoids it also re-firing from open() if this is somehow called while already open
    clearPersistedState();
    const container = document.getElementById('pc-messages');
    container.innerHTML = '';
    if (inlineHost) { // back to the compact block, no greeting
      greeted = false;
      if (inlineFull) setFull(false);
      setCompact(true);
      return;
    }
    addDateSep('Сегодня');
    displayLog.push({ type: 'dateSep', payload: 'Сегодня' });
    PROACTIVE.forEach((text, i) => {
      setTimeout(() => addBotBubble(text), i * 650 + 200);
      displayLog.push({ type: 'bot', payload: text });
    });
    setTimeout(() => addButtonsBubble(QUICK_BUTTONS), PROACTIVE.length * 650 + 500);
    displayLog.push({ type: 'buttons', payload: QUICK_BUTTONS });
    saveState();
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
      <div class="pc-msg-icon">${botIconHtml()}</div>
      <div class="pc-bubble">${renderMarkdown(text)}</div>
    `;
    appendMsg(el);
  }

  // Bot icon next to messages: the homepage avatar inline, AI_Agent.png in the bubble.
  function botIconHtml() {
    return inlineHost ? INLINE_AVATAR_IMG
      : `<img src="${BASE_URL}/AI_Agent.png" style="width:20px;height:20px;object-fit:contain;border-radius:50%;" onerror="this.parentElement.textContent='🚗'">`;
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

  // Rotating reassurance messages shown once a reply is taking a while --
  // the compatibility lookup against the full parts database can take
  // 10-12s, and with nothing on screen that reads as "stuck" rather than
  // "working". Kept generic (no fake specificity about what's happening
  // server-side) since the client-side timer has no real visibility into
  // which backend stage is actually running.
  const TYPING_STATUS_MESSAGES = [
    'Ищу подходящие запчасти…',
    'Проверяю совместимость с вашим автомобилем…',
    'Сверяю по каталогу…',
    'Почти готово…',
  ];
  const TYPING_STATUS_DELAY_MS   = 2500; // don't show text on fast replies
  const TYPING_STATUS_ROTATE_MS  = 3000;

  let typingStatusTimers = [];

  function clearTypingStatusTimers() {
    typingStatusTimers.forEach(t => clearTimeout(t) || clearInterval(t));
    typingStatusTimers = [];
  }

  function addTypingIndicator() {
    const el = document.createElement('div');
    el.className = 'pc-msg pc-msg-bot';
    el.id = 'pc-typing';
    el.innerHTML = `
      <div class="pc-msg-icon">${botIconHtml()}</div>
      <div class="pc-bubble" style="padding:0;">
        <div class="pc-typing-wrap">
          <div class="pc-typing"><span></span><span></span><span></span></div>
          <div class="pc-typing-status" id="pc-typing-status"></div>
        </div>
      </div>
    `;
    appendMsg(el);

    // Start the rotation after a delay so a fast reply never shows text
    // that immediately gets ripped away -- only kicks in once the wait
    // is long enough to actually need reassurance.
    const startTimer = setTimeout(() => {
      const statusEl = document.getElementById('pc-typing-status');
      if (!statusEl) return;
      let i = 0;
      statusEl.textContent = TYPING_STATUS_MESSAGES[i];
      statusEl.classList.add('pc-visible');
      const rotateInterval = setInterval(() => {
        i = (i + 1) % TYPING_STATUS_MESSAGES.length;
        statusEl.classList.remove('pc-visible');
        setTimeout(() => {
          const el2 = document.getElementById('pc-typing-status');
          if (!el2) return;
          el2.textContent = TYPING_STATUS_MESSAGES[i];
          el2.classList.add('pc-visible');
        }, 300);
      }, TYPING_STATUS_ROTATE_MS);
      typingStatusTimers.push(rotateInterval);
    }, TYPING_STATUS_DELAY_MS);
    typingStatusTimers.push(startTimer);

    return el;
  }

  function removeTypingIndicator() {
    clearTypingStatusTimers();
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
        } else if (label === CATEGORY_OTHER_BTN) {
          document.getElementById('pc-input').focus();
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
        <span class="pc-manager-btn-sub">${MANAGER_PHONE_LABEL}</span>
      </div>
    `;

    btn.addEventListener('click', () => {
      endSession(true);
      triggerManagerHandoff();
    });

    wrap.appendChild(btn);
    appendMsg(wrap);
  }

  // ─── PART PAGE BUTTONS ───────────────────────────────────────────────────────
  // The customer typed a part number: a button to the site's own search page
  // for it (all offers, prices, delivery times -- including parts that have
  // no product card in the feed). Opens in a new tab so the chat stays.
  const SITE_URL = (window.PC_SITE_URL || 'https://bmwclub77.ru').replace(/\/+$/, '');
  function addPartLinks(codes) {
    const list = (Array.isArray(codes) ? codes : []).map(c => String(c).toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(c => c.length >= 5).slice(0, 3);
    if (!list.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'pc-partlink-wrap';
    for (const code of list) {
      const a = document.createElement('a');
      a.className = 'pc-partlink-btn';
      a.href = `${SITE_URL}/search?pcode=${encodeURIComponent(code)}`;
      a.target = '_blank';
      a.rel = 'noopener';
      a.innerHTML = `<span style="font-size:18px;">🔎</span><span class="pc-partlink-label"><span>Открыть деталь ${escHtml(code)}</span><span class="pc-partlink-sub">цены и сроки на сайте</span></span>`;
      a.addEventListener('click', () => logEvent('product_open', { article: code, name: 'Страница детали (поиск по номеру)', url: a.href }));
      wrap.appendChild(a);
    }
    appendMsg(wrap);
  }

  // Button under a diagram card (owner, 26.10): the marked part's product page
  // if the server found it in the price list, else the site search page.
  function addDiagramLink(d) {
    const code = String((d && d.oem) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 5) return;
    const product = safeUrl(d.productUrl);
    const wrap = document.createElement('div');
    wrap.className = 'pc-partlink-wrap';
    const a = document.createElement('a');
    a.className = 'pc-partlink-btn';
    a.href = product || `${SITE_URL}/search?pcode=${encodeURIComponent(code)}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.innerHTML = `<span style="font-size:18px;">🔎</span><span class="pc-partlink-label"><span>Открыть деталь ${escHtml(code)}</span><span class="pc-partlink-sub">${product ? 'страница товара на сайте' : 'цены и сроки на сайте'}</span></span>`;
    a.addEventListener('click', () => logEvent('product_open', { article: code, name: product ? 'Страница товара (схема)' : 'Страница детали (схема)', url: a.href }));
    wrap.appendChild(a);
    appendMsg(wrap);
  }

  // ─── UNIT DIAGRAM ────────────────────────────────────────────────────────────
  // Laximo diagram for a catalog part that has no product photo: image via
  // our proxy (/api/laximo-image), the part's position marked in red (box
  // coordinates are in the image's own pixels, scaled to the shown size).
  // Service kit (ТО): every position of the unit with the site price (product
  // in the feed) or the cheapest live offer; each row opens the part on the site.
  function kitHtml(kit) {
    if (!Array.isArray(kit) || !kit.length) return '';
    const fmt = n => Number(n).toLocaleString('ru-RU');
    const rows = kit.slice(0, 20).map(k => {
      const code = String(k.oem || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const href = (k.inFeed && safeUrl(k.url)) || `${SITE_URL}/search?pcode=${encodeURIComponent(code)}`;
      let price = '';
      if (k.inFeed && Number(k.price) > 0) price = `${fmt(k.price)} ₽`;
      else if (Number(k.priceFrom) > 0) price = `от ${fmt(k.priceFrom)} ₽<span class="pc-kit-sub">${k.inStock ? 'в наличии' : (k.days ? '~' + Number(k.days) + ' дн.' : '')}</span>`;
      else price = '<span class="pc-kit-sub">цена на сайте</span>';
      const warn = k.discontinued ? '<span style="color:#c00;font-weight:600;"> ⚠ снят с пр-ва</span>' : '';
      return `<a class="pc-kit-row" href="${escHtml(href)}" target="_blank" rel="noopener" data-code="${escHtml(code)}">
        <span class="pc-kit-pos">${escHtml(String(k.position || '').replace(/^0+(?=\d)/, ''))}</span>
        <span class="pc-kit-name"><b>${escHtml(code)}</b> ${escHtml(k.name || '')}${k.qty ? ' <span class="pc-kit-sub">(' + escHtml(k.qty) + ')</span>' : ''}${warn}</span>
        <span class="pc-kit-price">${price}</span></a>`;
    }).join('');
    return `<div class="pc-kit"><div class="pc-kit-title">Состав ТО по каталогу BMW</div>${rows}</div>`;
  }

  function addDiagram(d) {
    if (!d || !d.image) return;
    const src = `${BASE_URL}/api/laximo-image?u=${encodeURIComponent(d.image)}`;
    const wrap = document.createElement('div');
    wrap.className = 'pc-diagram';
    const pos = d.position ? `Поз. ${escHtml(d.position)} — ` : '';
    wrap.innerHTML = `
      <div class="pc-diagram-title">🛠 Схема${d.unitName ? ': ' + escHtml(d.unitName) : ''}</div>
      <a class="pc-diagram-frame" href="${escHtml(src)}" target="_blank" rel="noopener" title="Открыть схему крупно">
        <img alt="Схема узла" loading="lazy">
        <span class="pc-diagram-mark"></span>
      </a>
      <div class="pc-diagram-caption">${pos}<b>${escHtml(d.oem || '')}</b>${d.name ? ' — ' + escHtml(d.name) : ''}${d.qty ? ' (' + escHtml(d.qty) + ')' : ''}</div>
      ${d.notes && typeof d.notes === 'object' && Object.keys(d.notes).length ? `<div class="pc-diagram-note" style="color:#444;">${Object.entries(d.notes).slice(0, 3).map(([k, v]) => /не производ|снят/i.test(k + ' ' + v) ? `<span style="color:#c00;font-weight:600;">⚠ ${escHtml(k)}: ${escHtml(v)}</span>` : `${escHtml(k)}: ${escHtml(v)}`).join(' · ')}</div>` : ''}
      ${kitHtml(d.kit)}
      <div class="pc-diagram-note">Оригинальный каталог производителя${d.box ? ' · позиция отмечена красным' : ''}</div>`;
    const img = wrap.querySelector('img');
    const mark = wrap.querySelector('.pc-diagram-mark');
    const place = () => {
      if (!d.box || !img.naturalWidth) return;
      const k = img.clientWidth / img.naturalWidth;
      const pad = 3;
      mark.style.left = `${d.box.x * k - pad}px`;
      mark.style.top = `${d.box.y * k - pad}px`;
      mark.style.width = `${(d.box.w || 12) * k + pad * 2}px`;
      mark.style.height = `${(d.box.h || 16) * k + pad * 2}px`;
      mark.style.display = 'block';
    };
    img.addEventListener('load', place);
    window.addEventListener('resize', place);
    img.addEventListener('error', () => { // no broken image in the chat (keep the kit list if there is one)
      if (Array.isArray(d.kit) && d.kit.length) wrap.querySelector('.pc-diagram-frame').remove(); else wrap.remove();
    });
    wrap.querySelectorAll('.pc-kit-row').forEach(a => a.addEventListener('click', () =>
      logEvent('product_open', { article: a.dataset.code, name: 'Состав ТО (схема)', url: a.href })));
    img.src = src;
    appendMsg(wrap);
  }

  // ─── MISSING CARD PHOTOS (owner, 26.10) ─────────────────────────────────────
  // Items from the new suppliers come WITHOUT a photo in the price-list export
  // (wipers, fuel filter, ATF...), but the site's product page shows one (from
  // ABCP's reference catalogue). The widget runs on the site itself, so it
  // loads that product page in the visitor's browser (same site: no CORS, no
  // load on our server) and takes the product image. Max 4 per carousel, one
  // after another; remembered per page URL. Not found -> placeholder stays.
  const productImageCache = new Map(); // product url -> image url | null
  function sameSite(u) {
    try {
      const a = new URL(u, location.href).hostname.replace(/^www\./, '');
      return a === location.hostname.replace(/^www\./, '');
    } catch (e) { return false; }
  }
  async function findProductImage(pageUrl) {
    if (!pageUrl || !sameSite(pageUrl)) return null;
    if (productImageCache.has(pageUrl)) return productImageCache.get(pageUrl);
    let img = null;
    try {
      const res = await fetch(pageUrl, { credentials: 'same-origin' });
      if (res.ok) {
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        // 1) the page's share image, 2) the first image from ABCP's image server
        const og = doc.querySelector('meta[property="og:image"]');
        const abcpImg = doc.querySelector('img[src*="nodacdn.net/images/"]');
        const cand = (og && og.getAttribute('content')) || (abcpImg && abcpImg.getAttribute('src')) || null;
        img = cand ? safeUrl(new URL(cand, pageUrl).href) : null;
      }
    } catch (e) { img = null; }
    productImageCache.set(pageUrl, img);
    return img;
  }
  async function fillMissingImages(items) {
    let changed = false;
    for (const { p, ph } of items.slice(0, 4)) {
      const src = await findProductImage(p.url);
      if (!src || !ph.isConnected) continue;
      const img = document.createElement('img');
      img.className = 'pc-product-img';
      img.alt = String(p.article || '');
      img.loading = 'lazy';
      img.src = src;
      img.onerror = () => img.replaceWith(ph);
      ph.replaceWith(img);
      p.picture = src; // the same object is in displayLog -> kept after a reload
      changed = true;
    }
    if (changed) saveState();
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
    const needImage = []; // cards without a photo -> fillMissingImages()

    products.forEach(p => {
      // Card fields come from the AI's reply. Only allow real web addresses
      // (no javascript:, data: etc.) and escape everything put into HTML,
      // so a manipulated reply can't inject code into the page.
      p.picture = safeUrl(p.picture);
      p.url     = safeUrl(p.url);
      const stockNum = Number(p.stock);
      const priceNum = Number(p.price);

      const card = document.createElement('div');
      card.className = 'pc-product-card';

      // ── Stock label: car parts use unit count, not m² ──
      const stockLabel = (stockNum > 0)
        ? `В наличии: ${stockNum} шт.`
        : '<span style="color:#c00">Под заказ</span>';

      card.innerHTML = `
        ${p.picture
          ? `<img class="pc-product-img" src="${escHtml(p.picture)}" alt="${escHtml(p.article)}" loading="lazy" onerror="this.style.display='none'">`
          : `<div class="pc-product-img-ph">🔩</div>`
        }
        <div class="pc-product-body">
          <div class="pc-product-code">${escHtml(p.article || '')}</div>
          <div class="pc-product-name">${escHtml(p.name || '')}</div>
          <div class="pc-product-meta">${escHtml(p.brand || '')}${p.category ? ' · ' + escHtml(p.category) : ''}</div>
          ${p.compatibility ? `<div class="pc-product-meta">Подходит: ${escHtml(p.compatibility)}</div>` : ''}
          <div class="pc-product-price">${priceNum > 0 ? priceNum.toLocaleString('ru-RU') + ' ₽' : ''}</div>
          <div class="pc-product-stock">${stockLabel}</div>
          ${p.best_for ? `<div class="pc-product-bestfor">${escHtml(p.best_for)}</div>` : ''}
        </div>
        ${p.url ? `<a class="pc-product-link" href="${escHtml(p.url)}" target="_blank" rel="noopener">Подробнее →</a>` : ''}
      `;
      const link = card.querySelector('.pc-product-link');
      if (link) link.addEventListener('click', () => logEvent('product_open', cardInfo(p), true));
      if (!p.picture && p.url) needImage.push({ p, ph: card.querySelector('.pc-product-img-ph') });
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
    if (needImage.length) fillMissingImages(needImage.filter(x => x.ph)).catch(() => {});
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
    let autoHandoff = false;
    let partLinks = null;
    let diagram = null;

    // An unfinished block (reply cut off; the server normally repairs it)
    // must never reach the customer as raw <<<…>>> text.
    for (const tag of ['PRODUCTS', 'BUTTONS', 'DIAGRAM', 'PART_LINKS']) {
      const i = text.lastIndexOf(`<<<${tag}>>>`);
      if (i !== -1 && text.indexOf(`<<<END_${tag}>>>`, i) === -1) text = text.slice(0, i);
    }

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

    // One or more diagram cards (main part + parts on other diagrams).
    const diagrams = [];
    for (const m of text.matchAll(/<<<DIAGRAM>>>([\s\S]*?)<<<END_DIAGRAM>>>/g)) {
      try { const d = JSON.parse(m[1].trim()); if (d && d.image) diagrams.push(d); } catch(e) {}
    }
    text = text.replace(/<<<DIAGRAM>>>[\s\S]*?<<<END_DIAGRAM>>>/g, '').trim();
    diagram = diagrams[0] || null;

    const linkMatch = text.match(/<<<PART_LINKS>>>([\s\S]*?)<<<END_PART_LINKS>>>/);
    if (linkMatch) {
      try { partLinks = JSON.parse(linkMatch[1].trim()); } catch(e) {}
      text = text.replace(/<<<PART_LINKS>>>[\s\S]*?<<<END_PART_LINKS>>>/, '').trim();
    }

    if (text.includes('<<<MANAGER_BUTTON>>>')) {
      showManager = true;
      text = text.replace(/<<<MANAGER_BUTTON>>>/g, '').trim();
    }

    if (text.includes('<<<AUTO_MANAGER_HANDOFF>>>')) {
      autoHandoff = true;
      text = text.replace(/<<<AUTO_MANAGER_HANDOFF>>>/g, '').trim();
    }

    // Removing the blocks above leaves the blank lines that surrounded them
    // (e.g. "...масляный фильтр:\n\n<<<PRODUCTS>>>...\n\nЭтот артикул...").
    // Every \n renders as <br>, so those show up as a large empty gap in the
    // bubble. Collapse any run of blank lines to a single blank line.
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    return { text, products, buttons, showManager, autoHandoff, partLinks, diagram, diagrams };
  }

  // ─── SEND ────────────────────────────────────────────────────────────────────
  function sendMessage() {
    const input = document.getElementById('pc-input');
    const text  = input.value.trim();
    if (!text || isLoading) return;
    input.value = '';
    input.style.height = 'auto';
    input.style.overflowY = 'hidden';
    doSend(text);
  }

  async function doSend(userText) {
    if (isLoading) return;
    lastUserText = userText;
    userMessageCount++;
    if (inlineHost) expandInline();

    addUserBubble(userText);
    messages.push({ role: 'user', content: userText });
    displayLog.push({ type: 'user', payload: userText });
    saveState();

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

      const { text, products, buttons, showManager, autoHandoff, partLinks, diagram, diagrams } = parseBotResponse(raw);

      if (!sessionStartPromise) {
        await startSession();
        // The session is created only after the first reply, so the first
        // message is logged now. It's the first entry in `messages`.
        const first = messages.find(m => m.role === 'user');
        if (first) logEvent('first_message', { text: first.content, placement: inlineHost ? 'inline' : 'bubble' });
      }

      if (text) {
        addBotBubble(text);
        displayLog.push({ type: 'bot', payload: text });
        const cleanedForHistory = raw
          .replace(/<<<PRODUCTS>>>[\s\S]*?<<<END_PRODUCTS>>>/g, '[запчасти показаны]')
          .replace(/<<<BUTTONS>>>[\s\S]*?<<<END_BUTTONS>>>/g, '')
          .replace(/<<<PART_LINKS>>>[\s\S]*?<<<END_PART_LINKS>>>/g, '')
          .replace(/<<<DIAGRAM>>>[\s\S]*?<<<END_DIAGRAM>>>/g, '[схема показана]')
          .replace(/<<<MANAGER_BUTTON>>>/g, '')
          .replace(/<<<AUTO_MANAGER_HANDOFF>>>/g, '')
          .trim();
        messages.push({ role: 'assistant', content: cleanedForHistory });
      }
      // Each diagram is followed by the "Открыть деталь" button of its marked
      // part; buttons without a diagram come after all of them.
      const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      let restLinks = Array.isArray(partLinks) ? partLinks.slice() : [];
      for (const d of (diagrams || (diagram ? [diagram] : []))) {
        addDiagram(d);
        displayLog.push({ type: 'diagram', payload: d });
        const own = restLinks.filter(c => normCode(c) === normCode(d.oem));
        if (own.length) {
          restLinks = restLinks.filter(c => normCode(c) !== normCode(d.oem));
          addPartLinks(own);
          displayLog.push({ type: 'partlinks', payload: own });
        } else if (d.oem) {
          const link = { oem: d.oem, productUrl: d.productUrl || null };
          addDiagramLink(link);
          displayLog.push({ type: 'diaglink', payload: link });
        }
      }
      if (restLinks.length > 0) {
        addPartLinks(restLinks);
        displayLog.push({ type: 'partlinks', payload: restLinks });
      }
      if (products && products.length > 0) {
        addProductCarousel(products);
        displayLog.push({ type: 'products', payload: products });
        logEvent('products_shown', { products: products.map(cardInfo) });
      }
      if (buttons && buttons.length > 0) {
        addButtonsBubble(buttons);
        displayLog.push({ type: 'buttons', payload: buttons });
      }
      if (showManager) {
        addManagerButton();
        displayLog.push({ type: 'manager', payload: null });
      }
      if (autoHandoff && !managerAutoTriggered) {
        // Customer typed a phone/email instead of clicking the button --
        // reuse the exact same handoff path (Bitrix lead + Supabase save)
        // rather than duplicating that logic here. Guarded by
        // managerAutoTriggered so this only fires once per session even if
        // contact info is mentioned again later in the conversation.
        managerAutoTriggered = true;
        triggerManagerHandoff();
      }
      saveState();

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
      document.getElementById('pc-input').focus({ preventScroll: !!inlineHost });
    }
  }

  // ─── UTILS ───────────────────────────────────────────────────────────────────
  // http(s) URLs only (http upgraded to https); anything else -> null.
  function safeUrl(u) {
    if (!u || typeof u !== 'string') return null;
    const t = u.trim().replace(/^http:\/\//i, 'https://');
    try {
      const parsed = new URL(t);
      return parsed.protocol === 'https:' ? parsed.href : null;
    } catch (e) {
      return null;
    }
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ─── PUBLIC API ──────────────────────────────────────────────────────────────
  window.AutoChat = { open, close, toggle };

  // ─── BOOT ────────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
