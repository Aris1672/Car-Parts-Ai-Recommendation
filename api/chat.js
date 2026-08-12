/**
 * api/chat.js — Vercel Serverless Function
 * Proxies requests from the chat widget to the Anthropic Claude API.
 * Keeps the API key secret on the server side.
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CATALOG_API       = process.env.CATALOG_API_URL || 'https://abcp-catalog-proxy.vercel.app/api/catalog';
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Compatibility data (vendorCode -> compatible vehicles). Read directly
// from Postgres (SUPABASE_DB_URL, declared near fetchCompatibilityBySeries()
// below), queried per BMW series rather than pulled as one giant blob — see
// that function's comment for why (dataset growing toward ~650MB+,
// previously also hit Vercel's 4.5MB function response limit when served
// via api/compatibility.js, since retired).

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Ты — профессиональный ИИ-консультант по автозапчастям компании BMW Club77 (https://bmwclub77.ru/).
Ты дружелюбный, компетентный и лаконичный.
НИКОГДА не называй себя по имени и не представляйся как ChatGPT, Claude или любым другим именем.
ВАЖНО: ВСЕГДА отвечай ТОЛЬКО на русском языке, независимо от языка пользователя.
НИКОГДА не упоминай, что ты ChatGPT, Claude или другая AI-модель.
Рекомендуй ТОЛЬКО товары из каталога BMW Club77.

Контакты компании:
- Телефон: +79855558675
- Email: Orders@BmwClub77.ru
- Адрес: г.Москва, ул.Юровская д.103
- Сайт: https://bmwclub77.ru/
- Режим работы: Пн-Пт: 11:30-19:00, Сб: 12:00-13:00, Вс: выходной

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

## ПОДБОР МАСЛА И ЖИДКОСТЕЙ (Oil & Fluids)
Масла и технические жидкости (моторное масло, тормозная жидкость, антифриз и т.д.) НЕ имеют данных о совместимости с конкретным автомобилем (в отличие от запчастей) — производитель платформы не связывает эти товары с конкретной моделью/двигателем. Поэтому подбор идёт иначе, в два этапа:

**Этап 1 — точный допуск производителя (приоритет, самый надёжный способ):**
Спроси у пользователя, знает ли он требуемый допуск производителя для своего двигателя (например, VW 507.00, BMW Longlife-01, MB 229.5 — обычно указан в руководстве по эксплуатации автомобиля или можно узнать у дилера).
- Если пользователь называет допуск — он уже сверен по коду (см. раздел "ТОВАРЫ ИЗ РУЧНОГО КАТАЛОГА" выше, который содержит уже отфильтрованные по этому допуску товары). ВАЖНО: подходящее масло necessarily не обязательно от бренда производителя автомобиля — универсальные бренды (LUKOIL, GENERAL MOTORS и т.д.) часто имеют тот же допуск и полностью подходят. Если в разделе есть товары — уверенно предложи их, указав, что они имеют нужный допуск.
- Если раздел "ТОВАРЫ ИЗ РУЧНОГО КАТАЛОГА" пуст, а допуск был назван — честно скажи, что среди доступных товаров нет масла с этим допуском, и предложи связаться с менеджером.

**Этап 2 — если пользователь НЕ знает допуск производителя:**
В текущей версии агента общий (запасной) подбор по типу топлива/наддуву/пробегу ещё не реализован. Если пользователь не знает допуск — вежливо объясни, что для точного подбора масла нужен допуск производителя (можно посмотреть в руководстве по эксплуатации или на крышке маслозаливной горловины), и предложи связаться с менеджером для помощи с подбором, используя сценарий ЭСКАЛАЦИИ (см. ниже). НЕ угадывай подходящее масло по типу топлива/наддуву самостоятельно — это будет добавлено отдельно.

**Запчасти в этом же разделе (не масла):** раздел "ТОВАРЫ ИЗ РУЧНОГО КАТАЛОГА" может также содержать физические запчасти (например, амортизаторы), которые клиент вручную привязал к конкретным моделям авто в панели управления. Если такой товар присутствует в разделе — значит его совместимость с автомобилем пользователя УЖЕ подтверждена подбором по марке/модели/году (см. поле fitment товара), и отдельно проверять её по разделу "ДАННЫЕ О СОВМЕСТИМОСТИ" не нужно — та секция про ABCP-данные, это независимый источник.

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
2. Предложи пользователю СРАЗУ ДВА равнозначных варианта связи со специалистом, оба варианта в одном ответе, а не по очереди:
   - Вариант 1: оставить номер телефона или email прямо в чате — специалист свяжется в ближайшее время. Например: "Вы можете оставить номер телефона или email прямо здесь, и специалист свяжется с вами."
   - Вариант 2: нажать кнопку связи с менеджером ниже, чтобы передать диалог сразу.
3. Добавь в конец ответа блок <<<MANAGER_BUTTON>>> (см. ниже), чтобы кнопка появилась одновременно с текстовым предложением оставить контакт — оба пути должны быть доступны пользователю сразу, а не последовательно.

Если пользователь в ЛЮБОЙ момент диалога (не обязательно сразу после эскалации) сам называет номер телефона или email текстом — ничего специально делать не нужно: система автоматически обнаружит контакт и запустит передачу менеджеру таким же образом, как и по кнопке. Просто поблагодари пользователя за контакт в ответе (например: "Спасибо! Специалист свяжется с вами в ближайшее время.").

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

═══════════════════════════════════════════
ТОВАРЫ ИЗ РУЧНОГО КАТАЛОГА (масла/жидкости, подобранные по допуску производителя, И/ИЛИ запчасти, подобранные по совместимости с автомобилем клиента — оба типа уже проверены ниже, доверяй результату):
═══════════════════════════════════════════
{{OIL_PRODUCTS}}
`;

// ─── COMPATIBILITY (normalized table, queried by series) ───────────────────
// UPDATED (2026-08-02): the dataset is growing toward ~10x its current
// size. Pulling the ENTIRE compatibility dataset into memory on every cold
// start (the previous approach) doesn't scale — risks Postgres jsonb
// limits, Vercel function memory limits, and slow reads on Supabase's free
// Nano compute. Fixed by normalizing into a `compatibility` table (one row
// per vendorCode+vehicle, indexed by `series` — BMW series like '1','3','X5'
// extracted from the model string) and querying only the relevant series'
// rows per conversation, instead of everything.
//
// This means the compatibility fetch can no longer happen before knowing
// the vehicle (see handler below) — it now happens AFTER
// extractVehicleInfo(), once we know which series to query.
//
// Two separate reads:
//  - fetchCompatibilityVendorCodes(): just the distinct vendor_codes across
//    ALL series — cheap (one column, one DISTINCT), used only to filter the
//    catalog down to parts we have ANY fitment data for (independent of
//    which specific vehicle this conversation is about).
//  - fetchCompatibilityBySeries(series): the actual vehicle records for one
//    series — this is the slice matchCompatibility() runs against.
const { Client } = require('pg');
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

// Extracts BMW series from a model string. Works on both shapes in play:
// the catalog's own "3 (E46)" / "X5 Touring (E70)" style, and Haiku's
// extracted "3 E46 320i" / "X1 F48 xDrive20i" style — both cases just need
// the first whitespace-delimited token once any "(...)" is stripped.
function extractSeries(model) {
  if (!model) return 'unknown';
  const beforeParen = model.split('(')[0].trim();
  const firstToken = beforeParen.split(' ')[0].trim();
  return firstToken || 'unknown';
}

let vendorCodesCache      = null; // Set
let vendorCodesCachedAt   = 0;
const VENDOR_CODES_TTL_MS = 6 * 60 * 60 * 1000;

async function fetchCompatibilityVendorCodes() {
  if (!SUPABASE_DB_URL) return new Set();

  const now = Date.now();
  if (vendorCodesCache && (now - vendorCodesCachedAt) < VENDOR_CODES_TTL_MS) {
    return vendorCodesCache;
  }

  const client = new Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const result = await client.query('select distinct vendor_code from compatibility');
    const codes = new Set(result.rows.map(r => r.vendor_code));
    vendorCodesCache    = codes;
    vendorCodesCachedAt = now;
    return codes;
  } catch {
    return vendorCodesCache || new Set();
  } finally {
    await client.end().catch(() => {});
  }
}

// Per-series cache — a handful of series get asked about repeatedly within
// a 6h window (BMW has ~18 series total), so this stays small regardless
// of total dataset size.
const seriesCache = new Map(); // series -> { data, cachedAt }
const SERIES_TTL_MS = 6 * 60 * 60 * 1000;

async function fetchCompatibilityBySeries(series) {
  if (!SUPABASE_DB_URL || !series) return {};

  const now = Date.now();
  const cached = seriesCache.get(series);
  if (cached && (now - cached.cachedAt) < SERIES_TTL_MS) {
    return cached.data;
  }

  const client = new Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const result = await client.query('select vendor_code, vehicle from compatibility where series = $1', [series]);

    // Reshape back into the { vendorCode: [vehicle, vehicle, ...] } shape
    // matchCompatibility() already expects — keeps that function unchanged.
    const data = {};
    for (const row of result.rows) {
      if (!data[row.vendor_code]) data[row.vendor_code] = [];
      data[row.vendor_code].push(row.vehicle);
    }

    seriesCache.set(series, { data, cachedAt: now });
    return data;
  } catch {
    return cached ? cached.data : {};
  } finally {
    await client.end().catch(() => {});
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
{"vendorCode": "артикул детали, если пользователь его назвал, иначе null", "brand": "марка авто, иначе null", "model": "модель авто, иначе null", "year": "год выпуска автомобиля (только число), если известен, иначе null", "engineCode": "код(ы) двигателя, иначе null", "powerHp": "мощность в л.с. (только число), иначе null", "partKeywords": "МАССИВ строк с ключевыми словами деталей НА РУССКОМ ЯЗЫКЕ (каталог хранит названия по-русски), без марки/модели авто. Если клиент назвал конкретную деталь -- один элемент массива, но ДОБАВЬ известные синонимы, которые каталог использует вместо обиходного термина: 'тормозные колодки' -- добавь также 'накладки' (каталог часто называет ремкомплект колодок 'рем.к-т торм.накладок', это другое слово, не однокоренное). Например запрос про тормозные колодки -- [\"тормозные колодки\",\"накладки\"]. Если клиент сделал ОБЩИЙ запрос про ТО/техобслуживание/'что нужно менять' -- разверни его в стандартный список категорий: [\"масляный фильтр\",\"моторное масло\",\"воздушный фильтр\",\"салонный фильтр\",\"свеча зажигания\",\"тормозные колодки\",\"накладки\",\"тормозной диск\"]. Если клиент ничего из этого не называл и не спрашивал про ТО -- null.", "oilApprovalCode": "допуск производителя для масла, если пользователь его назвал (например VW 507.00, BMW Longlife-01), иначе null", "fuelType": "petrol или diesel, если известно, иначе null", "turbo": "true, false, если известно, иначе null", "mileageKm": "пробег в километрах (только число), если известно, иначе null", "contactPhone": "номер телефона клиента, ТОЛЬКО если он написал его текстом в диалоге (любой формат: +7..., 8..., с пробелами/дефисами), иначе null", "contactEmail": "email клиента, ТОЛЬКО если он написал его текстом в диалоге, иначе null"}
For BMW, Mercedes, Audi, VW, Skoda and similar brands:

The "model" field should include BOTH the model designation and the chassis/generation when available.

Examples:

BMW 320i (E46)
→ "3 E46 320i"

BMW 530d F10
→ "5 F10 530d"

Audi A6 Avant (4G, C7)
→ "A6 Avant 4G C7"

Mercedes C220 W204
→ "C W204 C220"

Do not omit chassis codes such as:
E46
E90
F30
G20
4G
C7
B8
W204
W212
etc.
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
        model:       'claude-haiku-4-5-20251001', // fast + cheap -- pure extraction, no need for a bigger model here
        max_tokens:  200,
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

    // Keep chassis codes inside parentheses:
    // (E46) -> E46
    // (B8)  -> B8
    .replace(/\(([^)]*)\)/g, ' $1 ')

    // Remove punctuation
    .replace(/[^A-ZА-Я0-9\s]/g, ' ')

    // Strip BMW body-style/generation descriptor words entirely. The
    // catalog's `model` field routinely wedges a body-style word (or a
    // ", N поколение" generation marker) BETWEEN the series number and
    // the chassis code -- e.g. "1 Купе (E82)", "5 (G30) Седан, 7
    // поколение", "5 Gran Turismo (F07)". Customers never mention these
    // ("BMW 1M E82", never "BMW 1 Coupe E82") -- Haiku extracts what the
    // customer actually said, so the user's series-number and chassis end
    // up directly adjacent with nothing between them, while the catalog's
    // don't. That positional difference then interacts badly with the
    // digit+letter merge below: the user's "1"+"E82" (nothing between)
    // merges into one token "1E82", but the catalog's "1"+"Купе"+"E82"
    // never merges the same way (a Cyrillic word, not digits, precedes
    // "E82"), so "1E82" is never a substring of it. Confirmed real
    // incident: BMW 1M (E82) brake parts matched zero results this way.
    // Stripping these words here (before the merge step) means the
    // catalog's own string collapses to "1 E82" too, so it merges
    // identically to the user's version instead of diverging.
    //
    // NOTE: no \b word-boundary anchors around the Cyrillic terms --
    // JS regex's \b is defined relative to \w ([A-Za-z0-9_] only), and
    // Cyrillic letters are NOT \w characters by default, so \b silently
    // never matches next to them (confirmed by testing: \bКУПЕ\b matched
    // nothing at all, the whole clause was a no-op). Plain literal match
    // works fine here since these are distinctive enough strings.
    .replace(/КУПЕ|КАБРИОЛЕТ|СЕДАН|УНИВЕРСАЛ|ХЭТЧБЕК/g, ' ')
    .replace(/\b(TOURING|GRAN\s+COUPE|GRAN\s+TURISMO)\b/g, ' ') // Latin words -- \b works normally here
    .replace(/\d+\s*ПОКОЛЕНИЕ/g, ' ') // ", 7 поколение" etc. -- generation ordinal customers never mention

    // Strip BMW's xDrive (AWD) marker entirely before merging. It's
    // written inconsistently: catalog data spells it out as its own word
    // ("xDrive 50 i"), while customers/Haiku commonly use the colloquial
    // shorthand of a trailing "x" fused to the trim number ("50iX").
    // Confirmed real incident: user "X6 F16 50iX" normalized to
    // "X6F16 50IX", but the catalog's "X6 (F16, F86) xDrive 50 i"
    // normalized to "...XDRIVE50I" -- the trailing "X" in "50IX" has no
    // equivalent adjacent character in the catalog string (its "X" is a
    // separate word, far away after compacting), so the token never
    // matched and a correctly-catalogued part (11427583220) returned zero
    // results. Rather than try to keep xDrive/non-xDrive apart reliably
    // across both spellings, drop it from both sides -- a false positive
    // (occasionally matching a non-xDrive variant) is far less costly
    // than a false negative (telling a customer a real part isn't there).
    .replace(/\bXDRIVE\b/g, ' ')

    // Merge BMW style names:
    // 320 I -> 320I
    // 330 XD -> 330XD
    // 740 LI -> 740LI
    // EXCEPT standalone "M" (BMW's M-performance division, e.g. "X5 M",
    // "M3") -- unlike engine-suffix letters (i/d/xd/li), "M" is always
    // written as its own word and is never concatenated to the preceding
    // number. Merging it anyway breaks matching whenever a chassis code
    // sits between the base model number and "M" in one of the two
    // strings being compared but not the other (e.g. user says "X5 M",
    // catalog stores "X5 (E70) M" -- confirmed real incident: correctly
    // catalogued BMW X5 M records matched zero results because "X5M" is
    // not a substring of "X5E70M").
    .replace(/(\d+)\s+([A-Z]+)/g, (match, num, letters) => (letters === 'M' ? match : num + letters))

    // Strip a leftover xDrive shorthand "x" now fused to a trim number
    // (e.g. "50IX" -> "50I"), now that the word form has already been
    // removed above. Only strips when it directly follows an existing
    // digit+letter pair, so body-style prefixes like "X5"/"X6" (letter
    // before digit, not after) are untouched.
    .replace(/([0-9][A-Z])X\b/g, '$1')

    // Strip a trailing "M" fused directly onto a model number with NO
    // space in the ORIGINAL text (e.g. "1M") -- distinct from the M-merge
    // exclusion above, which only stops US from fusing a space-separated
    // "X5 M" into "X5M". Some BMW M-cars are marketed and commonly typed
    // as one fused word from the start ("1M" Coupe, unlike "X5 M" or "M3"
    // which keep a space) -- Haiku faithfully extracts it that way since
    // that's genuinely how people write it. Confirmed real incident: user
    // "1M E82" normalized/compacted to "1M E82"; the catalog stores this
    // as model "1 Купе (E82)" + modificationName "M" (separate fields,
    // chassis between them), compacting to "1КУПЕE82M" -- "1M" is not a
    // contiguous substring of that (chassis sits between the "1" and the
    // "M"), so a correctly-catalogued 1M brake part matched zero results.
    // Same tradeoff as xDrive: drop the M rather than try to keep the
    // M/non-M distinction reliable across every possible way it's written.
    .replace(/(\d+)M\b/g, '$1')

    // Remove duplicate spaces
    .replace(/\s+/g, ' ')
    .trim();
}

function engineCodesOverlap(userCode, recordCode) {
  if (!userCode || !recordCode) return true;
  // Split ONLY on commas -- a comma genuinely separates multiple distinct
  // codes (e.g. "CJCD,CSUA"), but whitespace does NOT: some codes contain
  // internal spaces as part of a single code (e.g. BMW's "M54 B22"), and
  // splitting on whitespace was wrongly fragmenting those into two tokens
  // that never matched the stored no-space form ("M54B22") -- this was
  // intermittent (not a constant failure) because the extraction step
  // doesn't always format the code identically across calls, sometimes
  // preserving the display's internal space and sometimes not.
  // normalizeApprovalCode() strips ALL internal whitespace/punctuation, so
  // "M54 B22" and "M54B22" always compare equal regardless of which form
  // extraction happens to produce.
  const userCodes   = userCode.split(',').map(normalizeApprovalCode).filter(Boolean);
  const recordCodes = recordCode.split(',').map(normalizeApprovalCode).filter(Boolean);
  return recordCodes.some(rc => userCodes.some(uc => uc === rc || uc.includes(rc) || rc.includes(uc)));
}

// Parses the compatibility table's `years` field, e.g. "2004/04 - 2006/09"
// (also tolerates an open-ended side, e.g. "2015/04 -" for a still-in-
// production model, or a missing/malformed value). Only the YEAR portion
// is used -- the model doesn't need month precision, and customers/Haiku's
// extraction never provide a production month anyway. Returns null if the
// string can't be parsed at all (record is then treated as "no year data",
// i.e. NOT filtered out -- see yearOverlaps below -- since an unparseable
// value is a data-quality gap, not evidence the vehicle doesn't fit).
function parseYearRange(yearsStr) {
  if (!yearsStr) return null;
  const parts = String(yearsStr).split('-').map(s => s.trim());
  const parseYear = (s) => {
    const m = s && s.match(/(\d{4})/);
    return m ? parseInt(m[1], 10) : null;
  };
  const from = parseYear(parts[0]);
  const to   = parts.length > 1 ? parseYear(parts[1]) : from;
  if (from === null && to === null) return null;
  return { from: from ?? -Infinity, to: to ?? Infinity };
}

// True if the customer's stated year falls inside the record's production
// range -- this is what actually distinguishes BMW's X5 generations (E53
// 1999-2006, E70 2006-2013, F15 2013-2018, G05 2018+) from each other,
// since normalizeModel()'s substring match on "X5" alone matches all of
// them equally (chassis code is rarely present in what the customer says).
// Added 2026-08-12 after confirming via production logs that a single
// "BMW X5 2008" + one part-category query was matching 137 vendorCodes/
// ~130k compatibility rows -- almost entirely different X5 generations
// that were never actually asked about. Deliberately permissive when data
// is missing on EITHER side (no user year, or an unparseable/absent
// `years` field) -- absence of information should fall through to the
// existing brand/model/engine filters rather than silently drop a
// possibly-correct match.
function yearOverlaps(userYear, recordYearsStr) {
  if (!userYear) return true;
  const range = parseYearRange(recordYearsStr);
  if (!range) return true;
  const y = parseInt(userYear, 10);
  if (isNaN(y)) return true;
  return y >= range.from && y <= range.to;
}



// Crude Russian stemming: truncates a word to tolerate case/gender/number
// endings (тормозНЫЕ/тормозНАЯ/тормозНОГО/тормозНОЙ all share the root
// "тормоз"). NOT linguistically rigorous -- just chops a fixed number of
// trailing characters off longer words -- but it's cheap, deterministic,
// and good enough to stop exact-word-form mismatches from silently
// dropping real matches. Left short/ambiguous words (<=4 chars) alone,
// since stemming those risks matching unrelated words.
function stemRu(word) {
  if (word.length <= 4) return word;
  return word.slice(0, Math.max(4, word.length - 2));
}

// Narrows an already vehicle-matched catalog slice down to the specific
// part(s) the customer is asking about. Without this, matchCompatibility()
// returns every vendorCode that fits the customer's vehicle regardless of
// part type -- as the compatibility catalog grows to cover more part
// categories, that set (and therefore the prompt) grows with total catalog
// size instead of staying scoped to the actual question. This is a plain
// substring match against the catalog's own `name`/`category` fields (both
// in Russian, matching how ABCP's feed stores them) -- cheap, deterministic,
// no LLM retrieval involved, same principle as the vehicle-matching layer.
//
// Accepts a LIST of keywords (OR'd together), not a single keyword --
// broad requests like "everything needed for a service" get expanded by
// the extraction prompt into several concrete categories (oil filter, air
// filter, spark plugs...) rather than one term that matches nothing.
//
// Uses stemRu() (see above) on both the keyword tokens and the haystack
// words -- confirmed real incident: customer asked for "тормозные
// колодки" (brake pads); the correct catalog products were named "Рем.
// к-т торм.накладок" (abbreviated "торм." + a genuinely different word,
// "накладок" not "колодки") -- neither the grammatical ending nor the
// word itself matched exactly, so the real match was silently dropped
// and only an unrelated handbrake-shoe kit (which happened to contain the
// literal word "колодки") got recommended instead. Stemming plus the
// накладки synonym now added to the extraction prompt (see EXTRACT_PROMPT
// above) together close this specific gap; stemming alone also helps
// generically with other Russian case-ending mismatches we haven't hit
// yet.
function filterCatalogByPartKeyword(catalogArray, partKeywords) {
  if (!partKeywords || !partKeywords.length) return catalogArray; // nothing to narrow by yet -- caller decides whether that's safe to send as-is
  const keywordTokenLists = partKeywords
    .map(k => (k || '').toUpperCase().trim().split(/\s+/).filter(Boolean).map(stemRu))
    .filter(tokens => tokens.length);
  if (!keywordTokenLists.length) return catalogArray;
  return catalogArray.filter(p => {
    const haystackWords = `${p.name || ''} ${p.category || ''}`
      .toUpperCase()
      .split(/[^A-ZА-Я0-9]+/)
      .filter(Boolean)
      .map(stemRu);
    return keywordTokenLists.some(tokens =>
      tokens.some(tok => haystackWords.some(hw => hw.includes(tok) || tok.includes(hw)))
    );
  });
}

// Logs vendorCodes that fit a customer's vehicle but are absent from the
// client's catalog feed (see call site above -- almost always the
// no-photo export exclusion). One row per vendorCode ("missing_articles"
// table), incremented/updated on every occurrence rather than logged as a
// full history -- keeps the dashboard sorted by "most requested" so the
// client can prioritize which photos to add first, instead of scrolling
// an unsorted event log.
//
// Uses PostgREST's upsert (Prefer: resolution=merge-duplicates) plus a
// Postgres function bump for the increment -- see abcp-catalog-proxy /
// dashboard setup SQL for the missing_articles table + bump_missing_article
// function definitions. Never throws into the caller -- this is a
// best-effort side log, not something that should ever affect the actual
// chat response.
async function logMissingArticles(vendorCodes, extracted) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('logMissingArticles: SUPABASE_URL or SUPABASE_SERVICE_KEY is not set in this deployment\'s environment');
    return;
  }

  const vehicleInfo = {
    brand:      extracted.brand      || null,
    model:      extracted.model      || null,
    year:       extracted.year       || null,
    engineCode: extracted.engineCode || null,
  };

  // Cap + batch. Confirmed real incident: a single vehicle-wide match can
  // legitimately have 200+ vendorCodes that fit the vehicle but aren't in
  // the catalog (e.g. a common model with a large compatibility footprint
  // but sparse photo coverage). The original code fired one fetch() per
  // vendorCode via a single unbounded Promise.all -- for ~213 missing
  // vendorCodes that's ~213 simultaneous outbound HTTPS connections from
  // one invocation, which blew through the serverless container's file
  // descriptor limit (EMFILE) and took the NEXT unrelated Supabase call
  // (fetchOilProducts) down with it in the same request.
  //
  // MAX_PER_REQUEST also makes sense on its own terms, independent of the
  // resource-exhaustion angle: logging 200+ "missing" parts from one
  // customer query is noise, not a useful worklist entry for the client --
  // most of those 200 have nothing to do with what was actually asked.
  const MAX_PER_REQUEST = 25;
  const BATCH_SIZE      = 5;
  const toLog = vendorCodes.slice(0, MAX_PER_REQUEST);
  if (vendorCodes.length > MAX_PER_REQUEST) {
    console.warn(`logMissingArticles: capping ${vendorCodes.length} missing vendorCodes to ${MAX_PER_REQUEST} for this request`);
  }

  for (let i = 0; i < toLog.length; i += BATCH_SIZE) {
    const batch = toLog.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (vendorCode) => {
      try {
        const res = await fetch(
          `${SUPABASE_URL.replace(/\/?$/, '/')}rest/v1/rpc/bump_missing_article`,
          {
            method:  'POST',
            headers: {
              'apikey':        SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
              'Content-Type':  'application/json',
            },
            body: JSON.stringify({
              p_vendor_code:  vendorCode,
              p_vehicle_info: vehicleInfo,
            }),
            signal: AbortSignal.timeout(8000),
          }
        );
        if (!res.ok) {
          console.error('bump_missing_article failed:', vendorCode, await res.text());
        }
      } catch (err) {
        console.error('bump_missing_article error:', vendorCode, err.message, err.cause || '');
      }
    }));
  }
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
  console.log("User model:", extracted.model);
console.log("Normalized:", userModelNorm);
  const userModelTokens = userModelNorm.split(' ').filter(Boolean);

  for (const [vendorCode, records] of Object.entries(compatibilityData)) {
  const hits = records.filter(r => {
    if (userBrand && r.brand?.toUpperCase().trim() !== userBrand) {
      return false;
    }

    if (userModelTokens.length) {
      // Search BOTH model and modificationName because different
      // manufacturers store the trim in different fields.
      // Examples:
      //   Audi: model="A4 (B8)", modificationName="2.0 TDI quattro"
      //   BMW:  model="3 (E46)", modificationName="320 i"

      const recordSearchNorm = normalizeModel(
        `${r.model} ${r.modificationName || ''}`
      );

      // Remove spaces so that:
      // 320i == 320 i
      // 330xd == 330 xd
      // 740Li == 740 Li
      const recordCompact = recordSearchNorm.replace(/\s+/g, '');

      const modelOk = userModelTokens.every(tok => {
        const tokenCompact = tok.replace(/\s+/g, '');
        // Short/bare series tokens ("3", "5", "X1"...) are too easy to
        // accidentally substring-match against unrelated digits elsewhere
        // in the compacted record string once trim/engine suffixes are
        // squashed together (e.g. token "3" matching inside "530D" from
        // a completely different 5-series record). Confirmed real
        // incident: a customer who'd only said "BMW 3" so far (no
        // chassis/trim yet) was matching 5-series and other unrelated
        // records purely because their model number contained a "3"
        // somewhere. For tokens this short, require an exact match
        // against the record's OWN series (its model string before any
        // "(" or trim) instead of an anywhere-substring check. Longer
        // tokens (chassis codes, merged trim numbers like "320I") keep
        // the substring check, since that's what makes "320i"=="320 i"
        // matching work in the first place.
        if (tokenCompact.length <= 2) {
          const recordSeriesToken = normalizeModel(extractSeries(r.model)).replace(/\s+/g, '');
          return recordSeriesToken === tokenCompact;
        }
        return recordCompact.includes(tokenCompact);
      });

      if (!modelOk) {
        return false;
      }
    }

    // Engine code match
    if (
      extracted.engineCode &&
      !engineCodesOverlap(extracted.engineCode, r.engineCode)
    ) {
      return false;
    }

    // Production-year match -- see yearOverlaps() above. Without this,
    // "X5" (or any model name) matches every generation of that model
    // equally, since chassis codes are rarely present in what the
    // customer actually says.
    if (extracted.year && !yearOverlaps(extracted.year, r.years)) {
      return false;
    }

    return true;
  });
    if (hits.length) matched[vendorCode] = hits;
  }

  return matched;
}

// ─── MANUAL PRODUCTS (oils/fluids, client-curated) ─────────────────────────
// See README's "Compatibility matching architecture" section for why this
// follows the same deterministic-matching pattern as vehicle compatibility
// rather than dumping the whole table into the prompt: searching a large
// embedded list for one matching approval code is a retrieval task, which
// both Haiku and Sonnet 5 were unreliable at for the vehicle-fitment case.
// Same fix applies here -- match in plain JS, hand Claude only the result.

let oilProductsCache    = null;
let oilProductsCachedAt = 0;
const OIL_PRODUCTS_TTL_MS = 15 * 60 * 1000; // 15 min -- client adds products manually, doesn't change often

async function fetchOilProducts() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('fetchOilProducts: SUPABASE_URL or SUPABASE_SERVICE_KEY is not set in this deployment\'s environment');
    return [];
  }

  const now = Date.now();
  if (oilProductsCache && (now - oilProductsCachedAt) < OIL_PRODUCTS_TTL_MS) {
    return oilProductsCache;
  }
  try {
    const url = `${SUPABASE_URL.replace(/\/?$/, '/')}rest/v1/manual_products?select=*`;
    const res = await fetch(url, {
      headers: {
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error('fetchOilProducts: Supabase responded', res.status, await res.text().catch(() => ''));
      return oilProductsCache || [];
    }
    const data = await res.json();
    oilProductsCache    = data;
    oilProductsCachedAt = now;
    return data;
  } catch (err) {
    // "fetch failed" from Node hides the real cause (DNS, TLS, connection
    // refused, timeout...) -- err.cause carries the underlying error the
    // top-level message doesn't show. Previously this catch block was
    // fully silent, which meant a systemic Supabase connectivity problem
    // here looked identical to "just no oil products yet" -- confirmed
    // real incident: totalOilProducts silently dropped to 0 in production
    // logs with no error at all pointing to why.
    console.error('fetchOilProducts error:', err.message, err.cause || '');
    return oilProductsCache || [];
  }
}

// Normalizes an approval code for comparison: uppercase, strip all
// punctuation/whitespace. "VW 502.00", "VW 502 00", and "vw50200" all
// become "VW50200" -- this handles the inconsistent formatting seen across
// different products' "Допуски производителей" field.
function normalizeApprovalCode(code) {
  if (!code) return '';
  return code.toUpperCase().replace(/[^A-Z0-9А-Я]/g, '');
}

// Given the full manual_products list and a customer-stated approval code,
// return only the products whose "Допуски производителей" field contains
// that code -- brand-agnostic, exactly how real oil-compatibility works
// (a generic-brand oil carrying the right approval is just as valid as an
// OEM-branded one).
function matchOilByApproval(products, approvalCode) {
  const target = normalizeApprovalCode(approvalCode);
  if (!target) return [];

  return products.filter(p => {
    const approvalsField = p.specs?.['Допуски производителей'];
    if (!approvalsField) return false;
    const codes = approvalsField.split(',').map(c => normalizeApprovalCode(c));
    return codes.some(c => c === target || c.includes(target) || target.includes(c));
  });
}

// Given the full manual_products list and the extracted vehicle info,
// return products whose `fitment` array (set by the client in the
// dashboard, see products.js `set_fitment`) contains an entry matching the
// customer's vehicle. Only products WITH a non-empty fitment array are
// considered here -- products without one (e.g. most oils, matched
// instead by approval code above) are intentionally left untouched by
// this function so their existing brand/vehicle-agnostic behavior doesn't
// change. Reuses normalizeModel() so matching stays consistent with the
// ABCP vehicle-compatibility matching above (matchCompatibility) rather
// than introducing a second, subtly different comparison scheme.
function matchManualProductsByVehicle(products, extracted) {
  if (!extracted.brand && !extracted.model) return [];

  const userBrand       = (extracted.brand || '').toUpperCase().trim();
  const userModelNorm   = normalizeModel(extracted.model);
  const userModelTokens = userModelNorm.split(' ').filter(Boolean);
  const userYear        = extracted.year ? parseInt(extracted.year, 10) : null;

  return products.filter(p => {
    const fitmentList = Array.isArray(p.fitment) ? p.fitment : [];
    if (fitmentList.length === 0) return false; // no vehicle data on this product -- not vehicle-matchable

    return fitmentList.some(f => {
      if (userBrand && f.brand && f.brand.toUpperCase().trim() !== userBrand) {
        return false;
      }

      if (userModelTokens.length) {
        // Same series+modification search-string trick as matchCompatibility
        // (record.model + record.modificationName), just with this
        // fitment entry's own field names.
        const recordSearchNorm = normalizeModel(`${f.series || ''} ${f.modification || ''}`);
        const recordCompact    = recordSearchNorm.replace(/\s+/g, '');
        // Same fix as matchCompatibility (see its comment) -- short bare
        // tokens ("3", "5", "X1") must match this entry's OWN series
        // exactly, not substring-match anywhere in the compacted string,
        // or e.g. token "3" would match any fitment entry whose
        // modification happens to contain a "3" somewhere (like "530d").
        const modelOk = userModelTokens.every(tok => {
          const tokenCompact = tok.replace(/\s+/g, '');
          if (tokenCompact.length <= 2) {
            const recordSeriesToken = normalizeModel(f.series || '').replace(/\s+/g, '');
            return recordSeriesToken === tokenCompact;
          }
          return recordCompact.includes(tokenCompact);
        });
        if (!modelOk) return false;
      }

      if (userYear && (f.yearFrom || f.yearTo)) {
        const from = f.yearFrom ? parseInt(f.yearFrom, 10) : -Infinity;
        const to   = f.yearTo   ? parseInt(f.yearTo, 10)   : Infinity;
        if (userYear < from || userYear > to) return false;
      }

      return true;
    });
  });
}

// Pre-warm caches on cold start -- vendor codes (lightweight) first, since
// catalog filtering depends on it. Per-series compatibility data is fetched
// on-demand per request instead (see handler below), since which series
// matters isn't known until the conversation is read.
fetchCompatibilityVendorCodes()
  .then((codes) => fetchCatalog(codes))
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

    // Vendor codes (lightweight, all series) -- used only to filter the
    // catalog down to parts we have ANY fitment data for. The actual
    // vehicle-matched compatibility records come later, once we know the
    // series (see below) -- can't query by series before extraction runs.
    const vendorCodes = await fetchCompatibilityVendorCodes();
    const catalog = await fetchCatalog(vendorCodes);
    const catalogParsed = JSON.parse(catalog);

    // Deterministic matching layer (see functions above) -- extract vehicle
    // fields cheaply, match them in plain JS, and only send Claude the
    // already-matched result instead of the full dataset.
    const extracted = await extractVehicleInfo(messages);
    console.log("========== VEHICLE ==========");
console.log(JSON.stringify(extracted, null, 2));

    // Now that we know the vehicle's series, pull just that series' rows
    // instead of the whole compatibility table.
    const series = extractSeries(extracted.model);
    const compatibilityData = await fetchCompatibilityBySeries(series);

    const matchedCompatibilityByVehicle = matchCompatibility(compatibilityData, extracted);
    const matchedVendorCodesByVehicle = new Set(Object.keys(matchedCompatibilityByVehicle));
    const matchedCatalogByVehicle = catalogParsed.filter(p => matchedVendorCodesByVehicle.has(p.article));

    // Parts that genuinely fit this vehicle (per the compatibility data)
    // but have no entry at all in catalogParsed -- almost always because
    // ABCP's export excludes items without a photo (see README's
    // "Compatibility matching architecture" -- the catalog feed is
    // configured upstream to only include items with images, precisely so
    // the agent never recommends something with no visual). Rather than
    // just silently having nothing to offer, log these so the client can
    // see which specific parts are blocking a sale and go add a photo for
    // them. Fire-and-forget -- must never block or fail the chat response.
    const missingVendorCodes = [...matchedVendorCodesByVehicle].filter(
      code => !matchedCatalogByVehicle.some(p => p.article === code)
    );
    if (missingVendorCodes.length) {
      logMissingArticles(missingVendorCodes, extracted).catch(err =>
        // Node's top-level "fetch failed" message hides the real cause
        // (DNS, TLS, connection refused, timeout...) -- err.cause carries
        // the underlying error. Also log whether SUPABASE_URL looks sane,
        // since a wrong/missing env var in THIS deployment's environment
        // scope (e.g. set for Production but this is a Preview deploy)
        // would produce this exact generic failure with no other clue.
        console.error(
          'logMissingArticles error:', err.message, err.cause || '',
          '| SUPABASE_URL set:', !!SUPABASE_URL, '| SUPABASE_SERVICE_KEY set:', !!SUPABASE_SERVICE_KEY
        )
      );
    }

    // Narrow the vehicle-matched slice down to the part actually being asked
    // about (see filterCatalogByPartKeyword above) -- this is what keeps
    // prompt size scoped to the question rather than to total catalog size.
    // Safety net: if the customer hasn't named a part yet (partKeyword is
    // null -- e.g. still in the middle of the "which car do you have"
    // back-and-forth), fall back to a hard cap instead of sending every
    // part that ever fits their vehicle.
    const MAX_UNFILTERED_CATALOG_ITEMS = 40;
    let matchedCatalog;
    let partFilterApplied = false;
    if (extracted.partKeywords && extracted.partKeywords.length) {
      matchedCatalog = filterCatalogByPartKeyword(matchedCatalogByVehicle, extracted.partKeywords);
      partFilterApplied = true;
      // Safety net: an imperfect extraction shouldn't turn a real result
      // into a false "nothing found" -- fall back to the capped unfiltered
      // set rather than silently returning empty.
      if (matchedCatalog.length === 0 && matchedCatalogByVehicle.length > 0) {
        matchedCatalog = matchedCatalogByVehicle.slice(0, MAX_UNFILTERED_CATALOG_ITEMS);
        partFilterApplied = false;
      }
    } else if (matchedCatalogByVehicle.length > MAX_UNFILTERED_CATALOG_ITEMS) {
      matchedCatalog = matchedCatalogByVehicle.slice(0, MAX_UNFILTERED_CATALOG_ITEMS);
    } else {
      matchedCatalog = matchedCatalogByVehicle;
    }

    const matchedVendorCodes = new Set(matchedCatalog.map(p => p.article));
    const matchedCompatibility = {};
    for (const code of matchedVendorCodes) {
      if (matchedCompatibilityByVehicle[code]) matchedCompatibility[code] = matchedCompatibilityByVehicle[code];
    }

    const compatibility = JSON.stringify(matchedCompatibility);
    const catalogForPrompt = JSON.stringify(matchedCatalog);

    // Manual-products matching, two independent paths merged together:
    // 1) Oil/fluid cross-sell (Tier 1: exact approval code match). Tier 2
    //    (general fuel/turbo/mileage fallback when the customer doesn't
    //    know their required approval) is not yet implemented -- this path
    //    contributes nothing in that case, and the prompt instructs the
    //    agent accordingly (see ПОДБОР МАСЛА skill below).
    // 2) Vehicle-fitment match, for manual_products that carry a `fitment`
    //    list (physical parts tied to specific car models -- see
    //    products.js). Independent of approval codes entirely.
    const oilProducts = await fetchOilProducts();
    const matchedByApproval = extracted.oilApprovalCode
      ? matchOilByApproval(oilProducts, extracted.oilApprovalCode)
      : [];
    const matchedByVehicleFitment = matchManualProductsByVehicle(oilProducts, extracted);
    // Merge + dedupe by id -- a product could in principle satisfy both
    // (an oil with an approval code AND a fitment list), don't send it twice.
    const matchedOilProductsMap = new Map();
    [...matchedByApproval, ...matchedByVehicleFitment].forEach(p => matchedOilProductsMap.set(p.id, p));
    const matchedOilProducts = [...matchedOilProductsMap.values()];
    const oilProductsForPrompt = JSON.stringify(matchedOilProducts);

    // TEMPORARY DIAGNOSTIC LOGGING — shows what the matching layer actually
    // found, plus payload size for cost comparison against the old
    // full-blob approach.
    console.log('DIAG match-check', JSON.stringify({
      partKeywords: extracted.partKeywords || null,
      partFilterApplied,
      vehicleMatchedCount: matchedCatalogByVehicle.length,
      finalMatchedCount: matchedCatalog.length,
      compatibilityPromptChars: compatibility.length,
      catalogPromptChars: catalogForPrompt.length,
      totalOilProducts: oilProducts.length,
      matchedOilProductCount: matchedOilProducts.length,
    }));

    const systemWithData = SYSTEM_PROMPT
      .replace('{{CATALOG}}', catalogForPrompt)
      .replace('{{COMPATIBILITY}}', compatibility)
      .replace('{{OIL_PRODUCTS}}', oilProductsForPrompt);

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
        max_tokens:  4096, // was 2048 -- too tight for a full TO service kit
                           // (5+ verbose product entries with long URLs/
                           // picture links + intro prose sharing the same
                           // budget), causing the response to cut off
                           // mid-JSON. The widget can't parse a truncated
                           // <<<PRODUCTS>>> block, so it silently fell back
                           // to showing the raw (broken) text instead of
                           // rendering cards.
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
    let text = textBlock?.text ?? '';

    // If the customer typed a phone/email instead of clicking the manager
    // button, tell the widget to trigger the same handoff automatically
    // (Bitrix lead + Supabase save via api/session/manager.js) -- see
    // extracted.contactPhone/contactEmail above. The widget guards this
    // with a per-session flag so it only fires once even if contact info
    // is repeated in a later message.
    if (extracted.contactPhone || extracted.contactEmail) {
      text = `${text}\n<<<AUTO_MANAGER_HANDOFF>>>`;
    }

    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ reply: text });

  } catch (err) {
    console.error('Handler error:', err);
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(500).json({ error: err.message });
  }
};
