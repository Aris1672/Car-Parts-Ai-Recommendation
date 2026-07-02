# Car Parts AI Recommendation Chat Agent

Custom Claude-powered chat widget and analytics dashboard for car parts e-commerce (client: bmwclub77.ru, ABCP platform, id2319).
Powered by Claude Haiku via a Vercel serverless proxy.

Pattern copied from a working sibling project: `pixmosaic-proxy` + `mosaic-recom` (mosaic tile e-commerce, same two-repo architecture).

---

## 📍 PROJECT STATUS — read this first if resuming work

**Last updated:** 2026-07-02 — both blocking questions (client scope, ABCP compatibility-API access) have been sent; nothing further to build until at least one reply arrives.

### Where we are
- Catalog source confirmed: client's site runs on **ABCP** (auto parts distribution platform, not a simple CMS).
- Data access path decided: **ABCP's built-in "Экспорт прайсов" (price export) feature, type = YML** — NOT the raw ABCP REST API. This avoids needing API-admin credentials/auth entirely.
- Test export created in ABCP admin panel (`cp.abcp.ru → Экспорт прайсов`), config name **"Aris Test"**, format = YML, sub-format = "Яндекс.Вебмастер 'Поиск по товарам'" (required Профиль = "Гость (Опт)").
- Test run scoped to **1 warehouse only** ("LandRover Rolf") to keep the file small: **4,324 offers**, confirmed working persistent URL:
  ```
  https://bmwclub77.ru/get_price?p=bc9c683f7cf1457d829f1b223b796eba&FranchiseeId=426390
  ```
  This URL always serves the latest generated file (not a one-time download — confirmed via PowerShell `Invoke-WebRequest`, browser "download" behavior is just a `Content-Disposition` header, irrelevant to server-side `fetch()`).
- **Image coverage confirmed: only ~21% of offers have a `<picture>` tag** (917 of 4,324 in the test file). Images come from ABCP's own CDN (`pubimg.nodacdn.net` / `f.nodacdn.net` — "Noda" = ABCP's parent company, NodaSoft). The other ~79% have no picture — not a bug, aftermarket parts often lack ABCP-hosted photos.
  - Fallback options exist in the export config ("Ссылка на фото товара" setting): can fall back to product-group photo, or a placeholder image URL — not yet decided/configured.
- **No refresh schedule (Расписание) has been set yet** — current export is demo-only, one-time manual runs. Fine for prototyping; must be set before any production use.
- **✅ SENT to client** — question list (in Russian) asking them to define: which warehouses/brands to include, which pricing profile to use, any stock to exclude, whether vehicle-compatibility data exists, and whether exact stock quantities are needed. **Awaiting client's reply before building the real export.**
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

### 🕓 Currently blocked on two replies (as of 2026-07-02)
1. **Client** — warehouse/brand scope, pricing profile, stock exclusions, exact-quantity need (question sent).
2. **ABCP support** — whether TecDoc Aftermarket (or the pricier Каталог ТО) actually exposes an API method for compatibility data, vs. front-end-only (question sent).

Nothing else should be built or purchased until at least the ABCP support reply comes back — it determines whether `compatibility` is buildable at all right now, and if so, which of the two paid tiers is worth recommending to the client.

