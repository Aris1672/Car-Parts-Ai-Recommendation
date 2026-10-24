/**
 * api/chat.js — Vercel Serverless Function
 * Proxies requests from the chat widget to the Anthropic Claude API.
 * Keeps the API key secret on the server side.
 */

const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
// Direct Russia -> api.anthropic.com access is blocked (same constraint as
// the AI Senior Auditor project). Routes through the existing Kazakhstan
// Nginx reverse proxy (audit.assistant24info.ru) by default -- it's a
// generic passthrough, not tied to any one project, so it's safe to reuse
// here as-is. Defaults to the real API directly so this still works
// unchanged in any environment that CAN reach Anthropic directly (e.g. if
// this is ever run somewhere other than the Russian VPS).
const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
const CATALOG_API        = process.env.CATALOG_API_URL || 'https://abcp-catalog-proxy.vercel.app/api/catalog';
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Laximo (original BMW catalog, scraped on demand from the client's own
// /laximo pages) -- see lib/laximo.js. When the customer gives a VIN, this
// replaces the compatibility-table lookup with exact OEM numbers for that
// car; without a VIN (or if Laximo fails) the table path below is used.
// LAXIMO_ENABLED=false turns it off without a code change.
const laximo = require('../lib/laximo');
const abcpOrders = require('../lib/abcpOrders');
const LAXIMO_ENABLED   = process.env.LAXIMO_ENABLED !== 'false';
const LAXIMO_BUDGET_MS = Number(process.env.LAXIMO_BUDGET_MS || 30000);

// Find-part advice about VINs, depending on whether the VIN lookup can run
// right now (LAXIMO_ENABLED, and not paused/over budget -- see lib/laximo.js).
// When it can't, the agent must not push customers for a VIN it can't use.
const VIN_ADVICE_ON = 'Для любой марки ЛУЧШИЙ способ — VIN-номер (17 символов, указан в СТС/ПТС): по нему детали подбираются по оригинальному каталогу производителя точно для этой машины, без уточнения поколения и двигателя. Поэтому в первую очередь попроси VIN; если клиент не может его дать — продолжай по шагам ниже. НО если раздел \"АВТОМОБИЛЬ ИЗ ОРИГИНАЛЬНОГО КАТАЛОГА\" уже заполнен с \"matchedBy\": \"model\" (автомобиль найден по модели) — НЕ требуй VIN и не переспрашивай модель/год/двигатель: сразу покажи найденные детали и лишь предложи прислать VIN для максимальной точности.';
const VIN_ADVICE_OFF = 'Подбор по VIN сейчас недоступен — НЕ проси клиента прислать VIN. Подбирай по марке/модели/году по шагам ниже. Если клиент сам прислал VIN — поблагодари и предложи передать его менеджеру для точного подбора (кнопка менеджера), а сам подбирай по модели/году.';

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
- Магазин и BMW-сервис (новый филиал в Химках, около МКАД): Московская обл., г. Химки, ул. Молодежная, д. 9Н. В навигаторе искать «БмвКлуб77».
- Режим работы: Пн-Пт с 10:30 до 20:00; Сб-Вс с 11:00 до 18:00 — в выходные только выдача готовых заказов.
- Телефон: +7 (967) 555-7-555
- Вопросы по заказам: в Telegram или в MAX по номеру +7 (967) 555-7-555
- Email: Orders@BmwClub77.ru
- Сайт: https://bmwclub77.ru/
- Доставка: по Москве — Яндекс.Доставка; в регионы — отправка СДЭКом.
Если спрашивают адрес, где забрать заказ, куда приехать, часы работы, как связаться или про доставку — отвечай ТОЛЬКО по этим данным, ничего не придумывай. Стоимость и сроки доставки здесь не указаны: если о них спрашивают, предложи уточнить у менеджера.

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
{{VIN_ADVICE}}
5. **Код двигателя или мощность (л.с.)** — ОБЯЗАТЕЛЬНО уточни, если для указанных марки/модели/года в разделе "ДАННЫЕ О СОВМЕСТИМОСТИ" присутствует НЕСКОЛЬКО записей с разными engineCode или powerHp. Одна и та же модель и даже один и тот же диапазон годов выпуска часто включает несколько разных двигателей (например, у Audi A4 (8K2, B8) 2011-2015 могут быть модификации и с кодом CJEB 170 л.с., и с другими кодами — это РАЗНЫЕ двигатели с разными запчастями). Двигателеспецифичные детали — воздушный/масляный/топливный фильтр, ремень/цепь ГРМ, свечи зажигания, прокладки двигателя, датчики (кислородный, коленвала, распредвала) и т.п. — НЕЛЬЗЯ рекомендовать без уточнения кода двигателя или мощности, если по данным совместимости видно больше одной модификации. Спроси прямо: "Уточните код двигателя (обычно указан на табличке под капотом или в ПТС) или мощность в л.с. — для вашей модели есть несколько вариантов двигателя с разными запчастями."
   Для деталей, НЕ зависящих от двигателя (кузовные элементы, подвеска, элементы салона, некоторые детали кузова) — уточнение двигателя необязательно, ориентируйся на здравый смысл.
Когда собрал достаточно — верни JSON с подходящими товарами (см. формат ниже).

## ПОИСК ПО АРТИКУЛУ / VIN (Search)
Если пользователь называет артикул или VIN-номер:
- По артикулу — найди точное совпадение в каталоге и верни карточку.
- По VIN — если раздел "АВТОМОБИЛЬ ИЗ ОРИГИНАЛЬНОГО КАТАЛОГА" ниже заполнен с "matchedBy": "vin", автомобиль уже точно определён по оригинальному каталогу производителя (любой марки — поле "brand"): НЕ переспрашивай модель, год, поколение или двигатель — сразу уточни, какая деталь нужна (если ещё не назвал), или покажи найденные товары. Если раздел пуст или там написано, что VIN не найден — попроси проверить VIN (17 символов, без букв O, I, Q) или назвать модель и год.
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
ВАЖНО: наличие товара называй ТОЛЬКО словами из его поля "availability" ("в наличии (N шт.)" или "под заказ") — дословно, ничего не добавляя. Для товара "под заказ" можно добавить, что менеджер уточнит срок поставки. ЗАПРЕЩЕНО писать про товары из каталога «нет в наличии», «в наличии нет», «отсутствует», «недоступен» в любом порядке слов — товар можно заказать, и такие слова отпугивают покупателя.
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
АВТОМОБИЛЬ ИЗ ОРИГИНАЛЬНОГО КАТАЛОГА (оригинальный каталог производителя, любая марка; по VIN или по модели):
═══════════════════════════════════════════
{{VIN_VEHICLE}}

═══════════════════════════════════════════
ДАННЫЕ О СОВМЕСТИМОСТИ (артикул → автомобили, если есть):
═══════════════════════════════════════════
Записи с полем "source": "laximo" взяты из оригинального каталога производителя (марка — в поле "brand"). Если "matchedBy": "vin" — подобрано по VIN клиента, совместимость с его машиной ПОДТВЕРЖДЕНА, уточнять двигатель/поколение не нужно. Если "matchedBy": "model" — подобрано по модели БЕЗ VIN (модель уже уточнена, НЕ переспрашивай её): эти детали подходят для этой модели по каталогу производителя, но если на одну деталь найдено несколько номеров, они могут отличаться по дате выпуска или комплектации — перечисли их как варианты и предложи прислать VIN, чтобы выбрать точный; если номер один — можно уверенно предлагать, коротко упомянув, что по VIN подбор ещё точнее. Обрати внимание на поле "notes": если там есть условие (например, "Для автомобилей с ..."), упомяни его клиенту. Несколько артикулов на одну позицию ("position") — это альтернативы или замены одной детали.
{{COMPATIBILITY}}

═══════════════════════════════════════════
ОРИГИНАЛЬНЫЕ НОМЕРА ПО VIN, КОТОРЫХ НЕТ В КАТАЛОГЕ:
═══════════════════════════════════════════
Здесь детали, которые оригинальный каталог производителя нашёл для автомобиля клиента (по VIN или по модели), но которых сейчас нет в КАТАЛОГЕ ТОВАРОВ выше (их нельзя показать карточкой). Если раздел пуст — пропусти его.
Если подходящего товара в КАТАЛОГЕ ТОВАРОВ нет, а здесь есть номер для запрошенной детали:
- Назови клиенту оригинальный номер производителя (OEM) и название детали — это точный номер для его машины.
- Объясни, что этой позиции пока нет в каталоге сайта, но менеджер может проверить наличие и срок поставки именно по этому номеру. Предложи оставить телефон или нажать кнопку менеджера.
- Если для одной детали несколько номеров — перечисли их (до 5) как альтернативы/замены; если у номера есть условие в "notes", укажи его.
- НЕ добавляй эти номера в блок <<<PRODUCTS>>>, НЕ называй цену и наличие — их нет в данных. НЕ говори, что деталь «не найдена» или «не подтверждена» — номер подтверждён по оригинальному каталогу.
{{LAXIMO_NOT_IN_CATALOG}}

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

// Pulls the chassis/generation code out of a model string's parentheses,
// e.g. "X5 (E70)" -> "E70", "X5 (F15, F85)" -> "F15, F85". Used only for
// the ambiguity check below -- not part of the actual matching logic.
function extractGeneration(model) {
  if (!model) return null;
  const m = model.match(/\(([^)]*)\)/);
  return m ? m[1].trim() : null;
}

