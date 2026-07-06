# Car Parts AI Recommendation Chat Agent

Custom Claude-powered chat widget and analytics dashboard for car parts e-commerce (client: bmwclub77.ru, ABCP platform, id2319).
Powered by Claude Haiku via a Vercel serverless proxy.

Pattern copied from a working sibling project: `pixmosaic-proxy` + `mosaic-recom` (mosaic tile e-commerce, same two-repo architecture).

---

## 📍 PROJECT STATUS — read this first if resuming work

**Last updated:** 2026-07-07 — automated crawler approach SUSPENDED INDEFINITELY after triggering a site-wide anti-bot block that locked the operator out of their own site login (real-world harm, not just a script failure). Pivoted to a manually-built compatibility table (validated: 100% vendorCode match rate against the catalog on the first batch). Next actionable step: continue building the manual table (~5-7 days estimated), then wire it into `chat.js` same as the crawler output would have been.

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
7. **⏭️ Continue building the manual compatibility table** (`Car_model_list.xml` or equivalent) — currently at Audi A1/A3 (41 variants), ~5-7 days estimated to cover all 8 brands (Audi, BMW, Land Rover, Mercedes-Benz, Nissan, Porsche, VW, Volvo).
8. Convert the completed manual table into the same `vendorCode → [{brand, model, ...}]` JSON shape the crawler would have produced, so it's a drop-in replacement — no changes needed to how `chat.js` consumes it.
9. Update `api/chat.js`'s `fetchCatalog()` + system prompt for car parts (see field mapping below). Things now finalized and ready to implement:
   - Product card button = simple link to `product.url`, opened in a new tab — no cart API integration needed.
   - Compatibility lookup: ask user for car make/model/year → look up in the manually-built compatibility mapping → cross-reference candidate vendorCodes against the catalog → fall back to text matching only if no mapping match is found.
10. Fill remaining `TODO` placeholders in this repo (see table further down).

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
