/**
 * lib/abcpPrices.js -- live price & delivery time for part numbers that are
 * NOT in the catalog feed (typed numbers, original numbers found via Laximo).
 *
 * Михаил (24.10.2026): "цены будут такими же, как в прайсе, только
 * актуальными" -> the same rules as the bot's price-list export:
 *   - price profile "Гость (Опт)" (ABCP_PRICE_PROFILE_ID, or found by name
 *     ABCP_PRICE_PROFILE_NAME via cp/users/profiles);
 *   - only the export's warehouses (ABCP_PRICE_ROUTES: comma-separated IDs
 *     as shown in ABCP, matched against an offer's distributorId or
 *     supplierCode/route). Not set -> all offers the profile can see.
 *
 * Read-only: search/articles (one number per call, own number only, no
 * analogs) via lib/abcpOrders.js. Results cached 20 min per number.
 * Kept outside api/ so server.js never mounts it as a route.
 */

const abcp = require('./abcpOrders');

const PROFILE_ID_ENV = process.env.ABCP_PRICE_PROFILE_ID || '';
const PROFILE_NAME = process.env.ABCP_PRICE_PROFILE_NAME || 'Гость (Опт)';
const ROUTES = new Set(String(process.env.ABCP_PRICE_ROUTES || '').split(/[\s,;]+/).filter(Boolean));
const USE_ONLINE = process.env.ABCP_PRICE_ONLINE !== '0'; // online suppliers are slower but part of the export
const CALL_TIMEOUT_MS = 8000;
const CACHE_MS = 20 * 60 * 1000;

// Михаил wants the price-list prices, so live prices stay OFF until the export's
// warehouses are configured (ABCP_PRICE_ROUTES). ABCP_LIVE_PRICES=all allows
// all routes the profile sees; =false switches it off.
const MODE = String(process.env.ABCP_LIVE_PRICES || '').toLowerCase();
let offWarned = false;
const enabled = () => {
  if (!abcp.enabled() || MODE === 'false') return false;
  if (ROUTES.size || MODE === 'all') return true;
  if (!offWarned) { offWarned = true; console.warn('[prices] live prices off: set ABCP_PRICE_ROUTES (the price-list export\'s warehouses) or ABCP_LIVE_PRICES=all'); }
  return false;
};
const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ─── Profile id (by name, cached 6 h) ───────────────────────────────────────
let profileCache = null, profileAt = 0;
async function profileId() {
  if (PROFILE_ID_ENV) return PROFILE_ID_ENV;
  if (profileCache !== null && Date.now() - profileAt < 6 * 3600 * 1000) return profileCache;
  try {
    const list = await abcp.apiGet('cp/users/profiles', {});
    const arr = Array.isArray(list) ? list : Object.values(list || {});
    const want = PROFILE_NAME.toLowerCase().replace(/\s+/g, ' ').trim();
    const hit = arr.find(p => p && String(p.name || '').toLowerCase().replace(/\s+/g, ' ').trim() === want);
    profileCache = hit ? String(hit.profileId) : '';
    profileAt = Date.now();
    if (!hit) console.warn(`[prices] profile "${PROFILE_NAME}" not found among ${arr.length} profile(s): ${arr.map(p => p && p.name).filter(Boolean).slice(0, 10).join(' | ')}`);
    else console.log(`[prices] using profile "${hit.name}" (id ${hit.profileId})`);
  } catch (err) {
    console.error('[prices] cp/users/profiles failed:', err.message);
    profileCache = null; // retry next time
    return '';
  }
  return profileCache;
}

/** Pure: offers for one number -> { cheapest, fastest, count } | null. Exported for tests. */
function pickOffers(number, offers, routes = ROUTES) {
  const want = norm(number);
  const ok = (Array.isArray(offers) ? offers : Object.values(offers || {})).filter(o => {
    if (!o || norm(o.numberFix || o.number) !== want) return false;   // own number only, no analogs
    if (!(Number(o.price) > 0)) return false;
    if (routes.size && !routes.has(String(o.distributorId)) && !routes.has(String(o.supplierCode))) return false;
    return true;
  }).map(o => {
    const hours = Number(o.deliveryPeriod) || 0;
    const hoursMax = Number(o.deliveryPeriodMax) || 0;
    const avail = Number(o.availability);
    return {
      price: Math.round(Number(o.price)),
      days: Math.ceil(hours / 24),
      daysMax: hoursMax > hours ? Math.ceil(hoursMax / 24) : null,
      inStock: hours === 0 || avail > 0,
      qty: avail > 0 ? avail : null,
      noReturn: !!Number(o.noReturn),
      used: !!Number(o.isUsed),
      description: o.description || null,
    };
  }).filter(o => !o.used); // the price list sells new parts
  if (!ok.length) return null;
  const cheapest = [...ok].sort((a, b) => a.price - b.price || a.days - b.days)[0];
  const fastest = [...ok].sort((a, b) => a.days - b.days || a.price - b.price)[0];
  return { cheapest, fastest: fastest === cheapest || (fastest.days === cheapest.days) ? null : fastest, count: ok.length };
}

const cache = new Map(); // `${brand}:${number}` -> { at, data }

/** Live offers for one number (brand defaults to BMW). null = nothing / not available. */
async function priceFor(number, brand = 'BMW') {
  const key = `${norm(brand)}:${norm(number)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const pid = await profileId();
  const params = { number: norm(number), brand, withOutAnalogs: 1, useOnlineStocks: USE_ONLINE ? 1 : 0 };
  if (pid) params.profileId = pid;
  let data = null;
  try {
    const res = await Promise.race([
      abcp.apiGet('search/articles', params),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${CALL_TIMEOUT_MS}ms`)), CALL_TIMEOUT_MS)),
    ]);
    data = pickOffers(number, res);
  } catch (err) {
    if (err.abcpCode == 301) data = null;      // no offers for this number
    else { console.error(`[prices] search/articles ${number} failed:`, err.message); return null; } // don't cache failures
  }
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 1000) cache.clear();
  return data;
}

/** Up to `max` numbers in parallel -> { [number]: offers } (only numbers with offers). */
async function livePrices(numbers, brand = 'BMW', max = 3) {
  if (!enabled()) return {};
  const list = [...new Set((numbers || []).map(norm).filter(n => n.length >= 5))].slice(0, max);
  const out = {};
  await Promise.all(list.map(async n => { const d = await priceFor(n, brand); if (d) out[n] = d; }));
  console.log(`[prices] ${list.length} number(s) asked, ${Object.keys(out).length} with offers${ROUTES.size ? ` (routes ${[...ROUTES].join(',')})` : ' (all routes -- ABCP_PRICE_ROUTES not set)'}`);
  return out;
}

module.exports = { livePrices, priceFor, pickOffers, enabled };