// Detects the specific scenario that was costing real money for no
// product recommendation: a matched vendorCode set that spans MULTIPLE
// distinct generations of the same model (e.g. BMW X5's E70/F15/G05),
// with neither year nor engine code known yet to narrow it down. In that
// state the agent can never confidently recommend a product this turn --
// it can only ask which generation the customer has -- so there's no
// reason to pay for a full Sonnet 5 call carrying the entire matched
// catalog + compatibility blob just to arrive at a clarifying question.
// See the handler's short-circuit below, which uses this to skip straight
// to a cheap Haiku-only clarification instead. Returns an array of
// {generation, years} for each distinct generation found (deduped), so
// the caller can list concrete options rather than a vague "tell me your
// year" -- capped by the caller, not here.
function detectGenerationAmbiguity(matchedCompatibility) {
  const generations = new Map();
  for (const hits of Object.values(matchedCompatibility)) {
    for (const r of hits) {
      const gen = extractGeneration(r.model);
      if (!gen) continue; // no parenthetical chassis info -- can't offer it as an option
      if (!generations.has(gen)) generations.set(gen, { generation: gen, years: r.years || null });
    }
  }
  return [...generations.values()];
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

  const client = new Client({ connectionString: SUPABASE_DB_URL, ssl: false });
  try {
    await client.connect();
    const result = await client.query('select distinct vendor_code from compatibility');
    const codes = new Set(result.rows.map(r => r.vendor_code));
    vendorCodesCache    = codes;
    vendorCodesCachedAt = now;
    return codes;
  } catch (err) {
    console.error('fetchCompatibilityVendorCodes DB error:', err.message, '— falling back to',
      vendorCodesCache ? `stale cache (${vendorCodesCache.size} codes)` : 'empty Set (no cache yet)');
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

  const client = new Client({ connectionString: SUPABASE_DB_URL, ssl: false });
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
  } catch (err) {
    console.error('fetchCompatibilityBySeries DB error:', 'series=', series, err.message, '— falling back to',
      cached ? `stale cache (${Object.keys(cached.data).length} vendorCodes)` : 'empty {} (no cache yet)');
    return cached ? cached.data : {};
  } finally {
    await client.end().catch(() => {});
  }
}

// Direct vendor_code lookup, independent of series/brand/model.
//
// WHY THIS EXISTS: fetchCompatibilityBySeries() requires knowing the
// vehicle's series first (extractSeries(extracted.model)) -- but a pure
// "what car does part 61319483006 fit?" question often comes with NO
// brand/model at all (the customer is asking BECAUSE they don't know, or
// is asking on someone else's behalf). In that case extracted.model is
// null, extractSeries(null) returns 'unknown', and
// fetchCompatibilityBySeries('unknown') returns {} -- there's no
// series='unknown' row in Postgres. matchCompatibility() already has a
// vendorCode-first short-circuit (see below) that would happily answer
// from just the vendorCode, but it never gets the chance because the
// compatibility data for that code was never fetched in the first place.
// This function fetches it directly by vendor_code so that path actually
// has data to work with, regardless of whether a vehicle was ever
// mentioned. Confirmed real gap: this silently returned "no compatibility
// data" for any vendor-code-only compatibility question.
const vendorCodeCompatCache = new Map(); // vendorCode -> { vehicles, cachedAt }
const VENDOR_CODE_COMPAT_TTL_MS = 6 * 60 * 60 * 1000;

// ─── CACHE INVALIDATION ──────────────────────────────────────────────────
// All the compatibility/catalog caches above are module-level and now live
// as long as this Coolify container does (unlike the old Vercel serverless
// setup, where a cold start naturally reset them often). That means
// push-compatibility-to-supabase.js's `truncate + reinsert` can silently go
// unnoticed for up to VENDOR_CODES_TTL_MS/SERIES_TTL_MS (6h) after a push,
// since nothing here ever told this running process the DB changed.
// clearCaches() resets every cache that reads from the `compatibility`
// table (plus the derived catalog cache, since fetchCatalog() filters by
// the vendor-codes cache) so a push takes effect immediately instead of
// waiting out the TTL. Called via the /api/admin/clear-cache endpoint --
// see api/admin/clear-cache.js.
function clearCaches() {
  vendorCodesCache    = null;
  vendorCodesCachedAt = 0;
  seriesCache.clear();
  vendorCodeCompatCache.clear();
  catalogCache    = null;
  catalogCachedAt = 0;
  catalogIndexCache    = null;
  catalogIndexCachedAt = 0;
  laximo.resetPause().catch(() => {});
  console.log('clearCaches(): laximo pause lifted; vendorCodesCache, seriesCache, vendorCodeCompatCache, catalogCache, catalogIndexCache all cleared');
}

/**
 * Part numbers to offer as "open the part page" buttons: the extracted
 * vendorCode, only if the customer typed it in their LATEST message (so the
 * button doesn't repeat on every later reply). Spaces/dashes ignored, so
 * "13 62 8 582 663" matches 13628582663. Never a VIN or the phone number.
 */
function partLinksForMessage(extracted, messages) {
  const code = String(extracted?.vendorCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 5 || code.length > 20 || !/\d/.test(code)) return [];
  if (code === String(extracted?.vin || '').toUpperCase()) return [];
  const phone = String(extracted?.contactPhone || '').replace(/\D/g, '');
  if (phone && phone.endsWith(code.slice(-10))) return [];
  const lastUser = [...(messages || [])].reverse().find(m => m.role === 'user');
  const typed = String(lastUser?.content || '').toUpperCase().replace(/[\s\-.]/g, '');
  return typed.includes(code) ? [code] : [];
}

async function fetchCompatibilityByVendorCode(vendorCode) {
  if (!SUPABASE_DB_URL || !vendorCode) return [];

  const now = Date.now();
  const cached = vendorCodeCompatCache.get(vendorCode);
  if (cached && (now - cached.cachedAt) < VENDOR_CODE_COMPAT_TTL_MS) {
    return cached.vehicles;
  }

  const client = new Client({ connectionString: SUPABASE_DB_URL, ssl: false });
  try {
    await client.connect();
    const result = await client.query('select vehicle from compatibility where vendor_code = $1', [vendorCode]);
    const vehicles = result.rows.map(r => r.vehicle);
    vendorCodeCompatCache.set(vendorCode, { vehicles, cachedAt: now });
    return vehicles;
  } catch (err) {
    console.error('fetchCompatibilityByVendorCode DB error:', 'vendorCode=', vendorCode, err.message, '— falling back to',
      cached ? `stale cache (${cached.vehicles.length} vehicles)` : 'empty [] (no cache yet)');
    return cached ? cached.vehicles : [];
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
// Same wording the widget's product card shows (widget/chat-widget.js:
// stock > 0 -> "В наличии: N шт.", otherwise "Под заказ"). Given to the
// agent as a ready-made label so its text can't contradict the card --
// a prompt rule alone wasn't enough: in a live test the model still wrote
// "в наличии нет, доступны под заказ" for stock 0.
function availabilityLabel(stock) {
  const n = Number(stock);
  return n > 0 ? `в наличии (${n} шт.)` : 'под заказ';
}

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
        availability: availabilityLabel(p.available),
        url:      p.url     ? p.url.replace('http://', 'https://')     : null,
        picture:  p.picture ? p.picture.replace('http://', 'https://') : null,
      }));
    catalogCache    = JSON.stringify(compact);
    catalogCachedAt = now;
    return catalogCache;
  } catch (err) {
    console.error('fetchCatalog fetch error:', err.message, '— CATALOG_API:', CATALOG_API, '— falling back to',
      catalogCache ? 'stale cache' : 'empty [] (no cache yet)');
    return catalogCache || '[]';
  }
}

// ─── FULL CATALOG INDEX (for the Laximo/VIN path) ────────────────────────────
// fetchCatalog() above deliberately keeps only products that appear in the
// compatibility table. Laximo returns OEM numbers straight from the original
// BMW catalog, many of which were never in that table -- so the VIN path
// needs the WHOLE catalog, looked up by article. Kept as a Map (normalized
// article -> compact product) and never put into the prompt wholesale; only
// the handful of Laximo-matched products are.
let catalogIndexCache    = null; // Map
let catalogIndexCachedAt = 0;