### Key architecture decision
**One combined YML export, not separate exports per brand.** Brand filtering (BMW vs Mercedes vs Jaguar etc.) should happen at the code level (filter by `<vendor>` field in the proxy or in `chat.js`'s `fetchCatalog()`), not as multiple separate ABCP export configs. Reasons: avoids maintaining N scheduled jobs/URLs/proxies, and every offer already carries a `<vendor>` field to filter on.

Open question once client responds: full combined catalog across all their warehouses could be very large (BMW aftermarket catalogs can run 100k+ SKUs) — may be too big to inject wholesale into Claude's system prompt like the mosaic project does. **Need to check real combined offer count once client confirms scope**, and likely add a runtime filtering/keyword-matching step before building the system prompt (mosaic's catalog was small enough to skip this; car parts likely won't be).

### Next steps (in order)
1. **⏳ Waiting on client's reply** to the warehouse/profile/compatibility/stock questions (sent).
2. **⏳ Waiting on ABCP support's reply** on whether TecDoc Aftermarket / Каталог ТО exposes a real API method for compatibility data (sent) — **do not purchase/activate either tier until this comes back.**
3. Once client responds: create the real (non-test) YML export config with agreed warehouses + profile.
4. Set a **Расписание** (refresh schedule) — target within ABCP's free generation window (17:00–06:00 MSK) to avoid overage costs.
5. Check total offer count of the real export — decide if runtime filtering by brand/category is needed before feeding Claude (very likely yes).
6. Write `catalog.js` for the new proxy repo, adapted from `pixmosaic-proxy`'s version — **field mapping is different, see below.**
7. Once ABCP responds: decide whether to activate a compatibility data tier, then integrate its API into `catalog.js`/`chat.js` (separate from the YML feed integration).
8. Update `api/chat.js`'s `fetchCatalog()` + system prompt for car parts (see field mapping + open questions below). Product card button = simple link to `product.url`, opened in a new tab — no cart API integration needed (see finding above).
9. Fill remaining `TODO` placeholders in this repo (see table further down).

---

## ⚠️ Catalog field mapping — ABCP YML vs. this repo's original placeholder schema

The field names below (`article`, `brand`, `compatibility`, `stock`) were an initial placeholder guess written before the actual ABCP feed was inspected. **They don't fully match reality.** Use this table when writing `catalog.js` and `chat.js`:

| This repo's placeholder field | ABCP YML actual tag | Notes |
|---|---|---|
| `article` | `vendorCode` | |
| `name` | `name` | matches |
| `brand` | `vendor` | |
| `category` | `categoryId` | numeric ID only — needs a lookup against the `<categories>` block (id → readable name) in the same feed, similar to how pixmosaic flattened `<param>` tags |
| `compatibility` | **not in the YML feed — but a dedicated API exists.** Two related things confirmed: (1) "Каталог ТО" in `API.ABCP.Client` docs, ~40k modifications, 10 product groups only. (2) A fuller TecDoc-style REST API with official NodaSoft PHP client (`getAdaptability($articleId)` = direct part→vehicle fitment lookup) — **but requires separate `userKey` auth, likely a paid add-on, not yet confirmed for this client's account.** | Not yet implemented. Pending ABCP support's answer on cost/access for the TecDoc-style API specifically. |
| `price` | `price` | matches |
| `stock` | **not present as a quantity — only `available="true/false"` boolean** | If client needs real quantities, the export's "Наличие товара" setting and/or a different data source will need revisiting. |
| `url` | `url` | matches. **This is also the product card's button target** — confirmed it's a direct link to a fully working product page (live stock, price, analogs, working add-to-cart on the site itself). Open in a new tab from the widget. |
| `picture` | `picture` | **present on ~21% of offers only — absent (not empty) on the rest.** Parser must handle `offer.picture || null`, not assume the tag exists. |

Also note: unlike pixmosaic's feed, **ABCP's YML has no `<param>` blocks** (no material/surface/size attributes) — the offer structure is flatter. Don't port pixmosaic's params-extraction loop as-is.

---

## Project structure

```
Car-Parts-Ai-Recommendation/
├── api/
│   ├── dashboard/
│   │   └── sessions.js        ← Sessions data endpoint for dashboard
│   ├── session/
│   │   ├── end.js             ← Ends a user session
│   │   ├── manager.js         ← Session management logic
│   │   └── start.js           ← Starts a new user session
│   ├── chat.js                ← Vercel serverless function (Claude proxy)
│   └── image.js               ← Image handling endpoint
├── dashboard/
│   └── index.html             ← Admin analytics dashboard
├── widget/
│   └── chat-widget.js         ← Chat UI loaded by your landing page
├── apple-touch-icon.png       ← PWA / bookmark icon
├── .env.local                 ← Your API key (NEVER commit)
├── .gitignore
├── vercel.json                ← Routes + CORS headers
└── README.md
```

**Still to be created:** a separate catalog-proxy repo (e.g. `abcp-catalog-proxy`), mirroring `pixmosaic-proxy`'s structure — single `api/catalog.js` that fetches the ABCP YML URL, parses it, and exposes a clean JSON endpoint for `chat.js` to consume. Not started yet.

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

## Step 5 — Update the widget URL

After deployment, Vercel gives you a URL like:
`https://car-parts-ai-recommendation.vercel.app`

1. Open `widget/chat-widget.js`
2. Find this line near the top:
   ```js
   const BASE_URL = window.AGENT_URL || 'https://TODO-YOUR-PROJECT.vercel.app';
   ```
3. Replace the TODO with your actual Vercel URL
4. Commit and push — Vercel auto-redeploys

---

## Step 6 — Add the widget to the client's landing page

Add before `</body>`:
```html
<!-- AI Chat Widget -->
<script>
  window.AGENT_URL = 'https://car-parts-ai-recommendation.vercel.app';
</script>
<script src="https://car-parts-ai-recommendation.vercel.app/widget/chat-widget.js" defer></script>
```

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

## How it works

1. User opens the chat widget on the landing page
2. Widget sends `POST /api/chat` with the conversation history
3. `api/session/start.js` creates a session and logs it via `api/session/manager.js`
4. Vercel function fetches the live parts catalog (from the ABCP YML export, via the catalog-proxy repo) and injects it into Claude's system prompt
5. Claude returns a response with optional `<<<PRODUCTS>>>` and `<<<BUTTONS>>>` blocks
6. Widget parses and renders product carousels + quick-action buttons
7. When the user requests a manager, `api/session/end.js` closes the session
8. Dashboard reads session data from `api/dashboard/sessions.js` and renders analytics

Reference implementation for the proxy/chat.js contract: see the working `pixmosaic-proxy` (`api/catalog.js`) + `mosaic-recom` (`api/chat.js`) sibling project. Same pattern, different feed format — see field mapping table above for the deltas.

---

## Catalog API field mapping (target schema — see ABCP mapping table above for real source fields)

The catalog endpoint must return a `products` array. Each product should have:

| Field | Description |
|---|---|
| `article` | Part number / SKU (ABCP: `vendorCode`) |
| `name` | Part name (ABCP: `name`) |
| `brand` | Manufacturer brand (ABCP: `vendor`) |
| `category` | Part category (ABCP: `categoryId`, needs id→name lookup) |
| `compatibility` | Compatible car makes/models — **not in the YML feed; exists on the live site as a separate vehicle-fitment catalog module, API access unconfirmed (pending)** |
| `price` | Price in RUB (ABCP: `price`) |
| `stock` | Units in stock — **ABCP feed only has boolean `available`, not a quantity, pending client input** |
| `url` | Product page URL (ABCP: `url`) |
| `picture` | Product image URL (ABCP: `picture`, only ~21% coverage, may be absent) |

If your catalog uses different field names, update the mapping in `api/chat.js` inside `fetchCatalog()`.

---

## Updating

Any push to `main` branch triggers automatic Vercel redeployment.
No manual steps needed after initial setup.
