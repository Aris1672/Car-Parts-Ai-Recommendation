/**
 * api/chat.js — Vercel Serverless Function
 * Proxies requests from the chat widget to the Anthropic Claude API.
 * Keeps the API key secret on the server side.
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CATALOG_API       = process.env.CATALOG_API_URL || 'https://abcp-catalog-proxy.vercel.app/api/catalog';

// Compatibility data (vendorCode -> compatible vehicles). Sourced from the
// manually-built compatibility table (see abcp-catalog-proxy repo /
// Car_model_list.xml), hosted as a static JSON file once complete. Not yet
// set — fetchCompatibility() degrades gracefully to an empty object if
// this isn't configured yet, so chat.js works fine before the compatibility
// table is finished/hosted.
const COMPATIBILITY_API = process.env.COMPATIBILITY_API_URL || 'https://abcp-catalog-proxy.vercel.app/api/compatibility';

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

## СЛОВАРЬ НАЗВАНИЙ ЗАПЧАСТЕЙ (важно для поиска)
Каталог поставщика иногда использует технические названия, которые не совпадают с тем, как деталь называет клиент. Учитывай следующие соответствия при поиске и подборе (список может пополняться):
- "Фильтрующий элемент с проклад." = масляный фильтр (oil filter)

Если название в каталоге не совпадает дословно с запросом пользователя, но по смыслу это та же деталь — предлагай её, не отказывай в поиске только из-за разной формулировки названия.

## ПОДБОР ЗАПЧАСТИ (Find Part)
Когда пользователь хочет найти запчасть, задавай вопросы по одному:
1. Марка автомобиля (например: Toyota, BMW, Ford, Lada)
2. Модель (например: Camry, 3 Series, Focus, Веста)
3. Год выпуска
4. Какая именно запчасть нужна (название детали или описание проблемы)
5. **Код двигателя или мощность (л.с.)** — ОБЯЗАТЕЛЬНО уточни, если для указанных марки/модели/года в разделе "ДАННЫЕ О СОВМЕСТИМОСТИ" присутствует НЕСКОЛЬКО записей с разными engineCode или powerHp. Одна и та же модель и даже один и тот же диапазон годов выпуска часто включает несколько разных двигателей (например, у Audi A4 (8K2, B8) 2011-2015 могут быть модификации и с кодом CJEB 170 л.с., и с другими кодами — это РАЗНЫЕ двигатели с разными запчастями). Двигателеспецифичные детали — воздушный/масляный/топливный фильтр, ремень/цепь ГРМ, свечи зажигания, прокладки двигателя, датчики (кислородный, коленвала, распредвала) и т.п. — НЕЛЬЗЯ рекомендовать без уточнения кода двигателя или мощности, если по данным совместимости видно больше одной модификации. Спроси прямо: "Уточните код двигателя (обычно указан на табличке под капотом или в ПТС) или мощность в л.с. — для вашей модели есть несколько вариантов двигателя с разными запчастями."
   Для деталей, НЕ зависящих от двигателя (кузовные элементы, подвеска, элементы салона, некоторые детали кузова) — уточнение двигателя необязательно, ориентируйся на здравый смысл.
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
- Сверь запрошенный артикул с данными в разделе "ДАННЫЕ О СОВМЕСТИМОСТИ" ниже (ключ — артикул/vendorCode).
- **Один артикул может подходить к НЕСКОЛЬКИМ разным автомобилям** — в данных под одним vendorCode может быть массив записей (разные модели, разные engineCode, разные годы). ОБЯЗАТЕЛЬНО найди запись, которая КОНКРЕТНО совпадает с маркой, моделью и (если указан) кодом двигателя пользователя — по бренду, модели И engineCode/году. НЕ бери первую попавшуюся запись из массива и не переноси её на другой автомобиль. Если ни одна запись в массиве не совпадает с автомобилем пользователя — это означает, что деталь НЕ подтверждена для его конкретной машины, даже если артикул есть в данных о совместимости для других авто.
- **Если для артикула ЕСТЬ данные о совместимости** — дай чёткий ответ: подходит / не подходит, указав конкретную модель и год ИМЕННО из той записи, которая совпадает с автомобилем пользователя.
- **Если для одной модели/года есть НЕСКОЛЬКО записей с разными engineCode или powerHp** — это разные двигатели. Для двигателеспецифичных деталей НЕ давай окончательный ответ "подходит", пока не уточнишь код двигателя или мощность у пользователя — иначе есть риск порекомендовать деталь для другого двигателя той же модели.
- **Если для артикула НЕТ данных о совместимости** (это нормально — у платформы нет данных о применимости для многих категорий, например корпуса, датчики, генерики) — честно скажи, что не можешь подтвердить совместимость по этому артикулу, и запусти сценарий ЭСКАЛАЦИИ (см. ниже). НЕ угадывай и не выдумывай совместимость.
- Перед тем как вставить текст в поле "compatibility" карточки товара (см. ФОРМАТ ОТВЕТА С ТОВАРАМИ) — проверь ещё раз, что это ИМЕННО та запись, которая совпадает с автомобилем пользователя, а не случайная запись из массива для этого артикула.
- **Текст ответа должен совпадать с полем "compatibility" по каждому товару.** Если в карточке товара поле "compatibility" показывает ДРУГОЙ автомобиль (не тот, что назвал пользователь) — значит для этого конкретного товара совпадение НЕ подтверждено. В этом случае нельзя писать в тексте фразы вроде "вот подходящие товары для вашего автомобиля" или "оба варианта подходят" применительно к такому товару. Вместо этого либо не включай этот товар в подборку, либо явно предупреди: "Для этого артикула у меня есть данные о совместимости с {модель из compatibility}, но не с вашим автомобилем — уточню у специалиста, подходит ли он и для вашей модели" и добавь <<<MANAGER_BUTTON>>>.

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
СЦЕНАРИЙ ЭСКАЛАЦИИ (передача менеджеру):
═══════════════════════════════════════════

Запускай эскалацию в ЛЮБОМ из следующих случаев:
1. Пользователь явно просит связаться с менеджером / живым человеком / оператором.
2. Нет данных о совместимости для запрошенного артикула (см. навык СОВМЕСТИМОСТЬ выше).
3. Не удалось найти ни одного подходящего товара в каталоге по запросу пользователя.

Порядок действий при эскалации:
1. Кратко и честно объясни, почему нужен специалист (например: "У меня нет данных о совместимости этой детали с вашим автомобилем" или "Я не нашёл точного совпадения в каталоге").
2. Попроси пользователя оставить номер телефона ИЛИ email, чтобы специалист связался с ним в ближайшее время. Спрашивай прямо в тексте ответа, например: "Оставьте, пожалуйста, номер телефона или email — наш специалист свяжется с вами и уточнит детали."
3. Добавь в конец ответа блок <<<MANAGER_BUTTON>>> (см. ниже), чтобы пользователь мог передать диалог менеджеру одним нажатием, даже если ещё не оставил контакт текстом.

НЕ придумывай данные о совместимости и НЕ придумывай товары, которых нет в каталоге — эскалация в этих случаях лучше, чем неверная информация.

═══════════════════════════════════════════
КНОПКА МЕНЕДЖЕРА:
═══════════════════════════════════════════

Показывай кнопку связи с менеджером (<<<MANAGER_BUTTON>>>) в следующих случаях:
- Любой из случаев эскалации выше (явный запрос менеджера, нет данных о совместимости, товар не найден)
- Пользователь готов оформить заказ или спрашивает про оплату / доставку конкретного заказа
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
    "compatibility": "<для каких авто подходит, ТОЛЬКО если есть в данных о совместимости, иначе null>",
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
ВАЖНО: поле "compatibility" — указывай ТОЛЬКО ту запись из ДАННЫЕ О СОВМЕСТИМОСТИ, которая реально совпадает с маркой/моделью/двигателем пользователя. НИКОГДА не переноси данные о другой модели (например, с A6 на A4) или другом двигателе на автомобиль пользователя, даже если это тот же артикул. Если совпадающей записи нет — ставь null и не утверждай совместимость в тексте ответа.
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

═══════════════════════════════════════════
ДАННЫЕ О СОВМЕСТИМОСТИ (артикул → автомобили, если есть):
═══════════════════════════════════════════
{{COMPATIBILITY}}
`;

// ─── COMPATIBILITY CACHE ────────────────────────────────────────────────────
// Refreshes much less often than the catalog — vehicle fitment data barely
// changes, unlike price/stock. Degrades gracefully to '{}' if
// COMPATIBILITY_API_URL isn't configured yet (e.g. manual table still in
// progress) — the agent will just always treat compatibility as unknown
// and correctly trigger escalation per the system prompt's instructions.
//
// IMPORTANT: this is fetched BEFORE the catalog (see fetchCatalog below)
// because the catalog is filtered down to only vendorCodes present here.
// Without that filter, the full ~22k-product catalog blows past Claude's
// 200k-token context limit by more than 10x (observed: 2.75M tokens) --
// see the "prompt is too long" incident this fixes.
let compatibilityCache      = null; // parsed object
let compatibilityCacheStr   = '{}'; // stringified, for the prompt
let compatibilityCachedAt   = 0;
const COMPATIBILITY_TTL_MS  = 6 * 60 * 60 * 1000; // refresh every 6 hours

async function fetchCompatibility() {
  if (!COMPATIBILITY_API) return { data: {}, str: '{}' };

  const now = Date.now();
  if (compatibilityCache && (now - compatibilityCachedAt) < COMPATIBILITY_TTL_MS) {
    return { data: compatibilityCache, str: compatibilityCacheStr };
  }
  try {
    const res = await fetch(COMPATIBILITY_API, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    compatibilityCache    = data;
    compatibilityCacheStr = JSON.stringify(data);
    compatibilityCachedAt = now;
    return { data, str: compatibilityCacheStr };
  } catch {
    return { data: compatibilityCache || {}, str: compatibilityCacheStr };
  }
}

// ─── CATALOG CACHE (module-level, survives warm Vercel instances) ──────────────
// Filtered down to only vendorCodes that appear in the compatibility data --
// there is no reason to send Claude pricing/description info for a part we
// have no confirmed vehicle fitment for, since the agent can't safely
// recommend it anyway. This is what keeps the prompt size bounded as the
// catalog grows (currently ~22k products; only ~a few hundred have
// confirmed compatibility so far).
let catalogCache     = null;
let catalogCachedAt  = 0;
const CATALOG_TTL_MS = 30 * 60 * 1000; // refresh every 30 minutes

async function fetchCatalog(compatibilityKeys) {
  const now = Date.now();
  if (catalogCache && (now - catalogCachedAt) < CATALOG_TTL_MS) {
    return catalogCache;
  }

  // No known compatible vendorCodes yet (compatibility API not configured,
  // or fetch failed with nothing cached) -- return empty rather than
  // falling back to the full unfiltered catalog, which would re-trigger
  // the token-limit crash. Safe default: agent treats everything as
  // unconfirmed and escalates, per its existing instructions.
  if (!compatibilityKeys || compatibilityKeys.size === 0) {
    return catalogCache || '[]';
  }

  try {
    const res = await fetch(CATALOG_API, { signal: AbortSignal.timeout(25000) });
    const data = await res.json();
    if (!data.products) return catalogCache || '[]';

    const compact = data.products
      .filter(p => compatibilityKeys.has(p.vendorCode))
      .map(p => ({
        article:  p.vendorCode,
        name:     p.name,
        brand:    p.vendor,
        category: p.category,
        price:    p.price,
        stock:    p.available,
        url:      p.url     ? p.url.replace('http://', 'https://')     : null,
        picture:  p.picture ? p.picture.replace('http://', 'https://') : null,
      }));
    catalogCache    = JSON.stringify(compact);
    catalogCachedAt = now;
    return catalogCache;
  } catch {
    return catalogCache || '[]';
  }
}

// ─── DETERMINISTIC VEHICLE MATCHING ─────────────────────────────────────────
// Two models (Haiku AND Sonnet 5) both failed to correctly match
// "AUDI A4 Allroad" against a compatibility record literally containing
// "A4 Allroad (8KH, B8)" when reading through a 214-entry JSON blob in the
// prompt. That's a search/fuzzy-matching task, not a reasoning task -- LLMs
// are unreliable at exact retrieval over multi-KB embedded data regardless
// of model size. So: extract the vehicle fields with a cheap, small call,
// then do the actual matching in plain JS (fast, deterministic, testable),
// and only ever hand the main conversational call the ALREADY-MATCHED
// result -- a handful of records instead of the full ~214-key blob. This
// also cuts token cost substantially since the big data dump no longer
// goes into the expensive conversational call on every turn.

const EXTRACT_PROMPT = `Извлеки из диалога данные об автомобиле пользователя и артикуле (если он его называл). Ответь СТРОГО в формате JSON, без пояснений, без markdown-разметки, только сам JSON объект:
{"vendorCode": "артикул детали, если пользователь его назвал, иначе null", "brand": "марка авто, иначе null", "model": "модель авто, иначе null", "engineCode": "код(ы) двигателя, иначе null", "powerHp": "мощность в л.с. (только число), иначе null"}

Диалог:
`;

async function extractVehicleInfo(messages) {
  const transcript = messages
    .map(m => `${m.role === 'user' ? 'Клиент' : 'Ассистент'}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
    .join('\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:       'claude-sonnet-5', // fast + cheap -- pure extraction, no need for a bigger model here
        max_tokens:  1000,
        temperature: 0, // deterministic extraction
        messages: [{ role: 'user', content: EXTRACT_PROMPT + transcript }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return {};

    const data = await res.json();
    const textBlock = (data.content || []).find(b => b.type === 'text');
    const raw = textBlock?.text ?? '{}';
    const cleaned = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return {}; // safe fallback -- matching below just yields nothing, agent keeps asking clarifying questions
  }
}

function normalizeModel(s) {
  if (!s) return '';
  return s
    .toUpperCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^A-ZА-Я0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function engineCodesOverlap(userCode, recordCode) {
  if (!userCode || !recordCode) return true;
  const userSet = new Set(userCode.toUpperCase().split(/[,\s]+/).filter(Boolean));
  const recordSet = recordCode.toUpperCase().split(/[,\s]+/).filter(Boolean);
  return recordSet.some(code => userSet.has(code));
}

function matchCompatibility(compatibilityData, extracted) {
  const matched = {};

  if (extracted.vendorCode && compatibilityData[extracted.vendorCode]) {
    matched[extracted.vendorCode] = compatibilityData[extracted.vendorCode];
    return matched;
  }

  if (!extracted.brand && !extracted.model) return matched;

  const userBrand = (extracted.brand || '').toUpperCase().trim();
  const userModelNorm = normalizeModel(extracted.model);
  const userModelTokens = userModelNorm.split(' ').filter(Boolean);

  for (const [vendorCode, records] of Object.entries(compatibilityData)) {
    const hits = records.filter(r => {
      if (userBrand && r.brand?.toUpperCase().trim() !== userBrand) return false;
      if (userModelTokens.length) {
        const recordModelNorm = normalizeModel(r.model);
        if (!userModelTokens.every(tok => recordModelNorm.includes(tok))) return false;
      }
      if (extracted.engineCode && !engineCodesOverlap(extracted.engineCode, r.engineCode)) {
        return false;
      }
      return true;
    });
    if (hits.length) matched[vendorCode] = hits;
  }

  return matched;
}

// Pre-warm caches on cold start -- compatibility first, since catalog
// filtering depends on it.
fetchCompatibility()
  .then(({ data }) => fetchCatalog(new Set(Object.keys(data))))
  .catch(() => {});

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

    // Compatibility must be fetched first -- catalog filtering depends on
    // knowing which vendorCodes we actually have fitment data for.
    const { data: compatibilityData } = await fetchCompatibility();
    const catalog = await fetchCatalog(new Set(Object.keys(compatibilityData)));
    const catalogParsed = JSON.parse(catalog);

    // Deterministic matching layer (see functions above) -- extract vehicle
    // fields cheaply, match them in plain JS, and only send Claude the
    // already-matched result instead of all ~214 compatibility records.
    const extracted = await extractVehicleInfo(messages);
    const matchedCompatibility = matchCompatibility(compatibilityData, extracted);
    const matchedVendorCodes = new Set(Object.keys(matchedCompatibility));
    const matchedCatalog = catalogParsed.filter(p => matchedVendorCodes.has(p.article));

    const compatibility = JSON.stringify(matchedCompatibility);
    const catalogForPrompt = JSON.stringify(matchedCatalog);

    // TEMPORARY DIAGNOSTIC LOGGING — shows what the matching layer actually
    // found, plus payload size for cost comparison against the old
    // full-blob approach.
    console.log(JSON.stringify({
      diag: 'match-check',
      extracted,
      matchedVendorCodeCount: matchedVendorCodes.size,
      matchedCatalogCount: matchedCatalog.length,
      compatibilityPromptChars: compatibility.length,
      catalogPromptChars: catalogForPrompt.length,
    }));

    const systemWithData = SYSTEM_PROMPT
      .replace('{{CATALOG}}', catalogForPrompt)
      .replace('{{COMPATIBILITY}}', compatibility);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:       'claude-sonnet-5', // TEMPORARY: testing whether this is a Haiku capability
                                         // limit vs a prompt issue. Sonnet 5 REJECTS non-default
                                         // temperature/top_p/top_k with a 400 error, so temperature
                                         // is intentionally omitted here (was 0.2 for Haiku).
        max_tokens:  4000,
        system:      systemWithData,
        messages:    messages,
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
    // Find the actual text block by TYPE, not by array position. Sonnet 5
    // (and any model with thinking/adaptive-thinking enabled) can return a
    // {type: "thinking", ...} block BEFORE the text block, so content[0]
    // is not reliably the reply -- that was silently returning an empty
    // string here (tokens billed, nothing rendered) once we switched off
    // Haiku, which never produced thinking blocks so this bug was latent.
    const textBlock = (data.content || []).find(block => block.type === 'text');
    const text = textBlock?.text ?? '';

    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ reply: text });

  } catch (err) {
    console.error('Handler error:', err);
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(500).json({ error: err.message });
  }
};