async function fetchCatalogIndex() {
  const now = Date.now();
  if (catalogIndexCache && (now - catalogIndexCachedAt) < CATALOG_TTL_MS) {
    return catalogIndexCache;
  }
  try {
    const res = await fetch(CATALOG_API, { signal: AbortSignal.timeout(25000) });
    const data = await res.json();
    if (!data.products) return catalogIndexCache || new Map();

    const index = new Map();
    for (const p of data.products) {
      index.set(laximo.normalizeOem(p.vendorCode), {
        article:  p.vendorCode,
        name:     p.name,
        brand:    p.vendor,
        category: p.category,
        price:    p.price,
        stock:    p.available,
        availability: availabilityLabel(p.available),
        url:      p.url     ? p.url.replace('http://', 'https://')     : null,
        picture:  p.picture ? p.picture.replace('http://', 'https://') : null,
      });
    }
    catalogIndexCache    = index;
    catalogIndexCachedAt = now;
    return index;
  } catch (err) {
    console.error('fetchCatalogIndex fetch error:', err.message, '— CATALOG_API:', CATALOG_API, '— falling back to',
      catalogIndexCache ? 'stale index' : 'empty Map (no index yet)');
    return catalogIndexCache || new Map();
  }
}

/**
 * Ask Laximo (original manufacturer catalogs, all brands the client's
 * Laximo licence shows -- ~60) for the OEM numbers of the requested parts,
 * within a time budget:
 *   - VIN given    -> exact car via the VIN search            (matchedBy 'vin')
 *   - no VIN, brand + model + part named -> the brand's parameter
 *     wizard, filled from the customer's own words           (matchedBy 'model')
 *     -- may come back with { needsChoice } when a dropdown
 *     can't be decided (e.g. "M240i" vs "M240i B58C")
 * Returns null whenever the regular compatibility-table path should be used
 * instead -- never throws.
 */
