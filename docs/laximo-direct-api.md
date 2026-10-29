# Laximo — direct API instead of the site pages (plan, 29.10.2026)

**Why:** the bot reads the catalog through bmwclub77.ru/laximo (HTML pages). That route is throttled by us (1 request / 3 s, 60 / hour) and can be blocked by ABCP's browser check — 29.10 20:22 UTC the check paused all catalog lookups for 6 h (chat fell back to the price list).

**What we know:**
- The shop has its **own Laximo licence** from the rights holder (Technology Trade): a personal cabinet at lk.laximo.ru and a **Laximo.Cat service login**. ABCP only uses that key to show /laximo (connected 10–15.10.2026, ABCP ticket).
- Laximo bills **per request**, bots and people alike — the bot's lookups already count against the shop's traffic. /laximo must stay closed to search robots.
- Laximo.Cat has a REST/SOAP API (login + password): VIN search, `FindVehicleByWizard2` (the model wizard), catalog units, details; Laximo.SEARCH for part names. Prices on request.

**Status:** owner's client asked to confirm with Laximo whether the existing Laximo.Cat key can be used directly from our server (IP binding? tariff change?). Also: change the lk.laximo.ru password (it equals the email).

**If confirmed:** credentials only as Coolify env vars (`LAXIMO_LOGIN`, `LAXIMO_PASSWORD`) — never in the repo, docs or chat. New API layer in `lib/laximo.js` (VIN, wizard, part search, units/diagrams), site pages kept as fallback; the AI filter, BMW groups, axle and version checks stay unchanged.

**Meanwhile:** ask ABCP to exempt the bot server's IP from the browser check.
