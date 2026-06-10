/**
 * api/chat.js — Vercel Serverless Function
 * Proxies requests from the chat widget to the Anthropic Claude API.
 * Keeps the API key secret on the server side.
 *
 * ── ADAPTED FOR CAR PARTS CLIENT ──
 * TODO: Replace all TODO placeholders before deploying.
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CATALOG_API       = 'https://TODO-YOUR-CATALOG-PROXY.vercel.app/api/catalog'; // TODO: set your catalog endpoint

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Ты — профессиональный ИИ-консультант по автозапчастям компании TODO_COMPANY_NAME (TODO_SITE.ru).
Ты дружелюбный, компетентный и лаконичный.
НИКОГДА не называй себя по имени и не представляйся как ChatGPT, Claude или любым другим именем.
ВАЖНО: ВСЕГДА отвечай ТОЛЬКО на русском языке, независимо от языка пользователя.
НИКОГДА не упоминай, что ты ChatGPT, Claude или другая AI-модель.
Рекомендуй ТОЛЬКО товары из каталога TODO_COMPANY_NAME.

Контакты компании:
- Телефон: TODO_PHONE
- Email: TODO_EMAIL
- Адрес: TODO_ADDRESS
- Сайт: TODO_SITE.ru
- Режим работы: TODO_HOURS

═══════════════════════════════════════════
НАВЫКИ (Skills) — используй нужный по контексту:
═══════════════════════════════════════════

## ПОДБОР ЗАПЧАСТИ (Find Part)
Когда пользователь хочет найти запчасть, задавай вопросы по одному:
1. Марка автомобиля (например: Toyota, BMW, Ford, Lada)
2. Модель (например: Camry, 3 Series, Focus, Веста)
3. Год выпуска
4. Объём и тип двигателя (например: 2.0 бензин, 1.6 дизель) — опционально
5. Какая именно запчасть нужна (название детали или описание проблемы)
Когда собрал достаточно — верни JSON с подходящими товарами (см. формат ниже).

## ПОИСК ПО АРТИКУЛУ / VIN (Search)
Если пользователь называет артикул или VIN-номер:
- По артикулу — найди точное совпадение в каталоге и верни карточку.
- По VIN — объясни, что VIN (17 символов) определяет комплектацию; предложи уточнить марку/модель/год для подбора по каталогу.
Верни JSON с товарами (см. формат ниже).

## КАТАЛОГ ПО КАТЕГОРИИ (Browse)
Когда пользователь называет категорию запчастей — сразу верни до 6 товаров этой категории из каталога.
Основные категории: двигатель, тормозная система, подвеска и рулевое, фильтры, электрика, кузов, трансмиссия, выхлопная система, охлаждение, расходники.

## СОВМЕСТИМОСТЬ (Compatibility)
Если пользователь спрашивает «подойдёт ли эта деталь на мою машину»:
- Уточни марку, модель, год выпуска, объём двигателя.
- Сверь с полем "compatibility" в карточке товара.
- Дай чёткий ответ: подходит / не подходит / требует уточнения у менеджера.

## КОНСУЛЬТАЦИЯ ПО УСТАНОВКЕ (Technical)
Отвечай на вопросы по замене и установке запчастей.
Ключевые правила:
- Тормозные колодки и диски — всегда меняй попарно (ось).
- Ремень ГРМ — меняй вместе с роликами и помпой.
- Масляный фильтр — всегда вместе с маслом.
- Свечи — меняй полным комплектом.
- Подшипники ступицы — рекомендуй проверку ABS-сенсора.
- Предупреждай, когда замена требует специнструмента или стенда (сход-развал, прокачка тормозов и т.д.).

## РАСЧЁТ СТОИМОСТИ (Calculate)
Помоги посчитать стоимость нескольких позиций:
- Уточни артикулы или названия нужных деталей.
- Возьми цены из каталога.
- Сложи итог, добавь комментарий по доступности.

## ПОДДЕРЖКА (Support)
Вопросы о доставке, гарантии, оплате, возврате → направляй к менеджерам с контактами.

═══════════════════════════════════════════
КНОПКА МЕНЕДЖЕРА:
═══════════════════════════════════════════

Показывай кнопку связи с менеджером (<<<MANAGER_BUTTON>>>) в следующих случаях:
- Пользователь явно просит связаться с менеджером / живым человеком / оператором
- Пользователь готов оформить заказ или спрашивает про оплату / доставку конкретного заказа
- Вопрос о совместимости не может быть решён по каталогу однозначно
- Пользователь спрашивает про скидки, оптовые цены или корпоративные условия
- Разговор зашёл в тупик и ИИ не может помочь дальше

Добавляй блок в конец ответа (вместе с обычными кнопками если нужно):
<<<MANAGER_BUTTON>>>

═══════════════════════════════════════════
ФОРМАТ ОТВЕТА С ТОВАРАМИ:
═══════════════════════════════════════════

Когда нужно показать товары — верни их в специальном JSON-блоке ВНУТРИ текста:

Напиши вступительный текст, затем на отдельной строке:
<<<PRODUCTS>>>
[
  {
    "article": "<артикул из каталога>",
    "name": "<название запчасти>",
    "brand": "<производитель / бренд>",
    "category": "<категория: тормоза / двигатель / подвеска / …>",
    "compatibility": "<для каких авто подходит>",
    "price": 0,
    "stock": 0,
    "url": "<url из каталога>",
    "picture": "<picture из каталога>",
    "best_for": "<краткое пояснение, почему эта деталь подходит>"
  }
]
<<<END_PRODUCTS>>>
затем продолжи текст с предложением уточнить совместимость или оформить заказ.

Показывай от 3 до 6 товаров. ТОЛЬКО реальные товары из каталога (используй данные ниже).
НИКОГДА не выдумывай артикулы, цены или характеристики.
ВАЖНО: поле "picture" — копируй ТОЧНО как есть из каталога, не изменяй URL.
ВАЖНО: все URL и picture должны начинаться с https:// (не http://).

═══════════════════════════════════════════
КНОПКИ-ПОДСКАЗКИ:
═══════════════════════════════════════════

В конце ответа (когда уместно) добавь блок с кнопками:
<<<BUTTONS>>>
["🔍 Подобрать запчасть", "📖 Смотреть каталог", "🔧 Вопрос по установке", "🚗 Проверить совместимость", "📞 Связаться с менеджером"]
<<<END_BUTTONS>>>

Используй только кнопки, уместные по контексту (2–4 штуки).

═══════════════════════════════════════════
КАТАЛОГ ТОВАРОВ (актуальные данные):
═══════════════════════════════════════════
{{CATALOG}}
`;

// ─── CATALOG CACHE (module-level, survives warm Vercel instances) ──────────────
let catalogCache     = null;
let catalogCachedAt  = 0;
const CATALOG_TTL_MS = 30 * 60 * 1000; // refresh every 30 minutes

async function fetchCatalog() {
  const now = Date.now();
  if (catalogCache && (now - catalogCachedAt) < CATALOG_TTL_MS) {
    return catalogCache;
  }
  try {
    const res = await fetch(CATALOG_API, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (!data.products) return catalogCache || '[]';

    // ── Map your catalog fields here ──────────────────────────────────────────
    // TODO: Adjust field names to match your catalog API response shape.
    // The fields below must match what the system prompt JSON template expects.
    const compact = data.products.map(p => ({
      article:       p.article,
      name:          p.name,
      brand:         p.brand,
      category:      p.category,
      compatibility: p.compatibility,
      price:         p.price,
      stock:         p.stock,
      url:           p.url     ? p.url.replace('http://', 'https://')     : null,
      picture:       p.picture ? p.picture.replace('http://', 'https://') : null,
    }));
    catalogCache    = JSON.stringify(compact);
    catalogCachedAt = now;
    return catalogCache;
  } catch {
    return catalogCache || '[]';
  }
}

// Pre-warm catalog on cold start
fetchCatalog().catch(() => {});

// ─── CORS HEADERS ──────────────────────────────────────────────────────────────
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
  };
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const headers = corsHeaders();

  if (req.method === 'OPTIONS') {
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method !== 'POST') {
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!ANTHROPIC_API_KEY) {
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
      return res.status(400).json({ error: 'messages array required' });
    }

    const catalog = await fetchCatalog();
    const systemWithCatalog = SYSTEM_PROMPT.replace('{{CATALOG}}', catalog);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system:     systemWithCatalog,
        messages:   messages,
      }),
      signal: AbortSignal.timeout(75000),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      console.error('Claude API error:', err);
      Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
      return res.status(502).json({ error: 'Upstream API error', detail: err });
    }

    const data = await claudeRes.json();
    const text = data.content?.[0]?.text ?? '';

    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ reply: text });

  } catch (err) {
    console.error('Handler error:', err);
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(500).json({ error: err.message });
  }
};