async function lookupLaximo(extracted, messages) {
  if (!LAXIMO_ENABLED) return null;
  const vin = laximo.normalizeVin(extracted.vin);

  let mode = null;
  let customerText = '';
  if (vin) {
    mode = 'vin';
  } else if (
    extracted.brand &&
    extracted.model &&
    Array.isArray(extracted.partKeywords) && extracted.partKeywords.length
  ) {
    mode = 'model';
    // Everything the customer wrote (incl. clicked clarification buttons like
    // "220i" or "Правый руль") plus the extracted model/engine strings.
    // The extracted fields get a label so their line never equals an option
    // exactly -- only the customer's own messages count as "answers" (a
    // clicked button); see pickWizardOption() in lib/laximo.js.
    customerText = [
      `модель: ${extracted.model}`, extracted.engineCode ? `двигатель: ${extracted.engineCode}` : null,
      extracted.year ? `год: ${extracted.year}` : null,
      ...(messages || []).filter(m => m.role === 'user' && typeof m.content === 'string').map(m => m.content),
    ].filter(Boolean).join(' \n ');
  }
  if (!mode) return null;

  const started = Date.now();
  let timer;
  try {
    const work = mode === 'vin'
      ? laximo.findPartsByVin(vin, extracted.partKeywords || [])
      : laximo.findPartsByModel(customerText, extracted.partKeywords, extracted.brand);
    const result = await Promise.race([
      work,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`budget ${LAXIMO_BUDGET_MS}ms exceeded`)), LAXIMO_BUDGET_MS); }),
    ]);
    console.log('DIAG laximo', JSON.stringify({
      mode,
      vin: vin || null,
      model: mode === 'model' ? extracted.model : undefined,
      found: !!result?.vehicle,
      needsChoice: result?.needsChoice ? result.needsChoice.step : undefined,
      brand: result?.vehicle?.brand || (mode === 'model' ? extracted.brand : null),
      vehicle: result?.vehicle?.name || null,
      path: result?.vehicle?.path ? result.vehicle.path.join(' › ') : undefined,
      partKeywords: extracted.partKeywords || null,
      oemCount: result?.parts?.length ?? 0,
      ms: Date.now() - started,
    }));
    if (result?.unavailable) return null; // paused / over budget / breaker -- not "VIN not found"
    if (mode === 'vin') return result ? { ...result, vin, matchedBy: 'vin' } : { vin, notFound: true, matchedBy: 'vin' };
    return result ? { ...result, matchedBy: 'model' } : null;
  } catch (err) {
    // Budget exceeded: the scrape keeps running in the background and its
    // results land in the cache, so the customer's NEXT message is fast.
    console.error(`lookupLaximo (${mode}) failed, using compatibility table instead:`, err.message, `(${Date.now() - started}ms)`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── PHONE SANITY CHECK ─────────────────────────────────────────────────────
// The extraction step once took a BMW part number for the customer's phone
// ("Подойдёт 13627823945? VIN …" -> contactPhone "13627823945", 23.10), which
// also fired the automatic manager handoff with a bogus lead. Accept: Russian
// mobiles (9xxxxxxxxx, optionally with 7/8 in front) always; other 11-digit
// 7…/8… numbers only when written like a phone (+, brackets, dashes, spaces).
function plausiblePhone(raw) {
  const t = String(raw || '').trim();
  const d = t.replace(/\D/g, '');
  if (/^(?:[78])?9\d{9}$/.test(d)) return true;
  return d.length === 11 && /^[78]/.test(d) && /[+()\-\s]/.test(t);
}
function sanitizeContactPhone(extracted) {
  if (extracted && extracted.contactPhone && !plausiblePhone(extracted.contactPhone)) {
    console.log(`[extract] contactPhone "${extracted.contactPhone}" doesn't look like a phone -- ignored`);
    if (!extracted.vendorCode && /^\d{7,14}$/.test(String(extracted.contactPhone).replace(/\D/g, ''))) extracted.vendorCode = String(extracted.contactPhone).replace(/\D/g, '');
    extracted.contactPhone = null;
  }
}

// ─── PART-NUMBER COMPATIBILITY CHECK (ABCP name + Laximo) ──────────────────
// The customer names a part number and their car: is that number in the car's
// original catalog? Laximo on the site can't search by number, only by part
// NAME, so: 1) the name comes from the customer's words or from ABCP
// (search/brands: number -> brand + description), 2) the car's catalog is
// searched by that name (the normal Laximo lookup), 3) the numbers are
// compared. The verdict goes into the prompt as data -- the agent never guesses.
const partNameCache = new Map(); // number -> { at, data }
const PART_NAME_TTL_MS = 24 * 60 * 60 * 1000;
const BRAND_KEY = s => String(s || '').toLowerCase().replace(/[^a-zа-я0-9]/g, '');

/** ABCP: brand + description for a part number, preferring the car's brand. */
async function abcpPartName(code, carBrand) {
  if (!abcpOrders.enabled()) return null;
  const hit = partNameCache.get(code);
  let list = hit && Date.now() - hit.at < PART_NAME_TTL_MS ? hit.data : null;
  if (!list) {
    try {
      const res = await Promise.race([
        abcpOrders.apiGet('search/brands', { number: code }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 5s')), 5000)),
      ]);
      list = (Array.isArray(res) ? res : Object.values(res || {})).filter(x => x && x.brand);
      partNameCache.set(code, { at: Date.now(), data: list });
      if (partNameCache.size > 2000) partNameCache.clear();
    } catch (err) {
      console.error('[compat] search/brands failed:', err.message);
      return null;
    }
  }
  if (!list.length) return null;
  const want = BRAND_KEY(carBrand === 'MINI' ? 'BMW' : carBrand);
  const usable = x => x.description && !/^деталь$/i.test(String(x.description).trim()) && !looksGarbled(x.description);
  const own = list.find(x => want && BRAND_KEY(x.brand) === want && usable(x));
  const any = list.find(usable);
  const pick = own || any || list[0];
  let name = usable(pick) ? String(pick.description).trim() : null;
  if (!name) {
    // Only garbled / "Деталь" names: take one from the offers of the price
    // search (one call; e.g. "Temperature sensor, exhaust").
    try {
      const offers = await Promise.race([
        abcpOrders.apiGet('search/articles', { number: code, brand: pick.brand, useOnlineStocks: 0, withOutAnalogs: 1 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 6s')), 6000)),
      ]);
      const arr = Array.isArray(offers) ? offers : Object.values(offers || {});
      const descs = arr.map(o => o && o.description).filter(d => usable({ description: d }));
      name = descs.find(d => /[а-яё]/i.test(d)) || descs[0] || null;
      if (name) console.log(`[compat] part name for ${code} from offers: "${name}"`);
    } catch (err) {
      console.error('[compat] search/articles failed:', err.message);
    }
  }
  return {
    brand: pick.brand,
    name,
    // Only brands other than the car's (e.g. MANN, Bosch) -> an aftermarket number.
    aftermarket: !!want && !list.some(x => BRAND_KEY(x.brand) === want),
  };
}

/** Mis-decoded text like "Ґрвзшъ вхьяхарвгал si" (seen in ABCP descriptions). */
function looksGarbled(s) {
  const t = String(s || '');
  return /[ҐґЄєЇїЎўІі]/.test(t) || /[ъь]{2}|[ъь][аеёиоуыэюя]/i.test(t.replace(/подъ|объ|съ|разъ|отъ|изъ|въ/gi, ''));
}

// Some ABCP names are English ("Temperature sensor, exhaust") -- the Laximo
// catalog on the site is Russian. Translate with a small, cheap model call.
const translateCache = new Map();
async function toRussianPartName(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  if (translateCache.has(key)) return translateCache.get(key);
  try {
    const res = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 60, temperature: 0,
        messages: [{ role: 'user', content: `Переведи название автозапчасти на русский так, как оно называется в оригинальном каталоге BMW (ETK), коротко, без пояснений и кавычек. Название: ${name}` }],
      }),
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json();
    const out = String(((data.content || []).find(b => b.type === 'text') || {}).text || '').split('\n')[0].replace(/["«».]/g, '').trim();
    const ru = /[а-яё]/i.test(out) ? out.slice(0, 80) : null;
    translateCache.set(key, ru);
    if (translateCache.size > 2000) translateCache.clear();
    return ru;
  } catch (err) {
    console.error('[compat] translation failed:', err.message);
    return null;
  }
}

/** "Фильтр масляный" -> ["фильтр масляный", "масляный фильтр"] (Laximo name search). */
function keywordsFromName(name) {
  const n = String(name || '').toLowerCase().replace(/[^a-zа-яё0-9\s-]/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!n || n === 'деталь') return [];
  const words = n.split(' ');
  const out = [n];
  if (words.length === 2) out.push(`${words[1]} ${words[0]}`);
  return out.slice(0, 2);
}

/** Pure: compare the checked number with the car's catalog parts. Exported for tests. */
function compatVerdict(code, laximoResult) {
  const want = laximo.normalizeOem(code);
  if (!laximoResult) return { verdict: 'unavailable' };
  if (laximoResult.notFound) return { verdict: 'vehicle_not_found' };
  const parts = laximoResult.parts || [];
  const hits = parts.filter(p => laximo.normalizeOem(p.oem) === want);
  if (hits.length) return { verdict: 'fits', matches: hits.slice(0, 3).map(p => ({ oem: p.oem, name: p.name, unit: p.unit, notes: p.notes })) };
  // The search itself failed (site block, pause...): "not found" would be a false statement.
  if (laximoResult.searchFailed) return { verdict: 'unavailable', reason: 'catalog search failed' };
  if (parts.length) return { verdict: 'other_numbers', catalogNumbers: parts.slice(0, 8).map(p => ({ oem: p.oem, name: p.name, unit: p.unit })) };
  return { verdict: 'part_not_found' };
}

// ─── ORDER STATUS (ABCP admin API, lib/abcpOrders.js) ──────────────────────
// Deterministic replies -- no Sonnet call: order data must never be guessed.
const ORDER_CONTACTS = 'в Telegram или MAX: +7 (967) 555-7-555';
const fmtDate = s => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
};
const fmtDay = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}` : null; };
const fmtRub = n => `${Math.round(Number(n)).toLocaleString('ru-RU').replace(/\u00a0/g, ' ')} ₽`;

async function orderStatusReply(extracted, ip) {
  const number = abcpOrders.normalizeOrderNumber(extracted.orderNumber);
  const phone = extracted.contactPhone, email = extracted.contactEmail;
  if (!abcpOrders.enabled()) {
    return `Статус заказа можно посмотреть в личном кабинете на сайте, в разделе «Мои заказы». Также вы можете написать нам ${ORDER_CONTACTS} — укажите номер заказа, и мы подскажем.\n<<<MANAGER_BUTTON>>>`;
  }
  if (!number) {
    return 'Подскажу статус заказа. Напишите, пожалуйста, **номер заказа** (обычно 9 цифр — есть в письме или SMS о заказе и в личном кабинете в разделе «Мои заказы») и **телефон или email**, указанный при заказе.';
  }
  if (!phone && !email) {
    return `Спасибо! Для защиты ваших данных напишите, пожалуйста, **телефон или email**, указанный при оформлении заказа №${number}.`;
  }
  const r = await abcpOrders.lookupOrder({ number, phone, email, ip });
  console.log('DIAG order-status', JSON.stringify({ number, by: phone ? 'phone' : 'email', status: r.status, reason: r.reason || undefined }));
  if (r.status === 'rate_limited') {
    return `Слишком много попыток проверки. Пожалуйста, напишите нам ${ORDER_CONTACTS} — менеджер подскажет статус заказа.\n<<<MANAGER_BUTTON>>>`;
  }
  if (r.status === 'unavailable') {
    return `Сейчас не получается проверить заказ автоматически. Статус можно посмотреть в личном кабинете («Мои заказы») или написать нам ${ORDER_CONTACTS}.\n<<<MANAGER_BUTTON>>>`;
  }
  if (r.status === 'no_match') {
    return `Не нашёл заказ №${number} с такими данными. Проверьте, пожалуйста, номер заказа и телефон или email, указанный при заказе, и напишите ещё раз. Если не получается — напишите нам ${ORDER_CONTACTS}.\n<<<MANAGER_BUTTON>>>`;
  }
  if (r.status === 'deleted') {
    return `Заказ №${r.number} сейчас не активен: возможно, он был объединён с другим заказом или отменён. Напишите, пожалуйста, нам ${ORDER_CONTACTS} — менеджер подскажет актуальный номер и статус.\n<<<MANAGER_BUTTON>>>`;
  }
  const short = t => { const x = String(t || ''); return x.length > 70 ? x.slice(0, 67).replace(/[\s,.;:]+\S*$/, '') + '…' : x; };
  const lines = [];
  if (r.viaCode) lines.push(r.orders.length > 1 ? `По коду заказа ${r.code} нашёл ${r.orders.length} заказа:` : `По коду заказа ${r.code}:`);
  for (const o of r.orders.slice(0, 3)) {
    if (lines.length) lines.push('');
    lines.push(`**Заказ №${o.number}**${fmtDate(o.date) ? ` от ${fmtDate(o.date)}` : ''}`);
    const pos = o.positions.slice(0, 15);
    // Timeline per item: "Заказ принят 23.10 → Заказано у поставщика 24.10 → **В пути** 26.10"
    // (from cp/orders/statusHistory; current status alone if there's no history).
    const timeline = p => {
      const h = (p.history || []).filter(e => e.status);
      if (h.length > 1) return h.map((e, i) => `${i === h.length - 1 ? `**${e.status}**` : e.status}${fmtDay(e.at) ? ` ${fmtDay(e.at)}` : ''}`).join(' → ');
      return `**${p.status || 'статус уточняется'}**${fmtDate(p.statusDate) ? ` (с ${fmtDate(p.statusDate)})` : ''}`;
    };
    const lines0 = pos.map(timeline);
    const one = new Set(lines0).size === 1;
    pos.forEach((p, i) => {
      const what = [p.brand, p.number].filter(Boolean).join(' ') + (p.description ? ` — ${short(p.description)}` : '') + (p.quantity ? ` (${p.quantity} шт.)` : '');
      lines.push(`• ${what}` + (one ? '' : `: ${lines0[i]}`));
    });
    if (o.positions.length > 15) lines.push(`…и ещё ${o.positions.length - 15} поз.`);
    if (one) lines.push(`${(pos[0] && (pos[0].history || []).length > 1) ? 'История' : 'Статус'}: ${lines0[0]}.`);
    // Expected arrival from the supplier's delivery time (only if still ahead).
    const days = Math.max(0, ...pos.map(p => p.deliveryDaysMax || p.deliveryDays || 0));
    const base = Date.parse(String(o.date || '').replace(' ', 'T'));
    if (days && !Number.isNaN(base) && base + days * 86400000 > Date.now()) {
      lines.push(`Ориентировочный срок поставки: до ${fmtDate(new Date(base + days * 86400000).toISOString())}${!one && pos.length > 1 ? ' (по самой долгой позиции)' : ''}.`);
    }
    // Each status's client description once, not per item.
    const infos = [...new Map(pos.filter(p => p.statusInfo).map(p => [p.status, p.statusInfo])).entries()];
    for (const [st, info] of infos) lines.push(one ? info : `${st}: ${info}`);
    if (o.deliveryOffice) lines.push(`Самовывоз: ${o.deliveryOffice}.`);
    else if (o.deliveryType) lines.push(`Доставка: ${o.deliveryType}.`);
    if (o.debt > 0) lines.push(`К оплате: ${fmtRub(o.debt)}.`);
    else if (o.sum) lines.push('Заказ оплачен.');
  }
  if (r.orders.length > 3) lines.push(`\n…и ещё ${r.orders.length - 3} заказ(а).`);
  lines.push(`\nЕсли нужны подробности по срокам — напишите нам ${ORDER_CONTACTS}.`);
  return lines.join('\n');
}

// Wording for the clarifying question when the model wizard can't decide a
// dropdown on its own. Keys are Laximo's step names.
const WIZARD_STEP_QUESTIONS = {
  'Серия': 'поколение (кузов) вашего автомобиля',
  'Год выпуска': 'год выпуска автомобиля',
  'Модификация': 'модификацию (двигатель)',
  'Тип кузова': 'тип кузова',
  'Модель': 'точную модификацию (модель/двигатель)',
  'Рулевое управление': 'расположение руля',
  'Трансмиссия': 'тип коробки передач',
  'Рынок': 'для какого рынка выпущен автомобиль',
  'Вариант автомобиля': 'какой из вариантов ваш',
};

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
{"vin": "VIN-номер автомобиля (17 символов, латиница и цифры), ТОЛЬКО если пользователь написал его в диалоге, иначе null. Не путай VIN с артикулом детали", "vendorCode": "артикул детали, если пользователь его назвал, иначе null", "brand": "марка авто, иначе null", "model": "модель авто, иначе null", "year": "год выпуска автомобиля (только число), если известен, иначе null", "engineCode": "код(ы) двигателя, иначе null", "powerHp": "мощность в л.с. (только число), иначе null", "partKeywords": "МАССИВ строк с ключевыми словами деталей НА РУССКОМ ЯЗЫКЕ (каталог хранит названия по-русски), без марки/модели авто. Если клиент назвал конкретную деталь -- один элемент массива, но ДОБАВЬ известные синонимы, которые каталог использует вместо обиходного термина: 'тормозные колодки' -- добавь также 'накладки' (каталог часто называет ремкомплект колодок 'рем.к-т торм.накладок', это другое слово, не однокоренное). Например запрос про тормозные колодки -- [\"тормозные колодки\",\"накладки\"]. Если клиент сделал ОБЩИЙ запрос про ТО/техобслуживание/'что нужно менять' -- разверни его в стандартный список категорий: [\"масляный фильтр\",\"моторное масло\",\"воздушный фильтр\",\"салонный фильтр\",\"свеча зажигания\",\"тормозные колодки\",\"накладки\",\"тормозной диск\"]. Если клиент ничего из этого не называл и не спрашивал про ТО -- null.", "oilApprovalCode": "допуск производителя для масла, если пользователь его назвал (например VW 507.00, BMW Longlife-01), иначе null", "fuelType": "petrol или diesel, если известно, иначе null", "turbo": "true, false, если известно, иначе null", "mileageKm": "пробег в километрах (только число), если известно, иначе null", "orderStatusQuestion": "true, если ПОСЛЕДНЕЕ сообщение клиента касается его УЖЕ ОФОРМЛЕННОГО заказа (статус, где заказ, когда привезут, готов ли к выдаче, оплачен ли) ИЛИ клиент в нём отвечает на вопрос ассистента о номере заказа / телефоне / email для проверки заказа; иначе false", "orderNumber": "номер уже оформленного заказа (обычно 9 цифр, например 286496721), если клиент его назвал, иначе null. НЕ путай с артикулом детали, VIN и номером телефона", "contactPhone": "НЕ путай с артикулом детали: артикулы BMW — 11 цифр и обычно начинаются с 0–6 (например 13627823945, 11428507683), это НЕ телефон. Номер телефона клиента, ТОЛЬКО если он написал его текстом в диалоге (любой формат: +7..., 8..., с пробелами/дефисами), иначе null", "contactEmail": "email клиента, ТОЛЬКО если он написал его текстом в диалоге, иначе null"}
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
    const res = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
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
    .replace(/\bXDRIVE/g, ' ')

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
// RU->EN part-keyword translations. Confirmed real incident (2026-08-14):
// a customer asked for "лобовое стекло" (windshield) on a BMW X6 E71 --
// vehicle matching correctly found the vendorCode, but the ABCP feed names
// this specific product entirely in English ("Green windshield, shade
// band+rain sensor"), so the Russian keyword tokens never shared a
// substring with the (Latin-only) haystack tokens and the real match was
// silently dropped. The ABCP feed mixes Russian- and English-named
// products, so this isn't a one-off -- any English-named item is invisible
// to Russian keyword search without this.
// Kept as a small hardcoded map rather than a translation API call: cheap,
// deterministic, no added latency/cost per request. Part-type vocabulary
// is a closed, slow-growing list -- extend as new gaps are confirmed via
// missing_articles / production logs, same as the накладки synonym above.
const PART_KEYWORD_RU_EN = {
  'СТЕКЛО':      ['GLASS', 'WINDSHIELD', 'WINDOW'],
  'ЛОБОВОЕ':     ['WINDSHIELD', 'FRONT'],
  'БАМПЕР':      ['BUMPER'],
  'ФАРА':        ['HEADLIGHT', 'HEADLAMP'],
  'ФОНАРЬ':      ['LIGHT', 'LAMP', 'TAILLIGHT'],
  'ЗЕРКАЛО':     ['MIRROR'],
  'КАПОТ':       ['HOOD', 'BONNET'],
  'ДВЕРЬ':       ['DOOR'],
  'РЕШЕТКА':     ['GRILLE', 'GRILL'],
  'РАДИАТОР':    ['RADIATOR'],
  'АМОРТИЗАТОР': ['SHOCK', 'ABSORBER', 'STRUT'],
  'ТОРМОЗНОЙ':   ['BRAKE'],
  'КОЛОДКИ':     ['PAD', 'PADS'],
  'ДИСК':        ['DISC', 'DISK', 'ROTOR'],
  'ФИЛЬТР':      ['FILTER'],
  'РЕМЕНЬ':      ['BELT'],
  'ПОДШИПНИК':   ['BEARING'],
  'ГЛУШИТЕЛЬ':   ['MUFFLER', 'EXHAUST'],
  'СВЕЧА':       ['SPARK', 'PLUG'],
  'ДАТЧИК':      ['SENSOR'],
  'НАСОС':       ['PUMP'],
  'ФИЛЬТРУЮЩИЙ': ['FILTER'],
};

// Expands a keyword word with any known EN equivalents (see
// PART_KEYWORD_RU_EN above), alongside its normal stemmed form. Looked up
// against the raw uppercase word (not the stemmed one) since the
// dictionary keys are full words -- stemming Cyrillic first and matching
// that against a dictionary keyed on full words would just add another
// way to miss.
function expandWithEnglish(rawWord) {
  const enMatches = PART_KEYWORD_RU_EN[rawWord];
  return enMatches ? [stemRu(rawWord), ...enMatches] : [stemRu(rawWord)];
}

function filterCatalogByPartKeyword(catalogArray, partKeywords) {
  if (!partKeywords || !partKeywords.length) return catalogArray; // nothing to narrow by yet -- caller decides whether that's safe to send as-is
  const keywordTokenLists = partKeywords
    .map(k => (k || '').toUpperCase().trim().split(/\s+/).filter(Boolean))
    .filter(words => words.length)
    .map(words => words.flatMap(expandWithEnglish));
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

      const modelOk = userModelTokens.every((tok, idx) => {
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
        //
        // IMPORTANT: only apply this strict check to the FIRST token
        // (idx === 0) -- the series identifier always comes first in
        // userModelTokens. Applying it to every short token also caught
        // engine-displacement fragments that end up isolated after
        // normalizeModel()'s "." -> " " punctuation step, e.g. "4.4i"
        // becomes tokens ["4", "4I"] -- that bare "4" was being compared
        // as if it were a series number and (correctly) never equaled
        // the record's actual series ("X5"), silently rejecting genuine
        // matches for the customer's own vehicle. Confirmed real
        // incident: BMW X5 E53 4.4i (N62B44) matched zero compatibility
        // rows despite an exact record existing, purely because of this.
        // Non-leading short tokens now fall through to the plain
        // substring check instead, same as longer tokens.
        if (idx === 0 && tokenCompact.length <= 2) {
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
async function handler(req, res) {
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
    sanitizeContactPhone(extracted);
    console.log("========== VEHICLE ==========");
console.log(JSON.stringify(extracted, null, 2));

    // ─── VIN PATH (Laximo / original BMW catalog) ─────────────────────────
    // If the customer gave a VIN, resolve the exact car and its OEM numbers
    // for the requested parts from the original catalog. When this yields
    // parts, it REPLACES the compatibility-table matching below; otherwise
    // (no VIN, VIN not found, no part named yet, scraper failed or slow)
    // we fall through to the table path exactly as before.
    // Questions about an existing order: answered from ABCP, no catalog work.
    if (extracted.orderStatusQuestion === true || extracted.orderStatusQuestion === 'true') {
      const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
      const reply = await orderStatusReply(extracted, ip);
      Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json({ reply });
    }

    // Part number + car known -> check that number against the car's catalog.
    let compat = null;
    let compatSkipCode = null;
    // Safety net: the extraction step sometimes misses the part number when a
    // VIN is in the same message (seen 23.10: "Подойдёт 13628582663? VIN …").
    // Take an 11-digit number from the latest message (BMW format; spaces ok),
    // never the VIN or a phone number (7…/8… with 11 digits, or the extracted phone).
    // Also when the "part number" it returned is really the VIN, or isn't in
    // the customer's recent messages at all (seen 23.10: no check ran for
    // "Подойдёт 13627823945? VIN X4XZW61140L560928").
    {
      const norm = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const vc = norm(extracted.vendorCode);
      const recent = (messages || []).filter(m => m.role === 'user').slice(-2)
        .map(m => String(typeof m.content === 'string' ? m.content : '')).join(' ').toUpperCase().replace(/[\s\-.]/g, '');
      if (vc && (vc === norm(extracted.vin) || vc.length === 17)) {
        console.log(`[compat] extracted vendorCode "${extracted.vendorCode}" is the VIN -- ignored`);
        extracted.vendorCode = null;                 // wrong anyway
      } else if (vc && !recent.includes(vc)) {
        compatSkipCode = vc;                         // older number: keep it, just don't re-check it
      }
    }
    if (!extracted.vendorCode || compatSkipCode) {
      const last = [...(messages || [])].reverse().find(m => m.role === 'user');
      const text = String(last && typeof last.content === 'string' ? last.content : '').replace(/(\d)[\s-](?=\d)/g, '$1');
      const phone = String(extracted.contactPhone || '').replace(/\D/g, '').slice(-10);
      const found = (text.match(/(?<![\dA-Z])\d{11}(?![\dA-Z])/gi) || [])
        .find(n => !/^[78]9/.test(n) && !(phone && n.endsWith(phone)) && !String(extracted.vin || '').includes(n));
      if (found) { extracted.vendorCode = found; compatSkipCode = null; console.log(`[compat] part number ${found} taken from the message (missed by extraction)`); }
    }
    const compatCode = compatSkipCode ? '' : String(extracted.vendorCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    // Only while the number is current: typed in one of the customer's last 2 messages.
    const recentUserText = (messages || []).filter(m => m.role === 'user').slice(-2)
      .map(m => String(typeof m.content === 'string' ? m.content : '')).join(' ').toUpperCase().replace(/[\s\-.]/g, '');
    if (compatCode.length >= 5 && recentUserText.includes(compatCode) && compatCode !== String(extracted.vin || '').toUpperCase()
        && (laximo.normalizeVin(extracted.vin) || (extracted.brand && extracted.model))) {
      compat = { code: compatCode, partName: null, source: 'customer' };
      if (!Array.isArray(extracted.partKeywords) || !extracted.partKeywords.length) {
        const info = await abcpPartName(compatCode, extracted.brand || 'BMW');
        if (info) Object.assign(compat, { partName: info.name, partBrand: info.brand, aftermarket: info.aftermarket, source: 'abcp' });
        if (info && info.name && !/[а-яё]/i.test(info.name)) {
          // English name from ABCP -> Russian, as the catalog names it.
          const ru = await toRussianPartName(info.name);
          console.log(`[compat] ABCP name "${info.name}" -> "${ru || '?'}"`);
          if (ru) { compat.partNameOriginal = info.name; info.name = ru; compat.partName = ru; }
        }
        const kw = keywordsFromName(info && info.name);
        if (kw.length) extracted.partKeywords = kw; // drives the Laximo name search below
      }
      if (!extracted.partKeywords || !extracted.partKeywords.length) compat.verdict = 'no_part_name';
    }

    const laximoResult = await lookupLaximo(extracted, messages);
    if (compat && !compat.verdict) Object.assign(compat, compatVerdict(compat.code, laximoResult));
    // Laximo couldn't check (site block, pause, disabled): fall back to our
    // compatibility table when the model is known; with only a VIN, ask for
    // the model (a VIN can't be decoded without Laximo).
    if (compat && ['unavailable', 'no_part_name'].includes(compat.verdict)) {
      compat.catalogUnavailable = true;
      // The car may be known from a saved VIN lookup even when the part search
      // is blocked (seen 23.10: "X5 40dX", Код модели E70N) -> use it for the
      // table: series + body code ("X5 E70"), no trim (tables spell it differently).
      let car = extracted.brand && extracted.model ? { brand: extracted.brand, model: extracted.model } : null;
      const lv = laximoResult && laximoResult.vehicle;
      if (!car && lv && lv.name) {
        const series = String(lv.name).trim().split(/\s+/)[0];
        const body = String((lv.options && (lv.options['Код модели'] || lv.options['Серия'])) || '').trim().match(/^[A-Z]\d{2,3}/i);
        if (series) car = { brand: lv.brand || 'BMW', model: [series, body && body[0].toUpperCase()].filter(Boolean).join(' ') };
        if (car) compat.carFromVin = `${car.brand} ${car.model}`;
      }
      if (car) {
        const recs = await fetchCompatibilityByVendorCode(compat.code);
        const fits = (matchCompatibility({ [compat.code]: recs }, { ...extracted, ...car, vendorCode: null })[compat.code]) || [];
        const desc = r => [r.brand, r.model, r.modificationName, r.engineCode,
          r.years || [r.yearFrom, r.yearTo].filter(Boolean).join('–')].filter(Boolean).join(' ');
        if (fits.length) Object.assign(compat, { verdict: 'table_fits', tableVehicles: fits.slice(0, 5).map(desc) });
        else if (recs.length) Object.assign(compat, { verdict: 'table_other_vehicles', tableVehicles: [...new Set(recs.map(desc))].slice(0, 8) });
        else compat.verdict = 'table_no_data';
      } else if (laximo.normalizeVin(extracted.vin)) {
        compat.verdict = 'vin_unavailable_need_model';
      }
    }
    if (compat) console.log('DIAG compat', JSON.stringify({ code: compat.code, source: compat.source, partName: compat.partName, keywords: extracted.partKeywords, aftermarket: compat.aftermarket || false, verdict: compat.verdict, tableRows: compat.tableVehicles ? compat.tableVehicles.length : undefined, by: laximoResult?.matchedBy || null }));

    // Model path couldn't decide a dropdown (e.g. "M240i" -> B58C or B58D?).
    // Ask the customer directly with the catalog's own options as buttons --
    // their click comes back as text the wizard can match on the next turn.
    // Cheap: no Sonnet call, no catalog payload.
    if (laximoResult?.needsChoice) {
      const { step, options } = laximoResult.needsChoice;
      const what = WIZARD_STEP_QUESTIONS[step] || String(step).toLowerCase();
      const buttons = options.slice(0, 16);
      const reply = `Чтобы подобрать детали по оригинальному каталогу производителя, уточните, пожалуйста, ${what}:` +
        `\n\nЛибо пришлите VIN (17 символов, указан в СТС) — по нему подбор будет точнее.` +
        `\n<<<BUTTONS>>>\n${JSON.stringify(buttons)}\n<<<END_BUTTONS>>>`;
      console.log('DIAG laximo-needs-choice', JSON.stringify({ step, optionCount: options.length }));
      Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json({ reply });
    }
    let vinVehicleForPrompt = 'Нет данных (клиент не назвал VIN).';
    const laximoDownReason = !LAXIMO_ENABLED ? 'disabled' : await laximo.unavailableReason().catch(() => null);
    const givenVin = laximo.normalizeVin(extracted.vin);
    if (givenVin && !laximoResult) {
      vinVehicleForPrompt = `Клиент указал VIN ${givenVin}, но подбор по VIN сейчас недоступен. НЕ обещай подбор по VIN и не проси VIN повторно: предложи передать VIN менеджеру для точного подбора (кнопка менеджера) и подбирай по марке/модели/году, если клиент их назвал.`;
    }
    if (laximoDownReason && !laximoResult) {
      vinVehicleForPrompt += ` ВНИМАНИЕ: оригинальный каталог производителя СЕЙЧАС ВРЕМЕННО НЕДОСТУПЕН, проверить по нему не удалось. НЕ говори клиенту, что детали нет у производителя или "среди оригинальных номеров" — это неизвестно. Если в КАТАЛОГЕ ТОВАРОВ подходящего нет, скажи, что сейчас не удалось найти её автоматически, и предложи менеджера: он подберёт деталь по оригинальному каталогу (лучше всего по VIN) и проверит наличие и сроки.`;
    }
    if (laximoResult?.notFound) {
      vinVehicleForPrompt = `VIN ${laximoResult.vin} не найден в оригинальных каталогах производителей. Попроси клиента проверить VIN или назвать марку, модель и год.`;
    } else if (laximoResult?.vehicle && laximoResult.matchedBy === 'model') {
      const v = laximoResult.vehicle;
      vinVehicleForPrompt = JSON.stringify({
        matchedBy: 'model',
        note: 'Подобрано по модели, без VIN',
        brand: v.brand,
        catalogPath: (v.path || []).join(' › '),
        model: v.name, modelCode: v.modelCode, ...v.options,
      });
    } else if (laximoResult?.vehicle) {
      const v = laximoResult.vehicle;
      vinVehicleForPrompt = JSON.stringify({ matchedBy: 'vin', vin: laximoResult.vin, brand: v.brand, model: v.name, modelCode: v.modelCode, ...v.options });
    }
    const laximoUsed = !!(laximoResult?.parts && laximoResult.parts.length);

    let matchedCompatibilityByVehicle;
    let matchedCatalogByVehicle;

    if (laximoUsed) {
      const catalogIndex = await fetchCatalogIndex();
      const v = laximoResult.vehicle;
      matchedCompatibilityByVehicle = {};
      for (const p of laximoResult.parts) {
        const record = {
          source:    'laximo',
          matchedBy: laximoResult.matchedBy, // 'vin' = exact car; 'model' = by model, no VIN
          brand:     v.brand || 'BMW',
          vin:       laximoResult.vin || null,
          model:     v.name,
          chassis:   v.options?.['Код модели'] || null,
          engine:    v.options?.['Двигатель'] || null,
          productionDate: v.options?.['Дата выпуска'] || null,
          partName:  p.name,
          unit:      p.unit,
          position:  p.position,
          qty:       p.qty,
          notes:     Object.fromEntries(Object.entries(p.notes || {}).filter(([k]) => k !== 'Количество')),
        };
        (matchedCompatibilityByVehicle[p.oem] ||= []).push(record);
      }
      // Laximo returns normalized OEMs; catalog articles are looked up the
      // same way, then keyed back by the catalog's own article string so the
      // rest of the handler (missing-articles logging, prompt) is unchanged.
      matchedCatalogByVehicle = [];
      const remapped = {};
      for (const [oem, records] of Object.entries(matchedCompatibilityByVehicle)) {
        const product = catalogIndex.get(oem);
        if (product) {
          matchedCatalogByVehicle.push(product);
          remapped[product.article] = records;
        } else {
          remapped[oem] = records;
        }
      }
      matchedCompatibilityByVehicle = remapped;
    } else {

    // Now that we know the vehicle's series, pull just that series' rows
    // instead of the whole compatibility table.
    const series = extractSeries(extracted.model);
    let compatibilityData = await fetchCompatibilityBySeries(series);

    // If the customer named a specific vendorCode, make sure ITS
    // compatibility rows are available regardless of whether the series
    // lookup above found anything -- e.g. no brand/model was ever
    // mentioned (series === 'unknown', fetchCompatibilityBySeries returns
    // {}), or the part's series differs from whatever vehicle info was
    // extracted. Without this, a pure "what car does 61319483006 fit?"
    // question with no stated vehicle silently gets no compatibility data
    // at all, even though matchCompatibility() below is fully able to
    // answer from the vendorCode alone. Skipped when the series fetch
    // already has this code, to avoid a redundant DB round-trip on the
    // common case (customer gave both a vehicle and a part number).
    if (extracted.vendorCode && !compatibilityData[extracted.vendorCode]) {
      const directVehicles = await fetchCompatibilityByVendorCode(extracted.vendorCode);
      if (directVehicles.length) {
        compatibilityData = { ...compatibilityData, [extracted.vendorCode]: directVehicles };
      }
      // TEMPORARY DIAGNOSTIC LOGGING -- confirms this path actually fires
      // in production and how often the direct fetch finds something the
      // series fetch missed (e.g. no vehicle mentioned at all, or a
      // cross-series part). Same style as the existing DIAG match-check
      // block further down.
      console.log('DIAG vendor-code-direct-compat', JSON.stringify({
        vendorCode: extracted.vendorCode,
        series,
        seriesHadIt: false, // guaranteed false here -- we only reach this branch when it didn't
        directHitCount: directVehicles.length,
      }));
    }

    matchedCompatibilityByVehicle = matchCompatibility(compatibilityData, extracted);
    const vendorCodesMatched = new Set(Object.keys(matchedCompatibilityByVehicle));
    matchedCatalogByVehicle = catalogParsed.filter(p => vendorCodesMatched.has(p.article));
    } // end compatibility-table path (non-VIN)

    const matchedVendorCodesByVehicle = new Set(Object.keys(matchedCompatibilityByVehicle));

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
    // VIN path: OEM numbers the original catalog found for this exact car
    // but that aren't in the catalog feed. Instead of the agent only saying
    // "not found", it gives the customer the exact BMW part number and
    // offers a manager to check availability/order by that number (the
    // client sells original parts and can usually order them). Capped so a
    // broad search can't flood the prompt.
    const MAX_LAXIMO_NOT_IN_CATALOG = 15;
    const laximoNotInCatalog = laximoUsed
      ? missingVendorCodes.slice(0, MAX_LAXIMO_NOT_IN_CATALOG).map(code => {
          const r = (matchedCompatibilityByVehicle[code] || [])[0] || {};
          return {
            oem: code,
            name: r.partName || null,
            ...(r.unit ? { unit: r.unit } : {}),
            ...(r.notes && Object.keys(r.notes).length ? { notes: r.notes } : {}),
          };
        })
      : [];

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
    if (laximoUsed) {
      // Laximo results already come from a part-NAME search for exactly
      // these keywords, so a second keyword filter would only drop real
      // matches whose catalog names are worded differently. Just cap it.
      matchedCatalog = matchedCatalogByVehicle.slice(0, MAX_UNFILTERED_CATALOG_ITEMS);
    } else if (extracted.partKeywords && extracted.partKeywords.length) {
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

    // ─── COST SHORT-CIRCUIT: generation ambiguity ───────────────────────────
    // If the customer named a part and a model, but hasn't given a year or
    // engine code, AND the matched vendorCodes span more than one distinct
    // generation of that model (e.g. BMW X5's E70/F15/G05), the main agent
    // can never confidently recommend a product this turn -- the ONLY
    // useful thing it can do is ask which generation the customer has.
    // Previously that still went through the full path: entire matched
    // catalog + compatibility blob (all generations at once) sent to
    // Sonnet 5, just to conclude "please tell me your year" -- confirmed
    // real incident, $0.38 for a single clarifying question with zero
    // products shown. Short-circuit here instead: skip Sonnet and the
    // catalog/compatibility payload entirely, ask a cheap Haiku call to
    // phrase the clarifying question using ONLY the small list of detected
    // generations (a few dozen tokens, not the full matched dataset).
    // (Never needed on the VIN path -- the VIN already pins the generation.)
    if (!laximoResult?.vehicle && partFilterApplied && extracted.model && !extracted.year && !extracted.engineCode) {
      const generationOptions = detectGenerationAmbiguity(matchedCompatibility);
      if (generationOptions.length > 1) {
        const optionsForPrompt = generationOptions.slice(0, 6);
        console.log('DIAG generation-ambiguity-shortcut', JSON.stringify({
          brand: extracted.brand, model: extracted.model, partKeywords: extracted.partKeywords,
          generationCount: optionsForPrompt.length,
          skippedSonnetCall: true,
        }));

        const CLARIFY_PROMPT = `Ты — дружелюбный ИИ-консультант по автозапчастям BMW Club77, отвечаешь ТОЛЬКО по-русски, кратко и по делу.
Клиент ищет деталь "${(extracted.partKeywords || []).join(', ')}" для ${extracted.brand || ''} ${extracted.model || ''}, но для этой модели есть несколько поколений с разными деталями:
${optionsForPrompt.map(g => `- ${g.generation}${g.years ? ` (${g.years})` : ''}`).join('\n')}
Кратко объясни, что для точного подбора нужно уточнить поколение (код кузова) или год выпуска, и перечисли перечисленные варианты. НЕ упоминай товары, цены или артикулы -- их в этом ответе быть не должно.`;

        try {
          const clarifyRes = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
            method: 'POST',
            headers: {
              'Content-Type':      'application/json',
              'x-api-key':         ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model:       'claude-haiku-4-5-20251001',
              max_tokens:  300,
              temperature: 0.3,
              messages:    [{ role: 'user', content: CLARIFY_PROMPT }],
            }),
            signal: AbortSignal.timeout(15000),
          });

          if (clarifyRes.ok) {
            const clarifyData = await clarifyRes.json();
            const clarifyBlock = (clarifyData.content || []).find(b => b.type === 'text');
            const clarifyText = clarifyBlock?.text
              || `Для BMW ${extracted.model} есть несколько поколений с разными деталями. Уточните, пожалуйста, год выпуска или код кузова (${optionsForPrompt.map(g => g.generation).join(', ')}).`;

            const buttonLabels = optionsForPrompt.map(g => g.generation);
            const buttonsBlock = buttonLabels.length
              ? `\n<<<BUTTONS>>>\n${JSON.stringify(buttonLabels)}\n<<<END_BUTTONS>>>`
              : '';

            Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
            res.setHeader('Content-Type', 'application/json');
            return res.status(200).json({ reply: clarifyText + buttonsBlock });
          }
          // Haiku call itself failed -- fall through to the normal full
          // path below rather than leaving the customer with no response.
        } catch (err) {
          console.error('generation-ambiguity clarify call failed, falling back to full path:', err.message);
          // fall through
        }
      }
    }

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
      source: laximoUsed ? 'laximo' : 'compatibility-table',
      laximoNotInCatalogCount: laximoNotInCatalog.length,
      partKeywords: extracted.partKeywords || null,
      partFilterApplied,
      vehicleMatchedCount: matchedCatalogByVehicle.length,
      finalMatchedCount: matchedCatalog.length,
      compatibilityPromptChars: compatibility.length,
      catalogPromptChars: catalogForPrompt.length,
      totalOilProducts: oilProducts.length,
      matchedOilProductCount: matchedOilProducts.length,
    }));

    // Part number typed by the customer IN THIS MESSAGE -> the widget shows a
    // button to the site's search page for it (all offers incl. "под заказ",
    // prices, delivery times -- also for parts with no card in the feed).
    const partLinkCodes = partLinksForMessage(extracted, messages);
    const compatNote = compat ? `\n\n═══════════════════════════════════════════\nПРОВЕРКА СОВМЕСТИМОСТИ АРТИКУЛА (результат автоматической проверки по оригинальному каталогу — опирайся ТОЛЬКО на него):\n═══════════════════════════════════════════\n${JSON.stringify({ ...compat, matchedBy: laximoResult?.matchedBy || null, vehicle: laximoResult?.vehicle?.name || null })}\nПравила по полю "verdict":\n- "fits": номер ЕСТЬ в оригинальном каталоге для автомобиля клиента. Если matchedBy = "vin" — скажи, что совместимость подтверждена по VIN. Если "model" — что по каталогу номер подходит для этой модели, а для полной уверенности можно прислать VIN. Упомяни узел (unit) и условия из notes, если есть.\n- "other_numbers": номера клиента в каталоге его автомобиля НЕТ, но для этой детали каталог указывает другие номера (catalogNumbers). Скажи это прямо и вежливо, назови номера из каталога. Возможные причины: номер устарел/заменён, деталь для другой модификации. Если "aftermarket": true — номер клиента от другого производителя (аналог), а оригинальный номер для машины — из catalogNumbers; подходит ли аналог, уточнит менеджер. Предложи менеджера для окончательной проверки.\n- "part_not_found": по названию детали в каталоге автомобиля ничего не найдено — скажи, что автоматически проверить не удалось, предложи менеджера (<<<MANAGER_BUTTON>>>).\n- "vehicle_not_found": автомобиль по VIN не найден — попроси проверить VIN.\n- "unavailable" или "no_part_name": проверить автоматически сейчас не удалось — скажи это и предложи менеджера (<<<MANAGER_BUTTON>>>), НЕ утверждай, что деталь подходит или не подходит.
- "vin_unavailable_need_model": проверка по VIN в оригинальном каталоге СЕЙЧАС ВРЕМЕННО НЕДОСТУПНА. Скажи это коротко и попроси марку, модель с кодом кузова (например X5 F15), двигатель или год — по ним проверишь по базе совместимости. НЕ утверждай, подходит ли деталь.
- "table_fits": оригинальный каталог сейчас недоступен, но по НАШЕЙ БАЗЕ СОВМЕСТИМОСТИ номер указан для автомобиля клиента (tableVehicles). Если есть поле carFromVin — автомобиль уже определён по VIN, НЕ проси подтвердить модель, сразу дай результат. Скажи "по нашей базе совместимости подходит для …", назови запись(и) и добавь, что для 100% уверенности можно проверить по VIN позже или уточнить у менеджера.
- "table_other_vehicles": оригинальный каталог сейчас недоступен; в нашей базе совместимости этот номер указан ТОЛЬКО для других автомобилей (tableVehicles). Назови их и скажи, что для модели клиента подтверждения в базе нет — это не значит, что не подходит; предложи проверку менеджером (<<<MANAGER_BUTTON>>>) или по VIN позже.
- "table_no_data": оригинальный каталог сейчас недоступен, и в базе совместимости по номеру данных нет — скажи, что сейчас проверить не получается, предложи менеджера (<<<MANAGER_BUTTON>>>).\nНИКОГДА не утверждай совместимость сверх этого результата.` : '';
    // Original numbers found for the car but missing from the feed get the same
    // "Открыть деталь" button (the site's search page shows their offers,
    // prices and delivery times) -- up to 3, after a typed number.
    const missingLinkCodes = laximoUsed
      ? laximoNotInCatalog.map(x => String(x.oem || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean) : [];
    const allLinkCodes = [...new Set([...partLinkCodes, ...missingLinkCodes])].slice(0, 3);
    const missingWithButton = missingLinkCodes.filter(c => allLinkCodes.includes(c));
    const missingLinkNote = missingWithButton.length
      ? `\n\n═══════════════════════════════════════════\nКНОПКИ ДЛЯ НОМЕРОВ, КОТОРЫХ НЕТ В КАТАЛОГЕ ТОВАРОВ:\n═══════════════════════════════════════════\nДля номеров ${missingWithButton.join(', ')} под ответом автоматически появятся кнопки «Открыть деталь …» — они открывают страницу поиска этого номера на сайте, где видны все предложения, цены и сроки поставки. Поэтому НЕ пиши, что цену или наличие показать невозможно: скажи, что цену и срок по этим номерам можно посмотреть по кнопкам ниже, а менеджер поможет с заказом. Сами цены НЕ называй (их нет в данных), ссылки в тексте НЕ дублируй.${missingLinkCodes.length > missingWithButton.length ? ' Для остальных номеров кнопок нет — по ним предложи менеджера.' : ''}`
      : '';
    const partLinkNote = partLinkCodes.length
      ? `\n\n═══════════════════════════════════════════\nКНОПКА СТРАНИЦЫ ДЕТАЛИ:\n═══════════════════════════════════════════\nПод твоим ответом автоматически появится кнопка «Открыть деталь ${partLinkCodes.join(', ')}» — она открывает страницу поиска этого номера на сайте, где видны все предложения, цены и сроки поставки (в том числе позиции под заказ, которых нет в КАТАЛОГЕ ТОВАРОВ). Если товара с этим номером нет в КАТАЛОГЕ ТОВАРОВ, НЕ пиши, что по номеру "нет данных" или "нет в наличии": скажи, что цену и срок поставки можно посмотреть по кнопке ниже, а менеджер поможет оформить заказ${compat ? ' (совместимость — см. раздел ПРОВЕРКА СОВМЕСТИМОСТИ АРТИКУЛА)' : ' и проверит совместимость с автомобилем клиента'}. Саму кнопку и ссылку в тексте НЕ дублируй.`
      : '';

    const systemWithData = SYSTEM_PROMPT
      .replace('{{CATALOG}}', catalogForPrompt)
      .replace('{{VIN_ADVICE}}', (laximoDownReason && !laximoResult) ? VIN_ADVICE_OFF : VIN_ADVICE_ON)
      .replace('{{VIN_VEHICLE}}', vinVehicleForPrompt)
      .replace('{{COMPATIBILITY}}', compatibility)
      .replace('{{LAXIMO_NOT_IN_CATALOG}}', laximoNotInCatalog.length ? JSON.stringify(laximoNotInCatalog) : '[]')
      .replace('{{OIL_PRODUCTS}}', oilProductsForPrompt) + compatNote + partLinkNote + missingLinkNote;

    // Unit diagram for a catalog part that has no product photo (fetched in
    // parallel with the AI reply; shown as a card under it). One per reply.
    let diagramPromise = null;
    if (laximoUsed && process.env.LAXIMO_DIAGRAMS !== 'false') {
      const withPhoto = new Set(matchedCatalog.filter(p => p.picture).map(p => laximo.normalizeOem(p.article)));
      const first = compat && compat.verdict === 'fits'
        ? laximoResult.parts.filter(p => laximo.normalizeOem(p.oem) === laximo.normalizeOem(compat.code)) : [];
      const cand = [...first, ...laximoResult.parts].find(p => p.schema && !withPhoto.has(laximo.normalizeOem(p.oem)));
      if (cand) {
        let t;
        diagramPromise = Promise.race([
          laximo.getPartDiagram(cand),
          new Promise(r => { t = setTimeout(() => r(null), 9000); }),
        ]).catch(err => { console.error('[laximo] diagram failed:', err.message); return null; })
          .finally(() => clearTimeout(t));
      }
    }

    const claudeRes = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
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
    // (Not when the phone/email was given to verify an order -- see above.)
    if ((extracted.contactPhone || extracted.contactEmail) && !extracted.orderNumber) {
      text = `${text}\n<<<AUTO_MANAGER_HANDOFF>>>`;
    }
    const diagram = diagramPromise ? await diagramPromise : null;
    if (diagram) {
      console.log('DIAG diagram', JSON.stringify({ oem: diagram.oem, unit: diagram.unitName, position: diagram.position, box: !!diagram.box }));
      text = `${text}\n<<<DIAGRAM>>>\n${JSON.stringify(diagram)}\n<<<END_DIAGRAM>>>`;
    }
    if (allLinkCodes.length) {
      text = `${text}\n<<<PART_LINKS>>>\n${JSON.stringify(allLinkCodes)}\n<<<END_PART_LINKS>>>`;
    }

    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ reply: text });

  } catch (err) {
    console.error('Handler error:', err);
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(500).json({ error: err.message });
  }
}

// Exported as a plain function (unchanged from before, so
// `require('./api/chat.js')` and however server.js mounts it keeps working
// exactly as-is) with clearCaches attached as a property -- functions are
// objects in JS, so this is safe and doesn't change the default export's
// shape or behavior at all.
module.exports = handler;
module.exports.partLinksForMessage = partLinksForMessage;
module.exports.orderStatusReply = orderStatusReply;
module.exports.compatVerdict = compatVerdict;
module.exports.keywordsFromName = keywordsFromName;
module.exports.abcpPartName = abcpPartName;
module.exports.looksGarbled = looksGarbled;
module.exports.plausiblePhone = plausiblePhone;
module.exports.toRussianPartName = toRussianPartName;
module.exports.clearCaches = clearCaches;
