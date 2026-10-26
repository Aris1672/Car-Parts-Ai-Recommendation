# Car Parts AI Recommendation Chat Agent

Custom Claude-powered chat widget and analytics dashboard for car parts e-commerce (client: bmwclub77.ru, ABCP platform, id2319).
Powered by a **two-model architecture** via a Vercel serverless proxy: **Claude Sonnet 5** handles the actual customer-facing conversation, **Claude Haiku** does a cheap, fast structured-data extraction step that feeds it (see "Compatibility matching architecture" below for why this changed from a single-model, single-blob design).

Pattern copied from a working sibling project: `pixmosaic-proxy` + `mosaic-recom` (mosaic tile e-commerce, same two-repo architecture).

---

## 🔭 Future direction — multi-tenant platform

This app is currently single-client (BMW parts only, `bmwclub77.ru`). **Planned direction: evolve this into a shared multi-tenant recommendation platform** serving many different clients across different product verticals (car parts, mosaic tiles, furniture, etc.) from one codebase — not a separate deployment per client.

Core idea: everything client-specific (system prompt, matching strategy, catalog source) becomes **data in a `clients` table, loaded at request time**, not hardcoded in `chat.js`. A client's custom prompt, for example, would be stored in the DB and fetched automatically based on which client the incoming request belongs to — no redeploy needed to onboard a new client or change their instructions.

Full architecture reasoning (pluggable matching strategies, pluggable catalog connectors, request routing by client, how this relates to the multi-tenant-via-RLS infrastructure decision) is captured separately in **`Multi-Tenant-Platform-Architecture-Plan.md`** — read that alongside this README before starting that work. **Not started yet** — this app remains fully car-parts/BMW-specific until that work begins.

**Planned rename:** once the multi-tenant platform work begins, this project should be renamed **"Recommendation Agent"** (dropping the car-parts-specific name, since it'll no longer be tied to one vertical). Not renamed yet — still `car-parts-ai-recommendation` today.

---

## 🔌 WIDGET EMBED CODE (live) — restore this if the chat disappears from the site

The chat widget on **bmwclub77.ru** is loaded by these **two lines**. Both are required, in this order:

```html
<script>
  window.AGENT_URL = 'https://bmwclub77.assistant24info.ru';
</script>
<script src="https://bmwclub77.assistant24info.ru/widget/chat-widget.js" defer></script>
```

- **Where it lives:** ABCP admin → **Внешний вид и контент** → tab **"Инфоблоки"** → **"Блок в подвале"** (the footer block, which appears on every page). This is ABCP's own instruction for adding a counter/consultant code. On the live site the code sits at the end of the footer contact block, next to an old commented-out Vercel version (`<!-- … vercel.app … -->`), which can stay as is.
- **How to check it's still there:** open bmwclub77.ru. The round consultant icon should appear bottom-right within a few seconds. Or press **Ctrl+U** (page source), then **Ctrl+F**, and search for `chat-widget.js`: it must appear with `bmwclub77.assistant24info.ru`.
- **If it's gone:** paste the two lines back into "Блок в подвале", save, then reload the site. Nothing needs changing on our server.
- **Common mistakes:** keeping only the second line (without `AGENT_URL` the widget falls back to the same server, but keep both); using an old `vercel.app` or `api2.o2plus.ru` address; pasting into a block that's only on the home page; editors that turn `'` into curly quotes or strip `<script>` tags. Paste in the HTML/source mode of the editor.
- Optional: any element on the site can open the chat with `onclick="window.AutoChat && window.AutoChat.open()"`.
- **Homepage block (inline agent, session 24):** ABCP → Внешний вид и контент → Инфоблоки → **`page_main`** ("Главная") → **Редактировать HTML** has, as its third line, the placeholder `<div id="bmw-ai-agent"></div>` (right after `<div class="mainSectionIn">`, before `<div class="mainBanners">`). On a page with this element the widget builds the chat into it instead of the bubble. If the line disappears, the homepage simply gets the bubble again. Put it in **one** infoblock only.

---

## 📍 PROJECT STATUS — read this first if resuming work

**Last updated:** 2026-10-26 night (session 27d: card photos from product pages, button under every diagram; session 27c: ТО service unit opened directly from the car page — E70 kit; session 27b: brake discs found again, fallback name «тормозной диск»; session 27: brand block in page_main + Exo 2 headings; session 26: price list as a Postgres table, 309 607 products, looked up by number — needs `SUPABASE_DB_URL` on the catalog proxy; session 25: new light hero on the homepage on desktop — owner's design, full width, above the icon row, 500 px; phones keep the previous dark design; session 24d: "снят с производства" only when the catalog says so; session 24c: ТО answers show service parts only; session 24: the agent built into the homepage — photo block, M-red "Подобрать", "AI" avatar, confirmed live; session 24b: ТО answers cut off inside `<<<PRODUCTS>>>`, fixed; session 23g: diagram for every "Открыть деталь" number; session 23f: "standard ТО" rule + search words; session 23e: full ТО kit from the catalog service unit; session 23d: agent sees the diagram notes, e.g. discontinued; session 23: live prices, cheapest offer with profile "Гость (Опт)"; session 22: "Открыть деталь" for catalog numbers; session 21: diagram card, confirmed live). **Everything below is live on `main` and confirmed working by the project owner:**
- Laximo VIN search and car-model search (session 14). ABCP exempted our server, 168.222.202.222, from its browser check.
- New dashboard tab **"Подбор"**: first message, shown cards, opened cards. Click tracking confirmed live after the beacon fix.
- Greeting bubbles shown **once per visitor** (7-day repeat).
- **Homepage block** (sessions 24 + 25): the agent as the homepage hero, placeholder `#bmw-ai-agent` in infoblock `page_main`. Current look: session 25 (light, full width); session 24 describes the mechanics and the earlier dark version.
- **Current phase: observation.** Watch the Laximo quota (1 000 OEM requests/month), the logs (`[chat] reply hit max_tokens`, `[chat] reply cut off inside …`) and the new tab. Open items: see "📝 Open items (25.10)" below.

Read sessions 24 and 24b first for the homepage block, then session 15, then session 14's "Status", then session 13 for the compatibility catalog push process.

### 🖼 Session 27d (Oct 26, night) — card photos from product pages + button under every diagram

- **Live 26.10:** with the service unit now found (E70 ТО kit complete: fuel filter, wipers 61610077821 / 61627161029, ATF, CHF), several cards had **no photo**: the new suppliers' items come without a picture in the price-list export, while the site's product page shows one (from ABCP's reference catalogue, "Из справочника ABCP").
- **Card photos (`widget/chat-widget.js`, `fillMissingImages()`):** for a card without a photo whose link is on the same site, the widget loads that product page **in the visitor's browser** (same origin — no CORS, no load on our server, no bot-check risk) and takes `meta[property="og:image"]`, else the first `img` from `pubimg.nodacdn.net/images/` (ABCP's image server, where the feed photos come from too). Max 4 per carousel, one after another, remembered per page; the found photo is saved into the chat history. Nothing found → placeholder as before. Other sites are never fetched.
- **Button under every diagram (owner):** `api/chat.js` attaches `productUrl` to a diagram when the marked part is in the price list (`matchedCatalog`, the ТО kit, else one `lookupCatalog()`); the widget shows "Открыть деталь N — страница товара на сайте" directly under the card, or the site search ("цены и сроки на сайте") without a product page. A diagram that already has its own "Открыть деталь" button keeps just that one. History type `diaglink`.
- **Tested** (jsdom): wiper photo taken from its product page, existing photo untouched, placeholder when the page has no image, other sites and photo cards never fetched, filled photo saved for reloads; diagram button directly under the card opens the product page. **Unverified:** the real product page markup (assumed: og:image or a nodacdn image) — if photos still don't appear, send the product page's image address (right-click → copy image address).

### 🧰 Session 27c (Oct 26, night) — ТО kit for every BMW: service unit opened directly

- **Live 26.10** (VIN X4XZW61140L560928, X5 40dX E70, "ТО для моей машины"): only filters as cards; wipers, brake fluid, coolant, washer fluid, CHF "подберёт и закажет менеджер — эти позиции заказываются индивидуально". The owner's screenshot shows the E70 DOES have the unit "ТО по регл.Oelservice / Inspektion" (13 positions).
- **Cause:** the bot reached the service unit only by a detour — the "Схема" button of a found part (oil filter element first). On the G05 that button opens the service unit; on the E70 it opens the oil filter's own unit → no kit; and the plain name search (capped at 4 of the 9 ТО keywords) never searched wipers/fluids.
- **Fix (`lib/laximo.js` `getServiceUnit(query)`):** opens the car's catalogue page (`lp=vehicle`, from the search's vehicle query — now returned as `vehicleQuery` by `findPartsByVin` / `findPartsByModel`), finds the unit by NAME (`/oelservice|inspektion|ТО по регл/`) among the page's units, else in at most 2 categories whose name suggests service (`/сервис|обслуж|ТО|регламент|…/`), opens it and reads the whole kit table (marker on the oil filter element). ~2 requests the first time, cached per car (30 days; "not found" retried after 6 h). Logs: `[laximo] service unit opened directly (car page|category "…"): "…", N rows` / `[laximo] service unit not found on the car page (… categories: …)`.
- **Live check 26.10 (00:42):** not found — the car page has 25 units and ~40 categories (log), and the first version checked only the first 2 Russian-named ones ("К-ты для регламентных работ", "Детали и пакеты: ремонт и обслуживание"). **Now** categories are checked by priority, up to 4: name with Oelservice/Inspektion/ТО по регл. → **"service/сервис"** (the E70 has "Parts Repair Service") → **"инспекц"** ("Инспекционные комплекты") → регламент/обслуж/ТО. Cache key `service2:`. The "not found" log lists the categories checked. **Confirmed by the owner's screenshot (03:53):** in the car's left menu, "ТО по регл.Oelservice / Inspektion" is a **sub-category** of **"Объем работ по обслуживанию и ремонту"** (next to "Сервисное обслуживание тормозов"), around #45 of the menu. Its own name matches the top priority, so it's opened first. On that sub-category page the bot takes the unit with the service name, or the only unit there, or reads the parts table if the page shows it directly. The "not found" log now lists all categories (not just 40).
- **Oil filter housing:** BMW names the housing module just "Масляный фильтр" (E70: 11427800066, offered at 24 300 ₽ as "альтернативный вариант" live 26.10). For ТО requests the bare name "Масляный фильтр" now counts as non-service (`HOUSING_BARE_NAME_RE`); the element "К-т сменного элемента масляного фильтра" stays.
- **`api/chat.js`:** for ТО requests the direct route runs first (14 s cap, total 22 s; if cut, it keeps running and caches the kit for the next request); if it finds nothing, the old "Схема" route runs as before, so the G05 path is unchanged as a fallback.
- **Also:** the fallback diagram skips non-service parts (it showed "Крышка микрофильтра"); the prompt forbids invented reasons for positions without cards ("заказываются индивидуально").
- **Tested** with simulated pages in the structure `parseVehiclePage()` / `parseUnitDiagram()` already parse: unit on the car page (2 requests, 10 kit rows incl. wipers/fluids, marker on the oil filter element); cached second time; unit inside a "Сервисное обслуживание" category (3 requests, other categories untouched); not found → null after 1 request (old route takes over). **Not yet checked against the live site** — the page structure is assumed from the existing parsers. Check: `ТО для моей машины` + the E70 VIN; the log must show `service unit opened directly`.

### 🛞 Session 27b (Oct 26) — brake discs found again

- **Live 26.10** (VIN X4XZW61140L560928, X5 40dX E70, "Тормозные колодки и диски"): pads found, but "по тормозным дискам сейчас нет данных — передать специалисту". Log: `oemCount: 3` — only the pads.
- **Cause:** the site's Laximo part search matches names **literally**, and BMW names the part in the singular: **«Тормозной диск (вентилируемый)»**. The extracted keyword "тормозные диски" (plural) matched nothing, and brake discs had no entry in `FALLBACK_QUERIES` (`lib/laximo.js`).
- **Fix:** new fallback for /торм… диск/: tries **"тормозной диск"**, and only if that finds nothing, **"диск"**, keeping only rows whose name has "диск" and whose name or unit has "торм" (no clutch discs / wheel rims). A fallback entry's `query` may now be a list, tried in order until one finds something. `MAX_FALLBACK_QUERIES` 2 → 3 (per answer, all fallbacks together). Runs only when the customer's own words found nothing. Log: `[laximo] "тормозные диски" found nothing; catalog name "тормозной диск" -> N part(s)`.
- **Tested** with simulated catalog pages: "Тормозной диск …" catalog → discs found with 1 extra request, pads still there; "Диск тормозной …" → second name used, clutch disc and wheel rim dropped; pads-only request → no extra searches. Other suites unchanged.

### 🏷 Session 27 (Oct 26) — brand block "Подбирайте по каталогам*:" + Exo 2 headings

- **Brand block (owner's design):** in ABCP infoblock **`page_main`** the old title carousel and grey logo strip are replaced by a header row (title **«Подбирайте по каталогам*:»** + **«Все марки →»** linking to `https://bmwclub77.ru/laximo` — check that it opens the catalogue list) and six cards **BMW, Audi, Mercedes-Benz, Porsche, Volkswagen, Land Rover** (same Laximo catalogue links and the site's own logo images `cdn.abcp.ru/f/5438xx`). Cards 170 px tall, logos 110 px (the logo files have wide empty margins); phones 150 / 90 px; 6 per row, 3 on tablets, 2 on phones. All cards equal; the highlight (light-blue background, blue border, arrow) only on hover / keyboard focus. Classes `bcMarks*`, CSS added at the end of the infoblock's `<style>`.
- **The full current `page_main` HTML is kept in the repo: `abcp-infoblocks/page_main.html`** (incl. the `bmw-ai-agent` placeholder). To change the block: edit this file, then paste ALL of it in ABCP → Инфоблоки → `page_main` → Редактировать HTML.
- **Headings font Exo 2** (owner, 26.10): self-hosted in `fonts/` (weights 700 + 800, Cyrillic + Latin woff2, 8–17 KB each; SIL OFL licence in `fonts/Exo2-OFL-LICENSE.txt`), family name **`'BC Exo 2'`**. Used for the hero title (desktop), the phone title (dark design) and the brand block title. The desktop hero title and the brand block title are also UPPERCASE (letter-spacing 0.5 px), like the phone title. The brand block title is **18 px** and reads **«Подбирайте по каталогам:»** without the asterisk (both changed by the owner directly in ABCP 26.10; the repo copy matches). `server.js` serves `/fonts/*` with `Access-Control-Allow-Origin: *` (cross-origin fonts) and a 1-year cache. The `page_main` CSS declares the same family with absolute URLs to `bmwclub77.assistant24info.ru/fonts/…`, so it doesn't depend on the widget.

### 🗄 Session 26 (Oct 26) — price list as a table: 309 607 products

- **Live 26.10:** the owner added the client's new suppliers; the price list ("Aris Test" export) grew from ~20 000 to **309 607** products. The refresh said "stored 309607 products", but ТО answers then lost their spark plug / fluid cards ("подберёт и закажет менеджер").
- **Cause:** the whole list was stored as ONE JSON value (`catalog_cache.data`, hundreds of MB) and the bot downloaded the WHOLE list every 30 min through the catalog proxy (`fetchCatalog` / `fetchCatalogIndex`, 25 s limit). At 309 607 products the proxy couldn't read the value in time (8 s), fell back to parsing the live XML, and the bot gave up -> stale or empty list.
- **Fix — one row per product, look up only what's needed:**
  - **Catalog proxy** (`abcp-catalog-proxy`, new `lib/catalogTable.js`): the refresh loads the parsed list into Postgres table **`catalog_products`** (`code` = number normalized like `laximo.normalizeOem()`: uppercase, no spaces/dots/dashes; `vendor_code`, `name`, `brand`, `category`, `price`, `available`, `url`, `picture`, `offer_id`; index on `code`). Every offer is stored (several suppliers per number). Loaded into `catalog_products_new` in batches of 1 000, indexed, then swapped in one transaction (the bot never sees a half-loaded table); an advisory lock stops two refreshes at once. The old single JSON value is still written, but best-effort once the table is loaded. `/api/refresh-catalog` now answers with `table: {rows, codes, ms}` or `table: {skipped: reason}`.
  - **Bot** (`api/chat.js`): **`lookupCatalog(codes, brand)`** asks the table for only the numbers of the current answer (`code = any($1)`), one offer per number — the car's brand first, then in stock, with a photo, cheapest — cached 10 min per number. Used in the 3 places that needed the list: model/table path, Laximo path, ТО kit. The whole-list download at the start of each request and the warm-up are gone; `fetchCatalog()` and `fetchCompatibilityVendorCodes()` (the startup read of all compatibility numbers, only used to pre-filter the downloaded list) were removed for cleanliness. The bot now does no periodic or startup downloads; only `fetchCatalogIndex()` remains, as the fallback. **Fallback:** table missing (`42P01`) or no `SUPABASE_DB_URL` -> the old whole-list path (for 10 min, then retried).
- **⚠️ Setup needed (once):** in Coolify, the **catalog proxy app** needs the env var **`SUPABASE_DB_URL`** — the same value the bot app already has. Then redeploy the proxy and run the refresh once; its answer must show `"table":{"rows":309607,…}`.
- **Tested** against real Postgres (PGlite) with a synthetic 309 607-product list incl. several suppliers per ТО number: load ~6 s; 9 numbers looked up in ~12 ms; offer choice; numbers with spaces/dashes; cache; second refresh swaps atomically with lookups still working, no duplicates or leftover staging table; table missing -> fallback without crash; proxy without `SUPABASE_DB_URL` -> skipped with a clear reason. Earlier suites (service filter, kit facts, cut-off repair, widget) unchanged.
- **Note:** the export only says available yes/no, so in-stock items show as "в наличии (1 шт.)" (as before).

### ☀️ Session 25 (Oct 26) — new light hero on the homepage (owner's design)

