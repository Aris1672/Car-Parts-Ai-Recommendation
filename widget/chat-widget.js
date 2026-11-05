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
  const MANAGER_PHONE_LABEL = '+7 (967) 555-7-555'; // shown in the request form, written the way the client writes it
  // Request form (152-ФЗ): contacts go from this form straight to our server
  // and database in Russia, never to the LLM. Consent link = the site's policy.
  const PRIVACY_POLICY_URL = 'https://bmwclub77.ru/data_protection';

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
    // «Шины и диски» replaces «Другие» on the homepage (owner 04.11); original BMW tyres / rims / wheels (searchTires).
    tires:      { name: 'Шины и диски', q: 'Что нужно: шины, диски или колёса в сборе?',
                  items: ['Летние шины', 'Зимние шины', 'Колёсные диски', 'Колёса в сборе', CATEGORY_OTHER_BTN] },
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
  const INLINE_MANAGER_TEXT = 'Менеджер поможет с подбором и заказом. Оставьте заявку по кнопке ниже — менеджер свяжется с вами. Или позвоните: ' + MANAGER_PHONE_LABEL + '.';
  // Phones: the agent goes ABOVE the icon row (.benefits-block), so it's on
  // the first screen; from 768 px up it stays where the placeholder is.
  const INLINE_MOBILE_QUERY = '(max-width: 767px)'; // below this: a card in the column, not full width
  // Agent avatar on the homepage block (owner, 25.10): "AI" with a single
  // red slash on black, centered (192 px, repo root). Replaced a version with
  // M-style tricolour stripes (BMW trade dress). Since 26.10 (owner) also the
  // bubble on the other pages: launcher, header and message icons.
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
    #pc-launcher img { width: 60px; height: 60px; object-fit: cover; display: block; border-radius: 14px; box-shadow: 0 4px 16px rgba(0,0,0,0.28); }

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
      line-height: 1.35; min-width: 0; overflow-wrap: anywhere;
    }
    .pc-typing-status.pc-visible { opacity: 1; }
    .pc-typing-elapsed { color: #b5b5b5; margin-left: 4px; white-space: nowrap; }
    /* Real steps from the server (stream): finished ones above the current line. */
    .pc-typing-done { padding: 0 16px; }
    .pc-typing-done:not(:empty) { padding-top: 12px; margin-bottom: -6px; }
    .pc-typing-step {
      display: flex; gap: 8px; font-size: 12.5px; line-height: 1.35; color: #8c8c8c;
      margin-bottom: 4px; overflow-wrap: anywhere; animation: pc-step-in 0.25s ease;
    }
    .pc-typing-step::before { content: '✓'; color: #3aa85b; font-weight: 700; flex-shrink: 0; }
    @keyframes pc-step-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }

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

    /* ── Request form (modal) ── */
    #pc-lead-overlay {
      position: fixed; inset: 0; z-index: 1000000;
      background: rgba(10,14,20,0.55);
      display: flex; align-items: center; justify-content: center;
      padding: 16px; font-family: var(--pc-font);
      -webkit-font-smoothing: antialiased;
      animation: pc-lead-fade 0.18s ease;
    }
    #pc-lead-overlay * { box-sizing: border-box; font-family: inherit; }
    @keyframes pc-lead-fade { from { opacity: 0; } to { opacity: 1; } }
    .pc-lead {
      position: relative; width: 100%; max-width: 440px;
      max-height: calc(100vh - 32px); max-height: calc(100dvh - 32px); overflow-y: auto;
      background: #fff; color: var(--pc-dark); border-radius: 16px;
      padding: 22px 20px 18px; box-shadow: 0 18px 60px rgba(0,0,0,0.3);
      text-align: left;
    }
    .pc-lead-close {
      position: absolute; top: 10px; right: 10px; width: 36px; height: 36px;
      border: none; background: transparent; border-radius: 50%; cursor: pointer;
      font-size: 24px; line-height: 1; color: #777;
    }
    .pc-lead-close:hover { background: #f1f1f1; color: #111; }
    .pc-lead h3 { margin: 0 36px 4px 0; font-size: 19px; font-weight: 700; line-height: 1.25; color: var(--pc-dark); }
    .pc-lead-sub { margin: 0 0 14px; font-size: 13px; color: #666; line-height: 1.4; }
    .pc-lead-field { display: block; margin-bottom: 11px; }
    .pc-lead-label { display: block; font-size: 12px; font-weight: 600; color: #444; margin-bottom: 4px; }
    .pc-lead-label i { font-style: normal; color: var(--pc-red); }
    .pc-lead input[type=text], .pc-lead input[type=tel], .pc-lead input[type=email], .pc-lead textarea {
      display: block; width: 100%; padding: 10px 12px; border: 1.5px solid #d6d9de; border-radius: 10px;
      font-size: 16px; color: #111; background: #fff; outline: none; margin: 0;
      transition: border-color 0.15s;
    }
    .pc-lead textarea { min-height: 92px; resize: vertical; line-height: 1.4; font-size: 15px; }
    .pc-lead input:focus, .pc-lead textarea:focus { border-color: var(--pc-red); }
    .pc-lead input.pc-bad { border-color: #d33; }
    .pc-lead-hint { font-size: 12px; color: #777; margin: -4px 0 11px; }
    .pc-lead-row { display: flex; gap: 10px; }
    .pc-lead-row .pc-lead-field { flex: 1; min-width: 0; }
    @media (max-width: 480px) { .pc-lead-row { flex-direction: column; gap: 0; } }
    .pc-lead-consent { display: flex; gap: 9px; align-items: flex-start; font-size: 12.5px; color: #444; line-height: 1.4; margin: 4px 0 14px; cursor: pointer; }
    .pc-lead-consent input { width: 18px; height: 18px; margin: 1px 0 0; flex-shrink: 0; accent-color: var(--pc-red); }
    .pc-lead-consent a { color: var(--pc-red); }
    .pc-lead-send {
      width: 100%; padding: 13px 16px; border: none; border-radius: 12px; cursor: pointer;
      background: var(--pc-red); color: #fff; font-size: 15px; font-weight: 700;
      transition: background 0.15s, opacity 0.15s;
    }
    .pc-lead-send:hover:not(:disabled) { background: var(--pc-red-hover); }
    .pc-lead-send:disabled { opacity: 0.45; cursor: not-allowed; }
    .pc-lead-error { color: #c62828; font-size: 13px; margin: 0 0 10px; display: none; }
    .pc-lead-call { margin: 12px 0 0; font-size: 13px; color: #666; text-align: center; }
    .pc-lead-call a { color: var(--pc-red); font-weight: 600; text-decoration: none; white-space: nowrap; }

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
    /* Diagram card (30.10): BMW diagram instead of a photo, zoomed on the part */
    .pc-diag-img { position: relative; overflow: hidden; background: #fff; cursor: zoom-in; border-bottom: 1px solid #eee; }
    .pc-diag-img img { position: absolute; left: 0; top: 0; max-width: none; display: none; }
    .pc-diag-mark { position: absolute; display: none; border: 2px solid #e30613; border-radius: 4px; box-shadow: 0 0 0 2px rgba(227,6,19,.18); pointer-events: none; }
    .pc-diag-badge { position: absolute; left: 6px; top: 6px; background: rgba(28,105,212,.92); color: #fff; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; letter-spacing: .2px; }
    .pc-diag-pos { position: absolute; right: 6px; bottom: 6px; background: rgba(0,0,0,.62); color: #fff; font-size: 10px; padding: 2px 6px; border-radius: 4px; }
    .pc-diag-wait { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #9aa3ad; font-size: 11px; }
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
    #pc-panel .pc-avatar, #pc-panel .pc-msg-icon, .pc-hero-icon {
      background: #1a1a1a; box-shadow: none; overflow: hidden;
    }
    #pc-panel .pc-avatar { border-radius: 8px; }
    #pc-panel .pc-msg-icon { border-radius: 6px; }
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
          linear-gradient(90deg, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.88) 20%, rgba(255,255,255,0.35) 56%, rgba(255,255,255,0) 66%), /* 20%: owner, 26.10 (was 40%) */
          var(--pc-hero-bg-image);
        background-size: 100% 100%, cover;
        background-position: 0 0, right 70%;
        background-repeat: no-repeat;
        border: 1px solid #e3e8ef;
        justify-content: center; padding: 36px 0; /* min-height 400px removed (owner, 26.10); the full-width hero keeps its 500px */
      }
      @media (min-width: 768px) {
        #pc-panel.pc-inline.pc-compact.pc-bleed {
          width: var(--pc-page-w) !important; margin-left: calc(-1 * var(--pc-col-left));
          border-radius: 0; border-left: none; border-right: none;
          min-height: 500px; /* owner, 26.10 (was 440); a minimum, so a wrapped title never gets cut */
          /* more room at the top: the hero now starts right under the header
             and the search tab hangs ~35 px into it (owner, 26.10) */
          padding-top: 64px; padding-bottom: 40px;
          /* the icon row's strip starts right under the photo (owner, 27.10) */
          margin-bottom: 0; border-bottom: none;
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
  // Conversation id (04.11, admin «Диалоги» tab): sent with every message from the
  // first one on -- the dashboard session exists only after the first reply.
  let convId              = null;
  const newConvId = () => `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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
        sessionId, convId, sessionStartTime, userMessageCount, sessionEnded,
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

  // ─── SESSION: MANAGER (request form) ───────────────────────────────────────
  // 152-ФЗ: the customer's name / phone / email go from this form straight to
  // /api/session/manager -> our database in Russia, never to the LLM, and only
  // with the customer's consent. The «Сообщение» text is prepared by the
  // server from the chat with every phone/email masked; the customer can edit
  // it. Opened by the manager button, or by the server (<<<CONTACT_FORM>>>)
  // when the customer typed a phone/email into the chat -- then that contact
  // is pre-filled here, in the browser.
  const LEAD_EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
  function leadPhoneOk(v) {
    const d = String(v || '').replace(/\D/g, '');
    return /^[78]\d{10}$/.test(d) || /^9\d{9}$/.test(d) || (/^\s*\+/.test(String(v)) && d.length >= 10 && d.length <= 15);
  }
  function contactsInText(t) {
    t = String(t || '');
    const email = (t.match(/[A-Za-z0-9А-Яа-яЁё._%+\-]+@[A-Za-z0-9А-Яа-яЁё\-]+(?:\.[A-Za-z0-9А-Яа-яЁё\-]+)*\.[A-Za-zА-Яа-яЁё]{2,}/) || [])[0] || '';
    const phone = (t.match(/(?:\+7|(?<![\d+])[78])?[\s\-]*\(?9\d{2}\)?[\s\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}(?!\d)|\+\d[\d\s\-()]{8,18}\d/) || [])[0] || '';
    return { phone: phone.trim(), email };
  }

  function closeLeadForm() {
    const o = document.getElementById('pc-lead-overlay');
    if (o) o.remove();
    document.removeEventListener('keydown', leadKeydown, true);
  }
  function leadKeydown(e) { if (e.key === 'Escape') { e.stopPropagation(); closeLeadForm(); } }

  function openLeadForm(prefill) {
    if (document.getElementById('pc-lead-overlay')) return;
    prefill = prefill || {};
    const overlay = document.createElement('div');
    overlay.id = 'pc-lead-overlay';
    overlay.innerHTML = `
      <form class="pc-lead" role="dialog" aria-modal="true" aria-labelledby="pc-lead-title" novalidate>
        <button type="button" class="pc-lead-close" aria-label="Закрыть">×</button>
        <h3 id="pc-lead-title">Заявка менеджеру</h3>
        <p class="pc-lead-sub">Менеджер свяжется с вами в рабочее время.</p>
        <label class="pc-lead-field">
          <span class="pc-lead-label">Имя <i>*</i></span>
          <input type="text" name="name" autocomplete="name" maxlength="80" required>
        </label>
        <div class="pc-lead-row">
          <label class="pc-lead-field">
            <span class="pc-lead-label">Телефон</span>
            <input type="tel" name="phone" autocomplete="tel" inputmode="tel" maxlength="40" placeholder="+7 900 000-00-00">
          </label>
          <label class="pc-lead-field">
            <span class="pc-lead-label">Email</span>
            <input type="email" name="email" autocomplete="email" maxlength="254" placeholder="name@mail.ru">
          </label>
        </div>
        <div class="pc-lead-hint">Укажите телефон или email — как вам удобнее (можно оба).</div>
        <label class="pc-lead-field">
          <span class="pc-lead-label">Сообщение</span>
          <textarea name="message" maxlength="2000" placeholder="Готовлю описание по вашему диалогу…"></textarea>
        </label>
        <label class="pc-lead-consent">
          <input type="checkbox" name="consent">
          <span>Я даю согласие на обработку моих персональных данных в соответствии с <a href="${PRIVACY_POLICY_URL}" target="_blank" rel="noopener">Политикой обработки персональных данных</a>.</span>
        </label>
        <div class="pc-lead-error" role="alert"></div>
        <button type="submit" class="pc-lead-send" disabled>Отправить</button>
        <p class="pc-lead-call">Или позвоните: <a href="tel:${MANAGER_PHONE}">${MANAGER_PHONE_LABEL}</a></p>
      </form>`;
    document.body.appendChild(overlay);

    const form    = overlay.querySelector('form');
    const f       = name => form.elements[name];
    const sendBtn = overlay.querySelector('.pc-lead-send');
    const errBox  = overlay.querySelector('.pc-lead-error');
    if (prefill.phone) f('phone').value = prefill.phone;
    if (prefill.email) f('email').value = prefill.email;

    const validate = () => {
      const phone = f('phone').value.trim(), email = f('email').value.trim();
      const phoneOk = !!phone && leadPhoneOk(phone);
      const emailOk = !!email && LEAD_EMAIL_RE.test(email);
      f('phone').classList.toggle('pc-bad', !!phone && !phoneOk && document.activeElement !== f('phone'));
      f('email').classList.toggle('pc-bad', !!email && !emailOk && document.activeElement !== f('email'));
      const ok = !!f('name').value.trim()
        && (phoneOk || emailOk) && (!phone || phoneOk) && (!email || emailOk)
        && f('consent').checked;
      sendBtn.disabled = !ok;
      return ok;
    };
    form.addEventListener('input', validate);
    form.addEventListener('change', validate);
    form.addEventListener('focusout', validate);
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) closeLeadForm(); });
    overlay.querySelector('.pc-lead-close').addEventListener('click', closeLeadForm);
    document.addEventListener('keydown', leadKeydown, true);
    setTimeout(() => (f('name').value ? f('phone') : f('name')).focus(), 50);
    validate();

    // «Сообщение»: prepared by the server from the masked chat. Never
    // overwrites what the customer has already typed.
    let typedMessage = false;
    f('message').addEventListener('input', () => { typedMessage = true; });
    if (messages.length) {
      fetch(`${SESSION_URL}/manager`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'summary', session_id: sessionId, messages: messages.slice(-20) }),
      }).then(r => r.json()).then(d => {
        if (!typedMessage && d && d.message && document.body.contains(form)) f('message').value = d.message;
      }).catch(() => {}).finally(() => {
        if (document.body.contains(form)) f('message').placeholder = 'Опишите, что нужно: автомобиль, деталь, вопрос';
      });
    } else {
      f('message').placeholder = 'Опишите, что нужно: автомобиль, деталь, вопрос';
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!validate()) return;
      sendBtn.disabled = true;
      sendBtn.textContent = 'Отправляю…';
      errBox.style.display = 'none';
      try {
        const res = await fetch(`${SESSION_URL}/manager`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action:     'submit',
            session_id: sessionId,
            name:       f('name').value.trim(),
            phone:      f('phone').value.trim(),
            email:      f('email').value.trim(),
            message:    f('message').value.trim(),
            consent:    f('consent').checked === true,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        closeLeadForm();
        managerAutoTriggered = true; // a request was sent in this chat
        const thanks = `Спасибо! Заявка №${data.id} передана менеджеру — он свяжется с вами в ближайшее время.`;
        addBotBubble(thanks);
        displayLog.push({ type: 'bot', payload: thanks });
        saveState();
      } catch (err) {
        console.warn('Request form error:', err);
        errBox.textContent = err.message === 'too_many_requests'
          ? 'Слишком много заявок подряд. Попробуйте позже или позвоните нам.'
          : 'Не удалось отправить заявку. Попробуйте ещё раз или позвоните нам.';
        errBox.style.display = 'block';
        sendBtn.textContent = 'Отправить';
        validate();
      }
    });
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

  // ─── SELECTION STRIP (05.11) ─────────────────────────────────────────────────
  // A product page opened from the chat's carousel shows a strip pinned to the
  // bottom of the screen instead of the round AI button: ‹ previous part ·
  // «Подбор · 5 из 10 · ✓2 в корзине» · next part › · ☰ the whole list ·
  // «Спросить ИИ» (opens the chat right here). The selection = the latest
  // carousel in the conversation (displayLog, restored from localStorage on
  // every page). Clicks on the site's own cart buttons in the offer table mark
  // the part «✓ В корзине». Pages that aren't one of the selected parts: the
  // round button as before. Homepage (inline agent): no strip.
  const STRIP_KEY = 'pc_strip_v1';
  let strip = null;   // { items, idx, sig, state }

  function codeKey(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  function currentSelection() {
    for (let i = displayLog.length - 1; i >= 0; i--) {
      const e = displayLog[i];
      if (e.type === 'products' && Array.isArray(e.payload)) {
        const items = e.payload.map(p => {
          let url = safeUrl(p.url);
          const isDiagram = !!(p.diagram && typeof p.diagram === 'object');
          if (isDiagram && !url) url = `${SITE_URL}/search?pcode=${encodeURIComponent(codeKey(p.article))}`;
          return { code: codeKey(p.article), article: p.article || '', name: p.name || '', price: Number(p.price) || 0,
            priceFrom: !!(isDiagram && p.priceFrom), url };
        }).filter(x => x.url && x.code.length >= 5);
        return items.length ? items : null;
      }
    }
    return null;
  }

  function pageMatches(item) {
    try {
      const u = new URL(item.url, location.href);
      if (u.pathname === location.pathname && u.search === location.search) return true;
    } catch (e) {}
    let here = '';
    try { here = decodeURIComponent(location.pathname + location.search); } catch (e) { here = location.pathname + location.search; }
    return codeKey(here).includes(item.code);
  }

  function loadStripState(sig) {
    try {
      const s = JSON.parse(localStorage.getItem(STRIP_KEY) || 'null');
      if (s && s.sig === sig) return s;
    } catch (e) {}
    return { sig, added: [], toast: false };
  }
  function saveStripState() { try { localStorage.setItem(STRIP_KEY, JSON.stringify(strip.state)); } catch (e) {} }

  function initStrip() {
    if (inlineHost) return false;
    const items = currentSelection();
    if (!items) return false;
    const idx = items.findIndex(pageMatches);
    if (idx < 0) return false;
    const sig = items.map(x => x.code).join(',');
    strip = { items, idx, sig, state: loadStripState(sig) };

    const style = document.createElement('style');
    style.textContent = STRIP_STYLES;
    document.head.appendChild(style);
    document.documentElement.classList.add('pc-has-strip');

    const bar = document.createElement('div');
    bar.id = 'pc-strip';
    bar.setAttribute('role', 'navigation');
    bar.setAttribute('aria-label', 'Ваш подбор запчастей');
    bar.innerHTML = `
      <button type="button" class="pc-s-arrow" id="pc-s-prev" aria-label="Предыдущая деталь">‹</button>
      <button type="button" class="pc-s-info" id="pc-s-info" aria-label="Весь список">
        <span class="pc-s-title">Ваш подбор</span>
        <span class="pc-s-count"></span>
      </button>
      <button type="button" class="pc-s-arrow" id="pc-s-next" aria-label="Следующая деталь">›</button>
      <button type="button" class="pc-s-list" id="pc-s-list" aria-label="Весь список">☰<span class="pc-s-lbl"> Список</span></button>
      <button type="button" class="pc-s-ask" id="pc-s-ask"><img src="${INLINE_AVATAR_URL}" alt=""><span>Спросить ИИ</span></button>
      <div class="pc-s-flash" id="pc-s-flash" hidden></div>`;
    document.body.appendChild(bar);

    const sheet = document.createElement('div');
    sheet.id = 'pc-s-sheet';
    sheet.hidden = true;
    document.body.appendChild(sheet);

    bar.querySelector('#pc-s-prev').addEventListener('click', () => goTo(strip.idx - 1));
    bar.querySelector('#pc-s-next').addEventListener('click', () => goTo(strip.idx + 1));
    bar.querySelector('#pc-s-info').addEventListener('click', toggleSheet);
    bar.querySelector('#pc-s-list').addEventListener('click', toggleSheet);
    bar.querySelector('#pc-s-ask').addEventListener('click', () => { closeSheet(); open(); });
    sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
    document.addEventListener('click', onSiteCartClick, true);
    renderStrip();

    if (!strip.state.toast) {
      strip.state.toast = true; saveStripState();
      setTimeout(() => flash(`Ваш подбор здесь — листайте ‹ › или откройте список`, false), 600);
    }
    return true;
  }

  function renderStrip() {
    const bar = document.getElementById('pc-strip');
    if (!bar) return;
    const n = strip.items.length, added = strip.state.added.length;
    const narrow = window.matchMedia('(max-width: 540px)').matches;
    bar.querySelector('.pc-s-count').textContent = narrow
      ? `${strip.idx + 1}/${n}` + (added ? ` · ✓${added}` : '')
      : `${strip.idx + 1} из ${n}` + (added ? ` · ✓ ${added} в корзине` : '');
    bar.querySelector('#pc-s-prev').disabled = strip.idx <= 0;
    bar.querySelector('#pc-s-next').disabled = strip.idx >= n - 1;
  }

  function goTo(i) {
    if (!strip || i < 0 || i >= strip.items.length) return;
    location.href = strip.items[i].url; // same tab: the strip comes with it
  }

  function toggleSheet() {
    const sheet = document.getElementById('pc-s-sheet');
    if (!sheet.hidden) return closeSheet();
    const added = new Set(strip.state.added);
    sheet.innerHTML = `<div class="pc-s-panel" role="dialog" aria-label="Ваш подбор">
      <div class="pc-s-head"><b>Ваш подбор · ${strip.items.length}</b><button type="button" class="pc-s-x" aria-label="Закрыть">✕</button></div>
      <div class="pc-s-rows">${strip.items.map((x, i) => `
        <a class="pc-s-row${i === strip.idx ? ' pc-s-cur' : ''}" href="${escHtml(x.url)}" data-i="${i}">
          <span class="pc-s-mark">${added.has(x.code) ? '✓' : i + 1}</span>
          <span class="pc-s-name"><span class="pc-s-art">${escHtml(x.article)}</span>${escHtml(x.name)}</span>
          <span class="pc-s-price">${x.price ? (x.priceFrom ? 'от ' : '') + x.price.toLocaleString('ru-RU') + ' ₽' : ''}</span>
        </a>`).join('')}</div></div>`;
    sheet.querySelector('.pc-s-x').addEventListener('click', closeSheet);
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('pc-open'));
  }
  function closeSheet() {
    const sheet = document.getElementById('pc-s-sheet');
    if (!sheet || sheet.hidden) return;
    sheet.classList.remove('pc-open');
    sheet.hidden = true;
  }

  // The site's «в корзину» button in the offer table (ABCP: a cart icon per
  // offer row). Matched loosely by class / title / href / onclick / icon name,
  // only inside a table row, so the header's «Корзина» link doesn't count.
  const CART_RE = /basket|cart|korzin|корзин/i;
  function onSiteCartClick(e) {
    const t = e.target;
    if (!strip || !t || !t.closest || t.closest('#pc-strip, #pc-s-sheet, #pc-panel')) return;
    if (!t.closest('tr')) return;
    const btn = t.closest('a, button, input, [onclick], [class*="basket"], [class*="cart"]');
    if (!btn) return;
    const img = btn.querySelector && btn.querySelector('img, i, svg, span');
    const hay = [btn.className && btn.className.baseVal !== undefined ? btn.className.baseVal : btn.className,
      btn.id, btn.title, btn.getAttribute('href'), btn.getAttribute('onclick'), btn.getAttribute('aria-label'),
      btn.getAttribute('value'), img && (img.getAttribute('src') || img.className && String(img.className.baseVal || img.className) || img.title)]
      .filter(Boolean).join(' ');
    if (!CART_RE.test(hay)) return;
    const cur = strip.items[strip.idx];
    if (!strip.state.added.includes(cur.code)) { strip.state.added.push(cur.code); saveStripState(); }
    renderStrip();
    const next = strip.items.findIndex((x, i) => i > strip.idx && !strip.state.added.includes(x.code));
    const nextI = next >= 0 ? next : strip.items.findIndex(x => !strip.state.added.includes(x.code));
    flash(nextI >= 0 ? `✓ Добавлено · Следующая: ${strip.items[nextI].name || strip.items[nextI].article} ›` : '✓ Добавлено · весь подбор в корзине', true, nextI);
  }

  let flashTimer = 0;
  function flash(text, ok, nextI) {
    const f = document.getElementById('pc-s-flash');
    if (!f) return;
    f.textContent = text;
    f.className = 'pc-s-flash' + (ok ? ' pc-ok' : '');
    f.hidden = false;
    f.onclick = (ok && nextI >= 0) ? () => goTo(nextI) : () => { f.hidden = true; };
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { f.hidden = true; }, ok ? 6000 : 4000);
  }

  const STRIP_STYLES = `
    .pc-has-strip #pc-launcher, .pc-has-strip #pc-teasers { display: none !important; }
    .pc-has-strip body { padding-bottom: 72px !important; }
    .pc-chat-open #pc-strip, .pc-chat-open #pc-s-sheet { display: none !important; }
    #pc-strip, #pc-strip *, #pc-s-sheet, #pc-s-sheet * { box-sizing: border-box; font-family: var(--pc-font, -apple-system, "Segoe UI", Roboto, Arial, sans-serif); }
    #pc-strip {
      position: fixed; left: 50%; transform: translateX(-50%); bottom: 16px; z-index: 999997;
      display: flex; align-items: center; gap: 6px; height: 56px; padding: 0 8px;
      width: min(680px, calc(100vw - 24px));
      background: #0f1b2d; color: #fff; border-radius: 14px; box-shadow: 0 8px 30px rgba(0,0,0,.3);
    }
    #pc-strip button { border: 0; background: none; color: inherit; cursor: pointer; font: inherit; -webkit-tap-highlight-color: transparent; }
    .pc-s-arrow { width: 44px; height: 44px; border-radius: 10px; font-size: 28px !important; line-height: 1; flex-shrink: 0; }
    .pc-s-arrow:hover:not(:disabled) { background: rgba(255,255,255,.1); }
    .pc-s-arrow:disabled { opacity: .3; cursor: default !important; }
    .pc-s-info { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; line-height: 1.2; padding: 4px; }
    .pc-s-title { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #9cc9ff; }
    .pc-s-count { font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .pc-s-list { height: 40px; padding: 0 12px; border-radius: 10px; background: rgba(255,255,255,.1) !important; font-size: 15px; white-space: nowrap; }
    .pc-s-ask { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px 0 4px; border-radius: 10px;
      background: #0a5cc4 !important; font-weight: 700; font-size: 14px; white-space: nowrap; flex-shrink: 0; }
    .pc-s-ask img { width: 32px; height: 32px; border-radius: 8px; display: block; }
    .pc-s-ask:hover { background: #084a9e !important; }
    .pc-s-flash { position: absolute; left: 0; right: 0; bottom: 64px; padding: 12px 16px; border-radius: 12px;
      background: #fff; color: #0f1b2d; font-size: 14px; box-shadow: 0 6px 24px rgba(0,0,0,.25); cursor: pointer; text-align: center; }
    .pc-s-flash.pc-ok { background: #1a8f3c; color: #fff; font-weight: 700; }
    .pc-s-flash[hidden] { display: none; }
    #pc-s-sheet { position: fixed; inset: 0; z-index: 999998; background: rgba(0,0,0,.35); display: flex; align-items: flex-end; justify-content: center; }
    #pc-s-sheet[hidden] { display: none; }
    .pc-s-panel { width: min(680px, 100vw); max-height: 70vh; margin-bottom: 80px; background: #fff; color: #0f1b2d;
      border-radius: 14px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,.3); }
    .pc-s-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid #e6ebf2; font-size: 16px; }
    .pc-s-x { border: 0; background: none; font-size: 18px; cursor: pointer; width: 36px; height: 36px; }
    .pc-s-rows { overflow-y: auto; -webkit-overflow-scrolling: touch; }
    .pc-s-row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #f0f3f7; color: inherit !important; text-decoration: none !important; }
    .pc-s-row:hover { background: #f4f8fd; }
    .pc-s-cur { background: #eaf2fe; }
    .pc-s-mark { width: 28px; height: 28px; border-radius: 50%; background: #e6ebf2; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; flex-shrink: 0; }
    .pc-s-row .pc-s-mark:not(:empty) { }
    .pc-s-name { flex: 1; min-width: 0; font-size: 14px; line-height: 1.3; }
    .pc-s-art { display: block; font-size: 11px; font-weight: 700; color: #0a5cc4; }
    .pc-s-price { font-weight: 700; font-size: 14px; white-space: nowrap; }
    @media (max-width: 540px) {
      #pc-strip { bottom: 0; width: 100vw; border-radius: 14px 14px 0 0; height: calc(56px + env(safe-area-inset-bottom, 0px));
        padding: 0 4px env(safe-area-inset-bottom, 0px); gap: 2px; }
      .pc-s-lbl, .pc-s-title { display: none; }
      .pc-s-count { font-size: 14px; }
      .pc-s-ask { padding: 0 10px 0 4px; font-size: 13px; }
      .pc-s-ask img { width: 28px; height: 28px; }
      .pc-s-list { padding: 0 10px; }
      .pc-s-flash { left: 8px; right: 8px; }
      .pc-s-panel { width: 100vw; margin-bottom: 0; border-radius: 16px 16px 0 0; max-height: 80vh; padding-bottom: calc(60px + env(safe-area-inset-bottom, 0px)); }
      #pc-s-sheet { z-index: 999996; }
    }
  `;

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
    // The "/AI" logo (agent-avatar.jpg), same as the header avatar and the
    // per-message icons; falls back to the inline headset SVG if it fails to load.
    window.__pcIconAgentFallback = ICON_AGENT; // used by the inline onerror string below (runs in global scope, can't see closure vars)
    launcher.innerHTML = `<img src="${INLINE_AVATAR_URL}" alt="" onerror="this.parentElement.innerHTML = window.__pcIconAgentFallback;">`; // the "/AI" logo (owner, 26.10; was AI_Agent.png)
    launcher.setAttribute('aria-label', 'Открыть ИИ-консультанта');
    launcher.addEventListener('click', toggle);
    document.body.appendChild(launcher);

    const panel = document.createElement('div');
    panel.id = 'pc-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'ИИ-Консультант по запчастям');
    panel.innerHTML = `
      <div id="pc-header">
        <div class="pc-avatar">${INLINE_AVATAR_IMG}</div>
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
      <div class="pc-powered">Разработано: <a href="https://assistant24info.ru/recom.html" target="_blank" rel="noopener">ASSISTANT24</a></div>
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
      window.addEventListener('load', updateBleed); // header logo / images change the header height
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
      convId           = restored.convId || null;
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
    if (initStrip()) return; // selected part's page: the strip replaces the round button and its teasers
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
      if (panel.classList.contains('pc-compact')) closeGapPhone(panel);
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

  // Phones: the photo starts right under the site's search field (owner,
  // 26.10: a grey strip of ~25 px between them). On phones the search field is
  // a separate block under the header, so measure the lowest of the header and
  // the search form ABOVE the hero, and close only a small gap (<= 60 px), so a
  // changed ABCP layout can never pull the photo over the search field.
  function closeGapPhone(panel) {
    const top = panel.getBoundingClientRect().top;
    if (top <= 0 || top >= window.innerHeight) return; // only measurable while on screen (on load it is)
    // Walk up from the photo's top edge until a point hits the search field or
    // the header: everything in between (grey page background, empty blocks,
    // margins) is the gap.
    const search = document.querySelector('input[placeholder*="номеру детали"], input[placeholder*="номер детали"]');
    const searchBox = search && (search.closest('form') || search.parentElement);
    const isAbove = el => !!(el.closest('header') || (searchBox && searchBox.contains(el)));
    const x = Math.min(24, window.innerWidth / 2);
    let gap = -1;
    for (let d = 1; d <= 61; d++) {
      const el = document.elementFromPoint(x, top - d);
      if (!el) break;
      if (isAbove(el)) { gap = d - 1; break; } // reached the search field / header
    }
    if (gap <= 0 || gap > 60) return; // not found nearby: leave the layout alone
    const current = parseFloat(getComputedStyle(panel).marginTop) || 0;
    panel.style.marginTop = (current - gap) + 'px';
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
    document.documentElement.classList.add('pc-chat-open');
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
    document.documentElement.classList.remove('pc-chat-open');
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
    convId           = null;
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

  // Bot icon next to messages: the "/AI" logo (agent-avatar.jpg) on every page.
  // Same avatar everywhere since 26.10 (owner): the square "/AI" logo.
  function botIconHtml() {
    return INLINE_AVATAR_IMG;
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
  // Shown from ~25 s on and kept (not rotated): a model the bot has never
  // looked up takes up to a minute in the original catalog (29.10).
  const TYPING_STATUS_LONG = 'Проверяю оригинальный каталог — для новой модели это может занять до минуты…';
  const TYPING_STATUS_LONG_MS = 25000;
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
        <div class="pc-typing-done" id="pc-typing-done"></div>
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
      const startedAt = Date.now();
      const rotateInterval = setInterval(() => {
        if (Date.now() - startedAt + TYPING_STATUS_DELAY_MS >= TYPING_STATUS_LONG_MS) {
          const el3 = document.getElementById('pc-typing-status');
          if (el3 && el3.textContent !== TYPING_STATUS_LONG) {
            el3.classList.remove('pc-visible');
            setTimeout(() => { const e = document.getElementById('pc-typing-status'); if (e) { e.textContent = TYPING_STATUS_LONG; e.classList.add('pc-visible'); } }, 300);
          }
          return;
        }
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

  // ─── Real steps from the server ─────────────────────────────────────────
  // /api/chat streams what it is actually doing (reading the question, finding
  // the car, opening catalog sections, checking prices, writing the answer).
  // The first real step replaces the timed messages above for good; finished
  // steps stay listed with a ✓ (last few), the current one sits next to the
  // dots, with its seconds once it takes a while.
  const STEP_SHOW_DELAY_MS = 1000; // a fast reply shows only the dots
  const STEP_ELAPSED_FROM_MS = 8000;
  const STEP_DONE_MAX = 4;
  let liveSteps = null; // { list: [], current, since, shown, timers }

  function startLiveSteps() {
    stopLiveSteps();
    liveSteps = { list: [], current: null, since: 0, shown: false, timers: [] };
  }

  function stopLiveSteps() {
    if (liveSteps) liveSteps.timers.forEach(t => clearTimeout(t) || clearInterval(t));
    liveSteps = null;
  }

  function renderLiveSteps() {
    const st = liveSteps;
    const doneEl = document.getElementById('pc-typing-done');
    const statusEl = document.getElementById('pc-typing-status');
    if (!st || !st.shown || !doneEl || !statusEl) return;
    const done = st.list.slice(-STEP_DONE_MAX);
    if (doneEl.childElementCount !== done.length || (done.length && doneEl.lastChild.textContent !== done[done.length - 1])) {
      doneEl.innerHTML = '';
      done.forEach(t => { const d = document.createElement('div'); d.className = 'pc-typing-step'; d.textContent = t; doneEl.appendChild(d); });
    }
    const secs = Math.floor((Date.now() - st.since) / 1000);
    statusEl.textContent = st.current || '';
    if (st.current && secs * 1000 >= STEP_ELAPSED_FROM_MS) {
      const e = document.createElement('span'); e.className = 'pc-typing-elapsed'; e.textContent = `${secs} с`;
      statusEl.appendChild(e);
    }
    statusEl.classList.add('pc-visible');
    // keep the bubble in view while it grows, unless the visitor scrolled up
    const c = document.getElementById('pc-messages');
    if (c && c.scrollHeight - c.scrollTop - c.clientHeight < 120) c.scrollTop = c.scrollHeight;
  }

  function onLiveStep(text) {
    const st = liveSteps;
    if (!st || !text) return;
    if (!st.started) {
      // the server streams: the timed placeholder text is not needed any more
      st.started = true;
      clearTypingStatusTimers();
      const statusEl = document.getElementById('pc-typing-status');
      if (statusEl) { statusEl.classList.remove('pc-visible'); statusEl.textContent = ''; }
      st.timers.push(setTimeout(() => { if (liveSteps === st) { st.shown = true; renderLiveSteps(); } }, STEP_SHOW_DELAY_MS));
      st.timers.push(setInterval(() => { if (liveSteps === st) renderLiveSteps(); }, 1000));
    }
    if (st.current) st.list.push(st.current.replace(/…$/, ''));
    st.current = text;
    st.since = Date.now();
    renderLiveSteps();
  }

  function removeTypingIndicator() {
    clearTypingStatusTimers();
    stopLiveSteps();
    const el = document.getElementById('pc-typing');
    if (el) el.remove();
  }

  // Reads /api/chat's reply: NDJSON with live steps (we ask with stream: true)
  // or, from a server without streaming, the plain JSON as before.
  async function readChatReply(res, onStep) {
    const type = (res.headers && res.headers.get('content-type')) || '';
    if (!/ndjson/i.test(type)) {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }
    let final = null;
    let buf = '';
    const handle = line => {
      if (!line.trim()) return;
      let o;
      try { o = JSON.parse(line); } catch (_) { return; }
      if (o.step) onStep(String(o.step));
      if (o.done) final = o;
    };
    if (res.body && typeof res.body.getReader === 'function' && typeof TextDecoder !== 'undefined') {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
      }
      buf += dec.decode();
    } else {
      buf = await res.text();
    }
    buf.split('\n').forEach(handle);
    if (!final) throw new Error('reply stream ended early');
    if (final.status >= 400) throw new Error(`HTTP ${final.status}`);
    return final.body || {};
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
        } else if (/связаться с менеджером|оставить заявку/i.test(label)) {
          // The AI's quick button «📞 Связаться с менеджером»: open the request
          // form right away -- sent as a message it went into the part search
          // (live 03.11: answered with a variant question instead).
          openLeadForm();
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

    const btn = document.createElement('button');
    btn.type       = 'button';
    btn.className  = 'pc-manager-btn';
    btn.innerHTML  = `
      ${ICON_PHONE}
      <div class="pc-manager-btn-label">
        <span class="pc-manager-btn-title">Оставить заявку менеджеру</span>
        <span class="pc-manager-btn-sub">менеджер свяжется с вами</span>
      </div>
    `;
    btn.addEventListener('click', () => openLeadForm());

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
    // Several offered parts of one unit (26.10): one card, every position marked.
    const marks = Array.isArray(d.marks) && d.marks.length ? d.marks : [d];
    const captionOf = m => `${m.position ? `Поз. ${escHtml(m.position)} — ` : ''}<b>${escHtml(m.oem || '')}</b>${m.name ? ' — ' + escHtml(m.name) : ''}${m.qty ? ' (' + escHtml(m.qty) + ')' : ''}`;
    wrap.innerHTML = `
      <div class="pc-diagram-title">🛠 Схема${d.unitName ? ': ' + escHtml(d.unitName) : ''}</div>
      <a class="pc-diagram-frame" href="${escHtml(src)}" target="_blank" rel="noopener" title="Открыть схему крупно">
        <img alt="Схема узла" loading="lazy">
        ${marks.map(() => '<span class="pc-diagram-mark"></span>').join('')}
      </a>
      ${marks.map(m => `<div class="pc-diagram-caption">${captionOf(m)}</div>`).join('')}
      ${d.notes && typeof d.notes === 'object' && Object.keys(d.notes).length ? `<div class="pc-diagram-note" style="color:#444;">${Object.entries(d.notes).slice(0, 3).map(([k, v]) => /не производ|снят/i.test(k + ' ' + v) ? `<span style="color:#c00;font-weight:600;">⚠ ${escHtml(k)}: ${escHtml(v)}</span>` : `${escHtml(k)}: ${escHtml(v)}`).join(' · ')}</div>` : ''}
      ${kitHtml(d.kit)}
      <div class="pc-diagram-note">Оригинальный каталог производителя${marks.some(m => m.box) ? (marks.length > 1 ? ' · позиции отмечены красным' : ' · позиция отмечена красным') : ''}</div>`;
    const img = wrap.querySelector('img');
    const markEls = wrap.querySelectorAll('.pc-diagram-mark');
    const place = () => {
      if (!img.naturalWidth) return;
      const k = img.clientWidth / img.naturalWidth;
      const pad = 3;
      marks.forEach((m, i) => {
        const mark = markEls[i];
        if (!m.box || !mark) return;
        mark.style.left = `${m.box.x * k - pad}px`;
        mark.style.top = `${m.box.y * k - pad}px`;
        mark.style.width = `${(m.box.w || 12) * k + pad * 2}px`;
        mark.style.height = `${(m.box.h || 16) * k + pad * 2}px`;
        mark.style.display = 'block';
      });
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

  // ─── DIAGRAM CARDS (owner, 30.10) ───────────────────────────────────────────
  // A part that fits by the BMW catalog but has no photo in the price list gets
  // a normal product card with the catalog diagram as its picture. The diagram
  // comes with the reply (from the catalog's group page); the part's position
  // (box) is loaded afterwards from /api/part-diagram, then the picture zooms
  // in on the part and marks it red. Tap -> the full diagram in a new tab.
  function diagramSrc(url) { return url ? `${BASE_URL}/api/laximo-image?u=${encodeURIComponent(url)}` : ''; }
  function layoutDiagram(frame, img, mark, box, whole) {
    const cw = frame.clientWidth, ch = frame.clientHeight, nw = img.naturalWidth, nh = img.naturalHeight;
    if (!cw || !ch || !nw || !nh) return;
    let rx = 0, ry = 0, rw = nw, rh = nh;
    if (!whole && box && box.x != null && box.y != null) { // whole = tyres/wheels: full picture (owner 04.11)
      const bw = box.w || 12, bh = box.h || 16;
      rw = Math.min(nw, Math.max(Math.max(bw, bh) * 9, nw * 0.4));
      rh = rw * ch / cw;
      if (rh > nh) { rh = nh; rw = rh * cw / ch; }
      const cx = box.x + bw / 2, cy = box.y + bh / 2;
      rx = Math.min(Math.max(cx - rw / 2, 0), Math.max(nw - rw, 0));
      ry = Math.min(Math.max(cy - rh / 2, 0), Math.max(nh - rh, 0));
    }
    const k = Math.min(cw / rw, ch / rh);
    const offX = (cw - rw * k) / 2, offY = (ch - rh * k) / 2;
    img.style.width = `${nw * k}px`; img.style.height = `${nh * k}px`;
    img.style.left = `${offX - rx * k}px`; img.style.top = `${offY - ry * k}px`;
    img.style.display = 'block';
    if (mark) {
      if (box && box.x != null) {
        const pad = 3;
        mark.style.left = `${offX + (box.x - rx) * k - pad}px`;
        mark.style.top = `${offY + (box.y - ry) * k - pad}px`;
        mark.style.width = `${(box.w || 12) * k + pad * 2}px`;
        mark.style.height = `${(box.h || 16) * k + pad * 2}px`;
        mark.style.display = 'block';
      } else mark.style.display = 'none';
    }
  }
  function diagramCardHtml(d) {
    const pos = d && d.position ? String(d.position).replace(/^0+(?=\d)/, '') : '';
    return `<div class="pc-product-img pc-diag-img" title="Схема BMW — нажмите, чтобы открыть крупно">
        <img alt="Схема BMW">
        <span class="pc-diag-mark"></span>
        <span class="pc-diag-wait">схема загружается…</span>
        <span class="pc-diag-badge">Схема BMW</span>
        ${pos ? `<span class="pc-diag-pos">поз. ${escHtml(pos)}</span>` : ''}
      </div>`;
  }
  function initDiagramCard(card, d) {
    const frame = card.querySelector('.pc-diag-img');
    if (!frame || !d) return;
    const img = frame.querySelector('img'), mark = frame.querySelector('.pc-diag-mark'), wait = frame.querySelector('.pc-diag-wait');
    const whole = !!d.whole; // tyres/wheels (server flag): full picture, no zoom
    let box = d.box || null, full = d.image || null; // ТО cards bring their marker with them
    const showFallback = () => { if (!img.naturalWidth) { wait.textContent = '🔩'; wait.style.fontSize = '42px'; } };
    img.addEventListener('load', () => { wait.style.display = 'none'; layoutDiagram(frame, img, mark, box, whole); });
    img.addEventListener('error', showFallback);
    window.addEventListener('resize', () => layoutDiagram(frame, img, mark, box, whole));
    // The card is built before the carousel is on the page (size 0): lay out again once it has a size.
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => layoutDiagram(frame, img, mark, box, whole)).observe(frame);
    else setTimeout(() => layoutDiagram(frame, img, mark, box, whole), 300);
    frame.addEventListener('click', () => { if (full) window.open(diagramSrc(full), '_blank', 'noopener'); });
    if (!d.ref) { if (d.image) img.src = diagramSrc(d.image); else showFallback(); return; }
    // The picture first, the marker after: marker requests wait in a small
    // queue (2 at a time) so they never hold up the diagram images themselves.
    const askMarker = () => diagramQueue(() => fetch(`${BASE_URL}/api/part-diagram?t=${encodeURIComponent(d.ref)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!j || !j.image) { if (!d.image) showFallback(); return; }
        box = j.box || null;
        full = j.image;
        const src = diagramSrc(j.image);
        if (img.getAttribute('src') !== src) img.src = src; // the unit page's own picture (box coordinates match it)
        else layoutDiagram(frame, img, mark, box, whole);
      })
      .catch(() => { if (!d.image) showFallback(); }));
    if (d.image) {
      let asked = false;
      const go = () => { if (!asked) { asked = true; askMarker(); } };
      img.addEventListener('load', go, { once: true });
      img.addEventListener('error', go, { once: true });
      img.src = diagramSrc(d.image);
    } else askMarker();
  }
  // At most 2 marker requests at a time (the server queues Laximo anyway).
  const diagramJobs = [];
  let diagramRunning = 0;
  function diagramQueue(job) {
    diagramJobs.push(job);
    const pump = () => {
      while (diagramRunning < 2 && diagramJobs.length) {
        const next = diagramJobs.shift();
        diagramRunning++;
        Promise.resolve().then(next).catch(() => {}).finally(() => { diagramRunning--; pump(); });
      }
    };
    pump();
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
      const isDiagram = !!(p.diagram && typeof p.diagram === 'object');
      // Diagram card: the site search for the number (all offers, prices, delivery).
      if (isDiagram && !p.url) p.url = `${SITE_URL}/search?pcode=${encodeURIComponent(String(p.article || '').toUpperCase().replace(/[^A-Z0-9]/g, ''))}`;
      const stockLabel = isDiagram
        ? (p.inStock ? '<span style="color:#1a8f3c">В наличии</span>'
          : Number(p.days) > 0 ? `Срок ~${Number(p.days)} дн.`
          : p.priceFrom ? ''
          : p.slowDelivery ? '<span style="color:#7a8591">Срок больше 3 дней — уточнит менеджер</span>'
          : '<span style="color:#7a8591">Цена и срок — уточнит менеджер</span>')
        : (stockNum > 0)
          ? `В наличии: ${stockNum} шт.`
          : '<span style="color:#c00">Под заказ</span>';

      card.innerHTML = `
        ${isDiagram ? diagramCardHtml(p.diagram)
          : p.picture
          ? `<img class="pc-product-img" src="${escHtml(p.picture)}" alt="${escHtml(p.article)}" loading="lazy" onerror="this.style.display='none'">`
          : `<div class="pc-product-img-ph">🔩</div>`
        }
        <div class="pc-product-body">
          <div class="pc-product-code">${escHtml(p.article || '')}</div>
          <div class="pc-product-name">${escHtml(p.name || '')}</div>
          <div class="pc-product-meta">${escHtml(p.brand || '')}${p.category ? ' · ' + escHtml(p.category) : ''}</div>
          ${p.compatibility ? `<div class="pc-product-meta">Подходит: ${escHtml(p.compatibility)}</div>` : ''}
          <div class="pc-product-price">${priceNum > 0 ? (isDiagram && p.priceFrom ? 'от ' : '') + priceNum.toLocaleString('ru-RU') + ' ₽' : ''}</div>
          <div class="pc-product-stock">${stockLabel}</div>
          ${p.best_for ? `<div class="pc-product-bestfor">${escHtml(p.best_for)}</div>` : ''}
        </div>
        ${p.url ? `<a class="pc-product-link" href="${escHtml(p.url)}" target="_blank" rel="noopener">Подробнее →</a>` : ''}
      `;
      const link = card.querySelector('.pc-product-link');
      if (link) link.addEventListener('click', () => logEvent('product_open', cardInfo(p), true));
      if (!p.picture && p.url && !isDiagram) needImage.push({ p, ph: card.querySelector('.pc-product-img-ph') });
      track.appendChild(card);
      if (isDiagram) initDiagramCard(card, p.diagram);
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
    let contactForm = false;
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

    if (text.includes('<<<CONTACT_FORM>>>')) {
      contactForm = true;
      text = text.replace(/<<<CONTACT_FORM>>>/g, '').trim();
    }
    // Older server: contacts typed in the chat started the handoff by
    // themselves. Now the request form is the only path.
    text = text.replace(/<<<AUTO_MANAGER_HANDOFF>>>/g, '').trim();

    // Removing the blocks above leaves the blank lines that surrounded them
    // (e.g. "...масляный фильтр:\n\n<<<PRODUCTS>>>...\n\nЭтот артикул...").
    // Every \n renders as <br>, so those show up as a large empty gap in the
    // bubble. Collapse any run of blank lines to a single blank line.
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    return { text, products, buttons, showManager, contactForm, partLinks, diagram, diagrams };
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

    startLiveSteps();
    let gotStep = false;
    const fetchWithRetry = async (retries = 1) => {
      try {
        const controller = new AbortController();
        // 150 s: a first lookup of a car by model can take a minute in the
        // catalog, plus the answer (29.10). At 60 s the widget used to give up
        // and send the whole message again. Covers reading the streamed reply too.
        const timer = setTimeout(() => controller.abort(), 150000);
        try {
          const res = await fetch(AGENT_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ messages: trimmedMessages, stream: true, conv_id: convId || (convId = newConvId()), session_id: sessionId || null }),
            signal:  controller.signal,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return await readChatReply(res, t => { gotStep = true; onLiveStep(t); });
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        // No resend after our own timeout: the server is still working on it.
        // Nor once the server has reported a step: it got the message.
        if (retries > 0 && err && err.name !== 'AbortError' && !gotStep) {
          await new Promise(r => setTimeout(r, 1500));
          return fetchWithRetry(retries - 1);
        }
        throw err;
      }
    };

    try {
      const data = await fetchWithRetry(1);
      const raw  = data.reply || '';

      removeTypingIndicator();

      const { text, products, buttons, showManager, contactForm, partLinks, diagram, diagrams } = parseBotResponse(raw);

      if (!sessionStartPromise) {
        await startSession();
        // The session is created only after the first reply, so the first
        // message is logged now. It's the first entry in `messages`.
        const first = messages.find(m => m.role === 'user');
        if (first) logEvent('first_message', { text: first.content, placement: inlineHost ? 'inline' : 'bubble' });
      }
      // Original catalog (Laximo) used for this message: ok / blocked (dashboard «Подбор» dot).
      if (data.catalog && typeof data.catalog === 'object') logEvent('laximo', data.catalog);

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
          .replace(/<<<CONTACT_FORM>>>/g, '')
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
        // one button per marked part (several when the card marks several)
        for (const m of (Array.isArray(d.marks) && d.marks.length ? d.marks : [d])) {
          const own = restLinks.filter(c => normCode(c) === normCode(m.oem));
          if (own.length) {
            restLinks = restLinks.filter(c => normCode(c) !== normCode(m.oem));
            addPartLinks(own);
            displayLog.push({ type: 'partlinks', payload: own });
          } else if (m.oem) {
            const link = { oem: m.oem, productUrl: m.productUrl || null };
            addDiagramLink(link);
            displayLog.push({ type: 'diaglink', payload: link });
          }
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
      if (contactForm) {
        // The customer typed a phone/email into the chat: the AI saw only a
        // mask. Open the request form with that contact filled in (taken
        // here, in the browser, from what they typed).
        const lastUser = [...messages].reverse().find(m => m.role === 'user');
        openLeadForm(contactsInText(lastUser && lastUser.content));
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
  // ask(text): open the chat and send `text` as if the visitor typed it --
  // e.g. the delivery page's «Отследить заказ» sends «Где мой заказ?» (29.10).
  // While an answer is still coming, only opens the chat.
  function ask(text) {
    open();
    const t = String(text || '').trim();
    if (!t || isLoading) return;
    setTimeout(() => { if (!isLoading) doSend(t); }, inlineHost ? 0 : 250);
  }
  window.AutoChat = { open, close, toggle, ask };

  // ─── BOOT ────────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
