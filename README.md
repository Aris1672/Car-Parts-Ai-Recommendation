# Car Parts AI Recommendation Chat Agent

Custom Claude-powered chat widget and analytics dashboard for car parts e-commerce (client: bmwclub77.ru, ABCP platform, id2319).
Powered by a **two-model architecture** via a Vercel serverless proxy: **Claude Sonnet 5** handles the actual customer-facing conversation, **Claude Haiku** does a cheap, fast structured-data extraction step that feeds it (see "Compatibility matching architecture" below for why this changed from a single-model, single-blob design).

Pattern copied from a working sibling project: `pixmosaic-proxy` + `mosaic-recom` (mosaic tile e-commerce, same two-repo architecture).

---

## 📍 PROJECT STATUS — read this first if resuming work

**Last updated:** 2026-07-23 — found and fixed two related bugs in `normalizeModel()` (`chat.js`), both same root cause: BMW's model-naming markers (the "M" performance division, the "xDrive" AWD marker) are written inconsistently between how the compatibility catalog stores them and how customers/Haiku phrase them, and the digit+letter merge logic assumed adjacency that isn't always there. Both caused correctly-catalogued parts to return zero matches in production (confirmed via screenshots: BMW X5 M brake discs, BMW X6 50iX oil pan — both existed in `Compatability_catalog.json` but the agent told the customer to contact a manager). See "Compatibility matching architecture" below for both, plus the earlier part-keyword cost-scaling fix from 2026-07-22.

### 🔄 Resuming in a fresh chat? This README explains *why* things are the way they are — it does NOT contain live file contents. Upload these before continuing:

- **From `abcp-catalog-proxy` repo:** `api/catalog.js`, `scripts/crawl-compatibility.js`, `vercel.json`, `package.json`
- **From `Car-Parts-Ai-Recommendation` repo:** `api/chat.js`, `api/session/manager.js`, `widget/chat-widget.js`, `vercel.json`
- **Latest compatibility data (✅ FINAL DECIDED FORMAT, 2026-07-08):** two accumulating files, NOT `Car_model_list.xml` (retired — see below): `Compatability_catalog.json` (vendorCode → compatible vehicles, what the agent actually queries) + `Crawled_modificationIds.json` (tracks which car models/modificationIds have been crawled — this is the client-relevant scope list, not the full ABCP range)
- **Do NOT re-paste real secrets into chat or this file** — `ABCP_EXPORT_URL` and `BITRIX24_WEBHOOK_URL` live only in Vercel's environment variables. This README was previously found to contain the live ABCP token in plain text (now redacted, 2026-07-08) — if it's ever pushed to git, treat that token as compromised/rotate it, since it would sit in git history regardless of later edits.

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

### ⬜ TO DO
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
│   │   └── products.js         ← Manual cross-sell products endpoint (Товары tab) — list/add/delete, paste-HTML extraction + manual price
│   ├── session/
│   │   ├── end.js              ← Ends a user session
│   │   ├── manager.js          ← Bitrix24 lead creation + Claude-generated summary
│   │   └── start.js            ← Starts a new user session
│   ├── chat.js                 ← Vercel serverless function (Claude proxy) — deterministic compatibility + oil matching, then Sonnet 5
│   └── image.js                ← Image handling endpoint
├── dashboard/
│   └── index.html               ← Admin dashboard (Аналитика + Товары tabs)
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

**Supabase tables** (shared project across both repos): `chat_sessions` (session logging), `catalog_cache` (price/stock, refreshed by the cron above), `manual_products` (client-curated oils/fluids/etc. with no vehicle-fitment data on ABCP's platform — see "Compatibility matching architecture" below).

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