- **Owner's design**, mockup approved 26.10 (canvas "ИИ-консультант на главной BmwClub77", row 2: "Новый hero"). Replaces the dark compact block of session 24; the chat state after the first message is unchanged.
- **Look** (`widget/chat-widget.js`, compact state):
  - photo **`agent-hero-mountains.jpg`** (owner's, 1872 × 576, re-saved at quality 85: 161 KB): mountains on the left, dark BMW on the right; white fade 0.94 → 0.88 at 40 % → 0 at 66 % behind the text; `cover`, `right 70%`;
  - label **«✦ ИИ-КОНСУЛЬТАНТ»**, title **«Найдём нужные запчасти / для вашего BMW»** (Montserrat 800, 42 px / 25 px on phones, "BMW" in the accent blue `#0a5cc4`), description «Опишите, что вам нужно, и ИИ подберёт подходящие детали по VIN, модели или номеру запчасти.» — texts in `INLINE_EYEBROW`, `INLINE_TITLE_1/2`, `INLINE_TITLE_ACCENT`, `INLINE_TEXT`;
  - one white input box (search icon) with the blue **«Подобрать с ИИ»** button (`INLINE_SEND_LABEL`). **Its width = the quick-button row**: `matchInputToChips()` measures where the last button («Где мой заказ?») ends and sets the input to end there too (owner 26.10, ~674 px on the owner's screen); re-measured on resize and when fonts finish loading; desktop hero only. CSS fallback if it can't measure: 820 px, at most 60 % of the window;
  - chips: the **same four as on phones** — ТО для моей машины / Подбор по VIN / Подойдёт ли номер? / Где мой заказ? — each sent as typed (`INLINE_CHIPS`, one list for both designs; owner 26.10: the phone set has the right commands). A desktop-only set (По VIN / По модели / По номеру детали / Не знаю номер, sending full sentences) was live briefly on 26.10 and replaced;
  - manager link + «Powered by AI · ASSISTANT24» in small lines under the chips;
  - (a handwritten note «Правильные детали для вашего BMW» with an arrow towards the car was in the design and live briefly on 26.10; removed the same day at the owner's request: on monitors wider than ~1900 px it landed on the windshield. Its self-hosted Caveat font and the `/fonts` CORS rule were removed with it.)
- **Position:** the hero now goes **above the icon row** (`.benefits-block`) on every screen size (before: only on phones). No ABCP change; the placeholder stays in `page_main`.
- **Full window width on desktop** (≥ 768 px, class `pc-bleed`): `updateBleed()` measures the placeholder's column and sets `--pc-col-left` (column start from the window edge) and `--pc-page-w` (`documentElement.clientWidth`, so no horizontal scrollbar); the panel gets that width and a negative left margin, and the content is indented by `--pc-col-left` to stay aligned with the site's column. Re-measured on resize. If an ABCP container ever clips it (`overflow: hidden`), the hero would be cut at the column edges — check after layout changes.
- **Directly under the header (desktop, owner 26.10):** there was a ~30 px grey strip between the header's search tab and the hero. `pullUnderHeader()` measures the gap (`header` bottom → hero top), pulls the hero up by exactly that (negative `margin-top`), and keeps the header above it (`position: relative` / `z-index: 5` only if the header has none), so the "Поиск по номеру детали" tab overlaps the top of the photo as in the design. Skipped if the gap looks unexpected (≤ 0 or > 150 px); re-measured on resize; only the compact hero (the chat keeps its spacing) and not on phones. With the hero starting right under the header, its top padding on desktop is 64 px (bottom 40 px), so "ИИ-КОНСУЛЬТАНТ" isn't squeezed against the header/search tab. Desktop hero height: **500 px** (min-height; owner 26.10, was 440). (Live 26.10 this showed no effect: an old `padding-top: 0 !important` in the base inline rule, meant to cancel the phone panel's safe-area padding, overrode every hero top padding; the `!important` is removed.)
- **Phones and small tablets (≤ 767 px) keep the PREVIOUS dark design** (owner, 26.10 — the light hero was for desktop): blue M5 in smoke (`agent-hero-bg.jpg`, CSS var `--pc-hero-bg-dark`), square "AI" avatar, uppercase «ПОДБЕРЁМ ЗАПЧАСТИ ВМЕСТЕ С ИИ-КОНСУЛЬТАНТОМ», red send button, the same chips as desktop (`INLINE_CHIPS`), placeholder «ТО для X5 G05 или VIN…». The styles are the session-24 ones taken unchanged from commit `6a7700d`, wrapped in `@media (max-width: 767px)` under their own names (`#pc-hero-m`, `.pc-hm-title`, `.pc-hm-text`, `#pc-chips-m`; texts `INLINE_M_*`); the light hero is wrapped in `@media (min-width: 768px)`. `setCompact()` picks the placeholder/button label by screen size, and switches when the window crosses 767/768 px. (A light phone variant with a photo band was live briefly on 26.10 and replaced.)
- **Kept for switching back:** `agent-hero-bg.jpg` (dark M5 in smoke, session 24) and `agent-hero-bg-light.jpg` (white car); the square "AI" avatar stays in the chat header and beside bot messages.
- **Tested:** the jsdom checks (14, incl. the pull-up under the header with the measured 67 px gap and the input width = button row, 733 − 59 = 674 px) updated to the new texts, chips (full sentences), position above the icon row, full width on desktop / card on phones; fonts and photo served with the right headers (local server). Look to be checked live.

### 🏷 Session 24d (Oct 25) — "снят с производства" only when the catalog says so

- **Live test 25.10** (X5 G05 40i, ТО): the bot said brake fluid, coolant and washer fluid were "сняты с производства". The catalog marked only the oil filter element (11428583898) as discontinued; the fluids were just not in the price list.
- **Cause:** both ТО prompt rules used ONE sentence for two cases ("если номера сняты с производства **или** позиций нет в карточках — «…(часть номеров снята с производства) подберёт менеджер»").
- **Fix (`api/chat.js`):**
  - **`serviceKitFacts(kit)`** sorts the kit per POSITION: `inCards` (any variant in the feed), `discontinued` (every variant marked discontinued), `orderViaManager` (everything else: not in the price list, orderable). Sent to the AI as **"ИТОГ ПО ПОЗИЦИЯМ ТО"**; removed from the diagram data before it goes to the browser. Log: `DIAG service-kit … positions {inCards, orderViaManager, discontinued}`.
  - Prompt rules split: missing positions → "подберёт и закажет менеджер" (never "снят с производства", never "нет в каталоге" — session 23c); "снят с производства" ONLY for `discontinued` / a catalog note "Не производится с …", with "менеджер подберёт актуальную замену". Applies also without the catalog kit (general "СТАНДАРТНОЕ ТО" rule).
- **Tested** with a kit shaped like the live one: the three fluids → `orderViaManager`, only the oil filter element → `discontinued`; a position with a discontinued old number but a current variant in the feed counts as `inCards`.

### 🧽 Session 24c (Oct 25) — ТО answers: service parts only

- **Live test 25.10** ("Набор на стандартный ТО. BMW X5 4.0i G05", homepage block): the first card was **"Корпус масляного фильтра B58" (11428488578, 38 500 ₽)**, and the cabin filter cover **"Крышка микрофильтра" (64119460554)** got its own diagram and "Открыть деталь" button. Neither is a service part.
- **Cause:** the name search for "масляный фильтр", "салонный фильтр"… also returns the parts around them (the oil filter module, sold as the housing; the filter cover). The housing is in the price list, so the AI got it as an available product; the cover isn't, so it got a button + diagram.
- **Fix (`api/chat.js`):** for a ТО request (`isServiceRequest()`), parts whose name matches `NON_SERVICE_PART_RE` (корпус, крышка, модуль, уплотнение, прокладка, датчик, кронштейн, держатель, теплообменник, патрубок, шланг, трубка, болт, винт, гайка, насос, клапан) are left out of the catalog data the AI gets and of the "not in feed" numbers (so no button/diagram), and **`dropNonServiceCards()`** removes any that still appear in the final cards. Positions of the catalog's service kit always stay. Skipped when the customer's last message asks for such a part (`asksForNonServicePart()`, e.g. "ещё нужен корпус фильтра").
- **Logs:** `[service] ТО request: N non-service part(s) left out: …`, `[service] dropped non-service card(s): …`.
- **Tested** on the 13 cards of that live answer: only the housing is dropped, 12 service cards stay (filters, plugs, wipers, ATF, CHF, fluids); the cover is filtered; kit positions are never dropped.

### ✂️ Session 24b (Oct 25) — ТО answer cut off, raw `<<<PRODUCTS>>>` shown

- **Live test 25.10** (first test of the homepage block): "ТО для моей машины" → X5 → E70 → 3.0d. The answer stopped inside the product JSON ("…\"category\": \"Антиф") and the customer saw the raw block instead of cards.
- **Cause:** Sonnet 5 **thinks by default** (adaptive thinking, effort high), and the thinking **counts toward `max_tokens`** (Anthropic docs, "Thinking"). With `max_tokens: 4096`, thinking plus an 8–12-card ТО answer didn't fit. The API said `stop_reason: "max_tokens"`, which wasn't checked.
- **Fix (`api/chat.js`):**
  - `max_tokens` **16000**; only the tokens actually used are billed;
  - `stop_reason: "max_tokens"` is logged: `[chat] reply hit max_tokens (output N tokens)`;
  - **`repairTruncatedBlocks()`**: an unfinished `<<<PRODUCTS>>>` keeps its complete cards and gets closed; an unfinished BUTTONS / DIAGRAM / PART_LINKS block is dropped. Log `[chat] reply cut off inside …`. Tested on the real cut-off answer: 7 complete cards kept, the broken 8th dropped.
- **Widget:** `parseBotResponse()` cuts any unfinished `<<<…>>>` block, so raw code never reaches a customer even from an older server.
- **Open decision (owner):** thinking could be turned off (`thinking: {type: "disabled"}`) to make replies faster and cheaper; not done, since it may change answer quality. Also noted in the same test: the generation list from the compatibility table showed wrong years (E70 "2007–2008", E53 "2003–2006"), and the reply started with "Привет! 👋" mid-conversation.

### 🏠 Session 24 (Oct 25) — the agent built into the homepage (inline mode) ✅ confirmed live 25.10

**What:** on the homepage the chat is no longer only the bottom-right bubble: it sits at the top of the page, above "Подбирайте по каталогам*:", as a block with a photo, a title, a large input and quick buttons. On the first message the block turns into the full chat. Requested by the client; mockup approved 25.10; the final look confirmed live by the owner 25.10 (screenshots).

**How it's switched on (ABCP):** infoblock **`page_main`** → Редактировать HTML → third line `<div id="bmw-ai-agent"></div>` (see the embed section above). No other ABCP change. Removing that line brings the bubble back on the homepage, without a redeploy.

**How it works (`widget/chat-widget.js`):** if the page has `#bmw-ai-agent`, the same chat panel is moved into it (class `pc-inline`). Cards, diagrams, "Открыть деталь", manager handoff, history and analytics are the same code as the bubble.
- **Compact state** (`pc-compact`, before the first message):
  - title **«ПОДБЕРЁМ ЗАПЧАСТИ ВМЕСТЕ С ИИ-КОНСУЛЬТАНТОМ»** (text in `INLINE_TITLE` is normal case; `text-transform: uppercase`), weight 800, 22 px / 16 px on phones, letter-spacing 0.3 px;
  - description "ИИ-консультант ответит сразу: …" (`INLINE_TEXT`), wraps at 600 px;
  - input with the **"Подобрать"** button in **BMW M red `#E7222E`** (hover `#C41B25`; white text 4.5:1 / 6:1). The chat's send button stays blue;
  - 4 quick buttons (`INLINE_CHIPS`): ТО для моей машины / Подбор по VIN / Подойдёт ли номер? / Где мой заказ? — each sends its text as the first message;
  - note "Ответы готовит ИИ. Если нужен человек — позвать менеджера." (opens the chat with the manager button) and **"Powered by AI · ASSISTANT24"** (link to https://assistant24info.ru/, new tab).
  - No bubble, teasers or badge on the homepage.
- **Chat state** (after the first message): header with "Начать заново" (back to the compact block, history cleared) and "Во весь экран" (fixed full screen; Esc or "Свернуть" returns), messages, input, "Powered by" line. Plain light background.
  - **Message area height:** `clamp(320px, calc(100vh - 240px), 640px)` — the window height minus 240 px, at least 320 px, **at most 640 px**; it takes this height as soon as the chat opens (no growing/jumping), then scrolls inside. With the header (60 px), input (~80 px) and "Powered by" line, the whole chat block is at most ~800 px. Full screen removes the limit.
- **Same conversation everywhere:** a chat started on the homepage continues in the bubble on other pages (same `localStorage` state; `greeted` is set so the bubble doesn't greet mid-chat), and a running chat is shown as the chat when the homepage is opened again. `AutoChat.open()` on the homepage scrolls to the block and puts the cursor in it.
- **Phones:** ≤ 767 px the block moves above the icon row (`.benefits-block`) so it's on the first screen, and back on wider screens. ≤ 540 px: compact paddings, quick buttons 2 × 2, icon-only "Подобрать".

**Background photo** (compact state only):
- `agent-hero-bg.jpg` (repo root, served at `/agent-hero-bg.jpg`): the owner's original **1920 × 1200** (blue M5 in blue smoke), re-saved at JPEG quality 85 (253 KB instead of 826 KB). To change the photo, replace this file under the same name.
- Shown at its **natural size, never enlarged** (an enlarged 1025 px crop looked soft): `background-size: max(1920px, calc(100% + 680px)) auto; background-position: right -680px bottom -458px` puts the car at the right with the headlights beside the quick buttons; it grows only on blocks wider than 1240 px, to leave no gap on the left.
- **Overlay only behind the text** (owner: the headlights looked dim under a full overlay): dark navy fade 0.78 → 0.66 at 45 % → 0 from 62 %, so the car is at full brightness; soft text shadow on all white text. Contrast: title 5.3:1, description 4.6:1 (with no overlay at all it's ~2:1 over the smoke).
- Phones (≤ 540 px): 960 × 600 (sharp on 2× screens), centered, `bottom -200px`, vertical fade 0.55 → 0 at 62 % (text 12.5:1; the note over the car relies on the text shadow).
- Earlier light photo (white car on a wet road, 854 px) kept as `agent-hero-bg-light.jpg`. To switch back: swap the file names, overlay 0.82 / 0.62 / 0.45 across, photo `cover` / `center 48%` (6.5:1).

**Agent avatar:** `agent-avatar.jpg` (repo root, 192 × 192, ~4 KB): the owner's "AI" logo with a single red slash on black, cropped centered. A **rounded square**: next to the title a **fixed 75 px** (= title + 2 description lines, top-aligned; 44 px on phones), 8 px corners in the chat header, 6 px beside each bot message, white ring on the photo. If it fails to load, the headset icon is shown. The bubble on other pages keeps `AI_Agent.png`.
- History: the first version had BMW M-style three-colour stripes (BMW trade dress) and was replaced the same day; a first sizing attempt (`align-self: stretch` + `aspect-ratio`) let the 192 px image set the size (~175 px live), hence the fixed 75 px.

**Analytics:** `first_message` events carry `placement: "inline" | "bubble"` (`lib/chatEvents.js` keeps only those two values) to compare the two placements. Stored, not yet shown in the "Подбор" tab.

**Tested:** jsdom with a copy of the homepage structure and a mocked API, 12 checks (build into the placeholder, quick button → chat + cards + placement event, restore, continuation in the bubble, full screen + Esc, restart, manager link, phone move and back, `AutoChat.open()`, bubble unchanged without the placeholder, unfinished `<<<…>>>` block never shown, server validation). Look and layout checked live by the owner. The test script is not in the repo (it needs `jsdom`).

#### Session 28 (26.10) — «Популярные категории»
- New homepage section (ABCP page_main, `abcp-infoblocks/page_main.html`): 8 cards `<a data-ai-category="brakes|suspension|engine|filters|electrics|body|fluids|other">`, 4×2 on desktop, 2 columns on tablets/phones. «Все категории» → /laximo (same as «Все марки»).
- Widget (`CATEGORIES` in chat-widget.js): a click scrolls to the inline chat and shows an instant follow-up question with sub-choice buttons (no AI call) + VIN/model request (skipped if a VIN is already in the chat). The canned exchange is added to the AI history, so a VIN or free text typed next keeps the category context. «Другое — опишу сам» only focuses the input. Without the inline chat (or Ctrl/⌘-click) the card is a normal link.
- Card images: `widget/categories/<key>.png`, owner's Gemini images (26.10): background whitened, trimmed, 320×240 (2× the card size). In page_main they are loaded with `?v=N` (raise N when files change — /widget is cached 1 h) and `mix-blend-mode:multiply`, so the white background takes the card colour on hover.

- «Почему BMW Club77?» block (owner's design, 26.10) replaces the old icon row `.mainAdvantages` in page_main: photo `widget/sections/why-bmw.jpg` (crop of the hero X5 photo, fades into the card), title + text, 4 points in a 2×2 grid (10+ лет на рынке / 100% оригинальные запчасти BMW / Гарантия от производителя* — added back by the owner / Профессиональная консультация). «Помощь в подборе*» dropped.

- «Новости»: ABCP's own news slider (`.wNews`, slick; part of the template, not editable as an infoblock) restyled by CSS in page_main to match: same column width (max 1450 px), Exo 2 uppercase title, «Все новости →», white cards with 170 px photo (placeholder icon when a news item has no photo, via `:has`), date / title / 2-line text / «Читать →», equal heights (`.slick-track` flex).

- Shop text + address (`.bcAbout`, end of page_main): aligned to the column, regular site font, address with a pin icon; grammar fixed («запчастей», «аналогов»). News slides: ABCP's own slide margin removed (gaps were 35 px).

- Footer: blue / navy restyle tried (26.10) and reverted by the owner — the original white ABCP footer stays. The styles are in git history (`abcp-infoblocks/footer-style.html`, commit c6ae4b2) if wanted later.

- Phones (≤ 767 px), owner's design 26.10 (canvas board 9): edge-to-edge hero on the owner's X5 photo `agent-hero-phone.jpg` (portrait), white text («Найдём нужные запчасти для вашего BMW», normal case), white search card with a full-width blue «Подобрать с ИИ», the same 4 quick buttons as desktop (2×2). The ABCP icon row overlaps the bottom as a white 2-column panel (CSS in page_main). Replaces the dark M5 / red-button phone design (`agent-hero-bg.jpg` no longer used).

- Phones: the hero closes a small gap (≤ 60 px) above it by scanning up from its top edge to the search field / header (`closeGapPhone`). `/widget/*.js` is now served with `Cache-Control: no-cache` (was 1 h), so widget fixes reach visitors on the next page load.

## 📝 Open items (25.10)

- **Compatibility table years:** the generation question showed wrong years (e.g. X5 E70 "2007–2008", built 2006–2013; E53 "2003–2006"). Comes from the table data (`detectGenerationAmbiguity()`).
- **"Привет! 👋" mid-conversation** in the generation question (Haiku short-cut in `api/chat.js`, `CLARIFY_PROMPT`).
- **Thinking on Sonnet 5:** on by default; turning it off (`thinking: {type: "disabled"}`) would make replies faster and cheaper but may change quality — owner's decision. Anthropic now lists Sonnet 5 as a legacy model (Sonnet 5.5 is current).
- **Dashboard:** show `placement` (homepage block vs bubble) in the "Подбор" tab.
- **Security (found 25.10, not fixed yet — details were given to the owner in the chat, deliberately not written here because this README may itself be publicly downloadable):**
  - `server.js` serves the whole repo root as static files (`express.static(__dirname)`), so source files and this README are probably downloadable from the live domain. Serve only the needed images instead. Fix this first.
  - Two secrets are committed in plain text (one in this repo, one in `abcp-catalog-proxy`): rotate both, keep them only in Coolify, delete them from the files.
  - `abcp-catalog-proxy`: `.github/workflows/refresh-catalog.yml` still calls the old Vercel URL every 6 hours although `server.js` refreshes in-process.
  - `api/chat.js` falls back to `https://abcp-catalog-proxy.vercel.app/api/catalog` if `CATALOG_API_URL` is missing.

### 🖼️ Session 18 (Oct 23) — "Нет фото": check against ABCP's catalog

- **Button "🔍 Проверить в ABCP"** in the "Нет фото" tab starts a **background check** (`lib/abcpCatalogCheck.js`) of every unresolved missing article, most-requested first. It uses `cp/articles/info/batch`: POST, **read-only**, 100 articles per call, 1.5 s pause between calls, so about 53 calls / 1–2 min for 5 200 articles. The dashboard shows progress ("⏳ … 1200 из 5201") and reloads when done.
- **Results stored** in Postgres table **`abcp_article_info`** (auto-created: vendor_code, brand, found, images_count, image, descr, checked_at), so opening the tab costs no ABCP calls. Later runs only check **new articles**, plus "no photo"/"not found" ones older than **7 days**.
- **Tab:** new **ABCP** column: a thumbnail (click → full photo from `https://imgcdn.abcp.ru/p/…`), "найден, без фото", "не найден" or "—" (not checked). ABCP's description appears under the article number. New **filter** "📷 Есть фото в ABCP / Найден, без фото / Не найден в ABCP / Не проверен", and a summary line with the counts.
- **Brand for the lookup:** missing articles store only the number, so the car's brand is used (BMW/MINI → "BMW", Мерседес → "Mercedes-Benz", Фольксваген → "VW"…). Wrong guesses show as "не найден".
- **Junk codes hidden:** placeholders from the old compatibility table (`00000000000`, `01104444444`: all zeros or 7+ identical digits in a row) are left out of the list and the check. Their count is shown in the summary line.
- **Client:** `lib/abcpOrders.js` got `apiPost()` with its own whitelist (`READ_ONLY_POST_OPS = cp/articles/info/batch`). Write operations such as `cp/productCards` are still refused.
- ⚠️ **First live run 23.10: `ABCP error 3: Unknown operation`.** Per the docs, `cp/articles/info/batch` is part of **"Каталоги в товарных группах через API", a separate paid ABCP service** ("для подключения необходимо связаться с отделом продаж ABCP"). It is not enabled on this account. The dashboard now says so (`job.error = 'NOT_ENABLED'`). Options: enable that service (the code works unchanged), or use the per-article `articles/info` from ABCP's "Общий интерфейс" (docs still to be checked; 1 call per article, so slow on the first run).
- **Switched to the free `articles/info`** (ABCP "Общий интерфейс", API-administrator only, not a paid add-on): one article per call, `format=bnhi` (brand, number, localized properties, images), `ABCP_CHECK_PAUSE_MS` default **700 ms** between calls. The first full run of ~5 200 articles takes **about 1 hour** in the background, most-requested first, saved every 25. Afterwards only new articles are checked. ABCP 301 = not in the catalog. Error 3/103 stops the run with a clear message. 5 network errors in a row stop the run, and the rest stays "not checked" for the next click. The progress line shows the remaining minutes, and the page can be closed meanwhile. `articles/info` was added to `READ_ONLY_OPS`.
- ⚠️ **ABCP rate limit (live 23.10):** at 0.7 s per call ABCP answered **error 303 "The resource is blocked. The limit on the number of requests per minute/hour/day has been exceeded"**. The limits aren't documented, and the **same API account serves the chat's order-status lookups**. So now:
  - **Pace:** `ABCP_CHECK_PAUSE_MS` default **3000 ms**.
  - **Daily cap:** `ABCP_CHECK_DAILY_LIMIT` default **500 articles per Moscow day**, most-requested first. When reached, the check continues **automatically at 00:05 MSK** the next day.
  - **On 303:** the run pauses and **resumes automatically after 1 hour**.
  - The dashboard shows "⏸ ABCP ограничил…" / "✅ Дневная порция проверена… Продолжится автоматически <time>" and the queue size.
  - The auto-resume timer lives in the server process; after a redeploy, click "Проверить в ABCP" once to restart it.
  - **Order status:** only ABCP error 301 counts as "order not found". A 303 block (or an auth/site error) now gives the "сейчас не получается проверить" answer instead of "не нашёл заказ", and doesn't count as a failed attempt.
- ⛔ **ABCP support's answer (23.10), so the check is OFF by default:** on site tariffs, **`articles/info` allows only 10 calls per minute / hour / day**, and every article counts. `cp/articles/info/batch` exists only on the separate **"API Crosses" tariffs** (abcp.ru/crossbase): 250 000 ₽ one-off, plus from 38 400 ₽/month for 5 000 `articles/info` per day. A separate API user shares the site's limits. Checking ~5 200 articles at 10/day isn't viable, so the job only runs with **`ABCP_CHECK_ENABLED=true`** (e.g. after switching tariffs; then also raise `ABCP_CHECK_DAILY_LIMIT`). The button is hidden otherwise, and rows already checked keep their result.
- **Limits per operation (ABCP "Детализация услуг", tariff "S-Klasse"):** articles/info 10/10/10 (min/hour/day); orders 1 000 / 20 000 / 120 000; users 500 / 10 000 / 100 000; search/brands 900 / 9 000 / 90 000; others 2 000 / 2 000 / 10 000. **Limits are separate per operation**, so order status (`orders`, `users`) was never at risk from the catalog check. Current usage is visible in ABCP → Финансы/Детализация услуг → "Статистика вызовов API-операций".
- **What the result means:** "📷 есть фото в ABCP" while the item is missing from the feed points to an export/price-list setting, not a missing photo. "Найден, без фото" / "не найден" need a photo added (next steps in the to-do list: product-card text, photo upload via "Мои каталоги").

### ✅ Session 19 (Oct 23) — "Подойдёт ли этот номер на мою машину?" (ABCP + Laximo)

The bot now checks a **part number the customer types** against **their car's original catalog** itself, instead of "менеджер проверит совместимость".

- **Why a combination:** Laximo on the site searches a car's catalog **only by part name**, not by number (tested by the owner). ABCP's site search finds a number but tells who sells it, not which cars it fits.
- **Flow** (`api/chat.js`, before `lookupLaximo`):
  1. **Trigger:** extracted `vendorCode` typed in one of the customer's **last 2 messages**, plus a VIN or brand+model.
  2. **Part name:** the customer's own keywords. Without them, ABCP **`search/brands`** (number → brands + description, read-only, cached 24 h, 5 s timeout; `abcpPartName()`) gives a name, preferring the car's brand ("BMW 11427808443 — Фильтр масляный"). The name becomes the Laximo keywords (`keywordsFromName()`: "фильтр масляный" + "масляный фильтр"). If only other brands have the number (MANN, Bosch…), it's flagged `aftermarket`.
  3. **Laximo** searches the car (VIN or model) by that name. This is the normal lookup, incl. FALLBACK_QUERIES, brake-only "накладки" and **both spellings of abbreviations** (`spellingVariants()` in `lib/laximo.js`). The customer's spelling is searched first; if it finds nothing, the other one is tried: ОГ ↔ отработавших газов, ГБЦ, ШРУС, ДМРВ, АКПП, МКПП. Max 2 extra requests.
  4. **Verdict** (`compatVerdict()`): **fits** (number in the car's catalog, with unit/notes), **other_numbers** (the catalog lists other numbers for this part, given to the customer), **part_not_found**, **vehicle_not_found**, **unavailable**, **no_part_name**.
- **Prompt:** section "ПРОВЕРКА СОВМЕСТИМОСТИ АРТИКУЛА" with the verdict as JSON and strict rules: by VIN = "подтверждено"; by model = "по каталогу подходит для модели, для точности VIN"; other_numbers = say so plainly and name the catalog numbers (old/replaced number or other modification; an aftermarket number goes to the manager); no automatic result = the manager button, and never claim fit beyond the result. The "Открыть деталь" note no longer says "менеджер проверит совместимость" when a check ran.
- **Logs:** `DIAG compat {"code","source","partName","keywords","aftermarket","verdict","by"}`.
- **Cost:** 1 ABCP `search/brands` (limit 90 000/day) + usually 1 Laximo details search (vehicle cached).
- **Tested** end-to-end with the real chat handler, saved Laximo pages and mocked ABCP/AI: fits, other_numbers, and no check for a number from 3 messages ago.
- **First live test 23.10, two fixes:**
  - **VIN test: no check ran.** "Подойдёт 13628582663? VIN …": the extraction missed the part number next to the VIN. Safety net: if `vendorCode` is empty, an **11-digit number from the latest message** is taken (spaces allowed). Never the VIN, never phone-like `79…`/`89…` or the extracted phone. Logged as `[compat] part number … taken from the message`.
  - **Model test: Laximo `found:false` in 81 ms, without a log line.** `findVehicleByModel` returned null silently when a wizard step didn't match, and it **cached empty vehicle lists** (e.g. fetched during the 21.10 site block), which then failed that car instantly. Now:
    - empty lists are never cached (key `modelveh3`, old v2 entries ignored);
    - **`partialWizardPick()`** matches customer tokens with digits as part of an option ("30d" → BMW's "30dX"). One match is taken, several become buttons, none become buttons for ≤ 16 options. It also narrows a picker question to one option when possible;
    - every give-up now logs `[laximo] model path: no "<step>" option matches (…options…)` or `…returned no vehicles`.
- **Second live test 23.10:**
  - ✅ **By model works:** "Подойдёт 11427808443 на X5 F15 30d?" → Laximo found X5 30dX (F15) → **other_numbers**. The bot named the catalog's numbers 11428507683 (oil filter) and 11428507697 (housing) and showed them as cards.
  - **By VIN: `part_not_found` for 13628582663.** ABCP's names for it are **English** ("Temperature sensor, exhaust") or **garbled** ("Ґрвзшъ вхьяхарвгал si"), and the catalog search is Russian. Now:
    - garbled names are skipped (`looksGarbled()`);
    - if only garbled / "Деталь" names exist, a name is taken from the offers of one `search/articles` call (added to the read-only whitelist);
    - a non-Russian name is translated by a small Haiku call into the BMW-catalog Russian name (`toRussianPartName()`, cached, 6 s timeout), e.g. "датчик температуры отработавших газов".
  - Logged as `[compat] ABCP name "…" -> "…"` and `[compat] part name for … from offers`.
- **Fourth live test 23.10:** "Подойдёт 13627823945? VIN X4XZW61140L560928" ran no check, and the fallback didn't fire either. The extraction had put the **VIN into `vendorCode`**. Now a `vendorCode` equal to the VIN (or 17 characters long) is discarded and the 11-digit number is taken from the message. A `vendorCode` that isn't in the last 2 customer messages is kept for the rest of the reply but **not re-checked** (`compatSkipCode`). Log: `[compat] extracted vendorCode "…" is the VIN -- ignored`.
- **Sixth live test 23.10:** the part name was now right ("Датчик температуры ОГ" from the ABCP offers), but **the site's browser check was back** (`BROWSER CHECK detected … paused until 22:38 UTC`, the probe was blocked again). The details search never ran, yet the verdict said **part_not_found**, i.e. the bot claimed "ничего не найдено". Fix: `searchPartsForVehicle()` marks the result `searchFailed` when a search errors or is skipped. `findPartsByVin/Model` pass it on, and `compatVerdict()` returns **unavailable** ("couldn't check now" + manager) unless the number was found anyway.
- **Fifth live test 23.10: false manager lead.** The extraction put the part number into **`contactPhone`** ("13627823945"), so no check ran **and the automatic manager handoff fired** ("Заявка принята", a lead with a bogus phone). Now `sanitizeContactPhone()` runs right after extraction. Russian mobiles (9xxxxxxxxx, optional 7/8 prefix) always pass; other 11-digit 7…/8… numbers pass only when written like a phone (+, brackets, dashes, spaces). Anything else is dropped and, if no part number was extracted, used as `vendorCode`. The extraction prompt also says that BMW part numbers (11 digits, usually starting 0–6) are not phones. Log: `[extract] contactPhone "…" doesn't look like a phone -- ignored`.
- **Third live test 23.10:** the translated "датчик температуры отработавших газов" still found nothing. The owner checked the X5 40dX (E70) catalog: BMW calls it **"Датчик температуры ОГ"** (13627823945). The earlier one-way expansion (ОГ → full) made this worse. Abbreviations are now tried **both ways**, and only when the first spelling finds nothing. Log: `[laximo] "…" found nothing; other spelling "…" -> N part(s)`. For this car the right verdict is **other_numbers → 13627823945** (13628582663 isn't in its catalog).

### 🖼 Session 23g (Oct 25) — a diagram for every "Открыть деталь" number

- **Live test 25.10:** the ТО answer had a button **"Открыть деталь 64119460554"**, but that number isn't on the ТО diagram, so the customer couldn't see what the part is.
- **Now (`api/chat.js`):**
  - every "Открыть деталь" number that is **not on the main diagram** (by `unitParts`) and was found by Laximo gets its **own diagram card** with its position marked;
  - max **2 extra** cards per answer, each ~2 Laximo requests, cached 7 days; 9 s cap together;
  - a card whose image matches the main diagram is dropped;
  - the agent gets their unit, position and notes (for "снят с производства").
  - Log: `DIAG extra-diagrams <codes> -> N`.
- **Widget:** parses **all** `<<<DIAGRAM>>>` blocks (`matchAll`) and renders one card per block; all of them come back after a page reload.
- **Buttons under their diagram (owner, 25.10):** each diagram card is followed by the "Открыть деталь" button of its marked part. Buttons without a diagram come after all the cards. The display log keeps this order, so it's the same after a reload.

### 📋 Session 23f (Oct 25) — "standard ТО" rule in the prompt

- **Why:** the catalog kit only works when Laximo is up and for BMW. A written definition also covers blocked Laximo and other brands, and makes the search find the right price-list items for cards.
- **Prompt (`SYSTEM_PROMPT`), skill "## СТАНДАРТНОЕ ТО (Maintenance)":**
  - **Owner's decision:** asking about mileage and intervals makes the chat long and painful. So the agent offers the **whole standard set right away**, as in BMW's catalog diagram "ТО по регл.Oelservice / Inspektion", and the customer picks what they want from the cards.
  - **The 10 items:**
    1. oil filter;
    2. spark plugs (petrol only);
    3. air filter;
    4. cabin filter (carbon version as an alternative);
    5. front wipers;
    6. rear wiper (if the body has one);
    7. brake fluid;
    8. coolant;
    9. washer fluid;
    10. CHF hydraulic oil (only if the catalog lists it for the car).
  - **Answer order:** the set in this order (numbers and prices only from the data) → cards for everything in the price list (up to 12) → **one closing question:** "Нужно ли также моторное масло (допуск…) и тормозные колодки/диски?"
  - **Engine oil and brake pads/discs** are added only after the customer says yes.
  - The catalog kit section, when present, has priority.
  - **Diagram card = only the red-marked part (owner, 25.10):** the "Состав ТО по каталогу BMW" list made the card very long. The server still builds the kit for the cards and the prompt, but removes `kit` from the diagram payload. The widget's `kitHtml()` stays for older chats.
  - **Short text (owner, 25.10):** the first version listed every position with numbers, prices and alternatives, which was too long on a phone and repeated the cards. Now:
    - one intro line;
    - one line naming the positions, without numbers or prices;
    - at most one sentence "часть номеров снята с производства — менеджер подберёт замену";
    - the oil and brakes question.
  - Numbers, prices and delivery times stay in the cards and the list under the diagram. This rule beats the "АКТУАЛЬНЫЕ ЦЕНЫ" and button sections for ТО replies.
- **Extraction:** a ТО request now expands to `["масляный фильтр","воздушный фильтр","салонный фильтр","микрофильтр","свеча","щетка","жидкость","антифриз","CHF"]`. Engine oil and brake pads/discs are added only when the customer names them.
- **Name matching fixes (`filterCatalogByPartKeyword`):**
  - 1–2 letter words of a product name ("к", "т" from "рем.к-т") no longer match every keyword. Before, "рем.к-т торм.накладок" showed up for unrelated keywords.
  - **Ё → Е** on both sides: "Щётки" used to split into "Щ" + "ТКИ" and never matched.

### 🧰 Session 23e (Oct 25) — full ТО kit from the original catalog

- **Live test 25.10:** "Набор на стандартный технический обслуживание. BMW X5 4.0i G05" listed only the oil/air/cabin filters and the oil filter housing. BMW's service unit **"ТО по регл.Oelservice / Inspektion"** also has spark plugs, wiper blades (front/rear), brake fluid, coolant, washer fluid and CHF hydraulic oil.
- **How it works now:**
  - `isServiceRequest()` (`api/chat.js`) spots a general maintenance request in the last two customer messages ("ТО" in capitals, "техобслуживание", "техническое обслуживание", "набор на ТО", "расходники", …) or in the extraction's ТО keyword list. Note: `\w` doesn't match Cyrillic in JS, so the patterns use `[а-яё]*`.
  - For such a request, the diagram is taken from the **oil filter** found by Laximo (even if it has a photo in the feed), because its diagram is the service unit.
  - `parseSchemaAnswer()` (`lib/laximo.js`) now also returns **`unitParts`**, every position of the unit, from the same "Схема" JSON. No extra Laximo request. Cache key `diagram4:`.
  - Each position is checked against the full feed (`fetchCatalogIndex`): products in the feed get the site price and product link; the others get the **cheapest live offer** (`livePrices`, up to 14 numbers, profile "Гость (Опт)").
  - The agent gets a **"ПОЛНЫЙ СОСТАВ ТО"** block: list the kit grouped (filters, plugs, wipers, fluids), prices only from this list, flag discontinued numbers.
  - **Widget:** the diagram card shows a **"Состав ТО по каталогу BMW"** list: position, number, name, quantity, price ("3 900 ₽", or "от 1 250 ₽ · в наличии / ~70 дн."), "⚠ снят с пр-ва". Each row opens the product or the site's search page. If the image fails, the list stays.
  - Only when the diagram's unit name looks like a service unit (ТО / Oelservice / Inspektion). Log: `DIAG service-kit {unit, items, inFeed, priced}`.
- **Second live test 25.10 (same request):** the card showed **"Масляный фильтр смаз.сист.,теплообменник"** (the oil filter housing unit, 11428488578 at pos. 1) and no kit. The bot had picked the "Масляный фильтр" **module**, whose "Схема" opens the housing unit; only the **filter element** (11428583898) opens the service unit. Fix:
  - `serviceCandRank()` orders the found parts: oil filter element → cabin microfilter → spark plug → air filter element → "Масляный фильтр" module (housings, covers, seals, sensors excluded);
  - up to 4 are checked with **`laximo.getPartSchemaInfo()`**, which makes only the "Схема" request (1 per part, cached 7 days as `schema1:`), until one opens the service unit; only then is the unit page loaded for the marker; total cap 16 s;
  - if none does, the oil filter element's own diagram (or the usual part without a photo) is shown;
  - logs: `[laximo] service unit via <oem> (<name>): <unit>` / `… not the service unit`.
- **Third live test 25.10:** the service diagram was found, but **no kit list**. The "Схема" JSON only lists the **asked part**, not the whole unit. Now `getPartDiagram()` takes `unitParts` from the **unit page's parts table**, which it already loads for the marker. Cache key `diagram5:`. The kit keeps max 2 variants per position and 20 rows, so the fluids at positions 7–10 aren't cut off.
- **Cards for the whole kit:** the AI only made cards for what its keywords matched (3 cards for a ~10-item set). Now `mergeKitCards()` adds **every kit position that is in the price list** to the `<<<PRODUCTS>>>` block on the server, or creates the block. Max **12 cards** (`MAX_KIT_CARDS`). The AI's own cards stay, without duplicates. Card note: "Состав ТО по каталогу BMW, поз. N (qty)"; compatibility: "<car> — по оригинальному каталогу BMW". The prompt rule "от 3 до 6 товаров" now says "для ТО — все позиции, до 12". Log: `DIAG kit-cards +N (total M)`.

### 🗂 Session 23d (Oct 25) — the agent now knows what the diagram card shows

- **Live test 25.10 (X5 G05 B58, ТО):** the diagram card correctly showed **11428583898 — "⚠ Не производится с: 16.11.2021"**, but the text didn't mention it and called the part "альтернативный/дополнительный вариант к корпусу фильтра". Cause: the diagram was loaded **in parallel** and only attached after the AI had written its reply, so the AI never saw the catalog notes.
- **Fix (`api/chat.js`):** the reply now **waits for the diagram** (only when one is being loaded; cached = instant, new = max 9 s) and adds a **"СХЕМА ПОД ОТВЕТОМ"** block to the prompt: unit, position, number, name, quantity and catalog notes. If a note says the part is discontinued, the agent **must** say so and that the manager will suggest the current replacement; it describes the part by its catalog name (a replacement filter element, not "a variant of the housing").
- **Dangling "подходят следующие позиции:"** — new prompt rule: feed products are shown as cards **below** the text, so the agent says "в карточках ниже" or lists their names, instead of ending on a colon.

### 🗣 Session 23c (Oct 25) — never "этого товара нет в нашем каталоге"

- **Owner rule:** the bot must **never** tell a customer that a part "isn't in our catalog / on the site". The feed it reads (KATALOG ТОВАРОВ) only holds items **with a photo**, while the site's search sells far more.
- **Prompt (`SYSTEM_PROMPT`, `api/chat.js`):**
  - a general rule next to the anti-hallucination rules;
  - in "ОРИГИНАЛЬНЫЕ НОМЕРА … КОТОРЫХ НЕТ В КАТАЛОГЕ" the old instruction "объясни, что этой позиции пока нет в каталоге сайта" is replaced by: name the number, say all offers are behind the "Открыть деталь" button, the manager helps with ordering and delivery. Example: «Также по оригинальному каталогу для вашей машины есть номер 11428583898 — «К-т сменного элемента масляного фильтра». Все предложения по нему можно посмотреть по кнопке ниже, менеджер поможет с заказом и сроками.»;
  - the typed-number button note also forbids "нет в каталоге/на сайте".

### 🧹 Session 23b (Oct 24) — polish from two live tests

- **"Fits" → only the checked number gets a button.** In "Подойдёт 13627823945? VIN …" the name search also returned 13628506995, a different sensor, and it got an "Открыть деталь" button too. When the compat verdict is `fits`, `laximoNotInCatalog` numbers no longer get buttons. With `other_numbers` they still do, since those are the catalog's correct numbers.
- **Readable notes in the diagram card.** Laximo sent the attribute name `end_of_production` with the value "Не производятся с: 20211116". `noteLabel()` (`lib/laximo.js`) maps technical keys (end_of_production, start_of_production, note), turns `YYYYMMDD` dates into `DD.MM.YYYY`, and uses a "Label: value" inside the value as the label, giving "**Не производится с: 16.11.2021**". The widget shows discontinued notes in **red with ⚠**. The diagram cache key is now `diagram3:`, so old raw notes are rebuilt.
- **Discontinued parts:** a prompt rule says that if a number's notes say it is no longer produced, the bot says so and that the manager can suggest the current replacement. (Seen with 11428583898, oil filter element for X5 G05 B58, discontinued 16.11.2021.)

### 💰 Session 23 (Oct 24) — live price & delivery time in the chat (cheapest offer, profile "Гость (Опт)")

> **Update 24.10 (owner):** the "Aris Test" export only contains items **with a photo**, so parts shown by diagram / "Открыть деталь" are not in it. Their price therefore comes from the **site search** with profile **"Гость (Опт)"**, **all warehouses** the profile sees, and **only the cheapest offer** is shown; the customer picks the best one on the search page. Live prices are **on by default** (`ABCP_LIVE_PRICES=false` turns them off). `ABCP_PRICE_ROUTES` is only an optional restriction now, and there's no "fastest" offer any more. "В наличии" only for same-day offers (supplier stock with a 70-day delivery is "~70 дн."). Tested with the 13627823945 offers from the site: "от 7 400 ₽, ~70 дн., 5 предложений". The text below describes the first version.

**Михаил's decision (24.10):** "цены будут такими же, как в прайсе, только актуальными". So live prices use the **same rules as the bot's price-list export**: profile **"Гость (Опт)"** and the **export's 6 warehouses** (Экспорт прайсов → "Aris Test" → Склады).

- **`lib/abcpPrices.js`** (read-only, via `lib/abcpOrders.js`): `search/articles` per number (`withOutAnalogs=1`, own number only, online suppliers on unless `ABCP_PRICE_ONLINE=0`, 8 s timeout, cached 20 min, max 3 numbers per reply in parallel).
  - **Profile:** found by name through `cp/users/profiles` (whitelisted, cached 6 h). Override with `ABCP_PRICE_PROFILE_ID` / `ABCP_PRICE_PROFILE_NAME`.
  - **Warehouses:** `ABCP_PRICE_ROUTES` = comma-separated IDs as shown in ABCP (`[1669168]` etc.), matched against an offer's `distributorId` or `supplierCode`.
  - **Offer selection** (`pickOffers()`): own number, price > 0, not used, allowed warehouse. Gives **cheapest**, plus **fastest** if its delivery time differs, with days (hours/24), in stock, no-return flag.
- **When:** only for numbers that get an "Открыть деталь" button and are **not in the feed** (typed numbers, original numbers from Laximo). Feed items keep their feed price.
- **Prompt:** section "АКТУАЛЬНЫЕ ЦЕНЫ" (takes precedence over "don't name prices" for these numbers): "от N ₽" plus delivery ("в наличии" / "~N дн."), the fastest offer in one phrase, a no-return warning, "актуальны на сейчас", all offers and ordering via the button. No prices for other numbers.
- **Safety switch:** live prices stay **OFF until `ABCP_PRICE_ROUTES` is set**, so the bot never shows prices that differ from the price list. One log line until then: `[prices] live prices off: …`. `ABCP_LIVE_PRICES=all` = all routes the profile sees; `=false` = off.
- **Logs:** `[prices] using profile "Гость (Опт)" (id …)`, `[prices] N number(s) asked, M with offers (routes …)`, `DIAG live-prices {number: {from, days, offers}}`.
- **Limits:** search calls count under "search"/"others" (10 000–90 000/day) and the monthly search quota (400 000).
- **Tested** with the chat handler and mocked ABCP: profile found by name, warehouse filter, used/analog/other-warehouse offers dropped, cheapest + fastest in the prompt; off without routes.

### 🔗 Session 22 (Oct 24) — "Открыть деталь" buttons for catalog numbers missing from the feed

- **Live test 24.10:** "балка заднего моста, VIN …" → 3 original numbers (33316863815, 41347179100, 41347179099) plus the diagram, but the bot said it **can't show price/availability** because they aren't in the feed.
- Now up to **3 numbers from `laximoNotInCatalog`** (after a typed number, if any) get the same **"🔎 Открыть деталь …" button** as typed numbers (`allLinkCodes` → `<<<PART_LINKS>>>`). The site's search page shows all offers, prices and delivery times for them.
- Prompt section "КНОПКИ ДЛЯ НОМЕРОВ, КОТОРЫХ НЕТ В КАТАЛОГЕ ТОВАРОВ": say price/delivery can be seen via the buttons below, never "невозможно показать цену", don't invent prices, don't repeat links; numbers beyond the 3 buttons go to the manager.
- Tested with the chat handler and a saved Laximo page: a catalog number missing from the feed gets the button plus the prompt note; compatibility tests unchanged.

### 🛠 Session 21 (Oct 23) — unit diagram card for parts without a photo (✅ confirmed live 24.10)

When the original catalog finds a part that has **no product photo** (a feed card without a picture, or a catalog number not in the feed), the reply gets a **"Схема" card**: the Laximo unit diagram with the part's **position marked in red**, plus "Поз. 11 — 13627823945 — Датчик температуры ОГ (1 шт.)" and the unit name. Tap the image to open it full-size. Built and tested on saved pages + in the widget; **not tested live** (site block on 23.10).

- **Unit page parsing** (`parseUnitDiagram()`, `lib/laximo.js`): `img.mapBlockImage` → image URL (`img.laximo.ru/…?s=…&k=…`, signed). `.mapObjects[data-code-on-image]` with `left/top/width/height` px → position boxes. Rows `tr[data-code-on-image]` link each OEM to its box (row 01 ↔ `a01`).
- **Part → unit page:** details-search rows have a **"Схема" button** (`a.checkSchema` with `data-number`, `data-catalog-code`, `data-vid`, `data-ssd`, now kept as `part.schema`). The site's JavaScript turns it into the unit page via an AJAX call whose address is **not known yet** → `resolveUnitUrl()` uses **`LAXIMO_SCHEMA_URL`** (Coolify env), a path template with `{number}`, `{catalog}`, `{vid}`, `{ssd}`. Its answer (HTML or JSON) must contain a link with `lp=unit`. Until it is set, no diagrams are shown and the log has one line: `[laximo] diagrams: LAXIMO_SCHEMA_URL not set`.
- ✅ **Confirmed live 24.10, 02:16 MSK** (Laximo back after the block): "Подойдёт 13627823945? VIN X4XZW61140L560928" → verdict **fits** by VIN (X5 40dX) and the diagram card "Чувствительные э-ты для сажевого фильтра" with **position 11 marked in red**, "Поз. 11 — 13627823945 — Датчик температуры ОГ (1 шт.)", plus the "Открыть деталь" button.
- ✅ **Answer format captured 23.10** (owner, browser console): the lookup returns **JSON** `{success, unit:{unitid, name, imageurl (with %size%), ssd, details:[{oem, name, codeonimage, attributes:[amount, note…]}]}}`, and the site's JS then opens `/laximo?lp=unit&c=&vid=&uid=<unitid>&detailCodeOnImage=<code>&ssd=<unit.ssd>`. `parseSchemaAnswer()` takes the image (`%size%` → `source`), unit name, position, qty and notes (e.g. "Примечание: L=156MM", shown in the card) and builds the same unit URL. **Request 2 (unit page) only adds the red marker box** (row OEM → `data-code-on-image`, else the box whose number equals the position). If it fails, the card shows without a marker. Cache key `diagram2:`.
- ✅ **Address captured 23.10** (owner, browser Network tab): the "Схема" button calls **`/?action=article/getSchemaApplicabilityLink&number=…&c=…&vid=…&ssd=…`**. This is now the **built-in default** of `LAXIMO_SCHEMA_URL`, so no Coolify setting is needed. The answer's shape (JSON / link / HTML) isn't confirmed yet, so `resolveUnitUrl()` takes the first `/laximo?…` link (preferring `lp=unit`). Otherwise it logs `[laximo] diagrams: schema answer has no /laximo link: …` with the first 200 characters.
- **How to find the address (needs Laximo working):** open a car in the site's Laximo catalog → search a part by name → press **F12 → Network** → click **"Схема"** on a row → copy the request URL that appears, and its response. Turn it into the template, e.g. `/laximo?…&number={number}&c={catalog}&vid={vid}&ssd={ssd}`.
- **Chat** (`api/chat.js`): if Laximo results are used, the first part without a feed photo (the compat-check match first, if it "fits") gets `getPartDiagram()`. It runs **in parallel** with the AI reply (9 s cap), is cached 7 days (`diagram:` key), costs **2 Laximo requests** per new diagram (schema lookup + unit page), and gives one diagram per reply. It is appended as `<<<DIAGRAM>>>{…}<<<END_DIAGRAM>>>`. Log: `DIAG diagram {oem, unit, position, box}`. Switch off with `LAXIMO_DIAGRAMS=false`.
- **Image proxy** `api/laximo-image.js`: `GET /api/laximo-image?u=<encoded url>`, **only `img.laximo.ru`** (no open proxy), Referer bmwclub77.ru, image types only, max 3 MB, in-memory cache (150 images, 7 days) so older chats keep their diagram after the signed link expires.
- **Widget:** card `.pc-diagram`; the red box is scaled from image pixels to the shown size (recomputed on resize). A failed image removes the card (no broken picture). It survives reloads (`displayLog` type `diagram`); the chat history stores "[схема показана]".

### 🧩 Session 20b (Oct 23) — compatibility check while Laximo is blocked

When Laximo can't check (site browser check, pause, `LAXIMO_ENABLED=false`, verdict `unavailable`/`no_part_name`), the check no longer just says "couldn't check":
- **Model known** (brand + model): the number is checked in **our compatibility table** (`fetchCompatibilityByVendorCode()` + `matchCompatibility()` against the customer's car, with the part number ignored for matching). Verdicts:
  - **`table_fits`**: "по нашей базе совместимости подходит для …", plus a recommendation to check by VIN later or ask the manager;
  - **`table_other_vehicles`**: the table lists the number only for other cars (named). There's no confirmation for this model, which doesn't mean it doesn't fit; manager / VIN later;
  - **`table_no_data`**: couldn't check, manager.
- **Only a VIN**: a VIN can't be decoded without Laximo → **`vin_unavailable_need_model`**: the bot says VIN checks are temporarily unavailable and asks for brand, model with body code (e.g. X5 F15), engine or year. The next message runs the table check.
- **Car already known from a saved VIN lookup** (the VIN result is cached even when part searches are blocked; seen 23.10: X5 40dX, Код модели E70N): the table check uses it directly, as series + body code ("X5 E70"), without asking for the model first. The prompt gets `carFromVin` and is told not to ask for confirmation.
- The compat check now also starts when `LAXIMO_ENABLED=false` (table only). The log `DIAG compat` gains `tableRows`; the prompt marks `catalogUnavailable: true`.
- Tested end-to-end with Laximo returning the browser-check page and a test table: table_fits (X5 F15 30d), table_other_vehicles (E70 only), table_no_data, vin_unavailable_need_model. The normal Laximo path is unchanged.

### 🕒 Session 20 (Oct 23) — order timeline in the order-status reply

- After the ownership check, **one** call to **`cp/orders/statusHistory`** (all item ids, max 100; read-only, whitelisted) gives each item's status history. `parseHistory()` in `lib/abcpOrders.js` sorts it oldest first and merges repeated statuses. **Staff names (`managerName`) are dropped** and never shown to customers.
- **Reply:** if all items share the same history, there is one line, "История: Заказ принят 21.10 → Заказано у поставщика 22.10 → **В пути** 23.10"; otherwise each item gets its own timeline. Without history, the current status shows as before.
- **"Ориентировочный срок поставки: до DD.MM.YYYY"** = order date + the longest supplier delivery time of the items (`deadlineMax`/`deadline`, hours → days), shown only while it's still ahead. Mixed orders add "(по самой долгой позиции)".
- If the history call fails, the reply falls back to the current status (logged `[abcp] statusHistory failed`). Limit group "orders": 120 000/day.
- Tested with mocked ABCP: shared timeline, per-item timelines, a missing history, merged duplicates, no staff names.
- **Live test 23.10: "Код заказа" 304981534 not found any more** (it had found 286508592 an hour earlier). Most likely the order was **archived** after processing, and `cp/orders` lists only active orders by default. Now:
  - the "Код заказа" scan also reads **archived** orders (`isArchive=1`, separate 10-min cache);
  - an order number that `cp/order` doesn't know is looked up in the archive (`cp/orders?numbers[]=…&isArchive=1`, deleted orders skipped) before the deleted/merged check;
  - the scan logs `[abcp] scanned active|archived orders since …: N order(s), M with notes`.

## 📝 TO-DO: second branch "Ленинский проспект, д.146"

The site's home page has the news item **"Новый филиал открыли на Ленинском проспекте д.146"** (26.01.2026, "Магазин запчастей BMW Ленинский проспект д.146"). The bot's contact block (`SYSTEM_PROMPT` → "Контакты компании", `api/chat.js`) only knows **Химки, ул. Молодежная, д. 9Н**.

**To ask Михаил:**
1. Should the bot mention this branch at all, and in what role (store, pickup point, service)?
2. Opening hours?
3. Phone (same +7 (967) 555-7-555 or its own)?
4. Can orders be picked up there? Is it a pickup option in ABCP (would show as `deliveryOffice` in order status)?

**Also check:** the news item "Открыли филиал на Мичуринском проспекте" (03.03.2025). Is that branch still open, or replaced by Ленинский проспект?

**When answered:** add a second address block under "Контакты компании" and tell the bot which address to give for which question (pickup vs. service). **Status:** ⏳ waiting for Михаил (owner asks 24.10).

## 📝 TO-DO: switch from scraping the site's Laximo pages to the direct Laximo API

**Why:** the bot reads Laximo through bmwclub77.ru's `/laximo` pages (scraper, `lib/laximo.js`). ABCP's bot check ("Мы проверяем ваш браузер") has blocked our server twice despite the IP exemption: **21.10.2026** and **23.10.2026**. During a block, VIN/model lookups and the part-number compatibility check fail (the pause + 30-min probe limits the damage, but the bot can't check anything). Михаил has his **own Laximo licence** (14 750 ₽, renewed on the 9th, dashboard lk.a-motive.ru, provider Technology Trade, ~1 000 OEM requests/month shared with site customers), so the direct Laximo web service may be usable.

**Expected gains:**
- no dependency on the site's bot protection;
- faster, structured data instead of HTML parsing (no breakage when the site's markup changes);
- possibly a **search by OEM number / list of applicable vehicles**, which would make the compatibility check exact and drop the ABCP part-name + name-search detour (session 19). To be confirmed in Laximo's docs.

**Open questions for Laximo support (Technology Trade):**
1. Does Михаил's licence include **direct access to the Laximo web service (OEM catalogs)** from our own server, or only the ABCP platform integration?
2. What is needed: **IP whitelist (168.222.202.222)** or separate API credentials? Where is the **API documentation**?
3. Do direct API requests count toward the **same monthly quota** as the site? Is there a method to **find the vehicles a given OEM number fits**?

**When answered:**
- Credentials go **only** into Coolify env vars (never code/README).
- Build a `lib/laximoApi.js` with the same outputs as `lib/laximo.js` (`findPartsByVin`, `findPartsByModel`, plus an OEM applicability lookup) and keep the scraper as a fallback behind an env switch.
- Keep the request budget/queue (quota is billed).

**Status:** ⏳ not started. Message to Laximo support not sent yet (a Russian draft can be prepared on request).

## 🗺️ ABCP API — future to-do list

Everything the ABCP **admin API** (`cp/…`, docs: ABCP API → Административный интерфейс) could add to the bot and the dashboard. **Done** = live. Priority: ⭐⭐⭐ high, ⭐⭐ medium, ⭐ low. Rule for all items: the bot only **reads**. Any write operation runs only from the admin dashboard, after an explicit click by Михаил, and is whitelisted one by one in `lib/abcpOrders.js` (`READ_ONLY_OPS`) or a separate admin-only client.

### For customers (chat widget)
- [x] **Part-number compatibility check** ("подойдёт ли 11427808443 на мою машину?"): ABCP `search/brands` gives the part name → Laximo searches the car's catalog by name → numbers compared *(session 19, 23.10.2026)*
- [x] **Order status** by order number or "Код заказа" + phone/email — `cp/order`, `cp/orders`, `cp/users`, `cp/statuses` *(session 17, live 23.10.2026)*
- [ ] ⭐⭐⭐ **"Оплатить заказ" button** for verified orders with an amount due — `cp/payment/token` (ABCP's own payment link). Small, builds on order status.
- [x] **Live price & availability** for numbers not in the feed: cheapest offer of the site search, profile "Гость (Опт)" *(session 23, `lib/abcpPrices.js`, 24.10.2026)*
- [x] **Order timeline**: accepted → ordered from supplier → in transit → ready, with dates, plus the expected delivery date — `cp/orders/statusHistory` *(session 20, 23.10.2026)*
- [ ] ⭐⭐ **Product details for parts without a feed card**: description, photos, properties (viscosity, approvals, sizes) — `cp/articles/info/batch` (POST, read-only, max 100 per call; images at `https://imgcdn.abcp.ru/p/<name>`). Also lets the bot answer oil-approval questions from real data.
- [ ] ⭐⭐ **Customer's garage**: after the phone check, use the cars (often with VIN) saved on the site — "Вижу у вас BMW X5 G05 — подбираю для неё?" → VIN to Laximo — `cp/users/garage`.
- [ ] ⭐ **Delivery times by zone** for "сколько ехать в …?" — `/cp/user/shipmentAddressZones` (min. delivery days per zone).
- [ ] ⭐ **Pickup offices** list/addresses kept in sync with ABCP — `cp/offices`.
- [ ] ⭐ **Supplier promotions** mentioned when they fit the request — `cp/distributors/notes`.
- [ ] ⭐ **Oil/fluid selection by catalog filters** (brand, viscosity, approval) — `/cp/catalog/info`, `/cp/catalog/search`, then `/cp/articles/info/batch`.

### For Михаил (admin dashboard)
- [x] **"Нет фото" → ABCP catalog check**: background check of every missing article against ABCP's catalog (`cp/articles/info/batch`), with thumbnail, description and an ABCP filter in the tab *(session 18, 23.10.2026; built but **off**: site tariff allows only 10 `articles/info` per day; needs the paid "API Crosses" tariff)*
- [ ] ⭐⭐ **"Нет фото" → product card text with one click**: `cp/productCards` (write, admin-only), description + SEO texts. ⚠️ The API does **not** upload photos; the card limit is a paid service (`403 Article cards limit exceeded`).
- [ ] ⭐⭐ **"Нет фото" → photo upload** via "Мои каталоги" import with an image archive — `/cp/usercatalogs/{catalogId}/upload` (`imagesArchive`, multipart) + `/cp/usercatalogs/{catalogId}/tasks/{taskId}/status`. Bigger job; needs a user catalog set up in ABCP.
- [ ] ⭐⭐⭐ **"Неудовлетворённый спрос" tab**: what customers searched on the site and didn't buy (in stock / not / analogs, put in cart or not) — `/cp/reports/unsatisfiedDemands`. Same idea as "Нет фото", for the whole site.
- [ ] ⭐⭐ **Bot conversions**: match chat sessions to real ABCP orders (phone/email from the manager handoff → `cp/orders` by date) → "orders after chat" in the dashboard.
- [ ] ⭐ **Status/notification overview**: which statuses notify customers (`cp/statuses`: notify, paid, delivery flags). Check that ABCP's own SMS/email notifications cover what the bot is asked most.
- [ ] ⭐ **Price-list freshness**: supplier list + status (`cp/distributors`, `cp/routes`) → warn when a supplier is switched off or stale.

### Not for the bot (exists in the API, deliberately not used)
Changing orders (`cp/order` POST, `merge`, `toArchive`/`fromArchive`), sending orders to suppliers (`cp/orders/online`), balances/credit limits/payments (`cp/finance/*`), creating or editing customers (`cp/user/new`, `cp/user`), suppliers and routes (`cp/distributor*`, `cp/routes*`), staff (`cp/manager`), and the password-recovery history (`cp/actionsHistory`).

### 📦 Session 17 (Oct 23) — order status from ABCP ("где мой заказ?")

Customers often ask about existing orders. The bot now answers from the shop's **ABCP admin API** (orders live in **"Заказы 1.0"**; "Заказы клиентов 2.0" only has 2024 test orders).

- **Flow** (`orderStatusReply` in `api/chat.js`, deterministic, **no Sonnet call**, so order data is never guessed). The extraction step sets `orderStatusQuestion` / `orderNumber`.
  1. No number → asks for the order number (9 digits, in the email/SMS and "Мои заказы") plus the phone or email used for the order.
  2. Number but no contact → asks for the phone or email.
  3. Both → `lib/abcpOrders.js` → `cp/order?number=…&format=additional`, then the **ownership check**: the phone (last 10 digits) or email must appear on the order (email, name field, notes, guest data) or on the customer card (`cp/users`).
  4. Verified → reply per item: brand, number, name, qty, **status** + date, the status's "Описание для клиента" (`cp/statuses`, cached 6 h), plus pickup point/delivery type, amount due or "оплачен", and the Telegram/MAX contact.
- **Security:**
  - **Read-only client:** `apiGet()` only allows `cp/order`, `cp/users`, `cp/statuses`, although the API-administrator account could change orders.
  - **"Not found" and "contact doesn't match" give the same answer.**
  - **Max 5 failed checks per IP per hour.**
  - The password is never logged.
  - A phone given for order verification does **not** trigger the automatic manager handoff (`AUTO_MANAGER_HANDOFF` is skipped when an `orderNumber` is in the conversation).
- **Config (Coolify env vars only):** `ABCP_API_HOST` (from Настройка → Система → "Данные для доступа к API"), `ABCP_API_LOGIN`, `ABCP_API_PASSWORD_MD5`. **Never put these in code or the README.** Without them the bot points to "Мои заказы", Telegram/MAX and the manager button.
- **First live test 23.10:** `fetch failed` (network/TLS level, no answer from ABCP). The likely cause is the host from the panel, `bmwmperformance.ru.public.api.abcp.ru`: it has an extra dot, which a `*.public.api.abcp.ru` certificate doesn't cover. `ABCP_API_HOST` now accepts **several hosts, comma-separated**. They are tried in order, the first that answers is remembered, and the real reason is logged (`[abcp] … via <host> failed: <code>: <reason>`). Try `bmwmperformance.ru.public.api.abcp.ru,id2319.public.api.abcp.ru` (id2319 = the shop ID).
- **Confirmed, and fixed:** the log showed `ERR_TLS_CERT_ALTNAME_INVALID … not in the cert's altnames: DNS:*.public.api.abcp.ru`. `id2319.public.api.abcp.ru` connects but ABCP answers **HTTP 418** (empty), so it is not a valid API host for this shop. The panel's host is the right one. `lib/abcpOrders.js` now connects to hosts with an extra dot under `.public.api.abcp.ru` via `https.get` with `checkAbcpIdentity`: the certificate **chain is fully verified**, and only the one-label wildcard rule is relaxed for ABCP's own `*.public.api.abcp.ru` certificate. A foreign or untrusted certificate is still rejected (tested with a local TLS server). Set `ABCP_API_HOST=bmwmperformance.ru.public.api.abcp.ru` (the id2319 fallback is not needed).
- **Live 23.10:** the connection works (ABCP answers). **"Код заказа"** support: many orders carry "Код заказа: 304981534, E-mail: …" in a note (another channel), and customers quote that code. If `cp/order` says "Order with such online number not found" (ABCP error 301), the number is searched as a "Код заказа" in the notes of the last 90 days' orders (`cp/orders`, one call, cached 10 min; `cp/orders` added to the read-only whitelist), then the real order is loaded and verified as usual. On a contact mismatch the log shows what the order holds, masked (`phones=[…49] emails=[b…@icloud.com]`, plus the field names), to see where ABCP stores the customer's phone.
- **Live 23.10, "Код заказа" works:** 304981534 + email → order 286508592 shown with status. Follow-ups:
  - **One code can be on several orders** (or orders get merged/re-created). All matching orders of the last 90 days (max 5) are loaded and verified, and up to 3 are shown, headed "По коду заказа … нашёл N заказа".
  - **Status notes were repeated per item** ("Спасибо, за заказ!" is the client description of "Заказ принят" in ABCP). Now, if all items share a status, there is one "Статус: …" line plus the note once; otherwise there is a status per item and each status's note once. Long item names are cut at about 70 characters.
  - **286461514 was "not found" although it was in the panel earlier** (probably merged or deleted). An unknown number is now retried with `withDeleted=1`. If it exists as deleted **and** the contact matches, the bot says the order is no longer active (merged or cancelled) and refers to the manager.
- **Logs:** `DIAG order-status {"number","by","status"}` and `[abcp] order …: verified / contact does not match / ABCP error …`.
- ✅ **Password rotated 23.10:** the API-admin password (shown in a chat screenshot earlier that day) was changed in ABCP, and `ABCP_API_PASSWORD_MD5` was updated in Coolify. **Confirmed working by the owner** after the change: order status by order number or "Код заказа" plus phone/email.
- **Final settings:** `ABCP_API_HOST=bmwmperformance.ru.public.api.abcp.ru` (single host; the id2319 fallback is not used), `ABCP_API_LOGIN`, `ABCP_API_PASSWORD_MD5`. **If the password is changed again, update the Coolify variable.**

### 📍 Session 16e (Oct 23) — company info from the client

The bot's contact block (`SYSTEM_PROMPT` in `api/chat.js`, "Контакты компании") was rewritten with the client's current data. It replaces the old Юровская address, the 11:30–19:00 hours and the +7 985 phone:
- **Address:** new branch in Химки near МКАД: Московская обл., г. Химки, ул. Молодежная, д. 9Н ("БмвКлуб77" in the navigator), store + BMW service.
- **Hours:** Mon–Fri 10:30–20:00; Sat–Sun 11:00–18:00, pickup of ready orders only.
- **Phone:** +7 (967) 555-7-555. **Order questions:** Telegram or MAX at the same number. **Email:** Orders@BmwClub77.ru.
- **Delivery:** Moscow by Yandex.Доставка, regions by СДЭК. Prices and times aren't given, so the bot refers those questions to the manager.
- The bot answers address, hours, contact and delivery questions **only** from this block.
- **Green "Связаться с менеджером" button** (`widget/chat-widget.js`): now calls **+7 (967) 555-7-555** (`MANAGER_PHONE = '+79675557555'`, label `MANAGER_PHONE_LABEL`) at the client's request; it called +7 985 555-86-75 before. Old cached widgets show the old number until a hard refresh.
- **Edit this block when company facts change.** If many more facts are needed (payment, returns, warranty…), consider a separate knowledge-base section.

### 🔗 Session 16d (Oct 22) — "Открыть деталь" button when the customer types a part number

- **Case:** "нужен датчик температуры ОГ БМВ ф15 13628582663". The bot answered "нет данных в каталоге", but the site's search page shows that number (and its replacement 13628573347) with prices and "под заказ". The feed only has items with photos, so the bot couldn't see it.
- **Now:** when the customer's **latest message** contains a part number (the extracted `vendorCode`; spaces/dashes ignored, never the VIN or the phone number), `api/chat.js` (`partLinksForMessage`) appends `<<<PART_LINKS>>>["13628582663"]<<<END_PART_LINKS>>>`. The widget shows a blue button **"🔎 Открыть деталь 13628582663 — цены и сроки на сайте"** linking to `https://bmwclub77.ru/search?pcode=<номер>`, opened in a new tab so the chat stays open. The button survives page reloads (displayLog type `partlinks`) and clicks are logged as `product_open` (visible in the "Подбор" tab). The site URL can be overridden with `window.PC_SITE_URL`.
- The prompt gets a short extra section when the button is shown: don't say "нет данных" for a number missing from the feed; point to the button for price/delivery and offer the manager for ordering and fit-check.

- **Confirmed live 22.10** (same F15 sensor message): the button opens the right search page on bmwclub77.ru. The reply no longer says "нет данных"; it points to the button for price/delivery and shows the green manager button plus the VIN suggestion. Possible later tweak (owner: "let it be for the moment"): shorter replies for part-number questions, since the text currently repeats "can't confirm compatibility" twice.

### 🔎 Session 16c (Oct 22) — catalog names for air & cabin filters

- **Case:** "BMW 2 G42 220d, фильтр воздушный, масляный фильтр, колодки". The oil filter and pads were found; the air filter was reported as missing, although **13718594535** is on the site. Laximo's part search matches **names**, and BMW calls the air filter **"Сменный элемент фильтра"**, with no word "воздушный".
- **Fix** (`searchPartsForVehicle` in `lib/laximo.js`, `FALLBACK_QUERIES`): if the customer's own keyword finds nothing, one more search runs under the catalog's name: "воздушный фильтр" → "элемент фильтра", keeping only "Сменный элемент фильтра" or intake/air-filter rows (so fuel/oil filter elements are dropped); "салонный фильтр" → "микрофильтр". At most 2 extra requests, and only when needed. Logged as `[laximo] "<keyword>" found nothing; catalog name "<query>" -> N part(s)`.
- Verified live: `"воздушный фильтр" found nothing; catalog name "элемент фильтра" -> 2 part(s)`. The same log showed **214 OEMs** for 4 parts: "накладки" also matches body trim ("Накладка порога"). Now `QUERY_KEEP` keeps only brake rows for "накладки", and the results are **interleaved by keyword** (1st of each, then 2nd of each…), so the prompt caps (40 products / 15 missing OEMs) can't cut off the keyword searched last.
- **Confirmed live 22.10** (same G42 220d request): `oemCount` **214 → 11**, 8 in the feed, 3 given as OEM numbers. The widget showed both air filters (13718580429, 13718594535), the oil filter (11428575211) and the brake pads as cards with price and availability, and listed the 3 missing numbers with the manager offer. Prompt payload dropped to ~2.7k chars of products.
- **Laximo recovered by itself** after the 21.10 browser-check block: the 30-min probe found the site open overnight and lifted the pause, with no manual reset or redeploy.
- Add new pairs to `FALLBACK_QUERIES` when the logs show a part name that finds nothing.

### 🛡️ Session 16b (Oct 21) — browser check came back; pause now self-recovers

- **Incident 21.10 ~17:12 UTC:** the site showed "Мы проверяем ваш браузер" to the server again, so Laximo paused for 6 h. A customer asking for a generator for an X5 E53 4.4i got "не нашли … ни среди оригинальных номеров производителя". That was wrong: Laximo was never asked. The unit page has 12317540990/992/994, and **12317540994 is in the feed** ("под заказ").
- **Probe during a pause** (`lib/laximo.js`): one real customer request is let through every `LAXIMO_PROBE_MINUTES` (default 30). If the page comes back without the check, the pause is lifted at once (`probe passed … pause lifted` in the logs). If the check is still there, the 6 h pause restarts. That is at most about 2 requests an hour to the site while blocked. Nothing tries to get around the check; it only looks again later.
- **Honest wording while paused** (`api/chat.js`): the prompt tells the agent the original catalog is *temporarily unavailable*. It must not claim the part doesn't exist at the manufacturer, and should offer the manager to check by VIN instead.
- Lift a pause by hand: `POST /api/admin/clear-cache` with header `x-admin-secret: <CACHE_CLEAR_SECRET>`.

### 🚗 Session 16 (Oct 21) — "Нет фото" tab: filter by car model, no 1000-row cap

- **Car-model dropdown** next to the article search: "BMW X2 F39 (312)" etc., sorted by number of articles. Groups come from each article's `vehicle_examples`, normalised by `vehicleLabel()` in `api/dashboard/missing-articles.js`: brand + model up to the first chassis code ("X2 F39 sDrive20i" → **BMW X2 F39**, "2 G42 220i" → BMW 2 G42, "A4 B8 2.0 TFSI" → Audi A4 B8), with one spelling per brand (Ауди/audi → Audi, бмв → BMW, Mercedes → Mercedes-Benz), the brand stripped from the model text, and codes upper-cased. An article matches if it was ever requested for that car (any stored example). The filter combines with the article search.
- **Sorting:** click a column header (Артикул / Запросов / Последний запрос) to sort; click again to flip. Default is **article number ascending** (plain character order, so leading zeros count: 01… < 07… < 11… < 4M…). Open items always stay above resolved ones, and the last choice is remembered in the browser.
- With a car selected, the car column shows the request **for that car** ("Автомобиль (запрос)") instead of the article's last request, which might be a different car.
- **Fixed a hidden truncation:** the list came from the REST API, which returns at most **1000 rows**, and the counter showed exactly 1000. `list` now reads the table directly via `SUPABASE_DB_URL` (REST paging as fallback), so all rows are shown. Tested with 1500 rows.
- Seen in the live list: placeholder-looking codes like `00000000000` and `01104444444` near the top (250+ "requests" each). They come from the old compatibility table, not from Laximo. Consider cleaning them out of the `compatibility` table or deleting them here.

### 🌍 Session 15b (Oct 19) — Laximo for ALL brands (not just BMW) ✅ confirmed working live by the project owner

The client's Laximo licence shows **~60 brands** on the site (`https://bmwclub77.ru/laximo`, start page with the brand list). Customers increasingly ask about other brands, so the bot now uses Laximo for every brand in that list:
- **VIN, any brand:** the general VIN search, `/laximo?vin=<VIN>&lp=findByVIN&c=` with **`c=` empty**, exactly what the start page's "Поиск по VIN" box sends. Laximo detects the brand; the result link carries the catalog code (Audi VIN `WAUDACF59SA004478` → `AU1587`). The vehicle page and part-name search have the same markup for all brands (verified on Audi), so the parsers didn't change. Cache key is now `vin:any:<VIN>`. This also fixes a real bug: a non-BMW VIN used to be searched in the BMW catalog only, and the agent told the customer "VIN не найден".
- **Model path, any brand:** brand → catalog code comes from the start page's brand links (`parseBrandList`, cached 7 days as `brands:v1`, so codes update automatically after catalog releases). `resolveBrand` understands Russian/short names (ауди, мерседес/Mercedes → Mercedes-Benz, VW/фольксваген, Range Rover → Land Rover, хендай, …); unknown brands (e.g. Lada) fall back to the compatibility table. The wizard steps differ per brand: **Audi is Рынок → Модель → Год выпуска**, while BMW is Серия → Тип кузова → Модель → Руль → Рынок.
- **Generic matching** (`pickWizardOption`, step 4/5): model names like "A4/S4/Avant/qu." are matched by shared words. Several equally good options means the customer gets buttons (≤16); no match means the table fallback. A year is matched from the customer's text (chat.js now passes `год: <year>`). With no year, the 16 most recent years are offered as buttons. Market default: ЕЭК → Европа → Россия. BMW keeps its own series/chassis rules. Never guess between models: a wrong model means wrong parts.
- **Agent wording is brand-neutral** ("оригинальный каталог производителя", field `brand`), and the VIN advice applies to every brand. `DIAG laximo` now logs `brand`.
- **Not verified live yet:** the Audi wizard JSON *after* a step was simulated from the catalog page's own dropdowns (Рынок/Модель/Год выпуска with options). Other brands' wizards may have other steps (e.g. "Модификация"), which the generic matcher handles by words or buttons. Watch `DIAG laximo` (`"mode":"model"`, `brand`, `path`) and `DIAG laximo-needs-choice` for non-BMW brands.
- ⚠️ **Quota:** still **1 000 OEM requests/month** for the client's whole licence (all brands, shared with site customers). More brands means more lookups. Check lk.a-motive.ru more often; a monthly bot budget may become necessary.

### 🛒 Session 15 (Oct 19) — dashboard tab "Подбор" + teaser fix ✅ confirmed live

New dashboard tab showing, per chat: the customer's **first message**, the **product cards the agent showed**, and **which cards the customer opened** ("Подробнее →"). KPIs: dialogs, cards shown, cards opened, open rate (opened ÷ shown), plus the most-opened products. Period: today / 7 / 30 / 90 days, with search by message text or article. Visible to both dashboard logins; session IDs are admin-only, same as the Analytics tab.

How it works:
- **Widget** (`widget/chat-widget.js`, `logEvent()`) posts 3 event types to the new public endpoint **`/api/session/event`**:
  - `first_message`: sent right after the session is created. The session is created only after the first AI reply, so this is the earliest point.
  - `products_shown`: new carousels only, not replayed history.
  - `product_open`: via `sendBeacon` on the card link click, because the click opens a new tab. Also attached to cards replayed from a restored chat.
- ⚠️ **Beacons must be `text/plain`, not `application/json`** (fixed the same day, after the first live test showed no clicks). `sendBeacon` sends cookies, and a JSON beacon triggers a CORS preflight that our `Access-Control-Allow-Origin: *` can't satisfy for credentialed requests, so the browser silently drops it. The session-**end** beacon (chat duration on tab close) had the same old bug. `server.js` now parses `text/plain` under `/api/session`, and `event.js`/`end.js` accept a JSON string. A Playwright test with `page.route()` does **not** catch this, because Playwright answers preflights itself. Test with a real server on a second origin.
- **Storage:** new Postgres table **`chat_events`** (`session_id, type, data jsonb, created_at`), **created automatically** on first use via `SUPABASE_DB_URL`. No migration needed. Code in `lib/chatEvents.js`.
- **Endpoint safety:** strict validation (session-ID format, 3 known types, field length caps, max 12 products, only http(s) URLs) and an in-memory rate limit of 60 events/min per IP. Logging failures never break the chat.
- **Dashboard data:** `/api/dashboard/product-views` (`POST {password, days}`), joined with `chat_sessions` for date/time and the manager flag. Dates come from `chat_sessions` (UTC, like the Analytics tab).
- **Data starts from the deploy.** Older chats have no events. Browsers cache the widget for up to 1 h, so the first hour after deploy may miss some events. An "opened" card without a logged "shown" event is still listed, and counts in "opened" but not in the rate.
- Tests: an in-memory Postgres emulator (pg-mem) for the endpoints, the real `server.js` on a second origin with headless Chromium (old widget lost the clicks, fixed widget delivers them), and a rendered dashboard with test data. **Confirmed live by the project owner on Oct 19:** opened cards show green with ✓.
- **Commits:** `cf3bedb` (tab + tracking), `ede2350` (beacon fix), `f70be7b` (teasers once).

**Also session 15: widget clean-up** (`widget/chat-widget.js`):
- **Removed the "keep warm" ping.** Every open tab with the widget called `GET /api/chat` every 4 minutes, a Vercel-era trick against cold starts. It's useless on the always-running Coolify container, and was just traffic from every visitor tab.
- **Product card fields are sanitised.** Card data comes from the AI's reply, so `safeUrl()` allows only http(s) links/images (http is upgraded to https; `javascript:`, `data:` etc. are dropped), and all values put into HTML are escaped (`escHtml` now escapes `'` too). Price and stock are converted to numbers. Tested with a reply containing a `javascript:` link, a `data:` image, a quote-injection link and junk price/stock: no script ran, and normal cards and click tracking still work.
- **Leftover placeholders replaced** (`TODO_COMPANY_NAME`, `TODO-YOUR-PROJECT.vercel.app`, TODO comments). The header now shows the real embed snippet. The `AGENT_URL` fallback is the live server instead of a placeholder.

**Also session 15: teaser bubbles once per visit.** The two greeting bubbles ("Здравствуйте! Я ИИ-консультант…" / "Подберу деталь…") plus the badge used to appear on **every page load**, including each product page opened from a card in a new tab, which was irritating on mobile. Now they show **once per visit**: only when the visitor comes to the site after being away **more than 30 minutes** (`TEASER_IDLE_MINUTES`). "Last seen on the site" (localStorage `pc_last_seen_at`) is refreshed on every page load, every minute while a page is visible, and on leaving a page (`pagehide`). So within a visit (product pages, new tabs, after chatting) they stay hidden, and after a break they greet again, even if an old conversation is still saved. If localStorage is blocked they're not shown at all. History: first built as "once per 7 days" (`f70be7b`), changed to 30 minutes on the owner's request.

### ✅ Status (session 14, Oct 17 evening) — start here

**Live on `main` (Laximo code up to `8c86806`; later commits are README only):**
- **VIN path:** VIN → client's Laximo catalog on bmwclub77.ru → exact OEM numbers → catalog cards, or the OEM number offered via a manager when not in the price feed. **Confirmed working live** (Oct 16, and again Oct 17 after the exemption): XM G09 (`11429453682`), and E70 40d with oil filter, a full maintenance set, cards, and correct "под заказ" wording.
- **Model path (no VIN):** fills in the site's parameter search (Серия → Тип кузова → Модель → Руль → Рынок) from the customer's words, with clarification buttons. **Confirmed working live on Oct 17** after the exemption. Before that it hit 403s: first a stale-token bug (fixed in `d098591`), then the bot protection (history below).
- **Safeguards** (`8c86806`): browser-check detection with a 6 h pause, an hourly request budget of 60, 3 s pacing, separate breakers. While Laximo is off or paused, the agent doesn't ask for a VIN.
- `LAXIMO_ENABLED` in Coolify was set back to on (or removed) for the Oct 17 tests. The switch still works: set it to `false` and redeploy to turn Laximo off again.

**History, the block on Oct 16→17 (resolved):** from about 00:00 MSK on 17.10, every `/laximo` page (VIN search included) returns **HTTP 403 "Мы проверяем ваш браузер"** to our server (168.222.202.222). This is ABCP's platform-level JavaScript browser check. Real browsers pass it automatically; we don't run JS and **must not try to get around it**. It most likely escalated because of the evening's test volume. **The client's site settings have no IP whitelist for it:** ABCP admin → Настройка → Система → "Защита от ботов" only chooses the captcha type (Ввод цифр / reCAPTCHA / SmartCaptcha). Leave that page as is. **Resolved on Oct 17: ABCP support exempted 168.222.202.222 from the browser check.** Laximo was then switched back on and tested.

**Requests to providers:**
1. ✅ **ABCP support:** exempt 168.222.202.222 from the browser check for `/laximo`. **Granted on Oct 17.** Support hours: Mon–Fri 08–19, Sat–Sun 09–18 MSK.
2. *(Optional now, no longer blocking)* **Laximo via Technology Trade (technologytrade.ru/oem) or lk.laximo.ru:** does the client's Laximo account include **web-service/API** access, is there an IP restriction (add 168.222.202.222), what are the request limits, and where are the API docs? ⚠️ This message was drafted for Laximo. Don't send it through the ABCP form, since ABCP can't grant Laximo API access.

**Findings in the ABCP admin, important for the next step:**
- **ABCP admin → Настройка → Каталоги → Laximo** shows the client's **own Laximo account** (login + password from Laximo). ABCP's servers use it to load the catalog from Laximo. **If that account has API access, the best fix is to call Laximo's API directly** (`FindVehicleByVin`, wizard/`FindVehicleByWizard2`, `ListUnits`, `ListDetailByUnit`, `ListQuickGroup`/`ListQuickDetail`, `FindReplacements`; PHP/Ruby client libraries exist). That means no site scraping, no bot check, no robots.txt issue, and structured data. Plan: keep the chat flow and rewrite only the data layer in `lib/laximo.js`. **Credentials go ONLY into Coolify env vars** (`LAXIMO_LOGIN`, `LAXIMO_PASSWORD`), never into code or this README.
- Same page: **"Доступ: Только для зарегистрированных…"**, meaning the catalog on the site is for logged-in customers only. It's unclear whether this was set recently. Ask the client. While it's set, guests can't use the catalog on the site, and the scraper (not logged in) couldn't either, even after an ABCP exemption.
- **ABCP server IPs** for outgoing requests to suppliers/catalogs: **188.127.248.138 / .142 / .155 / .163** (ABCP help article "IP-адреса для онлайн проценки"). The client's Laximo account is probably restricted to these, so our IP would need adding at Laximo.
- **ABCP's own API** ("Данные для доступа к API" in ABCP help) is the client's shop data: article search, prices, availability. Possible future use: price and availability for **any OEM number**, not just the ~20k products with photos in the feed. Example: service kit `88005B65469`, 11 900 ₽ "под заказ", which isn't in the feed because it has no photo.

**Found later that night: ABCP ticket history from when Laximo was connected (Oct 6–15, 2026).** This is important:
- Laximo was bought from the rights holder **Technology Trade** (https://technologytrade.ru/oem/). **Send the Laximo/API questions to them**, or via the client's Laximo dashboard **lk.laximo.ru** (login is the client's order email; the password was initially set equal to the email — **the client should change it**).
- The `am193599` login is described there as "доступ к сервисам Laximo.Cat", i.e. likely a service/API account. Direct API access looks plausible; still to be confirmed by Technology Trade.
- ⚠️ **Laximo bills per request, and "запросы от робота и от пользователя тарифицируются одинаково".** Every `/laximo` page our bot opened counted against the **client's paid quota**. Before re-enabling (by site or API): (a) check tonight's usage and the tariff/limits in lk.laximo.ru; (b) get the client's OK on the bot's expected usage; (c) consider lowering `LAXIMO_MAX_REQUESTS_PER_HOUR` to fit the tariff. Caching (30 days) is the main cost saver. This is also likely why the catalog's access is set to "только для зарегистрированных".

**Laximo quota (client's Laximo dashboard, lk.a-motive.ru, seen 17.10 ~01:40):** licence "OEM, OEM: Авто по госномеру", **14 750 ₽/month**, billing date the 9th. **Only 1 000 OEM requests per month** (plus 1 000 licence-plate searches), shared by real site customers AND the bot. On 17.10 978 OEM requests were left: only 22 used despite hundreds of bot page loads, so Laximo doesn't count every page (probably vehicle lookups; check "Статистика" to confirm what counts). **Before re-enabling, add a MONTHLY bot budget** well below 1 000 (agree the number with the client) on top of the hourly cap. The 30-day cache is the main saver. Laximo's own support is "Мои заявки" in that dashboard (phone support Mon–Fri 06:00–15:00 MSK); send the API/IP questions there. "Смотреть детально" next to the bmwclub77.ru profile may show API/IP settings.

**Next steps (observation phase, a few days from Oct 17):**
1. **Leave the code as is** and watch real conversations.
2. **Watch the Laximo quota** in lk.a-motive.ru: 1 000 OEM requests/month, renewed on the 9th, shared with site customers. If it drops much faster than ~30/day, add a **monthly bot budget** (not built yet; only the hourly cap of 60 exists).
3. **Watch the logs:**
   - `DIAG laximo`: `"found":true`, `"oemCount"` > 0, and `"mode":"vin"|"model"` with the `path`.
   - `DIAG match-check`: `"source":"laximo"` vs `"compatibility-table"`.
   - `DIAG laximo-needs-choice`: the clarification questions asked.
   - `[laximo] BROWSER CHECK detected`: the block came back; the bot pauses itself for 6 h. Contact ABCP if it recurs.
4. **Check the missing-articles dashboard** for OEM numbers customers needed that aren't in the price feed.
5. After observation, open ideas:
   - for maintenance requests, search **"сервисный комплект"** first (BMW sells oil + cabin filter kits like `88005B65469`);
   - ask the client to add photos to service kits so they appear as cards;
   - possibly the ABCP API for price/availability of any OEM;
   - possibly Laximo's direct API instead of the site (see findings above), which would be more robust;
   - a monthly bot budget if the quota requires it.

**Test data:** VIN `WBS11CS0609158489` (XM 50e G09; also the site's own example VIN) and VIN `X4XZW61140L560928` (X5 40dX E70 LCI, N57S, 29.09.2010; Avtotor-built, works in Laximo). Model test: "Набор на ТО, BMW 2" → 2' G42 → 220i.

**Lessons from the Oct 16–17 live testing:**
- The part-name search page uses a *different* table from the unit page. Always get real page sources before writing parsers; the saved samples were essential.
- Parameter-search tokens are single-use per session. Never cache them.
- Even with pacing, an evening of testing was enough to get the server challenged. Keep live tests few, and prefer an official API over scraping.

**Session 14 — on-demand Laximo scraper (VIN → exact OEM numbers):**

The client connected a **Laximo** original-parts catalog to the site (`https://bmwclub77.ru/laximo`, catalog code `BMW202601`). For a VIN it shows the exact car and every OEM number from BMW's own catalog — far more reliable than the compatibility table. Decision: use it **by scraping on demand** (only when a customer gives a VIN), not via a paid Laximo API account and never as a bulk crawl (see the July crawler lockout below).

How it works (`lib/laximo.js` + changes in `api/chat.js`):
1. Haiku extraction now also returns `vin`. The system prompt tells the agent to ask BMW customers for their VIN first (СТС/ПТС).
2. With a valid VIN, `lookupLaximo()` runs **3 page loads**: `/laximo?vin=…&lp=findByVIN` → the vehicle page (reads the inline `const data = {vid, ssd, …}`) → the site's own part-name search, `lp=details&detailsQuery=<keyword>` (one per part keyword, max `LAXIMO_MAX_QUERIES`=4).
3. The OEM numbers are looked up in a **new full-catalog index** (`fetchCatalogIndex()`). The old `fetchCatalog()` only keeps products already in the compatibility table, so it can't be used for this. The matched products and their fitment records (`source: "laximo"`, plus `notes` like "Для автомобилей с … = да") replace the compatibility-table result for that turn. Missing-articles logging, product cards and oil cross-sell are unchanged.
4. **OEM found but not in the catalog feed** (e.g. no product with a photo): those numbers (max 15) go into a separate prompt section, "ОРИГИНАЛЬНЫЕ НОМЕРА ПО VIN, КОТОРЫХ НЕТ В КАТАЛОГЕ". The agent then gives the customer the exact BMW part number and offers a manager to check availability and lead time by that number, instead of just saying "not found". These numbers never appear as product cards and get no price. They are still logged to missing-articles. `DIAG match-check` shows `laximoNotInCatalogCount`. First live test (XM G09 VIN, oil filter, nothing in the price list) prompted this change.
5. **Fallback:** no VIN, VIN not found, no part named yet, a scraper error, or more than `LAXIMO_BUDGET_MS` (30s) → the normal compatibility-table path runs exactly as before. `DIAG laximo` and `DIAG match-check` (`source:` field) log which path ran.

Safeguards (because of the July 2026 lockout):
- One global request queue with a minimum gap of `LAXIMO_MIN_INTERVAL_MS` (1.5s) between requests to the site.
- Cache in memory and in a new Postgres table **`laximo_cache`** (created automatically on first use; 30-day TTL). Repeat questions about the same VIN and part cost **zero** site requests.
- Circuit breaker: after 3 consecutive failures, all Laximo requests stop for 30 min and chat falls back to the table.
- Anti-bot cookie handling (manual redirects plus a cookie jar), ported from `abcp-catalog-proxy/scripts/crawl-compatibility.js`.
- ⚠️ The site's `robots.txt` disallows `/laximo` for bots. This is the client's own site: **get the client's OK and ask them to whitelist the Coolify VPS IP (168.222.202.222)** in their anti-bot settings before enabling this in production.

**Model path, no VIN (added later in session 14):** when a BMW customer names a model and a part but gives no VIN, the bot fills in the site's parameter search ("Поиск автомобиля по параметрам") itself:
- The series list comes from the `<select>` on `/laximo?lp=catalog&c=…`. Every later step is a JSON request, `/laximo?lp=wizard&c=…&ssd=<option token>&ajax=1`, returning `{wizardSteps:[{name, determined, options:[{key, value}]}], vehicles}`. The final vehicle list is `…&searchNow=1`, in the same table layout as the VIN result. The vehicle page and part-name search are the same as on the VIN path.
- `pickWizardOption()` picks each dropdown from the customer's words. It uses exact option names (longest match wins), chassis codes for the series ("G42" → "2' G42"; only letter+2–3 digits count as a code), body-type synonyms (touring → универсал), and defaults of **left-hand drive** and market **ЕЭК**.
- When a step can't be decided, the bot asks with the catalog's own options as buttons, skipping Sonnet. Examples: "M240i" vs "M240i B58C" / "B58D" (a short name that prefixes other options is never auto-picked, since those are different engines), "X5" with no generation, and "F20" vs "F20 LCI". The clicked button comes back as text and is matched on the next turn.
- **Option tokens differ on every request and are rejected later (HTTP 403).** First live run: a cached "X5 G05" token failed after a redeploy, three times, which opened the (then shared) breaker and also blocked VIN lookups. Fix: the cache holds **option names only** (`wiz-series-v2:` and `wizv:<catalog>:<path>`), used to plan the path and ask questions without site requests. Real tokens come only from a fresh walk (`liveTo()`), which starts at the catalog page and runs in the current session, seconds apart. Final vehicles (`modelveh2:`) and vehicle pages (`modelvehpage:`) are cached as before, since the vehicle page's `vid`/`ssd` are stable like on the VIN path.
- **Separate circuit breakers:** `'wizard'` for parameter-search requests and `'core'` for VIN search, vehicle pages and part-name search. A wizard problem can't switch off VIN lookups any more. 4xx errors log the first 160 characters of the site's response.
- Bare family names are recognized: "BMW 2", "2 серия" and "2er" all offer Laximo's full list of 2-series generations (16 buttons) instead of the old table's 3.
- The prompt marks these results `matchedBy: "model"`. The agent doesn't re-ask the model, presents several numbers for one part as variants (production date or equipment), and suggests a VIN for an exact match.
- First lookup for a new model plus a maintenance request takes about 11 site requests (≈15–20 s at 1.5 s pacing); a repeat takes 0. A vague model ("3 серия 320i" with no chassis code, too many generations for buttons) falls back to the old path, where the agent asks in its own words.
- Only BMW (`extracted.brand` matches bmw/бмв). Other brands still use the compatibility table.
- **Not yet verified live:** the step JSON *after* a model or steering choice (only the step after the series was seen), and series whose steps differ (e.g. with a transmission step). Watch `DIAG laximo` (`"mode":"model"`, `path`) and `DIAG laximo-needs-choice`.

**⚠️ Oct 16 late evening: the site's bot protection started challenging this server** *(resolved Oct 17: ABCP exempted the IP; Laximo is back on)*. After an evening of testing (several hundred requests plus 403 retries), every `/laximo` page, VIN search included, returned HTTP 403 with *"Мы проверяем ваш браузер…"*. That's ABCP's platform-level JavaScript browser check: real browsers pass it automatically, we don't run JS, and we must not try to get around it. The client's own IP whitelist evidently doesn't cover it. **Laximo was switched off with `LAXIMO_ENABLED=false`** (Coolify, then redeploy). **To do: the client asks ABCP support to exempt 168.222.202.222 from the browser check for `/laximo`.** Before switching back on, test once from the container (2 requests; both should return 200):
```bash
docker exec $(docker ps -q --filter "name=v2vsk2hijmk0nvgeubrzmkjj" | head -1) node -e "for (const u of ['https://bmwclub77.ru/laximo?lp=catalog&c=BMW202601','https://bmwclub77.ru/laximo?vin=X4XZW61140L560928&lp=findByVIN&c=BMW202601']) fetch(u).then(r=>console.log(r.status,u))"
```

**Safeguards added afterwards** (`lib/laximo.js`):
- **Browser-check pause:** if any response contains "Мы проверяем ваш браузер", ALL Laximo requests stop for `LAXIMO_CHALLENGE_PAUSE_HOURS` (6). The log shows `[laximo] BROWSER CHECK detected`. The pause is stored in `laximo_cache` (`state:pause-until`), so a redeploy doesn't lift it; `/api/admin/clear-cache` does. Normal pages never contain the phrase (checked on all saved sources).
- **Hourly budget:** at most `LAXIMO_MAX_REQUESTS_PER_HOUR` (60) requests to the site in any rolling hour; beyond that, lookups are skipped and the chat uses the table.
- **Pacing:** `LAXIMO_MIN_INTERVAL_MS` default raised from 1500 to **3000**. Trade-off: a first-time maintenance request by *model* (~11 requests ≈ 33 s) exceeds `LAXIMO_BUDGET_MS` (30 s). That one message falls back to the table while the lookup finishes in the background, and the next message is served from cache.
- Skips (pause, budget, breaker) never count as site failures, so they don't feed the breakers.
- While Laximo is disabled, paused or over budget, the agent **doesn't ask for a VIN**. If the customer gives one, the agent says the VIN lookup is temporarily unavailable and offers to pass the VIN to a manager. It does **not** say "VIN not found": `findPartsByVin` returns `{ unavailable }`, which is distinct from `null` (not found).

New env vars (all optional): `LAXIMO_ENABLED` (set `false` to switch off; needs a redeploy), `LAXIMO_MAX_REQUESTS_PER_HOUR` (60), `LAXIMO_CHALLENGE_PAUSE_HOURS` (6), `LAXIMO_CATALOG` (default `BMW202601`; **update it when the site's `c=` value changes** after a catalog release), `LAXIMO_SITE_URL`, `LAXIMO_MIN_INTERVAL_MS`, `LAXIMO_MAX_QUERIES`, `LAXIMO_BUDGET_MS`, `LAXIMO_CACHE_TTL_DAYS`, `LAXIMO_REQUEST_TIMEOUT_MS`.

New dependency: `cheerio`, **pinned to 1.0.0**, the last version that supports Node 18 (the Docker image is `node:18-slim`). Newer versions need Node ≥20.18.

**Not yet verified, check these first:**
- ✅ (fixed in a follow-up commit, same session) The **part-name search results page** uses a *different* table from the unit page: columns `OEM | Наименование детали | Схема`, OEM links to `/search?pcode=<OEM>`, and no qty, position, unit or notes. The first version of `parsePartRows` assumed the unit-page layout and would have returned **zero rows** on every search. It now finds columns by header text and handles both layouts, verified against a saved search page. Laximo's search matches by word: "масляный фильтр" found "К-т сменного элемента масляного фильтра" (X5 50iX → `11427583220`). How well other Russian keywords match is still worth watching in the logs (`"oemCount":0` = nothing found).
- The first live run from the VPS: watch for `DIAG laximo` lines and `[laximo]` errors.
- The parameter wizard path (no VIN) isn't supported yet. Units that need an equipment option ("Уточнение параметров автомобиля", e.g. S8TFA) only appear on that path.

To check the parsers after a site redesign: `node scripts/test-laximo-parsers.js <folder with vin.html, vehicle.html, unit.html, details.html>`.

**Session 13 — fixed and confirmed the compatibility catalog's real update process (`scripts/push-compatibility-to-supabase.js`):**

Investigated "how does the compatibility catalog get updated when I push to GitHub" — the honest answer turned out to be **it doesn't, and that's fine by design**. Found:

1. **`.github/workflows/refresh-compatibility.yml`'s schedule is already disabled**, with a comment explaining why: `Compatability_catalog.json` is no longer committed to git/LFS, so the workflow has nothing to check out even if manually triggered via `workflow_dispatch`. **Confirmed via direct user testimony: this workflow, and the automatic-refresh approach in general, has never actually worked.** Real updates happen by running `scripts/push-compatibility-to-supabase.js` **locally**, which connects directly to Supabase Postgres and replaces the whole `compatibility` table in one transaction — this was always the real (manual, not automated) process, just not written down anywhere until now.

2. **`.github/workflows/refresh-catalog.yml`** (the *catalog*, not compatibility, workflow — easy to confuse the two similarly-named files) was found to still be calling the **old Vercel URL** (`https://abcp-catalog-proxy-delta.vercel.app/api/refresh-catalog`), confirming it's been non-functional since the Coolify migration. Fully superseded by session 12's in-process scheduler regardless. **Both `refresh-catalog.yml` and `refresh-compatibility.yml` are candidates for deletion** — recommended, not yet done as of this session, since neither does anything useful in its current form and their presence is more likely to confuse a future session than help one.

3. **`scripts/push-compatibility-to-supabase.js` had the identical SSL bug** as `chat.js` (session 10) and the catalog refresh scripts — hardcoded `ssl: { rejectUnauthorized: false }`, incompatible with self-hosted Postgres. **Fixed:** changed to `ssl: false`.

4. **`env.local` (the project's local-only env file) was missing `SUPABASE_DB_URL` entirely** — only had `ABCP_EXPORT_URL`. Added the missing line, pointing at the self-hosted instance:
   ```
   SUPABASE_DB_URL=postgresql://postgres.your-tenant-id:h7QXHfD40buenTZ9kdptHr45WJWcTAX@77.222.47.140:6543/postgres
   ```

5. **Plain `node scripts/...` does NOT read `env.local` automatically** — the script has no `dotenv`-style auto-loader. Node's built-in `--env-file` flag (Node 20.6+) is required:
   ```powershell
   node --env-file=env.local scripts/push-compatibility-to-supabase.js
   ```

**Confirmed working end-to-end:** ran successfully, `Flattened 63681 vendor codes into 1208806 rows` → `Successfully replaced compatibility table with 1208806 rows`. Notably, this local catalog has **grown significantly** since the original migration (63,681 vendor codes vs. 21,554 seen in a live fetch shortly after migration) and now includes non-BMW brands (Audi, Mercedes, Land Rover, VW models) alongside BMW — confirms the local editing workflow has been actively used and is genuinely the live source of truth.

**The real, confirmed-working process going forward, no automation involved (by design, this data doesn't change often enough to need it):**
1. Edit `Compatability_catalog.json` locally
2. Run `merge-compatibility.js` if that's still part of the flow (merges/dedupes before pushing)
3. `node --env-file=env.local scripts/push-compatibility-to-supabase.js`
4. Optionally `git push` afterward — purely for backup/version history of the JSON file, does not trigger anything on its own

**Contrast with the catalog/pricelist refresh (session 12):** that one genuinely needed automation (live feed, changes constantly) and got the in-process 6h scheduler. This one (compatibility data) is a manual, deliberate curation process and correctly stays that way — don't rebuild automation for it without a real reason to.

**Session 12 — replaced abcp-catalog-proxy's GitHub Actions refresh cron with an in-process scheduler:**

`abcp-catalog-proxy` was refreshing its `catalog_cache` table (populated from the live ABCP YML export at `https://bmwclub77.ru/get_price?...`) via a GitHub Actions cron job calling `api/refresh-catalog.js` every 6h — a pattern inherited from when the app ran as Vercel serverless functions with no persistent process to schedule its own work.

**Two problems with this, both real:**
1. **Confirmed risk (not yet confirmed as having actually happened, but plausible and worth checking):** the GitHub Action authenticates via its own separate GitHub Actions Secrets store, completely independent of Coolify's env vars. When `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` were updated in Coolify during the self-hosted Supabase migration (session 10), there's no guarantee the GitHub Actions secrets were updated to match — they could have been silently still writing to the old Cloud Supabase's `catalog_cache` table instead of the new self-hosted one. **Not fully verified whether this actually occurred; worth checking GitHub Actions run history/logs from around the migration date if catalog staleness is ever suspected.**
2. **Unnecessary now that the app is self-hosted on Coolify as a persistent container** — it doesn't need an external scheduler poking an HTTP endpoint anymore; it can just schedule its own recurring work in-process.

**Fixed:** extracted the fetch-XML/parse/upsert-to-Supabase logic out of `api/refresh-catalog.js` into a new shared module, `lib/refreshCatalogCore.js` (deliberately placed *outside* `api/` so `server.js`'s auto-mount-every-file-as-a-route logic never turns it into an accidental endpoint). `server.js` now calls this directly on startup (so a fresh deploy/restart doesn't serve a stale or empty cache while waiting for the first scheduled tick) and then every 6 hours via `setInterval`. `api/refresh-catalog.js` still exists, slimmed down to a thin `REFRESH_SECRET`-protected HTTP wrapper around the same shared function — kept intentionally as a manual/backup trigger (forcing an immediate refresh without waiting up to 6h, or as a fallback if the in-process scheduler is ever disabled).

**Confirmed working:** first deploy's logs showed the startup refresh firing immediately and succeeding — `[catalog-refresh] Done: 19803 products, source updated=null` (the `updated=null` is the ABCP feed's own `shop.date` field not being present/parsed, unrelated to this change, not investigated further).

**Follow-up, not yet done:** the GitHub Actions workflow (`.github/workflows/refresh-catalog.yml`) in the `abcp-catalog-proxy` repo can now be disabled/deleted — it's fully redundant with the in-process scheduler. `REFRESH_SECRET` env var must stay in Coolify though, since the manual-trigger endpoint still needs it.

**Pattern worth reusing for future apps:** any app migrated from Vercel that had a GitHub Actions cron job calling one of its own endpoints on a schedule should get this same treatment once self-hosted as a persistent container — extract the core logic to a shared module, call it via `setInterval` from `server.js`, keep the original endpoint (if any) as an optional manual/backup trigger. Removes an entire class of secrets-drift risk between two separate config stores (GitHub Actions Secrets vs. Coolify env vars).

**Session 11 — found and fixed the remaining zero-match bug (4 stacked, independent causes):**

Session 10 left one open bug: compatibility matching returned zero results end-to-end even after the SSL fix. Turned out to be **four separate, independent bugs stacked on top of each other** — each one had to be fixed before the next became visible. In order of discovery:

1. **(Already fixed in session 10)** Forced SSL on the `pg` Client, incompatible with self-hosted Postgres having no SSL configured.

2. **`normalizeModel()`'s xDrive-stripping regex was asymmetric.** `\bXDRIVE\b` requires a word boundary on *both* sides to strip "xDrive" out of a model string before token-matching. Haiku's extraction sometimes fuses the trim directly to the following digit with no space (`"xDrive30d"`, not `"xDrive 30d"`) — a letter→digit transition is NOT a regex word-boundary, so the trailing `\b` silently fails to match there, while the *catalog's* `modificationName` field always stores "xDrive" as its own separate word (spaces on both sides), where the strip works correctly. Result: the user's normalized string kept a literal `XDRIVE` in it that the catalog's never had, so they could never match as substrings — for every single BMW xDrive vehicle in the whole dataset, Cloud or self-hosted, this whole time (this was **not** introduced by the migration — same bug would have existed on Cloud too, just apparently never hit by session 9's specific test wording). **Fixed:** changed to `\bXDRIVE` (boundary only required before, not after) in `normalizeModel()`. Verified against the existing documented edge cases in the code's own comments (X5 M, 1M E82, xDrive35i) — no regressions.

3. **This fix alone still wasn't enough** — added temporary trace logging (`isTraceTarget` in `matchCompatibility()`, since removed) which proved the matching logic itself was now working correctly: real hits were found (`PASSED ALL CHECKS`) for genuinely correct vendorCode/vehicle combinations. Yet the outer diagnostic (`vehicleMatchedCount`) still showed 0. Traced this to `vehicleMatchedCount` being computed *after* intersecting `matchCompatibility()`'s output against `catalogParsed` (the live ABCP feed) — i.e., a compatibility match is only "real" to the customer if that same vendorCode also has a live, photo-having catalog entry. This intersection is intentional, documented behavior (see "Compatibility matching architecture" / `missing_articles` sections below), not a bug — but it meant the actual remaining problem was upstream of matching entirely: **`catalogParsed` itself was empty**.

4. **Root cause: `CATALOG_API_URL` pointed at a dead internal Docker hostname.** Per session 9's own note (see below, now superseded), `car-parts-ai-recommendation`'s `CATALOG_API_URL` was set to `abcp-catalog-proxy`'s **internal Docker container hostname** (`http://<container-name>:3000/api/catalog`). Coolify appends a unique numeric suffix to each container name that **changes on every redeploy** (confirmed no stable network alias exists — `docker inspect ... Aliases` showed only the same changing suffix-name, nothing persistent). The env var still referenced an old, long-gone suffix from a previous deploy; the hostname simply didn't resolve anymore, `fetch()` failed, and a **silent `catch {}` in `fetchCatalog()`** (same class of bug as the three DB functions patched in session 9 — this one just hadn't been touched yet) swallowed the failure completely, silently returning `'[]'` every single time. This meant **the AI agent had zero pricelist/catalog access for an unknown period, regardless of how correct compatibility matching was** — every genuine vehicle match was being reported as "missing" by the gap-tracker even for parts with full photo/catalog coverage. **Fixed two ways:** (a) switched `CATALOG_API_URL` to the stable public domain instead of internal networking — `http://yydf0jmeqrhxnmrpff75ngc7.168.222.202.222.sslip.io/api/catalog` (goes through Traefik, immune to container-name churn on redeploy — internal Docker networking is **not safe to hardcoded-reference here going forward**, there is no stable alias to use instead); (b) added real error logging to `fetchCatalog()`'s catch block (was completely silent before) so this exact failure mode can never hide again.

**Confirmed working end-to-end** with a live customer conversation (BMW X5 F15 xDrive30d, N57D30A engine, 258hp) surfacing real matched parts (oil filter `11428507683`, air filter `13718518111`, fuel filter `13327822499`, glow plug, etc.) with correct prices, stock status, and fitment description.

**Diagnostic logging added this session, left in place (not temporary):**
- `fetchCatalog()`'s catch block now logs the real error + which `CATALOG_API` URL it tried + whether falling back to stale cache or empty array
- (Session 10's three DB-function catch-block logs from before are also still in place)

**Diagnostic logging added and then removed this session (was temporary, for this specific investigation):**
- A `DIAG compatibilityData-fetch` block logging fetched vendorCode counts/samples
- `isTraceTarget`-gated per-record filter tracing inside `matchCompatibility()`'s loop (logged brand/model/engine/year pass-fail per candidate record for one specific test vendorCode)

Both were essential for finding the bug chain above but added no lasting value once found — removed cleanly before final deploy.

**Session 10 — self-hosted Supabase migration:**
- Installed self-hosted Supabase (Docker Compose, official `supabase/supabase` repo) on **`assistant_vps_3`** (same VPS session 9 provisioned for DB, previously idle). Envoy gateway (this version replaced Kong) on port `8000`, Supavisor pooler on `5432` (session mode) and `6543` (transaction mode), Postgres 17.6. Studio dashboard: `http://77.222.47.140:8000`, login `assistant24_supabase` / `kiQhvYnT1ks2vFmC9LVk` (**not yet behind HTTPS or IP-restricted — flagged as a TODO, don't leave exposed long-term**).
- `.env` secrets generated fresh (not left as placeholders) — `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`/`SERVICE_ROLE_KEY` (HS256 JWTs signed with the JWT_SECRET via a one-off Python script, not the Supabase CLI). **Exception: `POOLER_TENANT_ID` was left as the literal placeholder `your-tenant-id`** — works fine functionally (Supavisor routes on it same as any real value), just not a meaningful name. Low priority to rename; would require updating `SUPABASE_DB_URL` everywhere if changed later.
- Migrated via `pg_dump`/`pg_restore` (custom format, `--no-owner --no-privileges`, restored to `--schema=public` only — deliberately did NOT touch `auth`/`storage`/`realtime` schemas, which the fresh self-hosted stack already created its own copies of). **Cloud's connection string uses port `6543` (transaction-mode pooler) — must switch to `5432` (session mode) for `pg_dump` itself**, transaction pooling doesn't hold the session state a dump needs and fails/hangs on large tables otherwise.
- **Real row count is ~1.21M (`1,212,611` exactly at migration time), NOT ~15.9M as session 8 estimated.** The 15.9M figure was a stale planning estimate from before the crawler was abandoned and the compatibility table was rebuilt manually (see session 8) — it was never updated after the real (smaller) dataset landed. Confirmed via direct `count(*)`, disk-size comparison (Cloud 487MB vs local 478MB, matches), and reconciled against the local `Compatability_catalog.json` line count (15.8M lines ÷ ~13 lines/record ≈ 1.22M records, consistent). **No data was lost — update any future planning docs that still cite 15.9M.**
- All 6 tables (`compatibility`, `chat_sessions`, `manual_products`, `push_subscriptions`, `missing_articles`, `compatibility_cache`) restored with row counts verified matching Cloud exactly. `bump_missing_article()` RPC and all three `compatibility` indexes (`idx_compatibility_series`, `idx_compatibility_series_vc`, `idx_compatibility_vendor_code`) confirmed present via `pg_indexes` (NOT via `\d` + `grep`, which gave a false-empty result once — use the system catalog directly if double-checking).
- Cross-VPS pooling verified working (`assistant_vps_4` → `assistant_vps_3`, both `5432` and `6543`) — this resolves the IPv4/IPv6 pooling risk flagged in session 8's plan; no issue found.
- **Coolify env vars updated for both apps** (see updated lists below) — note Coolify has **separate Production and Preview env var sets**, easy to update only one and think you're done; both need to match.
- **New recurring problem discovered: `github.com` (port 443 specifically) is intermittently unreachable from `assistant_vps_4`**, causing ~4 of Coolify's deploy attempts to fail today with `git ls-remote` timeouts (codeload.github.com, api.github.com, raw.githubusercontent.com all reachable fine — selective to the main domain, same category of block as the existing Anthropic-from-Russia issue). Spent significant time chasing a wrong theory (Docker network IPv6 misconfiguration on the `coolify` bridge network — recreated it IPv6-disabled, which is a harmless change that's still in place, but did NOT fix the real issue). Confirmed via SSH (port 22 to github.com works reliably) that a proper fix exists — **switch Coolify's git source from the current GitHub App/HTTPS integration to SSH deploy keys** — but Coolify only offers GitHub App / GitLab App as installable "Source" types; SSH/deploy-key access requires each app to be a different *resource type* ("Private Repository with Deploy Key"), which would mean recreating both apps' Coolify resources from scratch (build settings, domains, env vars). **Deliberately deferred as a separate follow-up task**, not done this session. For now: retry failed deploys, they usually succeed within 1-3 attempts. Two deploy keys already generated and added to both GitHub repos (`~/.ssh/github_deploy_key*` on `assistant_vps_4`) in case the follow-up task picks this up directly rather than starting over.
- **Found and fixed a real bug while testing the migration end-to-end**: `chat.js`'s three direct-Postgres functions (`fetchCompatibilityVendorCodes()`, `fetchCompatibilityBySeries()`, `fetchCompatibilityByVendorCode()`) all hardcoded `ssl: { rejectUnauthorized: false }` on the `pg` Client — required for Supabase Cloud, but the self-hosted Postgres/Supavisor has no SSL configured at all and flatly rejects SSL-negotiated connections ("The server does not support SSL connections"). This was invisible before session 9's logging fix (catch blocks were silent) but surfaced immediately as a clear error message this time. **Fixed: changed all three to `ssl: false`.** Committed and deployed.
- **Remaining bug, not yet fixed: compatibility matching still returns zero results end-to-end**, even though the SSL fix confirmed resolved the DB connection (no more `DB error` log lines) and the data is verifiably present and correctly queried (`SELECT count(*) FROM compatibility WHERE series = 'X5'` → `144395` rows on the live self-hosted DB). Live test transcript (BMW X5 F15 xDrive30d, N57D30, 258hp, 2013, diesel) shows `fetchCompatibilityBySeries('X5')` presumably returning real data now, but `matchCompatibility()` downstream still reports `vehicleMatchedCount: 0, finalMatchedCount: 0`. **Root cause not yet found** — ruled out: DB connectivity, missing data, wrong column names (`vehicle` column is `jsonb`, consistent with how it's presumably always been, not introduced by this migration). Next session should start by reading `matchCompatibility()`'s actual matching logic against the real shape of a `vehicle` jsonb row and the normalized vehicle string (e.g. `X5F15XDRIVE30D`) being compared against it.

**What's done as of session 9:**
- Both VPS provisioned via spaceweb.ru: `assistant_vps_3` (DB VPS — 6 vCPU/12GB RAM/80GB NVMe, IP `77.222.47.140`) and `assistant_vps_4` (Coolify VPS — 4 vCPU/8GB RAM/80GB NVMe, IP `168.222.202.222`), both Saint Petersburg datacenter, both with SSH-key-only access (private keys held locally, not committed anywhere).
- Coolify v4.3.23 installed on `assistant_vps_4` via the one-line installer, GitHub App connected (name: "My-Git-Hub"), dashboard reachable at `http://168.222.202.222:8000`. `.env` backup saved locally per Coolify's own warning at install time.
- **`car-parts-ai-recommendation`** deployed as a Coolify app (Dockerfile build pack — Railpack does NOT work for this repo's Vercel-serverless-function shape, must be set explicitly every time a Coolify app is created from this repo). Both Vercel-only source files (`server.js`, `Dockerfile`) added to the repo; `package.json` updated with `express` dependency + `start` script; `api/Safe/chat.js` backup folder deleted. `server.js` auto-discovers and mounts every `api/**/*.js` handler by walking the directory (skips `_lib/` and `Safe/`) — no per-route hand-wiring, so new `api/` files just work on next deploy without touching `server.js`.
- **`abcp-catalog-proxy`** deployed the same way, own Coolify project. Same `server.js`/`Dockerfile`/`package.json` pattern (skips `Safe/` only, no `_lib/` in this repo). Confirmed serving real data: `/api/catalog` returns `"success":true,"total":19803` products from the Supabase `catalog_cache` table.
- **Service-to-service networking**: `car-parts-ai-recommendation`'s `CATALOG_API_URL` originally pointed at `abcp-catalog-proxy`'s **internal Docker hostname** (`http://<internal-hostname>:3000/api/catalog`, both apps on Coolify's shared `coolify` Docker network) — no longer a public internet round-trip to Vercel. This session flagged the internal hostname as per-deploy and needing a re-check if `abcp-catalog-proxy` was ever redeployed under a different container ID. **That risk materialized exactly as predicted and broke silently — see session 11.** `CATALOG_API_URL` now points at the stable public domain instead (`http://yydf0jmeqrhxnmrpff75ngc7.168.222.202.222.sslip.io/api/catalog`); do not switch this back to internal container networking, there is no stable Docker network alias to reference (confirmed via `docker inspect`), only the ever-changing per-deploy container name.
- **Anthropic reachability confirmed as expected from session 8's note**: direct `api.anthropic.com` access from this Russian VPS IS blocked (confirmed by testing), same as the other two projects. Fixed by adding `ANTHROPIC_BASE_URL` (defaults to `https://api.anthropic.com`, overridden via env var) in both `chat.js` and `session/manager.js`, and reusing the **existing** `audit.assistant24info.ru` Kazakhstan Nginx reverse-proxy vhost (`AI Senior Auditor` project's proxy, generic passthrough to `api.anthropic.com`, not project-specific) rather than standing up a new one. Set as `ANTHROPIC_BASE_URL=https://audit.assistant24info.ru` in `car-parts-ai-recommendation`'s Coolify env vars. **`abcp-catalog-proxy` does NOT call Anthropic at all** (confirmed by code review) — no equivalent fix needed there.
- **Vercel reachability confirmed NOT blocked** — plain HTTPS to `*.vercel.app` works fine from this Russian VPS (tested via Node's native `fetch` from inside the container before migrating `abcp-catalog-proxy`, got a clean `STATUS 200`). Only Anthropic's specific endpoint is blocked, not all foreign traffic — don't assume every external call needs the Kazakhstan proxy treatment; test each one.
- **Public traffic routing**: the existing `bmwclub77.assistant24info.ru` Nginx vhost (on the same KZ box, `199.189.249.4`) — previously `proxy_pass`-ing to the old Vercel deployment — now points at Coolify's Traefik on `http://168.222.202.222:80` (NOT directly at the app's port 3000 — Coolify's Traefik is the only thing actually listening on the host's public ports; hitting 3000 directly gives a 502, Traefik has to route by `Host` header). The domain `bmwclub77.assistant24info.ru` was added under this app's Domains tab in Coolify so Traefik has a matching route — **this requires a redeploy after adding the domain** to regenerate the container's Traefik labels, adding a domain alone doesn't update a running container. Coolify's own "Redirect HTTP to HTTPS" was disabled for this domain (Traefik only ever receives plain-HTTP internally from Nginx in this setup; leaving its own HTTPS-redirect on caused an infinite redirect loop — Nginx already handles the real public-facing HTTPS/SSL termination, Traefik doesn't need to enforce it again for internally-forwarded traffic).
- Live widget embed on `bmwclub77.ru` updated to point at `https://bmwclub77.assistant24info.ru` (was already this domain pre-migration, just now resolving to Coolify instead of Vercel underneath — no widget-embed-code change needed once the Nginx/Traefik/domain plumbing above was correct).
- **Root cause of "agent can't find any compatibility data" bug** (main chunk of this session's debugging time): `chat.js` connects **directly to Postgres** (`pg` library, `SUPABASE_DB_URL`, NOT the Supabase REST API — different from `abcp-catalog-proxy`, which does use the REST API/`SUPABASE_SERVICE_KEY` pattern) for all compatibility lookups (`fetchCompatibilityVendorCodes()`, `fetchCompatibilityBySeries()`, and a third one around line 352). **`SUPABASE_DB_URL` was never added to this app's Coolify env vars** (missed in the initial 12-var list copied over from Vercel) — and because all three of those functions' `catch` blocks are silent (no `console.error`), the failure was completely invisible in logs; the agent just always returned empty compatibility data and told customers it couldn't confirm fitment. Fixed by adding `SUPABASE_DB_URL` (direct Postgres connection string, currently still pointing at **Supabase Cloud**, not yet self-hosted) + redeploying. **Consider adding logging to those three catch blocks** before the self-hosted Supabase cutover below, so a similar failure mode surfaces immediately next time instead of silently degrading.
- End-to-end live test successful: real widget conversation (BMW X5 F15 xDrive30d, N57D30C 258hp/2013) returned correct compatibility-filtered product carousel with real ABCP prices/images/stock status and working action buttons.

**Full env var lists actually needed in Coolify (confirmed working), for reference if either app is ever redeployed fresh:**

`car-parts-ai-recommendation`:
```
ANTHROPIC_API_KEY
ANTHROPIC_BASE_URL=https://audit.assistant24info.ru
SUPABASE_URL
SUPABASE_SERVICE_KEY
SUPABASE_DB_URL          ← the one that was missing, caused the compatibility bug above
CATALOG_API_URL=http://<abcp-catalog-proxy internal hostname>:3000/api/catalog
DASHBOARD_ADMIN_PASSWORD
DASHBOARD_CLIENT_PASSWORD
WEBPUSH_VAPID_PUBLIC_KEY
WEBPUSH_VAPID_PRIVATE_KEY
WEBPUSH_VAPID_SUBJECT
PORT=3000
```

`abcp-catalog-proxy`:
```
ABCP_EXPORT_URL
SUPABASE_URL
SUPABASE_SERVICE_KEY
REFRESH_SECRET
PORT=3000
```

**Standing gotchas worth remembering for the next session (all cost real debugging time this session, will recur on any future Coolify app in this setup):**
1. New Coolify app defaults to **Railpack** build pack even when Dockerfile was selected during initial setup — always double-check/re-set to **Dockerfile** in the app's Build Pipeline settings before first deploy.
2. **Env vars added/changed in Coolify do NOT apply to the currently-running container** — a redeploy is required every time. Same is true for **domains added after the first deploy** (Traefik labels are baked in at deploy time).
3. Coolify apps only expose their port to Traefik internally — anything proxying to a Coolify app from outside (like the KZ Nginx vhosts here) must target **port 80/443 with the correct `Host` header**, never the app's raw container port directly.
4. `docker exec`'d containers in this `node:18-slim` image have neither `curl` nor `wget` — use `node -e "fetch(...)"` for quick in-container network tests instead.

---

## NEXT STEP (not started yet) — self-hosted Supabase on `assistant_vps_3`

This is the actual 152-FZ data-residency fix — everything above moved compute to Russia, but the database is still Supabase **Cloud** (foreign-hosted) for both apps; `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`/`SUPABASE_DB_URL` all still point there. `assistant_vps_3` (77.222.47.140, 6 vCPU/12GB/80GB) is provisioned and idle, nothing installed on it yet.

Per session 8's plan (still valid, nothing below contradicts it):
- Install self-hosted Supabase via their official Docker Compose method
- `pg_dump` from Supabase Cloud → `pg_restore` into the new instance, including the `bump_missing_article()` RPC function and all indexes (the `compatibility` table alone is ~15.9M rows — expect this to take a while and to need enough free disk for both the dump file and the restored data simultaneously)
- Re-verify pooling/connection-string behavior — confirm whether self-hosted Supabase's bundled PgBouncer needs the same IPv4-vs-IPv6 handling that Vercel's old Transaction Pooler setup needed, or whether Coolify's networking sidesteps that constraint entirely (untested, don't assume)
- Once migrated, update `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` / `SUPABASE_DB_URL` in both apps' Coolify env vars to point at the new self-hosted instance, redeploy both
- `abcp-catalog-proxy`'s `REFRESH_SECRET`-protected `/api/refresh-catalog` endpoint is still being triggered by GitHub Actions (`refresh-catalog.yml`) pointed at the **old Vercel URL** — needs repointing to the new Coolify address as part of this same cleanup pass (not strictly blocked on the Supabase migration, could be done anytime, just hasn't been yet)
- Same for `refresh-compatibility.yml`, though per session 7's notes its schedule is already disabled (`workflow_dispatch`-only) — low urgency
- Add logging to the three silent `catch` blocks in `chat.js`'s compatibility-fetch functions (see bug writeup above) before cutting over the DB connection, so any connection issue during/after the Supabase migration is immediately visible rather than silently degrading the agent's answers again
- Old Vercel deployments for both apps: keep live as rollback option for now, don't decommission yet
- Still fully unresolved: the pseudonymization/legal question in session 8's block below — self-hosting the DB doesn't touch this

---

**Previous update:** 2026-09-19 (session 8) — **Infrastructure decision made: migrating off Vercel + Supabase Cloud to self-hosted Russian VPS infrastructure, for 152-FZ/242-FZ data-residency compliance** (Russian personal-data-localization law — customer phone numbers collected by this agent for manager handoff are personal data, and Vercel/Supabase Cloud are both foreign-hosted; not previously addressed). **This app is the FIRST of three internal projects to migrate — start here.** No code changes made this session; this was infrastructure planning only, across all three projects together (this one, `AI Senior Auditor`, and `АвтоСтрой` equipment rental) — decisions below apply to all three, but this file only tracks this app's own migration.

**Two new VPS being ordered now** (Russian hosting provider: spaceweb.ru, already have an account there running another project on their Serverless beta):

1. **Coolify VPS** — replaces Vercel, hosts all three apps' deployments (this one + the other two above) as separate Coolify "applications," each own domain/env vars. **Spec: 4 vCPU / 8GB RAM / 60-80GB SSD.** Install via Coolify's official one-line installer (`curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`), connect to GitHub for git-push auto-deploy, same env var set as today's Vercel deployment.
2. **Self-hosted Supabase VPS** — **this app IS included here, decided this session** (initially considered routing it to spaceweb's plain managed Postgres DBaaS instead, since this app's dashboard auth is just a `DASHBOARD_ADMIN_PASSWORD`/`DASHBOARD_CLIENT_PASSWORD` env-var check with no real `supabase.auth`/Storage usage — but decided to keep all three projects on one consistent self-hosted Supabase platform instead of splitting DB infrastructure across two different systems, for simpler ops: one backup strategy, one Postgres version, one place to check, even though this app itself won't use GoTrue/Storage/Realtime). This app gets its own isolated database (or its own separate Supabase stack instance, matching the "separate cluster per project" isolation preference already applied to the other two) on the shared self-hosted Supabase VPS, alongside `AI Senior Auditor` and `АвтоСтрой`.

**Target spec for this app's piece of the self-hosted Supabase VPS:** current Supabase Cloud usage is `compatibility` (~15.9M rows, indexed by `series`) + `chat_sessions` + `manual_products` + `push_subscriptions` + `missing_articles`, running comfortably today on Supabase Cloud's Small-compute/8GB-disk tier per session 3's notes — factor this into the shared self-hosted Supabase VPS's overall sizing (previously spec'd at 6 vCPU / 12-16GB RAM / 60-80GB SSD for the other two projects' stacks combined; adding this app's ~8-10GB of data plus its own light query load likely doesn't push CPU/RAM needs much further, but worth padding disk estimate slightly to account for it, and re-confirming the overall VPS spec once all three are actually sized together).

**Migration will need to address, not yet planned in detail:**
- New connection string (`SUPABASE_DB_URL`-equivalent) pointing at the self-hosted Supabase VPS instead of Supabase Cloud's Transaction Pooler — re-verify IPv4/pooling behavior works correctly from Coolify-hosted serverless-style requests the same way the old Vercel+Supabase Transaction Pooler combo did (see session 6 notes on why Direct-connection IPv6-only didn't work for Vercel; Coolify's networking may behave differently, don't assume the same constraint applies unchanged). Self-hosted Supabase should still expose a Postgres connection string in a similar shape, but confirm whether the self-hosted stack's pooler (PgBouncer, typically bundled) needs the same IPv4-vs-IPv6 handling or not.
- `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` env vars (used by `abcp-catalog-proxy`'s `api/catalog.js`/`api/refresh-catalog.js`) — since this app is now going to self-hosted Supabase (not plain Postgres), these should carry over conceptually unchanged (self-hosted Supabase exposes the same PostgREST/Kong API surface as Supabase Cloud) — just needs new URL/key values pointing at the self-hosted instance instead of Supabase Cloud's. Worth confirming this app's specific REST calls behave identically against self-hosted PostgREST, but shouldn't require a rewrite to raw `pg` queries the way a plain-Postgres target would have.
- Full data migration: `pg_dump` from Supabase Cloud → `pg_restore` into the new self-hosted Supabase instance's Postgres, including the `bump_missing_article()` RPC function (Postgres function, should migrate cleanly via dump/restore) and all table indexes
- ANTHROPIC_API_KEY / Anthropic reachability from Russia — **unconfirmed for this app.** Both other projects needed a Kazakhstan VPS reverse-proxy for direct Russia→Anthropic access (blocked otherwise) — check whether the same proxy requirement applies once this app moves off Vercel (a non-Russian host) onto the new Russian Coolify VPS. If yes, likely can reuse whichever Kazakhstan VPS/proxy setup the other two projects already have working, rather than building a new one.
- Nginx `location @fallback` proxy currently pointing at `car-parts-ai-recommendation-six.vercel.app` (see session 6) will need repointing to the new Coolify deployment's address once live
- GitHub Actions workflows (`refresh-catalog.yml`, `refresh-compatibility.yml`) currently target the Vercel deployment/`REFRESH_SECRET` — need updating for the new host, same pattern as the session 6 Vercel-to-Vercel migration

**Not yet resolved, flagged for legal sign-off before considering this migration "compliance complete":** moving the database to Russia addresses data-at-rest residency only. This agent sends customer conversation content (including phone numbers, when collected for manager handoff) to Anthropic's API, hosted outside Russia — whether 152-FZ's requirements extend to that in-transit data is a separate legal question, unresolved. The `AI Senior Auditor` project's own notes (Sept 3 session) raise the identical open question and describe a planned pseudonymization-pipeline approach (PII hash-tokenization before sending to Anthropic, reversible mapping kept in Russia) — worth evaluating whether the same approach applies here once a compliance advisor confirms it's actually needed.

**Previous update:** 2026-09-19 (session 7) — **`Compatability_catalog.json` is no longer committed to git/LFS at all** — `abcp-catalog-proxy` hit 90% of its account-wide Git LFS storage quota, traced to 347 accumulated historical commits of this file (~434MB each, "Crawl update" commits from whatever process used to commit it regularly) sitting in LFS history — Git LFS storage is billed by every version ever pushed, not just the current one, so even though the live file barely changes, repeated commits over time added up to ~150GB. (A second file, `package.zip` at ~460MB across 2 commits, was found and removed the same way — unrelated leftover, not part of the compatibility pipeline.)

**Fix applied:**
1. `git filter-repo --path Compatability_catalog.json --invert-paths --force` (then same for `package.zip`) — strips every historical version from all commits. Requires `git-filter-repo` (`pip install git-filter-repo`; not a built-in git command). This is a hard history rewrite — took a `git clone --mirror` backup first, and force-pushed afterward (`git push origin --force --all --tags`); `filter-repo` also strips the `origin` remote as a safety measure, re-add it (`git remote add origin ...`) before pushing.
2. Both files added to `.gitignore` — they're now untracked working files, same treatment `Compatability_catalog_merged.json` and `Compatability_catalog.json.bak` already had (confirmed via `git log --all --oneline -- <file>` returning empty — those two were never committed in the first place, no cleanup needed there).
3. `.gitattributes`' now-pointless `filter=lfs` rules for both JSON files removed.
4. `.github/workflows/refresh-compatibility.yml`'s 6-hour `schedule:` cron **disabled** (commented out, `workflow_dispatch` kept for manual runs) — it was doing `checkout` with `lfs: true` every 6h to feed `push-compatibility-to-supabase.js`, which no longer has a file to check out anyway now that git isn't tracking it. This also explains the correlated "Git LFS storage" GB-hr line item on the billing page (`Settings → Billing → Usage → abcp-catalog-proxy`), though bandwidth (repeated downloads) turned out to be a symptom, not the root cause — the 347-commit storage bloat was.

**⚠️ Workflow change, read before your next data update:** `push-compatibility-to-supabase.js` must now be run **manually, locally** (`node scripts/push-compatibility-to-supabase.js`, needs `SUPABASE_DB_URL` in local env) after editing `Compatability_catalog.json` — it will never again be triggered by GitHub Actions or by a `git push`, since the file no longer exists in the repo for a runner to check out. "Committing/pushing this file to git" and "pushing this data into Supabase" are two unrelated meanings of "push" that used to be the same action (via the old LFS-checkout-then-script CI step) — they no longer are. The local file itself was confirmed still present on disk from a stale local `.bak` copy (Aug 11 snapshot) after the cleanup — restored via `Copy-Item Compatability_catalog.json.bak Compatability_catalog.json` rather than re-crawling (crawling ~15.9M rows from scratch would take months given ABCP's rate limits, per session 1/existing crawl-cooldown notes above).

**Still open, not yet done:** the ~150GB of already-used LFS storage may not free up automatically just from the history rewrite + force-push — GitHub's LFS storage accounting sometimes needs an explicit server-side garbage-collection pass. Check the billing/usage page again in a few days; if "Git LFS storage" hasn't dropped, file a GitHub Support request asking them to garbage-collect orphaned LFS objects for `abcp-catalog-proxy`. Also **not yet checked:** whether `car-parts-ai-recommendation` (the other repo) has any similar large-file/LFS pattern — this session only looked at `abcp-catalog-proxy`.

**Previous update:** 2026-09-08 (session 6) — migrated both repos to a new Vercel account (old account being retired). Both projects confirmed fully working in production afterward — live widget tested end-to-end with real vehicle matching (BMW X5 E70 4.8i N62B48) and real push notification delivery.

**`abcp-catalog-proxy`** → redeployed at `abcp-catalog-proxy-delta.vercel.app`.
- Required env vars: `ABCP_EXPORT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `REFRESH_SECRET` — all reset fresh in the new project (old project's vars were Vercel "Sensitive" type, unrecoverable by design; `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` re-pulled from Supabase directly since it's the same project either way, `REFRESH_SECRET` regenerated since nothing else depends on its specific value).
- Confirmed `SUPABASE_DB_URL` and `GITHUB_LFS_TOKEN` (present in the old project's env list) are **not** needed here — neither is referenced by `api/catalog.js` or `api/refresh-catalog.js`. `SUPABASE_DB_URL` is only used by `push-compatibility-to-supabase.js`, run manually/locally per `Read_Me.txt`'s workflow (`merge.js` → `crawl-compatibility.js` → `add-compatibility.js`), never on Vercel. `GITHUB_LFS_TOKEN` isn't read by any script at all — it's a local git/LFS credential, not an app env var.
- `.github/workflows/refresh-catalog.yml`'s hardcoded target URL and its `REFRESH_SECRET` GitHub Actions secret both updated to match the new deployment — verified via a manual `workflow_dispatch` run (HTTP 200, `Refresh catalog cache #244` succeeded).

**`car-parts-ai-recommendation`** → redeployed at `car-parts-ai-recommendation-six.vercel.app`.
- Required env vars set: `ANTHROPIC_API_KEY` (new key issued, old one revoked), `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` (reused — same Supabase project as `abcp-catalog-proxy`, confirmed via `information_schema.tables` listing both repos' tables side by side), `SUPABASE_DB_URL` (freshly generated via Supabase's **Transaction pooler** connection string with the IPv4 add-on enabled — required for Vercel's serverless functions; the default Direct-connection string is IPv6-only and meant for long-lived connections, wrong fit here), `DASHBOARD_ADMIN_PASSWORD`/`DASHBOARD_CLIENT_PASSWORD` (reset to new values), `CATALOG_API_URL` (explicitly set to the new `abcp-catalog-proxy-delta` URL rather than relying on the old hardcoded fallback default).
- `BITRIX24_WEBHOOK_URL` deliberately left unset — **client no longer uses Bitrix24.** Confirmed this degrades cleanly, not silently broken: `session/manager.js` runs the Bitrix call, Supabase save, and push alert independently via `Promise.allSettled`, so the lead is still saved to `chat_sessions` (`manager_requested: true` + AI-generated summary) and still triggers a push alert even with Bitrix unconfigured. The handler's `ok` field reflects only the Bitrix outcome, but `chat-widget.js` doesn't surface that as an error — it shows the same "заявка принята, звоните напрямую" soft-fallback message either way, so customers never see a broken state.
- `COMPATIBILITY_API_URL` confirmed dead/unused — compatibility data comes from a direct `SUPABASE_DB_URL` Postgres query (`select vendor_code, vehicle from compatibility where series = $1`) inside `chat.js` itself, not any HTTP endpoint. The `api/compatibility.js` endpoint this var would have pointed to was already retired (see 2026-08-02 entry below); this fallback URL was pointing at a dead route even before the migration.
- `WEBPUSH_VAPID_PUBLIC_KEY`/`WEBPUSH_VAPID_PRIVATE_KEY` — the **original** key pair was recovered (not regenerated), so existing rows in `push_subscriptions` remained valid with zero user-facing disruption — no one had to re-enable notifications, unlike the domain migration in session 4. `WEBPUSH_VAPID_SUBJECT` set to a real monitored address (previously running on the code's generic `mailto:admin@example.com` fallback, unclear if it was ever explicitly set before).
- nginx's `location @fallback` blocks (both `:80` and `:443`, on the ISPmanager VPS) repointed from `car-parts-ai-recommendation.vercel.app` to `car-parts-ai-recommendation-six.vercel.app` — same pattern as the session 4 domain migration, `proxy_pass` and `proxy_set_header Host` both updated, verified with `nginx -t` before reload.

**Previous update:** 2026-08-16 (session 5) — fixed a real vehicle-matching bug in `matchCompatibility()` (`chat.js`): confirmed real incident, BMW X5 E53 4.4i (engine N62B44, 2005) returned zero compatibility matches (`vehicleMatchedCount: 0`) for a vendorCode (`11427511161`, oil filter) that had an exact, correctly-scoped record in the compatibility data (`X5 (E53)` / `4.4 i` / `N62 B44,N62 B44 A` / `2003/12 - 2006/09`) — series, engine code, and year all genuinely matched. Root cause: `normalizeModel()`'s punctuation-stripping step turns `.` into a space, so `"4.4i"` splits into two tokens, `"4"` and `"4I"`, instead of staying fused. The short-token guard added in session 2 (`tokenCompact.length <= 2` → require an exact match against the record's own series, to stop bare series numbers like `"3"` from accidentally substring-matching inside unrelated numbers like `"530D"`) was being applied to *every* short token in the user's model string, not just the actual series token — so the stray `"4"` left over from `"4.4i"` got compared against the record's series (`"X5"`), failed (`"X5" !== "4"`), and silently rejected the entire record even though the real series/engine/year all matched correctly. Fix: the strict short-token check now only applies to `userModelTokens[0]` (the series identifier always comes first) — non-leading short tokens fall through to the normal substring check like any other token. Verified against three cases: the original failing X5 E53 4.4i case (now matches), the original session-2 incident this guard was added for — bare "3" vs a 530D 5-series record (still correctly rejected), and a legitimate bare-series match — "3" vs a real 3-series 320i record (still correctly matches).

Likely broader impact than this one case: any vehicle whose model/trim string contains a numeric displacement fragment (`4.4i`, `3.0d`, `2.5xi`, `1.8t`, etc.) that ends up isolated as a ≤2-char token after normalization would have hit the same silent zero-match failure. **Follow-up, not yet done:** scan recent `DIAG match-check` production logs for other `vehicleMatchedCount: 0` cases with similar model strings, now that this class of failure is understood — there may be other real matches that were silently dropped before this fix shipped.

**Previous update:** 2026-08-16 (session 4) — domain migration, `api2.o2plus.ru` → `bmwclub77.assistant24info.ru` (client's own subdomain; old domain left live in parallel, not retired). Both domains proxy to the same Vercel deployment (`car-parts-ai-recommendation.vercel.app`) via nginx on the ISPmanager-managed VPS — no `chat.js`/`chat-widget.js`/Vercel changes were needed, since none of the app code had any hardcoded domain (confirmed by reading `chat-widget.js`, `chat.js`, `manifest.json`, `sw.js`, `push-subscribe.js`, `push.js` — all use relative paths or a single `window.AGENT_URL` override point). What actually changed:
   1. New ISPmanager site created for the new domain (same `www-root` owner, same VPS IP `199.189.249.4`), Let's Encrypt cert auto-issued at creation.
   2. nginx's `location @fallback { proxy_pass ... }` block (both `:80` and `:443` server blocks) repointed from ISPmanager's default local-Apache backend (`http://127.0.0.1:8080`) to `https://car-parts-ai-recommendation.vercel.app`, with `proxy_set_header Host car-parts-ai-recommendation.vercel.app` — mirroring the old site's config exactly.
   3. Hit one real bug along the way: ISPmanager's auto-issued cert config pointed `ssl_certificate` at the `_le1.crt` file (leaf certificate only), not `_le1.crtca` (leaf + intermediate chain bundled) — caused a silent TLS handshake failure (`unable to get local issuer certificate`) that looked from outside like the whole proxy wasn't working, but was purely a cert-chain issue once diagnosed with `curl -v` directly against the VPS IP. Fixed by pointing at `_le1.crtca`, matching how `api2.o2plus.ru` was already configured.
   4. Widget embed snippet (`<script>window.AGENT_URL = ...</script>` + `<script src=".../chat-widget.js">`) updated on the live bmwclub77.ru page to reference the new domain in both places — this is what was actually causing the "widget loads but chat + images don't work" symptom, since `chat-widget.js` falls back to a literal placeholder URL if `window.AGENT_URL` isn't set before it runs.
   5. **Known follow-up, not yet done:** the dashboard PWA (home-screen icon + push notifications) was installed from the old `api2.o2plus.ru` origin. Service workers and push subscriptions are scoped per-origin by the browser — there is no code-level fix for this; confirmed all four PWA-related files (`manifest.json`, `sw.js`, `push-subscribe.js`, `push.js`) are already domain-agnostic. Re-adding to home screen from the new domain (remove old icon → open `/dashboard` on new domain → re-grant notification permission → re-add to home screen) is a manual, one-time step on each device that uses the dashboard. Old subscription row in Supabase `push_subscriptions` will self-prune the next time a push is sent to it and 404s/410s (see `deleteSubscription()` in `push.js`) — no manual cleanup required, just not instant.

**Previous update:** 2026-08-14/15 (session 3) — two unrelated fixes:

1. **Supabase infra event, not a bug:** upgraded Supabase off Free plan (Nano, 1GB disk cap/500MB read-only threshold) to a paid plan on Small compute, and bumped disk 2GB→8GB. Hit AWS's 4-modifications-per-24h EBS quota mid-upgrade, which put the DB fully down (`terminating connection due to administrator command` on writes) for the remainder of the rolling window — waited it out (project still in demo mode, no client traffic to protect) rather than risk a rushed project-restore. Confirmed via GitHub Actions history that `refresh-catalog.yml`/`refresh-compatibility.yml` failed cleanly at the DB layer (crawl/fetch steps succeeded, only the Supabase write step failed) and self-recovered once the outage cleared — no code changes needed. Compatibility table confirmed final size at ~15.9M rows, not expected to grow further; 8GB disk / Small compute should be comfortably sufficient for this as a static, read-mostly dataset going forward.
2. **Fixed a real matching bug, found via this Supabase downtime:** `filterCatalogByPartKeyword()` in `chat.js` only ever matched Russian keyword tokens against catalog `name`/`category` text — worked for the majority-Russian-named catalog, but ABCP's feed turns out to mix in English-named products too (confirmed case: vendorCode `51317188778`, "Green windshield, shade band+rain sensor" on a BMW X6 E71 — vehicle matching correctly found it, `лобовое стекло` never could since no Cyrillic/Latin substring exists between them). Added a small hardcoded `PART_KEYWORD_RU_EN` dictionary (~20 common part types) checked alongside the existing Russian stemming, rather than a translation API call — cheap, deterministic, no added per-request latency/cost. Verified against the exact failing case. Not yet observed in production since the fix shipped — see TO DO.

**Previous update:** 2026-08-12 (session 2) — traced and fixed a ~3x prompt-token increase after the compatibility table grew to ~15.9M rows, in four steps, same test case ("BMW X5 2008, лобовое стекло") tracked $0.80 → $0.34 → $0.12 → sub-cent across them: (1) `matchCompatibility()` attached every raw row per matched vendorCode with no cap — added `dedupeVehicleHits()` + a 15-row cap; (2) matching never used production year at all, so "X5" matched every generation (E53/E70/F15/G05) as one blob — added `parseYearRange()`/`yearOverlaps()` against the compatibility data's `years` field; (3) short bare tokens like `"3"` could accidentally substring-match unrelated records (e.g. matching inside `"530D"`) — fixed in both `matchCompatibility()` and `matchManualProductsByVehicle()` to require an exact series match for tokens ≤2 chars; (4) the biggest one — a clarifying-question turn (part+model named, no year yet) was still paying for a full Sonnet 5 call carrying the entire multi-generation catalog+compatibility blob just to ask "which generation do you have?". Added a short-circuit (`detectGenerationAmbiguity()`) that skips Sonnet entirely for this case and asks the question via a cheap Haiku-only call instead, with quick-reply generation buttons. See "Compatibility matching architecture" below.

**Previous update:** 2026-08-12 (session 1) — added a rotating status message to the widget's typing indicator (`chat-widget.js`, `addTypingIndicator()`/`removeTypingIndicator()`). Compatibility lookups against the full parts database take ~10–12s, which was reading as the widget being stuck (just the three bouncing dots, no other feedback). The dots still show immediately as before; after a 2.5s delay a small status line fades in next to them and rotates every 3s through "Ищу подходящие запчасти…" → "Проверяю совместимость с вашим автомобилем…" → "Сверяю по каталогу…" → "Почти готово…", then fades out cleanly whenever the reply lands. Client-side only, no `chat.js` changes — the widget has no real visibility into which backend stage is running, so this is deliberately generic reassurance rather than real progress reporting (see "TO DO" for the tradeoff this creates if a reply ever takes much longer than usual, e.g. a cold Supabase connection).

**Previous update:** 2026-08-02 — normalized `Compatability_catalog.json` from a single ~65MB jsonb blob into a proper relational table (`compatibility`, one row per vendorCode+vehicle, indexed by `series`), because the dataset is expected to grow ~10x further and the blob approach would not have scaled (risked Postgres jsonb limits, Vercel function memory limits, and slow reads on Supabase's free Nano compute). `chat.js` now queries only the relevant series' rows per conversation (e.g. `WHERE series = 'X5'`) instead of loading everything — confirmed working end-to-end with a real conversation, and **token cost dropped ~40%** as a side effect of the leaner, more targeted compatibility data reaching the prompt. See "Compatibility data pipeline (Git LFS + Supabase)" below, now updated with this second migration.

**Previous update:** 2026-08-01 — migrated `Compatability_catalog.json` (then 65MB+) off plain git and onto Git LFS after it crossed GitHub's 50MB warning threshold, then had to solve LFS's incompatibility with Vercel in two more steps: Vercel doesn't resolve LFS pointers at all, and even once resolved via GitHub's LFS Batch API, a live per-request fetch took ~38s (too close to Vercel's function timeout) and Supabase's REST API (PostgREST/Cloudflare) couldn't reliably handle a payload this size either direction (writes failed outright with Cloudflare 520/521/525; reads "worked" but took ~37s). Also discovered (2026-08-02) that `api/compatibility.js` was additionally hitting Vercel's hard 4.5MB function-response-body limit — it had been silently returning truncated data the whole time, motivating the same-day normalization migration above.

**Previous update:** 2026-07-24 — built and confirmed working in production the "missing articles" feature: parts that genuinely fit a customer's vehicle (per the compatibility data) but are absent from the catalog feed — almost always because ABCP's export only includes items with a photo, and the agent deliberately never recommends something with no visual — now get logged automatically with the vehicle context, so the client can see exactly which parts are costing sales and add a photo for them. New Supabase table + Postgres function, new `api/dashboard/missing-articles.js` endpoint, new "🖼️ Нет фото" dashboard tab. See "Missing-articles (no-photo gap) tracking" below.

### 🔄 Resuming in a fresh chat? This README explains *why* things are the way they are — it does NOT contain live file contents. Upload these before continuing:

- **From `abcp-catalog-proxy` repo:** `api/catalog.js`, `scripts/crawl-compatibility.js`, `scripts/push-compatibility-to-supabase.js`, `.github/workflows/refresh-catalog.yml`, `.github/workflows/refresh-compatibility.yml`, `vercel.json`, `package.json` (`api/compatibility.js` retired 2026-08-02 — its query logic now lives in `chat.js` directly, see below)
- **From `Car-Parts-Ai-Recommendation` repo:** `api/chat.js`, `api/session/manager.js`, `api/dashboard/missing-articles.js`, `widget/chat-widget.js`, `dashboard/index.html`, `vercel.json`
- **Missing-articles Supabase setup:** `missing_articles_setup.sql` (table + `bump_missing_article()` function — already run against production as of 2026-07-24, keep this file as the source of truth for the schema, not something to re-run)
- **Latest compatibility data (✅ FINAL DECIDED FORMAT, 2026-07-08):** two accumulating files, NOT `Car_model_list.xml` (retired — see below): `Compatability_catalog.json` (vendorCode → compatible vehicles, what the agent actually queries) + `Crawled_modificationIds.json` (tracks which car models/modificationIds have been crawled — this is the client-relevant scope list, not the full ABCP range)
- **⚠️ `Compatability_catalog.json` is NOT tracked in git/LFS anymore** (removed session 7, 2026-09-19, after 347 accumulated commits bloated the account's LFS storage quota to 90%) — it's now a local-only, gitignored working file. See "Compatibility data pipeline (Git LFS + Supabase)" below (now mostly historical) and the session 7 entry in PROJECT STATUS for the current manual workflow. It is NOT served directly by Vercel and NOT served via any `api/compatibility.js` endpoint (retired) — data reaches Supabase's normalized `compatibility` table (one row per vendorCode+vehicle, indexed by `series`) via a manual local run of `push-compatibility-to-supabase.js`, and `chat.js` queries that table directly via `pg`, scoped to just the relevant series per conversation.
- **Live domains (as of 2026-08-16):** `bmwclub77.assistant24info.ru` (new, client's own subdomain) and `api2.o2plus.ru` (old, still live in parallel) both proxy via nginx to the same Vercel deployment. If troubleshooting anything domain/nginx/SSL-related, both are configured identically on the ISPmanager VPS — check `/etc/nginx/vhosts/www-root/<domain>.conf` for the live config (not just ISPmanager's UI, which can lag behind what's actually loaded).
- **Do NOT re-paste real secrets into chat or this file** — `ABCP_EXPORT_URL`, `BITRIX24_WEBHOOK_URL`, `GITHUB_LFS_TOKEN`, and `SUPABASE_DB_URL` live only in Vercel's environment variables / GitHub Actions secrets. This README was previously found to contain the live ABCP token in plain text (now redacted, 2026-07-08) — if it's ever pushed to git, treat that token as compromised/rotate it, since it would sit in git history regardless of later edits.

### ✅ DONE
- [x] Decided data access path: ABCP's YML price export (no API credentials needed)
- [x] Found ABCP's built-in image filter → 21,899 offers, 100% picture coverage, 12.8MB (was 1.18GB)
- [x] Built & deployed `catalog.js` (`abcp-catalog-proxy` repo) — tested working in production, secret moved to Vercel env var
- [x] Client confirmed warehouse/pricing scope, signed contract
- [x] Investigated paid Carbase/TecDoc compatibility API — rejected, too expensive (250k₽+ setup + monthly)
- [x] Built & debugged compatibility crawler (session cookies, IPv4 fix, retry/circuit breaker, metadata extraction) — validated twice, 100% catalog match rate (Mercedes, then Audi/VAG)
- [x] Found safer hybrid crawl workflow (manual browse + small batches) after full-scale crawl caused a site lockout
- [x] Designed + built escalation/lead-capture feature: `chat.js` (compatibility fetch + escalation triggers), `manager.js` (real Bitrix24 CRM lead, removed dangerous hardcoded webhook, fixed summary prompt), `chat-widget.js` (confirmed wiring + added confirmation message)
- [x] Decided product card button = link to `product.url`, new tab
- [x] Scrubbed exposed secret from README, added resume checklist
- [x] Built `merge-compatibility.js` — dedupes hybrid-crawl batches into the two accumulating files (by `modificationId` within each vendorCode; conflicts logged, batch/newer wins), with automatic timestamped backups
- [x] Updated `crawl-compatibility.js` to auto-emit `compatibility-crawl-successful-ids.json` per run (only genuinely-resolved ids, not failed ones) — closed the last manual-copy-paste gap in the crawl→merge workflow
- [x] Built & hosted `api/compatibility.js` in `abcp-catalog-proxy` — serves the committed `Compatability_catalog.json` directly (unwrapped JSON, matches `chat.js`'s `fetchCompatibility()` contract). `COMPATIBILITY_API_URL` set and live.
- [x] **Fixed catalog fetch timeout bug** — `catalog.js`'s live XML fetch/parse took 15–20s; `chat.js`'s original 8s timeout silently aborted and fell back to an empty catalog every time. Root-caused via `servedFrom` diagnostic field.
- [x] **Rebuilt `catalog.js` around a Supabase-backed cache**, refreshed every 6h by a GitHub Actions cron workflow (`refresh-catalog.yml`) calling a protected `api/refresh-catalog.js` endpoint — works around Vercel Hobby's 10s function-duration cap and once-daily cron limit. Live catalog reads are now near-instant (`servedFrom: "supabase"`), with a live-fetch fallback if Supabase is ever unreachable.
- [x] **Found & fixed a major scaling bug:** once the catalog fetch actually started succeeding (see above), `chat.js` was stuffing the *entire* ~22k-product catalog into every system prompt — 2.75M tokens, >13x Claude's 200k limit. Fixed by filtering the catalog server-side to only vendorCodes present in the compatibility data before it ever reaches the prompt.
- [x] **Diagnosed and fixed a cross-vehicle hallucination bug** — the agent would sometimes present a product's compatibility data for the *wrong* car (e.g. citing an A6 Avant fitment record while discussing an A4). Root cause: reading through a multi-hundred-record JSON blob and picking the right sub-record is a search/retrieval task, not a reasoning task — confirmed by testing with Sonnet 5 (a much stronger model) and getting the *same* class of failure. See "Compatibility matching architecture" below for the fix.
- [x] **Built a deterministic vehicle-matching pipeline** (`extractVehicleInfo()` + `matchCompatibility()` in `chat.js`) — a cheap Haiku call extracts `{vendorCode, brand, model, engineCode, powerHp}` from the conversation; plain JS does fuzzy brand/model/engine matching against the full compatibility dataset; only the already-matched result (typically 0–5 records) is sent to the main conversational call. Fixes both the hallucination bug and the token-cost problem at once.
- [x] Switched the main conversational model to **Claude Sonnet 5** (extraction step stays on Haiku) — now that the matching pipeline does the hard retrieval work in JS, the conversational model's job is just natural, well-reasoned dialogue around an already-correct answer.
- [x] Fixed a response-parsing bug (`data.content?.[0]?.text`) that broke silently on any model with thinking blocks enabled by default (e.g. Sonnet 5) — was grabbing content by array position instead of by `type: 'text'`, causing empty replies with real token cost. Fixed in both `chat.js` and `manager.js`.
- [x] Found and fixed a **silent duplicate-key data-loss bug** in `Compatability_catalog.json` from repeated manual edits bypassing `merge-compatibility.js`'s dedup logic — `JSON.parse` silently keeps only the last of several duplicate top-level keys. Client wrote a cleanup script; file is now clean.
- [x] Added a parts-terminology glossary to the system prompt (catalog naming quirks → plain-language equivalents, e.g. "Фильтрующий элемент с проклад." = oil filter) — extensible as more mismatches are found.
- [x] Added mandatory engine-code/horsepower disambiguation to the system prompt when multiple engine variants exist for the same model/year range (many parts — filters, timing belts, spark plugs — are engine-specific, not just model/year-specific).
- [x] Applied consistent widget CSS (explicit font stack + reset scoped to the widget's root containers, so it no longer inherits the host site's font) — fixes it looking inconsistent/small depending on the client site's own CSS.
- [x] **Widget integrated live on the client's site** — via ABCP's admin panel ("Внешний вид и контент" → "Инфоблоки" → footer info-block), confirmed working.
- [x] Rotated `ABCP_EXPORT_URL` after it was found committed in `env.local` (missing from `.gitignore`) via a stray `git add .`
- [x] **Diagnosed a structural data gap:** oils/fluids (and other consumables) have no vehicle-fitment data anywhere on ABCP's platform (confirmed via the platform's own product pages — "Нет информации о применимости"). The entire compatibility pipeline above is built around parts that DO have fitment data; oils needed a fundamentally different approach.
- [x] **Built the manual cross-sell products feature** — new dashboard tab ("Товары") where the client pastes a category + product URL + the page's HTML source (View Source) + price (typed manually, see below) for any product ABCP doesn't have fitment data for. New `manual_products` Supabase table (`category`, `url` unique, `name`, `image`, `price`, `description`, `specs` jsonb, `crawl_error`). New `api/dashboard/products.js` endpoint (list/add/delete, admin-only for add/delete, same password pattern as `sessions.js`).
- [x] **HTML extraction selectors verified against real ABCP product page markup** (not guessed from screenshots) — `extractName`, `extractImage`, `extractSpecs`, `extractDescription` all tested and confirmed working. `extractPrice()` was iterated on twice: first found the price is sometimes wrapped in extra markup depending on product category (made the regex more tolerant), then discovered the deeper issue below.
- [x] **Found that price loads via a separate async AJAX call** on ABCP's platform (`/ajaxRoute/goodsInfo/searchArticle`), *after* the page's initial HTML response — meaning "View Source" (Ctrl+U) can never contain it, no matter how good the parser is; it genuinely isn't there yet at that point. DevTools' "Copy outerHTML" (post-render DOM) would work but is too advanced for the client day-to-day.
- [x] **Solved this by adding a manual price field** — client just reads the price off the page and types it in; always overrides any extraction attempt. Simpler and more reliable than depending on any capture method for this one field. Kept the (still-improved) `extractPrice()` as a best-effort fallback for name/specs-only pastes.
- [x] Confirmed Vercel's outbound connections to `bmwclub77.ru` fail outright (`UND_ERR_CONNECT_TIMEOUT` at the TCP level, not a bot-challenge page) — consistent with many RU-hosted sites filtering foreign datacenter IP ranges. This is why the "paste HTML manually" flow exists at all instead of a one-click server-side crawl; kept a fetch-fallback in the code in case this changes later (e.g. after a custom domain move).
- [x] Found `car-parts-ai-recommendation` was missing `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` / `DASHBOARD_ADMIN_PASSWORD` / `DASHBOARD_CLIENT_PASSWORD` entirely — the dashboard login could never have worked until these were added.
- [x] **Designed the oil/fluid cross-sell matching strategy** (client's own proposal, refined together): Tier 1 — ask the customer for their engine's required manufacturer approval code (e.g. VW 507.00, BMW Longlife-01) and match it *exactly* against `manual_products.specs["Допуски производителей"]`, brand-agnostic (a generic-brand oil carrying the right approval is exactly as valid as an OEM-branded one — confirmed this is how real oil-compatibility approvals work, not a compromise). Tier 2 — a general fuel-type/turbo/mileage fallback heuristic for when the customer doesn't know their approval code — **designed but not yet built** (see TODO).
- [x] **Built Tier 1 end-to-end in `chat.js`**: `fetchOilProducts()` (cached Supabase read), `normalizeApprovalCode()` (tolerates "VW 502.00" vs "VW 502 00" vs "vw50200"), `matchOilByApproval()` (deterministic, brand-agnostic substring match) — same "match in code, not in the prompt" pattern as vehicle compatibility, for the same reason (retrieval over a large embedded list is unreliable regardless of model size). `extractVehicleInfo()`'s schema extended with `oilApprovalCode`/`fuelType`/`turbo`/`mileageKm` (last three captured now, unused until Tier 2). New `{{OIL_PRODUCTS}}` prompt section (always pre-matched, never the full table) and a "ПОДБОР МАСЛА И ЖИДКОСТЕЙ" skill telling the agent to ask for the approval code and escalate rather than guess if the customer doesn't know it.
- [x] Added a `description` field (separate from the structured `specs`) capturing the free-text technical/marketing blurb from product pages — extra context for the agent beyond raw spec values.
- [x] **Fixed a truncated-JSON bug**: `max_tokens: 2048` was too tight for a full multi-item response (e.g. a complete ТО service kit — 5 verbose products + intro prose sharing one budget), causing the response to cut off mid-`<<<PRODUCTS>>>` block. The widget can't parse broken JSON, so it silently fell back to showing the raw (broken) text instead of rendering cards. Raised to 4096.
- [x] **Fixed a conversation-persistence bug**: product card links open in a new tab (`target="_blank"`, deliberate — doesn't lose the chat by navigating away entirely) but the new tab had no way to see the original tab's state, so the widget looked like it "forgot" the conversation. First attempt used `sessionStorage` (wrong tool — never shared between tabs, even same-origin, by browser design); fixed by switching to `localStorage` (shared across tabs) with a 45-minute inactivity expiry so it never resurrects a genuinely old conversation. Also removed an overly-aggressive `endSession()` trigger on `visibilitychange` (was ending the session just from a customer glancing at another browser tab).

- [x] **Found & fixed a second major scaling bug (2026-07-22):** `matchCompatibility()` only ever matched on vehicle (brand/model/engine), with no concept of which *part* the customer was asking about — so a query like "brake pads for my BMW X5" returned every vendorCode in the whole compatibility catalog that fits an X5 (filters, spark plugs, suspension, everything), and that set grows with total catalog size rather than the actual question. This is why cost had started climbing as more parts were crawled, after having "worked well before." Fixed by extending `extractVehicleInfo()` to also extract `partKeywords` (an array, in Russian to match the catalog's own field language) and adding `filterCatalogByPartKeyword()` — a plain substring match against the catalog's `name`/`category` fields, same "match in code, not in the prompt" principle as vehicle matching. Cut one real BMW query from $1.30 to $0.15.
- [x] **Found & fixed a same-day regression from the fix above:** a broad request ("everything needed for a service") produced a single non-matching keyword like "техническое обслуживание" (a service concept, not a product-name word), so the new filter correctly matched nothing and the agent wrongly told the customer the parts weren't in the catalog — even though they were. Fixed two ways: (1) the extraction prompt now explicitly expands generic maintenance/ТО requests into the standard category list (oil filter, oil, air filter, cabin filter, spark plugs, brake pads, brake discs) instead of passing through a non-matching phrase, and `filterCatalogByPartKeyword()` OR-matches across the whole list; (2) a safety-net fallback — if the keyword filter still zeroes out a non-empty vehicle-matched set (imperfect extraction, unusual phrasing), fall back to the capped unfiltered set rather than silently returning empty. Also added a hard cap (40 items) for the case where no part has been named yet at all (mid-conversation), so that path can't regress into the original scaling bug either.
- [x] Removed leftover noisy per-record debug logging in `matchCompatibility()` (a stray `console.log` for every BMW record checked, regardless of relevance) that was flooding Vercel's log view and made diagnosing the above bugs harder than it needed to be. Rewrote the `diag: 'match-check'` log line as a single flat JSON object (`partKeywords`, `partFilterApplied`, `vehicleMatchedCount`, `finalMatchedCount`, prompt char counts) — the old nested-object version was apparently getting silently dropped by Vercel's per-log size limit on at least one occasion, making it look like the diagnostic wasn't running at all.

- [x] **Found & fixed two BMW model-naming matching bugs (2026-07-23):** `normalizeModel()`'s digit+letter merge rule (built for engine suffixes like "320 I" → "320I") was incorrectly also fusing BMW's "M" performance-division marker and its "xDrive" AWD marker to adjacent numbers, even though both are written inconsistently between the catalog and customer phrasing. (1) **M-bug:** customer said "X5 M", merged to token "X5M"; catalog stores "X5 (E70) M" (chassis between the number and M), merged to "X5E70M" — "X5M" is not a substring of "X5E70M", so a correctly-catalogued BMW X5 M brake-disc part matched zero results. Fixed by excluding standalone "M" from the merge. (2) **xDrive-bug:** customer said "X6 F16 50iX" (colloquial trailing-x shorthand for xDrive), merged to "...50IX"; catalog spells it as its own word, "xDrive 50 i", merging to "...XDRIVE50I" — the shorthand's trailing "X" has no adjacent equivalent in the catalog string once compacted, so a correctly-catalogued oil pan (vendorCode `11427583220`) matched zero results despite being clearly present in `Compatability_catalog.json` (confirmed against the raw file). Fixed by stripping "xDrive" (both the spelled-out word and the shorthand trailing "x") from both sides before comparing — trades a small amount of xDrive/non-xDrive precision for not missing real matches, deliberately, since a false "not in stock" is worse for this business than an occasional over-broad match. **Worth treating as a pattern, not two isolated bugs:** BMW's model-naming conventions don't concatenate consistently across sources. If a third one of these turns up, do a broader audit of `normalizeModel()` against a wider sample of real BMW model strings rather than patching markers one at a time.
- [x] **Built & confirmed working the "missing articles" feature (2026-07-24):** parts that fit a customer's vehicle per the compatibility data, but have no entry in the catalog feed at all (see "Missing-articles (no-photo gap) tracking" below for why that happens) — previously this just meant the agent had nothing to offer and the gap was invisible. Now `chat.js` diffs the vehicle-matched compatibility set against the vehicle-matched catalog set on every request; anything present in the former but missing from the latter gets logged via a new `bump_missing_article()` Postgres RPC (one row per vendorCode, atomic increment, keeps the last 5 vehicle examples, un-resolves automatically if asked for again after being marked fixed). New `missing_articles` Supabase table, new `api/dashboard/missing-articles.js` endpoint (list/resolve/delete, same auth pattern as `products.js`), new "🖼️ Нет фото" dashboard tab sorted unresolved-first by request count. End-to-end tested against a real conversation — confirmed a row landed correctly and the dashboard rendered it.
- [x] **Migrated `Compatability_catalog.json` to Git LFS + Supabase (2026-08-01)**, after several dead-end attempts — see "Compatibility data pipeline (Git LFS + Supabase)" below for the full path. Short version: file crossed 60MB → tracked via Git LFS → Vercel can't resolve LFS pointers → tried live LFS Batch API fetch from `api/compatibility.js` (worked but ~38s, too slow) → tried Supabase REST API for both the GitHub Actions push and the Vercel read (writes failed outright with Cloudflare 520/521/525 on the ~65MB payload; reads "worked" but took ~37s, no better than the LFS fetch) → **direct Postgres connection** (`pg` package + Supabase's Transaction Pooler connection string) on both sides, bypassing PostgREST/Cloudflare entirely. GitHub Actions (`refresh-compatibility.yml`) checks out the repo with `lfs: true` and runs `scripts/push-compatibility-to-supabase.js`. (Superseded the next day by the normalization migration below — the single-blob `compatibility_cache` table this bullet describes no longer exists.)
- [x] **Normalized compatibility data into a real relational table (2026-08-02)**, after discovering `api/compatibility.js` had ALSO been silently hitting Vercel's hard 4.5MB function-response-body limit the whole time (first test only returned "a fraction" of the data — this is why). Rather than patch around that limit again, restructured the data properly ahead of an expected ~10x size increase: new `compatibility` table (`vendor_code`, `series`, `vehicle` jsonb — one row per vendorCode+vehicle record, indexed on `series` and `vendor_code`). `series` (BMW's "1"/"3"/"X5"/etc., but really "model line" — the same table also holds Audi/Mercedes/VW data, distinguished the same way) is extracted from the `model` field's text before its first `(`. `push-compatibility-to-supabase.js` rewritten to flatten the source JSON into these rows (truncate + batch-insert in a transaction, 1000 rows/batch) instead of upserting one blob; confirmed working (179,917 rows from 14,771 vendor codes, logged per-series counts, only 2 rows landed in "unknown"). `api/compatibility.js` retired entirely — `chat.js` now queries Postgres directly (`fetchCompatibilityVendorCodes()` for cheap catalog-filtering, `fetchCompatibilityBySeries()` for the actual vehicle-matched slice, called AFTER `extractVehicleInfo()` now instead of before, since the series isn't known until extraction runs). End-to-end confirmed via a real conversation: correct results, and **token cost dropped ~40%** as a direct result of the leaner per-series data reaching the prompt.
- [x] **Added a rotating status message to the typing indicator (2026-08-12)** — with the parts database as large as it now is, the compatibility lookup behind a product card takes ~10–12s, and the widget previously showed nothing but static bouncing dots for that whole window, reading as stuck rather than working. `addTypingIndicator()` in `chat-widget.js` now starts a 2.5s-delayed, 3s-interval rotation through a small set of generic Russian reassurance messages next to the dots, cross-fading between them; `removeTypingIndicator()` clears the timers so nothing leaks or fires after the reply lands. Deliberately client-side only and deliberately generic wording — the widget has no real signal for which backend stage (`extractVehicleInfo()` Haiku call vs. `fetchCompatibilityBySeries()` vs. the main Sonnet 5 call) is actually running, so this reassures without claiming false precision. See TO DO for the known tradeoff (message rotation has no ceiling — a message like "Почти готово…" sitting on screen for an unusually long wait, e.g. a cold Supabase connection, could read worse than no promise at all).
- [x] **Diagnosed and fixed a ~3x prompt-token/cost increase (2026-08-12) after the compatibility table grew to ~15.9M rows**, in four parts, confirmed against the same test case throughout ("BMW X5 2008, лобовое стекло": $0.80 → $0.34 → $0.12 → sub-cent):
  1. `matchCompatibility()` attached the FULL raw `hits` array per matched vendorCode with no cap at all — fine at ~180k total rows, but at ~15.9M a single part can legitimately have hundreds of near-duplicate rows for the same series (date-range splits, LHD/RHD, trim-only differences). Added `dedupeVehicleHits()` (collapses to unique `model`+`modificationName`+`engineCode`+`powerHp` combos) plus a 15-row-per-vendorCode safety cap. Extended `DIAG match-check` with `seriesRowCount`/`matchedVendorCodeCount`/`matchedRowCountAfterDedupe` to make the before/after visible in production logs.
  2. Matching never used the compatibility data's `years` field (`"2004/04 - 2006/09"`-style strings) at all — a bare model name like "X5" matched every generation of that model (E53/E70/F15/G05) as one undifferentiated set, since chassis codes are rarely present in what customers actually say. Added `parseYearRange()` + `yearOverlaps()`, wired into `matchCompatibility()`'s filter alongside the existing engine-code check.
  3. Same over-matching pattern, different trigger: short bare tokens ("3", "5", "X1") were substring-matched against the whole compacted `model+modificationName` string, so e.g. a customer who'd only said "BMW 3" could match unrelated 5-series records purely because "530D" contains a "3". Fixed in both `matchCompatibility()` and the client-curated-products path `matchManualProductsByVehicle()` — tokens ≤2 chars now require an exact match against the record's own series (via `extractSeries()`) instead of an anywhere-substring check; longer tokens (real trim/chassis codes) keep the substring behavior they were designed for.
  4. **Biggest single fix:** even after 1–3, a "part named but no year yet" turn (e.g. "Ищу лобовое стекло BMW X5") still paid for a full Sonnet 5 call carrying the entire matched catalog + compatibility blob across all remaining generations, purely to conclude "please tell me your year" — no product ever shown. Added `detectGenerationAmbiguity()`: when a part + model are known but year/engine aren't, and the matched set still spans multiple distinct generations, the handler now skips Sonnet and the catalog/compatibility payload ENTIRELY and asks the clarifying question via a small Haiku-only call instead, with `<<<BUTTONS>>>` for each detected generation so the customer can tap instead of typing a year. Falls through to the normal full path if the Haiku call itself fails, so this is a pure cost optimization with no new failure mode. Logs `DIAG generation-ambiguity-shortcut` when it fires.
  Not yet audited: `engineCodesOverlap()` (line ~544) and `filterCatalogByPartKeyword()`'s stemmed matching do the same double-substring trick as fix #3 above, but on longer/more distinctive strings (engine codes, stemmed Russian words) and already bounded by the 40-item catalog cap respectively — lower risk, flagged for later rather than fixed now.

### ⬜ TO DO
- [ ] Watch `PART_KEYWORD_RU_EN` (added 2026-08-15) against real traffic — dictionary currently covers ~20 common part types found by inspection, not a systematic audit of the catalog. Watch `missing_articles`/DIAG logs for cases where `vehicleMatchedCount` is high but `finalMatchedCount` drops to 0 unexpectedly — that shape of gap is the signal an English-named product is slipping through and needs a new dictionary entry.
- [ ] Consider whether `filterCatalogByPartKeyword()`'s English-name gap (fixed 2026-08-15) has a mirror case elsewhere — anywhere else in `chat.js` that assumes catalog text is Russian-only (e.g. any other keyword/category matching outside this one function) is worth a quick check for the same failure shape.
- [ ] Watch the new `detectGenerationAmbiguity()` short-circuit (2026-08-12) in production — if a model's generations turn out to share an identical part for some category (chassis-agnostic parts), this will still ask an unnecessary clarifying question for that category. Not observed yet, just a theoretical edge case worth confirming isn't happening once there's real usage data.
- [ ] Consider auditing `engineCodesOverlap()` and `filterCatalogByPartKeyword()`'s stemmed matching for the same short-token substring over-matching pattern fixed elsewhere on 2026-08-12 (see DONE) — lower priority, both are on more distinctive strings and/or already bounded, but same shape of bug.
- [ ] Consider a hard ceiling or a final "still working, thanks for your patience" fallback message for the typing-indicator rotation (`chat-widget.js`, added 2026-08-12) — currently rotates indefinitely with no awareness of real elapsed time, so an unusually slow reply (cold Supabase connection, traffic spike) could leave "Почти готово…" on screen well past when it stops being reassuring. Not urgent at current ~10–12s typical latency, but worth revisiting alongside the Vercel/Supabase tier upgrade below, which should also improve the worst case.
- [ ] **Build Tier 2 oil/fluid fallback** (fuel type + turbo + mileage → general viscosity/spec recommendation, clearly labeled as non-manufacturer-verified) for when the customer doesn't know their required approval code — currently just escalates to a manager instead
- [ ] Set `BITRIX24_WEBHOOK_URL` once client's Bitrix24 account + webhook exist (currently degrades gracefully — logs the lead attempt, doesn't crash, shows a graceful fallback message to the user)
- [ ] Fill remaining `TODO_COMPANY_NAME` / `TODO_PHONE` / `TODO_EMAIL` / `TODO_ADDRESS` / `TODO_HOURS` placeholders in `chat.js` / `chat-widget.js`
- [ ] Upgrade Vercel plan from Hobby to Pro (client demo's 7-day free window; Hobby's 10s function-duration cap and non-commercial-use terms are a real risk for a live production tool)
- [ ] Remove the temporary diagnostic `console.log` calls in `chat.js` / `products.js` (`DIAG match-check`, `diag: 'crawl-fetch-check'`, etc.) once both pipelines have been observed stable for a while in production
- [ ] Watch `partKeywords`/`partFilterApplied` in the `DIAG match-check` log over the next few days — especially cases where `partFilterApplied: false` (no part named yet, or the empty-result safety net kicked in) — to confirm the 2026-07-22 fix and its safety nets are behaving as intended across real conversations, not just the cases tested manually
- [ ] Keep expanding compatibility crawl coverage — consider a part-first (reverse, per-vendorCode "Применимость" page) crawl direction for common wear items, which may reach full coverage faster than the current model-first (`getAdaptability`) direction for high-traffic parts
- [ ] Client is populating `manual_products` with real oils/fluids (in progress) — re-add the small number of early entries that were saved without a price (added before the manual price field existed) by re-submitting their URL with a price now
- [ ] Consider live cross-tab sync for the widget (currently: two simultaneously-open tabs each only see the shared `localStorage` state on their own next page load, not live) — likely unnecessary for the actual usage pattern (chat → click product → close that tab or return), flagged only if it turns out to matter in practice
- [ ] End-to-end regression test now that the model + both matching pipelines have changed (Sonnet 5 + deterministic vehicle matching + deterministic oil matching) — confirm escalation flow, product cards, oil recommendations, and manager handoff all still behave correctly together
- [ ] Watch `missing_articles` over the next couple of weeks once the client starts actively using the "🖼️ Нет фото" tab — confirm `vehicle_examples` stays useful (last 5 distinct requests) and the un-resolve-on-repeat-request behavior doesn't create noisy back-and-forth if a photo gets added but the catalog cache hasn't refreshed yet (6h Supabase cache TTL — a customer re-asking within that window before the new photo's synced would incorrectly re-flag an already-fixed row)
- [ ] After a crawl update + push, remember to manually trigger the "Refresh compatibility cache" GitHub Actions workflow (Actions tab → Run workflow) if you want Supabase updated immediately — otherwise it just waits for the next 6h scheduled run. Consider adding a `push`-triggered run (on changes to `Compatability_catalog.json` specifically) if manually clicking this becomes annoying.
- [ ] Watch query timing on `chat.js`'s `fetchCompatibilityBySeries()` as the dataset grows toward its expected ~10x size — currently fast (per-series row counts range from a handful up to ~119k for BMW's "1" series), but worth re-checking once real growth happens, especially for the largest series buckets.
- [ ] The 2 rows that landed in `series = "unknown"` during the 2026-08-02 migration are harmless at this scale but worth a quick look — indicates a `model` string that didn't parse as expected by `extractSeries()`.
- [ ] Consider widening the `series` index to `(brand, series)` if a future data source introduces a series-name collision across brands (e.g. two different manufacturers both using a numeral like "3") — not needed today, current brands (BMW/Audi/Mercedes/VW) don't collide.
- [x] ~~Supabase off free/Nano compute~~ — done 2026-08-14/15 (paid plan, Small compute, 8GB disk). Once the client's first payment lands, still need: upgrade Vercel to Pro, and the widget's relay VPS (currently Kazakhstan-hosted, hobby-tier, used to route around Vercel's outbound connections to `bmwclub77.ru` being blocked — see the RU-hosting note further down) — expected to meaningfully cut the ~20s response time observed in testing (Vercel function ceiling and the VPS relay hop are the two remaining contributors; Postgres compute tier is now addressed).

### Where we are
- Catalog source confirmed: client's site runs on **ABCP** (auto parts distribution platform, not a simple CMS).
- Data access path decided: **ABCP's built-in "Экспорт прайсов" (price export) feature, type = YML** — NOT the raw ABCP REST API. This avoids needing API-admin credentials/auth entirely.
- Test export created in ABCP admin panel (`cp.abcp.ru → Экспорт прайсов`), config name **"Aris Test"**, format = YML, sub-format = "Яндекс.Вебмастер 'Поиск по товарам'" (required Профиль = "Гость (Опт)").
- Test run scoped to **1 warehouse only** ("LandRover Rolf") to keep the file small: **4,324 offers**, confirmed working persistent URL (format only — actual token redacted, see `ABCP_EXPORT_URL` in Vercel env vars for the real value, never commit it here):
  ```
  https://bmwclub77.ru/get_price?p=<REDACTED_TOKEN>&FranchiseeId=<REDACTED_ID>
  ```
  This URL always serves the latest generated file (not a one-time download — confirmed via PowerShell `Invoke-WebRequest`, browser "download" behavior is just a `Content-Disposition` header, irrelevant to server-side `fetch()`).
- **Image coverage confirmed: only ~21% of offers have a `<picture>` tag** (917 of 4,324 in the test file). Images come from ABCP's own CDN (`pubimg.nodacdn.net` / `f.nodacdn.net` — "Noda" = ABCP's parent company, NodaSoft). The other ~79% have no picture — not a bug, aftermarket parts often lack ABCP-hosted photos.
  - Fallback options exist in the export config ("Ссылка на фото товара" setting): can fall back to product-group photo, or a placeholder image URL — not yet decided/configured.
- **No refresh schedule (Расписание) has been set yet** — current export is demo-only, one-time manual runs. Fine for prototyping; must be set before any production use.
- **✅ SENT to client** — question list (in Russian) asking them to define: which warehouses/brands to include, which pricing profile to use, any stock to exclude, whether vehicle-compatibility data exists, and whether exact stock quantities are needed. **Awaiting client's reply before building the real export.**

**✅ CLIENT ANSWERED (2026-07-03) — client also signed the service contract.** Confirmed scope:
- **Пул складов/прайсов (agreed warehouses/price lists), organized as two groups:**
  - **"BMW Brest" group:** BMW Brest 19.02, Mers Benz Brest 26.11, VAG Brest 26.11.2025
  - **"Автodom ЦС сток" group:** Куркино ЦС Автодом Сток, Мытищинский БХ ЦС МКАД'29 сток
- **Pricing profile: "Опт"** (confirmed explicitly by client).
- **Questions 3 (stock exclusions) and 4 (exact quantity need) were left unanswered** — not explicitly "no" or "not needed," just skipped. Don't assume either way if it becomes relevant later; safest default for now is to include all confirmed warehouses' stock as-is (per `available` boolean, matching what we already tested) and revisit only if something looks off once the real export is built.
- **We confirmed to the client:** warehouse list can be adjusted anytime — either they update it in ABCP themselves (changes propagate automatically to the export), or they can just message us and we'll adjust it — this was framed as a free, ongoing part of the service, not a one-time setup.

**Client interaction is now unblocked. Ready to move to actually building the real (non-test) YML export.**
- **"Add to cart" button decision: SOLVED, no custom cart logic needed.** The `<url>` field already present in the YML feed (e.g. `https://bmwclub77.ru/parts/JAGUAR/AJ82766?d=11972368`) is a direct link to the item's real product page on the live site — confirmed by manually browsing the site's own catalog navigation (Марка → Модель → Поколение → Модификация → part). That page already has live per-branch stock ("Куркино", "+Яндекс.Доставка"), price, brand analogs (PATRON, Stellox, etc.), and the site's own working add-to-cart. **Decision: the product card's button simply opens `product.url` in a new tab** (`target="_blank"`, so the embedded chat widget/session isn't lost). No need to call ABCP's `basket/add` API ourselves.
- **Major finding — compatibility data DOES exist, just not in the YML export.** Browsing the live site directly (bmwclub77.ru → Каталог → BMW → 3 → 3 Compact (E46) → 325 ti → Тормозная система) revealed a full structured vehicle-fitment catalog: brand → model → generation → modification (with engine code, years, fuel, power) → part category → specific parts. This is almost certainly ABCP's own vehicle-catalog module (TecDoc/Laximo-style), completely separate from the price-list/YML export mechanism we've been testing.
  - **This changes the answer to our own question 4 to the client** — compatibility data isn't missing, it's just not exposed through the export we've been using. Still need to confirm: is this vehicle-fitment catalog reachable via API (so the agent can query it programmatically), or is it front-end-only navigation with no API access? **New follow-up question to send the client/ABCP support**, not yet sent.
  - **Refined further:** found a "Характеристики" (Characteristics) popup on individual product pages (triggered from an info icon next to search results), explicitly labeled **"Из справочника АВСР"** (From the ABCP reference directory) — confirming this fitment data is a **standard ABCP platform feature tied to brand+article number**, not something bespoke the client built. Shown per article: full table of compatible models/years/engine codes/body type/kW/hp/fuel/drivetrain (e.g. article `34216778168` → BMW 3 (E46) across multiple submodels/years/engines). Since this is core ABCP reference data (same family as "Справочник товаров" in the sidebar), there's a good chance it's queryable via API by brand+article, similar to `search/articles`. **Revised follow-up question to send ABCP support:** ask specifically whether there's an API method returning this справочник/characteristics data (model, year, engine, body, drivetrain) by brand+article — more precise than the earlier generic compatibility question.
  - **✅ CONFIRMED via public docs (no need to wait for support on this) — the API exists.** Found in `API.ABCP.Client` docs: a dedicated section called **"Каталог ТО"** (Maintenance Catalog), methods 1.10.1 (general info), 1.10.4 (list of vehicle models for a manufacturer), 1.10.5 (list of modifications for a model), 1.10.6 (info about one modification). Docs describe it as a tree of 40,000+ vehicle modifications linked via fitment/applicability to part numbers — matches exactly what we saw in the site's front-end navigation and the "Характеристики" popup. **Caveat: scoped to 10 product groups only** (maintenance-type parts — filters, brakes, spark plugs, etc.), not the entire catalog — so compatibility lookups will work well for common service parts, but likely won't cover every category (body panels, electronics, trim, etc.). Docs URL: `https://www.abcp.ru/wiki/API.ABCP.Client`. Still worth getting ABCP support's answer on tariff/access requirements (email already sent), but the *existence* of the method is no longer in question.
  - **Found the actual technical spec: ABCP's TecDoc-style REST API, with an official NodaSoft PHP client library on GitHub** (`github.com/NodaSoft/ABCPApiClient`). Full method set: `getManufacturers()`, `getModels($manufacturerId)`, `getModifications($manufacturerId, $modelId)`, `getModelVariant($modificationId)` (category tree), `getArticles($modificationId, $categoryId)` / `getArticlesSimplified(...)`, `getArticle($articleId)`, **`getAdaptability($articleId)`** (⭐ reverse lookup — part → list of compatible vehicles, exactly matches the "Характеристики" popup), `getAnalogs($number, $analogType)`.
    - **⚠️ Auth is separate from everything else used so far.** Requires `userKey` + `userLogin` + `userPsw`, explicitly described as obtained "от менеджера платформы abcp" (from an ABCP account manager) — not the same credentials as the price export or `search/articles`. Strongly suggests this is a **separate, likely paid, provisioned service** (consistent with the "annual contract" language seen earlier on ABCP's crossbase/product-group-catalog pricing page). This is the #1 thing to confirm with ABCP support: cost + whether it's already included in this client's plan.
    - If granted, `getAdaptability($articleId)` is the single most useful method for the recommendation agent — direct part→vehicle fitment lookup, no need to walk the full manufacturer→model→modification tree.
  - **✅ REAL PRICING FOUND (abcp.ru/rates, "Дополнительные решения" table) — no longer guessing.**
    - **"Каталог для ТО" по API** — **48 000 ₽** (one-time/setup cost, per the rates table). Explicit note: *"работает на базе сервиса API, который подключается за отдельную плату"* — meaning this itself depends on ABCP's crossbase API service being connected first (separate cost, see `abcp.ru/crossbase`). This is almost certainly the "Каталог ТО" (1.10.1/1.10.4–1.10.6) methods found in the Client API docs.
    - **"Каталог Aftermarket на основе данных каталога TecDoc"** — **1 200 ₽/мес** (promo) / **1 440 ₽/мес** (base). Much cheaper, recurring monthly cost. Caveat: listed as "данные актуальны на 28.07.23" (data snapshot dated July 2023) — need to confirm with support how often this is refreshed, and whether it includes article-level lookup equivalent to `getAdaptability()` or is closer to the front-end catalog browsing only.
    - **Decision point for the client:** the ~48k one-time "Каталог ТО" option covers only 10 maintenance product groups but is likely more current/complete for those categories; the ~1.2-1.4k/month TecDoc-Aftermarket option is far cheaper but may be less fresh and scope is still unconfirmed. Worth asking support to clarify scope/freshness of the cheaper option specifically — could be the better fit for a recommendation-agent use case where "probably fits" beats "guaranteed exact" for most parts.
  - **✅ SENT to ABCP support** (standalone ticket, not email) — asked specifically: (1) does activating the Aftermarket TecDoc catalog (1200₽/мес) expose a callable API method (e.g. `getAdaptability`-equivalent) or is it front-end-only (`/catalog` page + "Характеристики" popup); (2) how it differs in scope/API-access from the pricier 48k "Каталог для ТО" option; (3) how often Aftermarket data refreshes going forward; (4) whether id2319 already has either service active. **Awaiting ABCP's reply — do not activate/pay for either option until this is answered**, since paying for a front-end-only catalog wouldn't solve the agent's programmatic compatibility-lookup need.

### 🕓 Status (as of 2026-07-03)
**✅ Client has responded — scope is now confirmed.** No remaining blockers. Ready to build the real export.

### ✅ ABCP support's answer — compatibility data question RESOLVED

**Received 2026-07-02.** Direct quote/summary of their reply:
1. **TecDoc/Aftermarket catalog has NO API access at all** — front-end/display only. Cross this off entirely as an option.
2. **"Каталог для ТО по API" (the 48,000₽ option) is actually Carbase catalog data via API — completely different service from TecDoc.** This resolves a naming confusion: what we'd been calling "Каталог ТО" is Carbase, ABCP's own compatibility database, not a TecDoc-derived one.
3. **TecDoc has exited the Russian market**, so its data (the 1,200₽/мес Aftermarket option) **cannot be updated going forward** — permanently frozen. Confirms it's a dead end regardless of API access.
4. **Carbase catalog is already active by default for this account (id2319) — no purchase needed for the data itself.** This explains the "Характеристики" popup and "Из справочника АВСР" we found earlier — that's Carbase, already live on the front-end. **The 48,000₽ fee is solely to unlock API access** to data the client already has and is already using on-site.

**Net result:** the only viable, real path for programmatic compatibility data is **Carbase API access, 48,000₽ one-time**, covering ~10 maintenance product groups (filters, brakes, spark plugs, etc.). No cheaper/free alternative exists via API. TecDoc/Aftermarket is not worth pursuing in any form.

**Follow-up sent to same ticket (#0737086), 2026-07-02 17:55** — asked ABCP support for: (1) Carbase API documentation — endpoint structure, auth method, rate limits; (2) whether "Каталог для ТО через API" is *already* enabled on id2319, and if so, exact scope (which endpoints, limits, response format); (3) confirmation that id2319 is technically ready to use the API immediately after payment (i.e. no separate setup/activation delay).

**❌ FINAL ANSWER, 2026-07-03 — compatibility API is NOT viable for this project. Decision: drop entirely, do not pursue further.**

Support's actual answer: *"Для использования услуги 'Каталог для ТО по API' Вам нужен отдельный аккаунт на одном из тарифов API Crosses."* This revealed the real pricing structure (`abcp.ru` API Crosses tariff page), which is completely different from — and far more expensive than — the 48,000₽ figure originally found on the general `/rates` page:

- **250,000₽ one-time connection fee** (mandatory regardless of tier), requires a signed contract with ABCP.
- Plus a **recurring monthly tariff** on top:
  - "Только кроссы" (cross-references/analogs only): API Crosses 1 = 38,400₽/мес (5,000 req/day), Crosses 2 = 50,400₽/мес (17,000/day), Crosses 3 = 84,000₽/мес (34,000/day), Crosses 4+ = custom pricing for higher volume.
  - "Кроссы + каталоги" (adds the 103 product-group catalogs with full characteristics/photos): 228,000₽/мес, **stacked on top of** a Crosses tier, not standalone.

This is enterprise-tier pricing clearly aimed at large multi-tenant resellers/marketplaces, not a single shop's AI-chatbot compatibility feature. **Decision: this is disproportionate to the project and not worth pursuing at any tier.** No further negotiation attempted — the cost structure itself (contract + 5–6-figure monthly minimums) rules it out regardless of which tier.

### ✅ Final approach for `compatibility` field (locked in)
No programmatic vehicle-fitment API will be used. Instead:
- Rely on the YML feed's existing `name` / `vendor` / `vendorCode` / `description` text, which often already contains model hints (e.g. "XF JAGUAR").
- System prompt must be **explicit and honest about this limitation**: ask the user for their car's make/model/year as context, do a best-effort text match, and **always tell the user to verify exact fitment on the product page (via `product.url`) or with a manager before ordering** — mirroring the safety net the site itself provides (the "Характеристики"/Carbase fitment table already shown on real product pages).
- This is now a closed decision, not an open question — no need to revisit unless the client's budget situation changes drastically.

### 🚨 Scale reality check — 1.18GB combined file, and the finalized filtering rule

**Once the real 5-warehouse export was generated, the combined YML file came in at 1.18GB** (~2.84M offers total per the config page estimate). This confirmed the theoretical concern above was real, not hypothetical, and revealed two separate problems that needed solving:

**1. Architecture problem (file size):** a 1.18GB file cannot be fetched/parsed in a single Vercel serverless function the way `pixmosaic-proxy`'s `catalog.js` does (whole-file `xml2js` DOM parse) — will hit timeout and/or memory limits regardless of plan tier. **Decision: split the export into separate per-warehouse XML files** (client already did this — 4 XML files instead of 1 combined). This doesn't eliminate the need for a streaming parser (`sax`/`saxes` instead of `xml2js`) and a database-backed ingestion step (not an in-memory JSON blob) — see the ingestion/serving split discussed in chat — but it makes each file more manageable to process independently, with partial-success resilience (one warehouse failing doesn't block the others).

**2. Data-quality problem (junk entries + unreliable listings) — SOLVED, this is the more important finding:**

Inspecting real offers in the file revealed two categories of entries that would actively hurt the recommendation agent if included:
- **Non-part administrative entries**: owner's manuals, warranty certificates, door templates, "Zertifikat," stick-on labels, trailer stickers, etc. — legitimate ABCP catalog entries, but useless/confusing for a parts-recommendation use case.
- **Unreliable/low-confidence listings**: e.g. Mercedes brake pad set `A000420920364` — genuinely a real part by name, but the live product page shows **"Под заказ"** (special order only), **"2-3 нед, цену и наличие сначала уточняем в Польше"** (price/availability must be manually confirmed with a Polish supplier first — i.e. even the listed price isn't reliable), and **"Нет информации о применимости"** (no fitment info at all). Recommending this with confidence would be actively misleading.

**✅ FINAL DECISION: only ingest offers that have a `<picture>` tag present. Everything without a picture is excluded, full stop — no separate category-exclusion list needed.**

Reasoning locked in:
- Empirically, both junk categories (manuals/templates/stickers) and the low-confidence backorder example lacked pictures. Picture-presence is being used as a cheap, decent proxy for "this is a normal, actively-carried catalog item" — not a perfect signal, but good enough given what the agent's actual job is (see next point).
- **The agent's job is narrower than initially assumed, which makes this safe:** the agent is not the source of truth on live stock/price/delivery/fitment — the product page (`product.url`) already handles that far better (shows the exact article in stock, backorder alternatives, OEM vs. aftermarket brand options like Ate/Brembo/Zimmermann, all with live pricing). The agent's actual scope is: **find a real, photographed, plausible-match part → hand the user a card with image + basic info + a link → the product page does the rest** (stock, price comparison, fitment confirmation, add-to-cart). This means over-including a slightly-imperfect candidate is low-risk (the product page catches it), but recommending something that turns out to be a backorder-only mislabeled item with no real price is a real risk the picture-filter helps avoid.
- **Known tradeoff, accepted:** this does exclude some genuine in-stock parts that simply lack a photo in ABCP's system (confirmed ~21% picture coverage in earlier smaller-scale testing) — the agent's recommendation pool is smaller than the full catalog. This is an accepted cost, not an oversight.
- This rule should be applied at the **streaming-parse/ingestion stage**, not as a runtime filter in `chat.js` — no reason to store rows that will never be recommended.

**✅ MAJOR SIMPLIFICATION (2026-07-05): ABCP has a built-in export-time image filter — no custom streaming/database architecture needed after all.**

While generating the export, discovered a filter option directly in the YML config screen ("Фильтр по изображению") with exactly the right choice: **"Оставлять только товары с изображениями в справочнике платформы"** (keep only items with a real per-item image in ABCP's reference). Applied it and regenerated.

**Result:** file size dropped from **1.18GB → 12.8MB** (~92x smaller), **21,899 offers, confirmed 100% picture coverage** (0 offers without a `<picture>` tag — verified programmatically). This means:
- The picture-required filtering rule (locked in above) is now applied **server-side by ABCP at export time**, not something we need to implement in a custom parser/ingestion step.
- **The whole streaming-parser + database-ingestion plan from the "Scale reality check" section above is no longer necessary.** 12.8MB is trivially small — the original `pixmosaic-proxy`-style approach (single Vercel function, `xml2js` whole-file parse, no separate database) works fine again.
- **One parser detail to handle:** ~12% of offers (2,583 of 21,899) have **multiple `<picture>` tags** (repeated sibling elements, not a list wrapper) — `xml2js` will parse these into an array automatically. Parser needs: `Array.isArray(offer.picture) ? offer.picture[0] : offer.picture` to pick the first image for the card.

**This resolves nearly all the open architecture questions in one step.** Ready to write `catalog.js` directly against this file/URL, following the `pixmosaic-proxy` pattern almost as-is.

### ✅ Compatibility data — REOPENED with a free, working alternative (2026-07-05)

After the Carbase/API Crosses pricing was confirmed disproportionate (250,000₽+ one-time, see above), a cheaper working alternative was found: **scrape the client's own public vehicle-catalog pages** (`bmwclub77.ru/carbase?ctModificationId=X`), rather than paying for API access to the same underlying data.

**Confirmed technically viable:**
- The catalog uses a clean, simple query-param scheme: `?ctManufacturerId=X` (brand) → `?ctModelId=X` (model) → `?ctModificationId=X` (specific engine/year variant — this page contains the full parts category tree + article list).
- **Confirmed server-rendered, not JS/AJAX-driven** — the article code (e.g. `A0004230912`) appears directly in the page's raw `<meta name="keywords">` tag (verified via View Page Source), meaning a single plain HTTP GET per modification page returns everything needed. No headless browser required — `fetch()` + HTML parsing (e.g. `cheerio`) is sufficient.
- **`ctModificationId` is a simple sequential-ish integer range, not a hierarchy that needs discovering.** Tested and confirmed valid, distinct vehicle pages across **IDs 1 through 42,099** — no need to crawl brand→model→modification levels separately; the crawler can just loop through this ID range directly. (This range matches ABCP's own "~40,000+ vehicle modifications" figure from the Каталог ТО docs found earlier — same underlying dataset, just accessed for free via the public page instead of a paid API.)
- **Cross-reference confirmed working end-to-end**: article `A0004230912`, found via the site's own MERCEDES-BENZ E-CLASS (W211) E280 navigation, exists in the picture-filtered YML catalog (21,899-entry file) with a real picture, price 17,900₽, and matching vendorCode — confirming the scraped article codes will successfully cross-reference against the already-ingested recommendable catalog.

**Planned architecture (NOT live/per-chat-message scraping — a separate periodic background job):**
1. Loop through `ctModificationId=1` to `42099`, fetching each page once (politely rate-limited, moderate concurrency).
2. Per valid page, extract: brand/model/generation/modification metadata (engine code, years, fuel, power — all visible in the page's vehicle-info box) + every article/vendorCode in that modification's parts tree (via the `<meta keywords>` tag).
3. Filter down to only vendorCodes that exist in the picture-filtered catalog (21,899 entries) — discard the rest.
4. Output: a JSON mapping `vendorCode → [{brand, model, modification, years, engine}, ...]`, stored alongside the catalog JSON in the proxy repo.
5. **Run infrequently** (e.g. monthly) — vehicle taxonomy barely changes, unlike price/stock. Full crawl estimated at ~1-2.5 hours with modest concurrency (5-10 parallel requests), or longer single-threaded; GitHub Actions' free-tier 6-hour job limit may require chunking the ID range across a matrix job if going conservative on request rate.
6. **At chat time**, `chat.js` looks up the user-stated car model against this pre-built mapping (instant, no live scraping) to get candidate vendorCodes, then builds the card from the already-ingested catalog data.

**Not yet built** — next concrete step is writing the crawler script.

### Key architecture decision
**One combined YML export, not separate exports per brand.** Brand filtering (BMW vs Mercedes vs Jaguar etc.) should happen at the code level (filter by `<vendor>` field in the proxy or in `chat.js`'s `fetchCatalog()`), not as multiple separate ABCP export configs. Reasons: avoids maintaining N scheduled jobs/URLs/proxies, and every offer already carries a `<vendor>` field to filter on.

Open question once client responds: full combined catalog across all their warehouses could be very large (BMW aftermarket catalogs can run 100k+ SKUs) — may be too big to inject wholesale into Claude's system prompt like the mosaic project does. **Need to check real combined offer count once client confirms scope**, and likely add a runtime filtering/keyword-matching step before building the system prompt (mosaic's catalog was small enough to skip this; car parts likely won't be).

### Next steps (in order)
1. **✅ Client scope confirmed** (see above) — no remaining blockers.
2. **✅ Real export generated with built-in image filter** — 12.8MB, 21,899 offers, 100% picture coverage confirmed. No streaming parser or database needed — file is small enough for a simple `pixmosaic-proxy`-style approach.
3. **✅ Compatibility approach found and confirmed technically viable** — scraping `/carbase?ctModificationId=1-42099`, cross-referenced against the catalog. Crawler not yet written — this is the next substantial build task.
4. Set a **Расписание** (refresh schedule) on the price/YML export config — target within ABCP's free generation window (17:00–06:00 MSK) to avoid overage costs. Not yet done.
5. **✅ `catalog.js` written, deployed, and now confirmed fully working in production** at `https://abcp-catalog-proxy.vercel.app/api/catalog` — real response verified: `total: 21899`, categories resolving correctly, pictures/prices/vendor data all correct.

   **Two deployment bugs found and fixed along the way (2026-07-05), worth remembering if similar issues recur on other endpoints:**
   - **Region/timeout:** default Vercel region (`iad1`, US East) was too slow reaching the Russian-hosted `bmwclub77.ru`, causing the function to hit its 30s timeout without completing. Fixed by adding `"regions": ["fra1"]` (Frankfurt) to `vercel.json` and raising `maxDuration` to 60s (the project's actual cap). No evidence of active blocking/throttling — it was genuinely just distance/latency.
   - **Gzip decoding:** the original `fetchXML()` sent `Accept-Encoding: identity` hoping to get an uncompressed response, but the server/CDN sent gzip-compressed data anyway (ignoring that hint). This caused `xml2js` to choke on raw compressed bytes (visible as a `\u001f` control character — the gzip magic number — in the error). Fixed by detecting the actual `content-encoding` response header and decompressing with `zlib` accordingly, regardless of what was requested.
   - **Secret handling:** `XML_URL` moved from a hardcoded string to `process.env.ABCP_EXPORT_URL`, set in Vercel's environment variables (not committed to git) — repo is private, but this adds defense-in-depth in case of accidental exposure.

6. **✅ Compatibility crawler fully built, tested, and validated** against 4 known-good real IDs (12690, 12691, 12692, 12700) — 0 errors, 100% correct field extraction confirmed by hand against the live site. Not yet run at full scale (1-42,099).

   **Debugging journey and fixes along the way (2026-07-05 – 2026-07-06), worth remembering:**
   - **GitHub Actions' IP range is blocked by bmwclub77.ru's hosting** (confirmed via a direct control test: the exact same requests succeeded instantly from a normal Moscow machine but timed out consistently from GitHub Actions runners, for both the homepage and `/carbase` pages). This is a common pattern — GH Actions IPs are heavily used for scraping across the web and frequently blocklisted by WAFs. **Decision: run this crawler locally or from a small non-cloud-datacenter VPS, NOT GitHub Actions.** The `.github/workflows/crawl-compatibility.yml` file is kept for reference/documentation but isn't the actual execution path.
   - **Session cookies required.** `bmwclub77.ru` runs a lightweight bot-check on first visit: it 302-redirects twice (through a path like `/.abcp-dbfsr/bdhz/...`), setting session cookies along the way, before returning the real page. `fetch()` doesn't persist cookies across redirects like a browser does — without handling this manually, every request loops forever (`"redirect count exceeded"`). Fixed by bootstrapping the session once at crawl start (manually following the redirect chain, accumulating `Set-Cookie` headers) and reusing those cookies for the entire run — cookies observed lasting 1 day to 2 months, so one bootstrap comfortably covers a full crawl.
   - **IPv4-first DNS resolution** added defensively (Node-on-Windows can be slow/hang on IPv6 in some environments — browsers handle this automatically via Happy Eyeballs, Node's `fetch()` doesn't).
   - **Metadata extraction bugs found and fixed via real output review:**
     - Brand/model extraction initially grabbed header/nav links instead of the actual breadcrumb (fixed: target `a[href*="ctManufacturerId="]` / `a[href*="ctModelId="]` specifically, which are unambiguous).
     - Engine code / fuel type were splitting incorrectly (e.g. `"Дизель"` → `"Дизел"` + `"ь"`) due to a regex-backtracking bug caused by a loose fallback pattern. Fixed with a lazy quantifier and requiring one of the known fuel words explicitly.
     - Added `modificationName` (e.g. `"E 280 4-matic (211.092)"`) as its own field, extracted from the H1 title using a regex built dynamically from the already-known brand/model strings — captures whatever text follows them, up to "Купить".
   - **Final validated field shape per vendorCode entry:** `vendor`, `modificationId`, `brand`, `model`, `modificationName`, `engineCode`, `fuel`, `engineVolumeCc`, `powerHp`, `bodyType`, `years`.

   **Next action: run the full crawl (set `TEST_IDS = null`, all 1-42,099 IDs) locally from a normal machine/network** (not GitHub Actions). Expect roughly 1-2.5 hours at the current concurrency/delay settings. The script has checkpoint/resume built in (saves progress every 200 IDs) in case it's interrupted.

### 🛑 CRAWLER APPROACH SUSPENDED INDEFINITELY (2026-07-06/07) — real-world harm occurred, pivoted to manual table

**What happened:** the full-scale crawl (even after adding gentler pacing, a circuit breaker, and retry logic) triggered the site's anti-bot system into a broader block — to the point that **the person running it was personally locked out of logging into the client's own site** (not just the script failing). This is materially different from "the script got rate-limited" — it's actual disruption to the client's own team's access to their own tools.

**Decision: stop using the automated `/carbase` scraping approach entirely, indefinitely.** Not "pause and retry later with different settings" — treat this as closed unless a fundamentally different, safer access method becomes available (e.g. the client formally whitelisting a specific IP in their own WAF, or ABCP/Carbase API pricing changes). The risk of repeating or worsening this outcome isn't worth it for what was always a workaround for a paid feature already judged too expensive.

**Pivot: manually-built compatibility table, already in progress and validated.** Using the same brand list shown on the client's own live homepage (Audi, BMW, Land Rover, Mercedes-Benz, Nissan, Porsche, VW, Volvo — confirmed these are the only brands the client actually sells), a manual XML table is being built by hand: one row per engine variant (manufacturer, engine, model, period, engineCode, fuelType, displacement, bodyStyle, power), each with its typical service parts (vendorCode + description) — sourced by browsing the live `/carbase` pages normally in a browser (manual browsing is fine; it was automated bulk scraping specifically that triggered the block).

- **Validated 2026-07-07:** first batch (Audi A1 + A3, 41 engine variants, 39 unique vendorCodes) checked against the real catalog — **100% match rate**, all 39 vendorCodes exist in the picture-filtered catalog. The bridging key (`vendorCode`) works perfectly between this manual table and `catalog.js`'s output, exactly as designed.
- **Estimated 5-7 days to complete** all 8 brands — many models share identical common-service part codes (oil filter, brake pads, etc.), so coverage should accelerate as a reusable part-code library builds up across similar models/engines.
- **This manual table becomes the actual `compatibility-map.json` equivalent** once complete — same consumption pattern in `chat.js` (vendorCode → array of compatible vehicles), just sourced by hand instead of by crawler. No difference to `chat.js`'s integration logic.
- **Revisit automated crawling only if/when a safer access method exists** — not as a default next step.

### ✅ UPDATE (2026-07-08): a safer hybrid workflow found — automated crawling resumed, carefully

**Not a reversal of the suspension decision above — a genuinely different, much gentler method**, found independently: instead of blind sequential iteration through the full 1-42,099 ID range (what caused the site-wide block), the project owner now **browses the live site normally** (as a real user, opening car-generation pages by hand) to discover which `modificationId`s are actually relevant, then feeds small batches (**max ~20 IDs at a time**) into the existing crawler script, with **30-40 minute cooldowns between batches**. This has run successfully multiple times with no repeat of the lockout.

**Why this works where the full crawl didn't:** the volume and pacing are now indistinguishable from a human occasionally refreshing pages — nothing like the sustained thousands-of-requests-per-hour pattern that triggered the anti-bot escalation before. The crawler script itself (session cookies, retry logic, metadata extraction — all built and validated earlier) didn't need any changes; it's the *usage pattern* that changed.

**Validated results, first real batch (2026-07-08):**
- 119 unique `modificationId`s crawled (502 total page loads including overlaps from browsing multiple related models).
- **183 unique vendorCodes** captured with full compatibility metadata (brand, model, modificationName, engineCode, fuel, engineVolumeCc, powerHp, bodyType, years).
- Cross-referenced against the real product catalog: **100% match rate** (all 183 vendorCodes exist in the catalog) — same clean result as the earlier Mercedes test batch, now confirmed working for a completely different brand family (Audi/VAG) too, proving the extraction logic generalizes correctly.

**Practical implications:**
- This is a better path than either extreme: safer than the full automated crawl, faster and less error-prone than a fully hand-typed table.
- **Still fundamentally a manual-pace process** — bounded by the person's own browsing time plus the 30-40 min cooldowns — but each batch produces clean, structured, typo-free data rather than hand-transcribed entries.

### ✅ FINAL DECISION (2026-07-08): two-file compatibility system, `Car_model_list.xml` retired

**`Car_model_list.xml` (the hand-typed table) is no longer used.** Superseded entirely by the hybrid crawl workflow's output, now formalized as two accumulating files:

- **`Compatability_catalog.json`** — the actual data source (`vendorCode → [{brand, model, modificationName, engineCode, fuel, years, ...}]`). This is what `chat.js`'s `fetchCompatibility()` will read from once hosted (see `COMPATIBILITY_API_URL` TODO).
- **`Crawled_modificationIds.json`** — a scope/tracking list of which `modificationId`s have been crawled so far. Its purpose is deliberately narrow: it defines **which car models are actually relevant to this client** (not the full 1-42,099 ABCP range) and prevents wasted re-crawling of IDs already captured. New batches should check against this list before crawling, and append newly-crawled IDs to it afterward.

**Not yet built:** an actual merge script. Right now, combining a new hybrid-crawl batch into these two accumulating files is manual. Needs: (1) dedupe `modificationId`s against the existing `Crawled_modificationIds.json` list, (2) merge new `vendorCode` entries into `Compatability_catalog.json` (concatenating vehicle-fitment arrays for vendorCodes that already exist, adding new keys for ones that don't) — same merge logic the crawler script's `retry` mode already does internally, likely adaptable into a standalone `merge-batch.js` script.

### ✅ Escalation & Bitrix24 lead capture — built (2026-07-07), waiting on client's Bitrix24 webhook

**Why this exists:** discovered that ABCP's applicability/fitment database (Carbase/`справочник АВСР`) only covers a specific subset of categories — maintenance items (filters, brakes, spark plugs, batteries, etc.) — not the whole catalog. Confirmed concretely: a BMW thermostat housing (`11517572859`, `categoryId=3`, generic "Запчасти" bucket) has **no fitment data anywhere on the site** — not in the car-model dropdown, not in the part's own "Характеристики" popup ("Нет информации о применимости"). This is a real, permanent gap in the source data, not something the manual table or any crawler could fix. **Decision: turn this gap into a lead-capture opportunity** — when the agent can't confirm something, ask the user for phone/email and hand off to a human via Bitrix24, instead of guessing or dead-ending.

**Trigger conditions (confirmed with the project owner):**
1. No compatibility/fitment data found for a requested part.
2. Agent can't find any matching product in the catalog at all.
3. User explicitly asks for a manager/human.

**What was built, across three files in `Car-Parts-Ai-Recommendation`:**

- **`api/chat.js`** — system prompt now explicitly instructs Claude to (a) recognize the three trigger conditions above, (b) honestly explain why it can't fully help, (c) ask the user in plain chat text to leave a phone number or email, and (d) show the existing `<<<MANAGER_BUTTON>>>` marker so the handoff can fire. Reuses the widget's existing button mechanism rather than inventing a new one.

- **`api/session/manager.js`** — **fully rewritten**, two real problems found and fixed:
  - The summary prompt was still the **literal mosaic-tile template** (asking for "🧩 Интерес: [тип мозаики]", "📐 Площадь") — never adapted for car parts. Replaced with a structured, machine-parseable format (`PHONE:`/`EMAIL:`/`NAME:`/`REASON:`/`CAR:`/`PART:`/`SUMMARY:`) that Claude fills in from the transcript, parsed reliably via line-matching rather than fuzzy regex over freeform text.
  - **A real, working Bitrix24 webhook URL was hardcoded as a "fallback"** (`b24-q8506c.bitrix24.ru/...`) — leftover from the mosaic client's actual Bitrix24 account, copied over via the template. This was dangerous: if `BITRIX24_WEBHOOK_URL` were ever unset, leads would have silently gone to the **wrong company's** Bitrix24 instead of failing loudly. **Removed entirely** — the endpoint now returns `bitrix_not_configured` and logs an error if the env var is missing, rather than falling back to anything.
  - Changed from `im.notify.system.add` (a transient internal chat ping) to **`crm.lead.add`** — creates a real, trackable CRM Lead with structured `PHONE`/`EMAIL` fields, `TITLE` (reason + car model), and `COMMENTS` (part, car, summary, session ID) — assignable/trackable by staff, not just a message that scrolls away.
  - Supabase logging (`SUPABASE_URL`/`SUPABASE_SERVICE_KEY`) kept exactly as-is — best-effort, non-blocking, degrades silently if unconfigured. **Not confirmed whether Supabase is actually set up for this project** (owner wasn't sure) — doesn't matter, the Bitrix24 lead creation is the real required path and doesn't depend on it.

- **`widget/chat-widget.js`** — confirmed the existing wiring already matches: `triggerManagerHandoff()` posts `{session_id, messages}` to `/api/session/manager`, exactly what the rewritten `manager.js` expects — **no widget changes needed for the core pipeline**. One small additive fix: the manager button was previously a silent background action framed purely as "call us" (`tel:` link, zero visible confirmation). Added a visible confirmation message after the handoff completes, checking the actual API response (`data.ok`) rather than assuming success.

**Still pending before this is live:**
- `BITRIX24_WEBHOOK_URL` — needs the client's Bitrix24 incoming webhook (with `crm` scope enabled), expected once their account is created (~2026-07-08).
- `TODO_COMPANY_NAME`/`TODO_PHONE`/`TODO_EMAIL`/`TODO_ADDRESS`/`TODO_HOURS` in `chat.js`/`chat-widget.js` — still genuinely unknown, need real values from the client.
- End-to-end test once both the webhook and the compatibility table (or at least a usable chunk of it) are ready.
7. **⏭️ Continue the hybrid crawl workflow** (browse client-relevant car models manually → batch-crawl ≤20 modificationIds at a time with 30-40 min cooldowns) to grow `Compatability_catalog.json` / `Crawled_modificationIds.json` — covering the 8 relevant brands (Audi, BMW, Land Rover, Mercedes-Benz, Nissan, Porsche, VW, Volvo). `Car_model_list.xml` is retired, not used going forward.
8. Build a merge script/process so each new batch's output cleanly dedupes against `Crawled_modificationIds.json` and merges into `Compatability_catalog.json`, instead of manual copy-paste. Then host the accumulated file and wire `COMPATIBILITY_API_URL` into `chat.js` — no other changes needed, `fetchCompatibility()` already expects exactly this shape.
9. **✅ `api/chat.js` rewritten** — correct catalog field mapping (`vendorCode`→`article`, `vendor`→`brand`, matching the real `abcp-catalog-proxy` output), added `fetchCompatibility()` (degrades gracefully to empty if not yet configured), and escalation logic built into the system prompt (see new section below).
10. Fill remaining `TODO` placeholders in this repo (see table further down).
11. **✅ Escalation / lead-capture feature built** (2026-07-07) — see "Escalation & Bitrix24 lead capture" section below for full details. `api/session/manager.js` and `widget/chat-widget.js` both updated; waiting on client's Bitrix24 webhook (account being created, expected 2026-07-08) before this goes live.

---

## ⚠️ Catalog field mapping — ABCP YML vs. this repo's original placeholder schema

The field names below (`article`, `brand`, `compatibility`, `stock`) were an initial placeholder guess written before the actual ABCP feed was inspected. **They don't fully match reality.** Use this table when writing `catalog.js` and `chat.js`:

| This repo's placeholder field | ABCP YML actual tag | Notes |
|---|---|---|
| `article` | `vendorCode` | |
| `name` | `name` | matches |
| `brand` | `vendor` | |
| `category` | `categoryId` | numeric ID only — needs a lookup against the `<categories>` block (id → readable name) in the same feed, similar to how pixmosaic flattened `<param>` tags |
| `compatibility` | **REOPENED with a working free approach: scraping the client's own `/carbase?ctModificationId=X` pages (IDs 1-42,099 confirmed valid), cross-referenced against the picture-filtered catalog.** See the "Compatibility data — REOPENED" section above for full technical confirmation and crawl plan. Not yet built. | Separate periodic crawl job (not live/per-chat), output stored as its own JSON mapping alongside the catalog. |
| `price` | `price` | matches |
| `stock` | **not present as a quantity — only `available="true/false"` boolean** | If client needs real quantities, the export's "Наличие товара" setting and/or a different data source will need revisiting. |
| `url` | `url` | matches. **This is also the product card's button target** — confirmed it's a direct link to a fully working product page (live stock, price, analogs, working add-to-cart on the site itself). Open in a new tab from the widget. |
| `picture` | `picture` | **✅ RESOLVED server-side.** ABCP's export config has a built-in "Фильтр по изображению" — selected "Оставлять только товары с изображениями в справочнике платформы," which filters at export time. Result: 12.8MB file, 21,899 offers, **100% picture coverage confirmed** (0 without). ~12% of offers have multiple `<picture>` tags (xml2js parses as array) — parser should take the first element. |

Also note: unlike pixmosaic's feed, **ABCP's YML has no `<param>` blocks** (no material/surface/size attributes) — the offer structure is flatter. Don't port pixmosaic's params-extraction loop as-is.

---

## Project structure

```
Car-Parts-Ai-Recommendation/
├── api/
│   ├── dashboard/
│   │   ├── sessions.js         ← Sessions data endpoint for dashboard (Аналитика tab)
│   │   ├── products.js         ← Manual cross-sell products endpoint (Товары tab) — list/add/delete, paste-HTML extraction + manual price
│   │   ├── product-views.js    ← "Подбор" tab: first message, shown & opened cards per chat (session 15)
│   │   ├── missing-articles.js ← "Нет фото" tab
│   │   └── billing.js          ← "Тариф" tab
│   ├── session/
│   │   ├── event.js            ← Public: records first_message / products_shown / product_open (session 15)
│   │   ├── end.js              ← Ends a user session (accepts text/plain beacons)
│   │   ├── manager.js          ← Bitrix24 lead creation + Claude-generated summary
│   │   └── start.js            ← Starts a new user session
│   ├── chat.js                 ← Vercel serverless function (Claude proxy) — deterministic compatibility + oil matching, then Sonnet 5
│   └── image.js                ← Image handling endpoint
├── lib/
│   ├── laximo.js               ← Laximo scraper: VIN + model (wizard) paths, cache, safeguards (session 14)
│   └── chatEvents.js           ← chat_events table: validation, insert, per-session grouping (session 15)
├── scripts/
│   └── test-laximo-parsers.js  ← Checks Laximo parsers against saved page sources
├── dashboard/
│   └── index.html               ← Admin dashboard (Аналитика, Товары, Подбор, Нет фото, Тариф tabs)
├── widget/
│   └── chat-widget.js           ← Chat UI loaded by the client's landing page (localStorage persistence, product card carousels)
├── apple-touch-icon.png        ← PWA / bookmark icon
├── .env.local                   ← Your API key (NEVER commit)
├── .gitignore
├── vercel.json                  ← Routes + CORS headers
└── README.md

abcp-catalog-proxy/               ← separate repo, mirrors pixmosaic-proxy's structure
├── api/
│   ├── catalog.js                ← Serves price/stock catalog from Supabase cache (live-fetch fallback)
│   ├── compatibility.js          ← Serves Compatability_catalog.json directly from the repo
│   └── refresh-catalog.js        ← Protected endpoint, fetches+parses ABCP XML export, writes to Supabase (triggered by GitHub Actions cron every 6h)
├── scripts/
│   └── crawl-compatibility.js    ← Crawls ABCP's vehicle-fitment pages (getAdaptability), hybrid manual+batch workflow
├── merge-compatibility.js        ← Dedupes/merges hybrid-crawl batches into the two accumulating files
├── Compatability_catalog.json    ← Accumulated vendorCode → vehicle-fitment data
├── Crawled_modificationIds.json  ← Scope/tracking list of already-crawled vehicle modifications
└── .github/workflows/
    └── refresh-catalog.yml       ← GitHub Actions cron (every 6h + manual trigger)
```

**Supabase tables** (shared project across both repos): `chat_sessions` (session logging), `chat_events` ("Подбор" tab events, auto-created), `laximo_cache` (Laximo results + pause state, auto-created), `missing_articles`, `catalog_cache` (price/stock, refreshed by the cron above), `manual_products` (client-curated oils/fluids/etc. with no vehicle-fitment data on ABCP's platform — see "Compatibility matching architecture" below).

---

## Step 1 — GitHub repo

Repository is already created at:
```
https://github.com/Aris1672/Car-Parts-Ai-Recommendation.git
```

To push changes from VS Code terminal:
```bash
git add .
git commit -m "describe what you changed"
git push
```

---

## Step 2 — Deploy to Vercel

1. Go to https://vercel.com/new
2. Click **Import Git Repository** → select `Car-Parts-Ai-Recommendation`
3. Framework Preset: **Other**
4. Click **Deploy**

Current known deployment: `https://car-parts-ai-recommendation.vercel.app`

---

## Step 3 — Add your Anthropic API key

1. In Vercel dashboard → your project → **Settings** → **Environment Variables**
2. Add:
   - Name: `ANTHROPIC_API_KEY`
   - Value: `sk-ant-xxxxxxxxxxxxxxxx` (your key from console.anthropic.com)
   - Environment: ✅ Production ✅ Preview
3. Click **Save**
4. Go to **Deployments** → click the three dots → **Redeploy** (to apply the env var)

---

## Step 4 — Fill in the TODO placeholders

Before deploying, open `api/chat.js` and `widget/chat-widget.js` and replace every `TODO` with real values:

| Placeholder | What to put | Status |
|---|---|---|
| `TODO_COMPANY_NAME` | Client's company name (bmwclub77 / actual legal name?) | not yet filled |
| `TODO_SITE.ru` | `bmwclub77.ru` | not yet filled |
| `TODO_PHONE` | Contact phone (display format) | not yet filled |
| `TODO_PHONE_DIGITS_ONLY` | Same phone, digits only e.g. `+79991234567` | not yet filled |
| `TODO_EMAIL` | Contact email | not yet filled |
| `TODO_ADDRESS` | Company address | not yet filled |
| `TODO_HOURS` | Working hours e.g. `Пн-Пт 09:00–18:00` | not yet filled |
| `TODO-YOUR-CATALOG-PROXY.vercel.app` | Catalog API endpoint URL | **blocked — proxy repo not built yet** |
| `TODO-YOUR-PROJECT.vercel.app` | `car-parts-ai-recommendation.vercel.app` | can be filled now |

---

## Step 5 — Widget server URL (historical, no action needed)

No longer needed: the widget gets its server address from `window.AGENT_URL` in the embed code (see "🔌 WIDGET EMBED CODE" at the top). The fallback inside `widget/chat-widget.js` is the live server, `https://bmwclub77.assistant24info.ru`, not a placeholder. The app runs on Coolify, not Vercel.

---

## Step 6 — Add the widget to the client's landing page

Use the **live** code from "🔌 WIDGET EMBED CODE" at the top of this README (ABCP: Внешний вид и контент → Инфоблоки → "Блок в подвале"):
```html
<!-- AI Chat Widget -->
<script>
  window.AGENT_URL = 'https://bmwclub77.assistant24info.ru';
</script>
<script src="https://bmwclub77.assistant24info.ru/widget/chat-widget.js" defer></script>
```
⚠️ Older versions of this README showed a `car-parts-ai-recommendation.vercel.app` address here. **Don't use it**; the app moved to Coolify.

Wire up any existing chat button:
```html
<button onclick="window.AutoChat && window.AutoChat.open()">
  Подобрать запчасть
</button>
```

---

## Step 7 — Access the Analytics Dashboard

The admin dashboard is available at:
```
https://car-parts-ai-recommendation.vercel.app/dashboard
```

It shows:
- **Total sessions** — unique conversations
- **Call conversion** — % of sessions that requested a manager
- **Manager requests** — total call requests
- **Last activity** — most recent session timestamp
- **Sessions by day** — bar chart with date filter

---

## Step 8 — Test locally

To test the API locally with Vercel CLI:
```bash
npm i -g vercel
vercel dev
```
Then set `window.AGENT_URL = 'http://localhost:3000'` temporarily in the widget.

---

## Compatibility matching architecture (why it works the way it does)

**Original design (retired 2026-07-10):** `chat.js` fetched the full catalog and full compatibility dataset, compacted them, and pasted both as raw JSON directly into the system prompt on every turn — one Claude call, no separate lookup step. Simple, but it broke in two escalating ways as real data volume arrived:

1. **Token-limit crash.** Once the catalog fetch was actually succeeding (see the timeout-bug fix above), the full ~22k-product catalog blew the prompt out to 2.75M tokens — over 13x Claude's 200k context limit. Fixed first by filtering the catalog down to only vendorCodes present in the compatibility data (nothing else can ever be recommended anyway, since compatibility can't be confirmed for it) — this alone got typical prompts down to ~10k tokens for the current crawl coverage.
2. **Cross-vehicle hallucination.** Even with the smaller, filtered payload, the model would sometimes present a *different* vehicle's fitment record as if it matched the customer's car (e.g. citing an Audi A6 Avant record while discussing an A4 — same part number, wrong vehicle attached). **This was tested and confirmed on both Claude Haiku and Claude Sonnet 5** — the same failure mode on a much stronger model rules out "the model just isn't smart enough" and points instead to a structural issue: correctly picking one matching record out of a few hundred embedded in a JSON blob is a *retrieval/search* task, not a *reasoning* task, and LLMs are unreliable at exact retrieval over multi-KB embedded data regardless of model size.

**Current design:** a deterministic, two-stage pipeline per message:

1. **Extraction (cheap, Claude Haiku, `temperature: 0`)** — `extractVehicleInfo()` in `chat.js` reads the conversation so far and returns strict JSON: `{vendorCode, brand, model, engineCode, powerHp, partKeywords}`. Small prompt, small output, fast and cheap by design — this call's only job is pulling structured fields out of freeform text, which LLMs are genuinely good at (unlike needle-in-haystack retrieval).
2. **Matching (deterministic, plain JavaScript, no LLM)** — `matchCompatibility()` searches the full compatibility dataset directly in code:
   - Direct `vendorCode` hit if the customer named a specific article, no further filtering.
   - Otherwise: case-insensitive brand match + fuzzy model-name match (`normalizeModel()` strips bracketed chassis codes and punctuation, so `"A4 Allroad"` correctly matches a record stored as `"A4 Allroad (8KH, B8)"`) + engine-code overlap check (`engineCodesOverlap()`) **only if** the customer has given an engine code — if they haven't yet, all matching engine variants for that model are kept so the agent can show them and ask the customer to disambiguate using real data, rather than guessing.
3. **Conversational response (Claude Sonnet 5)** — only the already-matched result (typically 0–5 records, not the full ~214) gets spliced into the system prompt. The model's job is reduced to natural dialogue and formatting around an answer that's already correct, instead of also being responsible for finding it.

This fixes the hallucination bug (matching is deterministic and testable, not probabilistic) and further reduces prompt size/cost on top of the earlier catalog filter (typical compatibility payload per turn: a handful of records instead of ~214).

**Part-category filtering (added 2026-07-22 — this is what actually keeps cost scoped to the question, not just the vehicle):** the vehicle-matching stage above answers "which vendorCodes fit this car," but says nothing about *which part* the customer wants. Left alone, that means a query like "brake pads for my BMW X5" returns every vendorCode that fits an X5 for *any* part category — and as the compatibility catalog grows to cover more parts, that set (and the resulting prompt) grows with total catalog size, not with the actual question. This was invisible early on (only a couple of brands crawled, coincidentally small matched sets) and got expensive as more parts were added — the exact "worked well before, now it's costly" pattern to watch for with this kind of code.

Fix: `extractVehicleInfo()` also extracts `partKeywords` (an array of Russian terms, since the catalog's `name`/`category` fields are in Russian) — a single element for a specific part ("тормозные колодки"), or an expanded standard list for broad maintenance requests (the prompt explicitly instructs this expansion, so "everything for a service" becomes `["масляный фильтр","моторное масло","воздушный фильтр","салонный фильтр","свеча зажигания","тормозные колодки","тормозной диск"]` rather than a single non-matching phrase like "техническое обслуживание"). `filterCatalogByPartKeyword()` then does a plain OR-matched substring check against `name`/`category` — same "match in code, not in the prompt" principle as vehicle matching, for the same reason.

**Update (2026-08-15):** the catalog's `name`/`category` fields turned out to NOT be reliably Russian — ABCP's feed mixes in English-named products too, which silently broke this matching for those items (real case: a BMW X6 E71 windshield named "Green windshield, shade band+rain sensor" was correctly vehicle-matched but never survived the Russian-only keyword filter). Fixed with a small hardcoded `PART_KEYWORD_RU_EN` dictionary checked alongside the Russian stemming — see PROJECT STATUS and TO DO above.

Two safety nets, both worth keeping in mind if this needs to change again:
1. **No part named yet** (mid-conversation, before the customer has said what they need): falls back to a hard cap (40 items) instead of the full vehicle-matched set.
2. **Keyword filter zeroes out a real result** (imperfect extraction, unusual phrasing): if `partKeywords` is present but the filtered result is empty while the vehicle-matched set wasn't, falls back to the capped unfiltered set rather than silently telling the customer nothing was found — this exact failure mode is what caused the same-day regression (see PROJECT STATUS above).

**BMW model-naming edge cases in `normalizeModel()` (found 2026-07-23):** the vehicle-matching stage above (step 2, `matchCompatibility()`) relies on `normalizeModel()`'s digit+letter merge (e.g. "320 I" → "320I", so a customer's "320i" reliably matches however the catalog spells the same trim) plus per-token independent substring checks against the record's own compacted string — token order doesn't matter, but token *contents* do, and BMW has two naming markers that don't concatenate the same way in the catalog as they do in customer speech:

- **"M" (performance division):** unlike engine-suffix letters (i/d/xd/li), "M" is always its own word and never concatenated to a number by convention — but the merge regex didn't know that, so "X5 M" merged to token "X5M". The catalog stores M-models with the chassis code *between* the number and "M" (`"X5 (E70)"` + `"M"` → `"X5E70M"` once compacted), so "X5M" was never a substring of it. Fix: exclude standalone "M" from the merge, so "X5" and "M" stay separate tokens — each is trivially found in "X5E70M" independently, regardless of what sits between them in the original string.
- **"xDrive" (AWD marker):** the catalog spells it out as its own word (`"xDrive 50 i"`), while customers/Haiku commonly use the shorthand of a trailing "x" fused onto the trim number (`"50iX"`). Both directions merge correctly on their own terms, but the resulting strings don't share a common substring where the marker lives (`"XDRIVE50I"` vs `"...50IX"` — the two X's are nowhere near each other post-compaction). Fix: strip "xDrive" — both the spelled-out word and the shorthand trailing "x" — from *both* sides before comparing.

Both bugs shared the same shape: a correctly-catalogued part (confirmed present in `Compatability_catalog.json` in both cases) matched zero results, and the agent told the customer to contact a manager for something that was in stock the whole time. Both fixes deliberately favor recall over precision — occasionally losing the ability to distinguish (e.g.) M from non-M or xDrive from non-xDrive during the *model-name* match is an acceptable tradeoff, since the customer's own stated engine code and other details still narrow things down, and a false "not found" is worse for the business than an occasional over-broad match.

**If a third BMW-naming-convention bug like this turns up:** treat it as a pattern rather than patching another one-off marker — worth doing a broader audit of `normalizeModel()` against a wider sample of real BMW model/trim strings from the catalog rather than continuing to fix these reactively as they're reported.

**Known trade-off:** the extraction step is a separate API call every turn (small/cheap, but non-zero latency + cost). Diagnostic logging (`console.log('DIAG match-check', ...)` in `chat.js`, a flat JSON object) prints the extracted fields, part-keyword filter status, match counts, and resulting prompt sizes — useful for auditing whether the matching layer found what it should have, and for comparing token cost against the old full-blob approach. Remove once the pipeline's been stable in production for a while (see TODO).

**Debugging note (2026-07-10 incident):** a "the agent doesn't know a match that should exist" report turned out to be **stale data on the debugging side, not a pipeline bug** — the live `Compatability_catalog.json` served by `api/compatibility.js` didn't yet contain a locally-fixed record that hadn't been pushed to the repo. Lesson: when a match unexpectedly fails, check the *actual live* data via the deployed `/api/compatibility` endpoint directly (browser `Ctrl+F` on the raw JSON works fine) before assuming the extraction/matching code is at fault — and note that `api/compatibility.js` has its own independent in-memory cache (6h TTL) on top of `chat.js`'s own cache, so a fresh Vercel deployment (which resets both) may be needed to see a just-pushed data fix reflected live.

**Related data-integrity incident (same day):** manual edits to `Compatability_catalog.json` (bypassing `merge-compatibility.js`) introduced **duplicate top-level JSON keys** — valid JSON syntax, but `JSON.parse` silently keeps only the last occurrence of a repeated key, discarding earlier ones. This looked identical to "data went missing" when in fact it was several different versions of the same vendorCode's data sitting in the file simultaneously, with only the last one surviving parse. Always edit these files via `merge-compatibility.js`, never by hand — if a manual fix is unavoidable, verify afterward that no vendorCode key appears more than once in the raw file (a JSON formatter/linter won't catch this on its own, since duplicate keys aren't a syntax error).

---

## Compatibility data pipeline (Git LFS + Supabase)

**Why this exists:** `Compatability_catalog.json` accumulates with every crawl batch and crossed 60MB in mid-2026 (past GitHub's 50MB soft-warning threshold, approaching its 100MB hard cap). This section documents the migration to Git LFS + Supabase, including the dead ends hit along the way — worth reading before changing any of this, since more than one plausible-looking fix turned out not to work for non-obvious reasons.

**Step 1 — Git LFS.** `git lfs track "Compatability_catalog.json"` (creates/updates `.gitattributes`), tracked going forward only — past commit history was NOT migrated (`git lfs migrate import --everything` was considered and deliberately skipped; simpler, no force-push/history-rewrite needed, at the cost of old large versions still sitting in git history).

**Step 2 — Vercel doesn't resolve LFS pointers.** `api/compatibility.js` originally read the file straight off the Vercel filesystem via `fs.readFileSync()`. Once the file was LFS-tracked, Vercel's build checks out the small ~130-byte *pointer* text (`version https://git-lfs.github.com/spec/v1...`), not the real content — so the endpoint started returning `JSON.parse` errors on the pointer text. Vercel does not run `git lfs pull` as part of its build.

**Step 3 — dead end: live LFS fetch from Vercel.** First fix attempt: have `api/compatibility.js` fetch the real content live from GitHub on each request. The `media.githubusercontent.com/media/...` shortcut URL was tried first and abandoned — it 404's unreliably even with correct auth/paths, likely because it's an undocumented convenience redirect, not a real supported API. Replaced with the **official Git LFS Batch API** (fetch the small pointer → POST oid+size to `.../info/lfs/objects/batch` → fetch the real content from the signed URL returned). This worked correctly, but took **~38 seconds** per cold request — a real risk given Vercel Hobby's function timeout (10s default, up to 60s with Fluid Compute enabled) and just not good UX regardless of plan.

**Step 4 — Supabase-backed cache, like `catalog.js`.** Same pattern that already fixed `catalog.js`'s own slow-external-fetch problem: don't do the expensive fetch in the request path at all. New `compatibility_cache` table (single-row, `jsonb`, mirrors `catalog_cache`'s shape minus a meaningful `total` field), refreshed on a schedule, with `api/compatibility.js` just reading the cached row.

**Step 5 — dead end: Supabase's REST API (PostgREST) with a ~65MB payload.** The refresh step first tried POSTing the full data as one request to Supabase's REST endpoint (`.../rest/v1/compatibility_cache`, fronted by Cloudflare) — this is exactly how `refresh-catalog.js` writes `catalog_cache`, but that payload is far smaller. At this size, writes failed outright and consistently with Cloudflare **520/521/525** errors — different error codes across repeated attempts (ruling out "just a transient blip"; retry-with-backoff logic was added and still failed every attempt). Reading the same data back via REST didn't error, but took **~37 seconds** — no real improvement over the Step 3 live-fetch approach it was meant to replace.

**Step 6 — final fix: bypass REST/Cloudflare, use a direct Postgres connection.** Supabase exposes a real Postgres connection string (Project → Connect → "Direct" tab), separate from the REST/PostgREST/Cloudflare layer entirely. Used the **Transaction Pooler** variant specifically (not "Direct connection") — the dashboard's own description of it ("ideal for stateless applications like serverless functions where each interaction with Postgres is brief and isolated") is exactly this use case, and it's IPv4-compatible, whereas "Direct connection" defaults to IPv6 (which GitHub Actions runners and Vercel don't reliably support outbound). Using the `pg` npm package:
- **Write side:** `scripts/push-compatibility-to-supabase.js`, run by GitHub Actions (not Vercel) — connects via `pg`, does a single `insert ... on conflict (id) do update` upsert of the full jsonb blob.
- **Read side:** `api/compatibility.js` — same `pg` approach, `select data from compatibility_cache where id = 1`, wrapped in the same 6h in-memory cache pattern as before.
- Result: GitHub Actions run completed in ~1m15s (was timing out entirely before), and the live endpoint went from ~37-38s to **~3s** cold, near-instant warm.

**Why GitHub Actions does the write, not Vercel.** GitHub Actions runners support Git LFS natively — `actions/checkout@v4` with `lfs: true` resolves the real file content during checkout, no Batch API dance needed. This is also why the refresh is GitHub-Actions-triggered (6h cron + manual `workflow_dispatch`) rather than Vercel-cron-triggered like `catalog.js`: the *source* of this data is your own crawl+push, not a continuously-changing external feed, so polling on a timer from Vercel would only ever be re-reading the same repo state anyway.

**Step 7 (2026-08-02) — the blob approach turned out to still be broken, AND unable to scale further.** The "~3s, working" result above turned out to be a false all-clear: a first real-world test showed only "a fraction" of the data coming through. Root cause: **Vercel enforces a hard 4.5MB limit on a serverless function's response body** (infrastructure-level, not configurable) — `api/compatibility.js` had been silently truncating its ~65MB response the entire time, regardless of how fast the underlying fetch was. No amount of speeding up the data source (tried: local file, live LFS fetch, REST API, direct Postgres) could ever fix this, since the limit applies to the function's *outbound* response, not how it was assembled.

This coincided with a separate, forward-looking problem: the dataset is expected to grow ~10x further, at which point even an *unlimited* single-blob response would mean loading ~650MB into Vercel function memory on every cold start — real risk of hitting memory limits and Postgres's own jsonb size ceiling (~1GB).

Fix (a genuine restructure, not another workaround): normalize into a proper relational table instead of one big jsonb blob.
```sql
create table compatibility (
  id          bigint generated always as identity primary key,
  vendor_code text not null,
  series      text not null,   -- '1', '3', 'X5', 'A4', 'E-CLASS', etc. — extracted from `model`
  vehicle     jsonb not null,  -- the full per-vehicle record
  created_at  timestamptz not null default now()
);
create index idx_compatibility_series      on compatibility (series);
create index idx_compatibility_vendor_code on compatibility (vendor_code);
create index idx_compatibility_series_vc   on compatibility (series, vendor_code);
```
`series` is extracted from the text before the model field's first `(` (e.g. `"X5 (E70)"` → `"X5"`, `"3 Touring (F31)"` → `"3"`) — same logic in both `push-compatibility-to-supabase.js` and `chat.js`. Despite the name, this column isn't BMW-specific — the same table holds Audi (A1-A8, Q3/Q5/Q7, TT, Allroad), Mercedes (various -Class models, Sprinter, Vito, Viano), and VW (Golf) data too, distinguished the same way. No collisions currently, but if a future brand introduces one, the index can be widened to `(brand, series)`.

`push-compatibility-to-supabase.js` now flattens the source JSON into these rows instead of upserting one blob — `truncate` + batched multi-row `insert` (1000 rows/batch) inside a transaction, so a failure partway through can't leave stale and fresh data mixed. Confirmed working: 14,771 vendor codes flattened into 179,917 rows, logged per-series counts as a sanity check (only 2 rows landed in `series = 'unknown'`).

`api/compatibility.js` is now retired entirely (no Vercel function response involved at all). `chat.js` queries Postgres directly:
- `fetchCompatibilityVendorCodes()` — cheap, `select distinct vendor_code from compatibility`, used only to filter the catalog down to parts with any fitment data (independent of which vehicle this conversation is about)
- `fetchCompatibilityBySeries(series)` — the real per-conversation data, `select vendor_code, vehicle from compatibility where series = $1`, reshaped back into the `{ vendorCode: [vehicle, ...] }` object `matchCompatibility()` already expects

**This changes the request flow's ordering**, worth knowing if touching `chat.js` again: the compatibility fetch can no longer happen before `extractVehicleInfo()` like it used to (there's no series to filter by yet) — it now happens *after* extraction, once the vehicle's series is known.

End-to-end confirmed via a real conversation: correct BMW 1 (E87) N43 B16A match, correct product cards — and **token cost dropped ~40%**, a direct result of the leaner per-series data now reaching the prompt instead of the full dataset.

**Required secrets/env vars, split across three systems (updated 2026-08-02):**
- **GitHub Actions repo secrets** (`abcp-catalog-proxy`, Settings → Secrets and variables → Actions): `SUPABASE_DB_URL` (Transaction Pooler connection string, with real password)
- **Vercel env vars, `abcp-catalog-proxy` project**: `GITHUB_LFS_TOKEN` is now fully unused (was only needed for the abandoned Step 3 Batch API approach) — harmless to leave set, safe to remove
- **Vercel env vars, `Car-Parts-Ai-Recommendation` project (separate project — env vars are NOT shared across Vercel projects)**: `SUPABASE_DB_URL` (same connection string value) — this is new as of the Step 7 migration, since `chat.js` now queries Postgres directly instead of calling `abcp-catalog-proxy`'s (now-retired) `api/compatibility.js`

**⚠️ Day-to-day workflow — CHANGED as of session 7 (2026-09-19), this paragraph is now stale, kept for history only.** `Compatability_catalog.json` is no longer committed to git/LFS at all — 347 accumulated commits of it (~434MB each) were burning through the account's Git LFS storage quota (traced to 90% usage), so the file was stripped from all git history via `git filter-repo` and added to `.gitignore`. The 6h scheduled workflow (`refresh-compatibility.yml`) is disabled for the same reason — it can no longer check out a file that isn't in the repo. **New workflow:** edit `Compatability_catalog.json` locally → run `node scripts/push-compatibility-to-supabase.js` manually, locally (needs `SUPABASE_DB_URL` in local env) → done, nothing touches git. See the session 7 entry in PROJECT STATUS above for full details before changing any of this again.

---

## Manual products & oil/fluid cross-sell architecture

**The problem this solves:** oils, brake fluid, coolant, and similar consumables have **no vehicle-fitment data anywhere on ABCP's platform** — confirmed directly on the platform's own product pages ("Нет информации о применимости" / no applicability data). The entire compatibility pipeline above (crawl → `Compatability_catalog.json` → deterministic match) only works because that data exists for parts; it structurally can't be extended to oils, since ABCP itself never links a bottle of oil to a `modificationId`.

**Data collection — client-curated, not auto-crawled.** Vercel's serverless functions can't reach `bmwclub77.ru` at all (`UND_ERR_CONNECT_TIMEOUT` at the TCP level — confirmed via diagnostic logging, consistent with RU-hosted sites filtering foreign datacenter IP ranges regardless of headers/UA). So instead of a server-side crawler, the dashboard's "Товары" tab lets the client build this catalog manually: paste a category, the product URL, the page's HTML (Ctrl+U → Ctrl+A → Ctrl+C — simple, no DevTools needed), and the price (typed in directly, since price loads via a separate async AJAX call on ABCP's site and is never present in a plain View Source capture, however captured). `api/dashboard/products.js` parses the pasted HTML for name/image/specs/description; price is always whatever was typed in, never guessed. Stored in the `manual_products` Supabase table.

**Matching strategy — the client's own proposal, refined together:**
- **Tier 1 (built):** the actual matching key is the **manufacturer approval code** (ABCP calls this "Допуски производителей" — e.g. `BMW Longlife-01`, `VW 507.00`, `MB 229.5`), not the oil's brand. This is how real oil compatibility works — a generic-brand oil (e.g. LUKOIL) carrying the right approval is exactly as valid as an OEM-branded one, not a compromise substitute. So: the agent asks the customer for their required approval code (from their vehicle's manual, or the oil cap), and `matchOilByApproval()` in `chat.js` searches every `manual_products` row's approvals field for that exact code — deterministic, brand-agnostic, tolerant of formatting differences (`"VW 502.00"` / `"VW 502 00"` / `"vw50200"` all normalize the same via `normalizeApprovalCode()`).
- **Tier 2 (designed, not yet built):** for customers who don't know their approval code, a general fallback using fuel type + turbo/naturally-aspirated + mileage to suggest a reasonable *general* viscosity/spec category — explicitly labeled as non-manufacturer-verified, never presented with Tier 1's confidence. `extractVehicleInfo()` already captures `fuelType`/`turbo`/`mileageKm` in anticipation of this, currently unused. Until Tier 2 exists, the agent escalates to a manager rather than guessing when the customer doesn't know their approval code.

**Same "match in code, not in the prompt" principle as vehicle compatibility, and for the same reason:** letting Claude search through an embedded list of `manual_products` for one matching approval code is the same retrieval task that caused the cross-vehicle hallucination bug (see above) — unreliable regardless of model size. `matchOilByApproval()` does the actual search in plain JavaScript; only the already-matched result reaches the prompt via `{{OIL_PRODUCTS}}`.

---



1. User opens the chat widget on the landing page (or it restores an in-progress conversation from `localStorage` if the customer navigated here via a product's "Подробнее" link, which opens in a new tab)
2. Widget sends `POST /api/chat` with the conversation history
3. `api/session/start.js` creates a session and logs it via `api/session/manager.js`
4. `chat.js` fetches the compatibility dataset, the price/stock catalog (both cached, from `abcp-catalog-proxy`), and the manual oils/fluids catalog (cached, from Supabase `manual_products`)
5. A cheap Claude Haiku call extracts `{vendorCode, brand, model, engineCode, powerHp, partKeywords, oilApprovalCode, fuelType, turbo, mileageKm}` from the conversation so far
6. Plain JavaScript deterministically matches the vehicle fields against the compatibility dataset, then narrows further by `partKeywords` against the catalog's `name`/`category` fields (see "Compatibility matching architecture" above) and, separately, any given oil approval code against `manual_products` (see "Manual products & oil/fluid cross-sell architecture" above) — only the matched results are used from here on, never the full datasets
7. Claude Sonnet 5 receives the system prompt with just those matched subsets injected, and returns a response with optional `<<<PRODUCTS>>>` and `<<<BUTTONS>>>` blocks
8. Widget parses and renders product carousels + quick-action buttons, persisting the conversation to `localStorage` after each turn
9. When the user requests a manager, `api/session/end.js` closes the session and `manager.js` generates a summary + creates a Bitrix24 lead (once `BITRIX24_WEBHOOK_URL` is set)
10. Dashboard reads session data from `api/dashboard/sessions.js` (Аналитика tab) and manual product data from `api/dashboard/products.js` (Товары tab)

Reference implementation for the proxy/chat.js contract: see the working `pixmosaic-proxy` (`api/catalog.js`) + `mosaic-recom` (`api/chat.js`) sibling project. Same pattern, different feed format — see field mapping table above for the deltas.

---

## Missing-articles (no-photo gap) tracking

**The problem this solves:** ABCP's export feed (`XML_URL` in `abcp-catalog-proxy`'s `catalog.js`) is configured to only include products that have a photo — deliberate, since the agent should never recommend a part with no visual (see "Found ABCP's built-in image filter" in DONE above). That's the right call for what the *customer* sees, but it created an invisible gap: `Compatability_catalog.json` (built by crawling ABCP's fitment data directly, independent of the photo filter) can say a part genuinely fits a customer's car, while the same vendorCode simply doesn't exist in `catalogParsed` at all — no error, no partial match, just nothing to offer. Before this feature, that gap was invisible to the client; a customer would get escalated to a manager for a part that, with fifteen minutes of adding a photo, would have sold itself.

**How it works:** in `chat.js`, right after `matchedCompatibilityByVehicle` (vendorCodes the compatibility data says fit this vehicle) and `matchedCatalogByVehicle` (the subset of those actually present in the catalog feed) are computed, the two are diffed. Anything in the first set but missing from the second is logged via `logMissingArticles()` — fire-and-forget, never blocks or risks the actual chat response even if the log call fails.

Logging goes through a Postgres RPC, `bump_missing_article(p_vendor_code, p_vehicle_info)` (see `missing_articles_setup.sql`), not a plain PostgREST upsert — needed because "increment an existing counter" isn't expressible as a single upsert; the function does an atomic `insert ... on conflict (vendor_code) do update ... request_count + 1`. One row per vendorCode (not a full event log) — sorted by `request_count` on the dashboard, so the client sees which specific gaps are actually costing sales first, not just the most recent one. Keeps the last 5 distinct vehicle examples per row (not unbounded) via a `jsonb_array_elements ... with ordinality` trim in the same function. A fresh request for an already-`resolved` row automatically flips it back to unresolved — if a customer asks again after the client thought they'd fixed it, that's a signal worth surfacing again, not silently dropping.

**Deliberately scoped to the whole vehicle match, not just what the customer explicitly asked about** — if a customer's car has 5 different missing-photo parts come up across a conversation (even ones only touched via the maintenance-category expansion, not named directly), all 5 get logged. The reasoning: this is meant to surface the *full* catalog gap for real customer vehicles, not just literal keyword matches — a more complete picture for the client to prioritize against, at the cost of occasionally logging something slightly tangential to what was asked.

New `api/dashboard/missing-articles.js` endpoint (`list`/`resolve`/`delete`, same password-based auth as `products.js`/`sessions.js`, both admin and client roles can manage it — same reasoning as `products.js`: this is the client's own catalog gap to manage day-to-day, not an admin-only concern) and a new "🖼️ Нет фото" dashboard tab, unresolved-first then sorted by request count.

---

## Catalog API field mapping (target schema — see ABCP mapping table above for real source fields)

The catalog endpoint must return a `products` array. Each product should have:

| Field | Description |
|---|---|
| `article` | Part number / SKU (ABCP: `vendorCode`) |
| `name` | Part name (ABCP: `name`) |
| `brand` | Manufacturer brand (ABCP: `vendor`) |
| `category` | Part category (ABCP: `categoryId`, needs id→name lookup) |
| `compatibility` | Compatible car makes/models — sourced from `Compatability_catalog.json` (crawled via `getAdaptability($articleId)`, see below), NOT the YML feed. Injected into the prompt only as an already-matched subset — see "Compatibility matching architecture" |
| `price` | Price in RUB (ABCP: `price`) |
| `stock` | Units in stock — **ABCP feed only has boolean `available`, not a quantity, pending client input** |
| `url` | Product page URL (ABCP: `url`) |
| `picture` | Product image URL (ABCP: `picture`, only ~21% coverage, may be absent) |

If your catalog uses different field names, update the mapping in `api/chat.js` inside `fetchCatalog()`.

---

## Updating

Any push to `main` branch triggers automatic Vercel redeployment.
No manual steps needed after initial setup.
