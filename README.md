# Car Parts AI Recommendation Chat Agent

Custom Claude-powered chat widget and analytics dashboard for car parts e-commerce (client: bmwclub77.ru, ABCP platform, id2319).
Powered by Claude Haiku via a Vercel serverless proxy.

Pattern copied from a working sibling project: `pixmosaic-proxy` + `mosaic-recom` (mosaic tile e-commerce, same two-repo architecture).

---

## 📍 PROJECT STATUS — read this first if resuming work

**Last updated:** 2026-07-02

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
- Sent client a question list (in Russian) asking them to define: which warehouses/brands to include, which pricing profile to use, any stock to exclude, whether vehicle-compatibility data exists, and whether exact stock quantities are needed. **Awaiting client's answers before building the real export.**

### Key architecture decision
**One combined YML export, not separate exports per brand.** Brand filtering (BMW vs Mercedes vs Jaguar etc.) should happen at the code level (filter by `<vendor>` field in the proxy or in `chat.js`'s `fetchCatalog()`), not as multiple separate ABCP export configs. Reasons: avoids maintaining N scheduled jobs/URLs/proxies, and every offer already carries a `<vendor>` field to filter on.

Open question once client responds: full combined catalog across all their warehouses could be very large (BMW aftermarket catalogs can run 100k+ SKUs) — may be too big to inject wholesale into Claude's system prompt like the mosaic project does. **Need to check real combined offer count once client confirms scope**, and likely add a runtime filtering/keyword-matching step before building the system prompt (mosaic's catalog was small enough to skip this; car parts likely won't be).

### Next steps (in order)
1. **Wait for client's answers** to the warehouse/profile/compatibility/stock questions.
2. Create the real (non-test) YML export config with agreed warehouses + profile.
3. Set a **Расписание** (refresh schedule) — target within ABCP's free generation window (17:00–06:00 MSK) to avoid overage costs.
4. Check total offer count of the real export — decide if runtime filtering by brand/category is needed before feeding Claude (very likely yes).
5. Write `catalog.js` for the new proxy repo, adapted from `pixmosaic-proxy`'s version — **field mapping is different, see below.**
6. Update `api/chat.js`'s `fetchCatalog()` + system prompt for car parts (see field mapping + open questions below).
7. Fill remaining `TODO` placeholders in this repo (see table further down).

---

## ⚠️ Catalog field mapping — ABCP YML vs. this repo's original placeholder schema

The field names below (`article`, `brand`, `compatibility`, `stock`) were an initial placeholder guess written before the actual ABCP feed was inspected. **They don't fully match reality.** Use this table when writing `catalog.js` and `chat.js`:

| This repo's placeholder field | ABCP YML actual tag | Notes |
|---|---|---|
| `article` | `vendorCode` | |
| `name` | `name` | matches |
| `brand` | `vendor` | |
| `category` | `categoryId` | numeric ID only — needs a lookup against the `<categories>` block (id → readable name) in the same feed, similar to how pixmosaic flattened `<param>` tags |
| `compatibility` | **not present in the YML feed at all** | Open question sent to client — may not exist in a structured form on ABCP at all (aftermarket catalogs vs. TecDoc/Laximo-style VIN catalogs). Until confirmed, agent should NOT assume compatibility data exists — fall back to matching by name/vendor keywords only. |
| `price` | `price` | matches |
| `stock` | **not present as a quantity — only `available="true/false"` boolean** | If client needs real quantities, the export's "Наличие товара" setting and/or a different data source will need revisiting. |
| `url` | `url` | matches |
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
| `compatibility` | Compatible car makes/models — **not available in current ABCP feed, pending client input** |
| `price` | Price in RUB (ABCP: `price`) |
| `stock` | Units in stock — **ABCP feed only has boolean `available`, not a quantity, pending client input** |
| `url` | Product page URL (ABCP: `url`) |
| `picture` | Product image URL (ABCP: `picture`, only ~21% coverage, may be absent) |

If your catalog uses different field names, update the mapping in `api/chat.js` inside `fetchCatalog()`.

---

## Updating

Any push to `main` branch triggers automatic Vercel redeployment.
No manual steps needed after initial setup.
