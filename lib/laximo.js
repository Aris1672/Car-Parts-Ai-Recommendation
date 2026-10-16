/**
 * lib/laximo.js — on-demand scraper for the Laximo original-parts catalog
 * (BMW ETK data) embedded on the client's own site at /laximo.
 *
 * WHY SCRAPING, NOT THE LAXIMO API: the client's ABCP site already shows
 * Laximo pages to every visitor; a separate Laximo API account was judged
 * not worth pursuing. This module fetches only what a single customer
 * question needs (VIN -> vehicle -> part-name search), never bulk-crawls.
 *
 * ⚠️ LESSON FROM JULY 2026: the bulk /carbase crawler tripped the site's
 * anti-bot system badly enough to lock a person out of the client's site.
 * Safeguards here, all deliberate -- do not remove without a reason:
 *   - Every request goes through ONE global queue with a minimum gap
 *     (LAXIMO_MIN_INTERVAL_MS), so a burst of chats can't become a burst
 *     of requests.
 *   - Every result is cached (memory + Postgres `laximo_cache`), so the same
 *     VIN / search is fetched from the site at most once per TTL.
 *   - A circuit breaker stops ALL Laximo requests for a cooldown period
 *     after repeated failures (e.g. the site starts blocking us), and the
 *     chat falls back to the compatibility table meanwhile.
 *   - The site's robots.txt disallows /laximo for bots. This is the client's
 *     own site and the client has to have OK'd this use -- ideally by
 *     whitelisting this server's IP in their anti-bot settings.
 *
 * Page types (all /laximo?lp=...), learned from saved page sources, Oct 2026:
 *   findByVIN  /laximo?vin=<VIN>&lp=findByVIN&c=<catalog>   -> vehicle rows
 *   vehicle    /laximo?lp=vehicle&...&vid=..&ssd=..          -> units, categories,
 *              plus an inline `const data = {...}` with the vid/ssd needed
 *              for the part-name search below
 *   details    /laximo?lp=details&c&vid&cid&gid&ssd&slp&vin&detailsQuery=<text>
 *              (the "Поиск по названию детали" box on the vehicle page)
 *   unit       /laximo?lp=unit&...&uid=..                   -> OEM table
 * ssd tokens are generated per step by Laximo, so URLs are always taken from
 * the previous page, never assembled from scratch (except the details search,
 * which the site itself builds from the vehicle page's `data` object).
 */

const dns = require('dns');
const cheerio = require('cheerio');
const { Client } = require('pg');

dns.setDefaultResultOrder('ipv4first');

const SITE_URL        = (process.env.LAXIMO_SITE_URL || 'https://bmwclub77.ru').replace(/\/+$/, '');
// Laximo catalog code. Versioned by release (BMW202601 = 2026/01 data) --
// if VIN lookups start returning nothing after a catalog update on the
// site, check the current `c=` value in the site's /laximo URLs.
const CATALOG         = process.env.LAXIMO_CATALOG || 'BMW202601';
const MIN_INTERVAL_MS = Number(process.env.LAXIMO_MIN_INTERVAL_MS || 1500);
const REQUEST_TIMEOUT = Number(process.env.LAXIMO_REQUEST_TIMEOUT_MS || 15000);
const MAX_QUERIES     = Number(process.env.LAXIMO_MAX_QUERIES || 4);
const CACHE_TTL_MS    = Number(process.env.LAXIMO_CACHE_TTL_DAYS || 30) * 24 * 60 * 60 * 1000;
const BREAKER_FAILS   = 3;                  // consecutive failures before opening the breaker
const BREAKER_COOLDOWN_MS = 30 * 60 * 1000; // stay off the site this long once open
const DB_URL          = process.env.SUPABASE_DB_URL;

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
};

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

function normalizeVin(vin) {
  if (!vin) return null;
  const v = String(vin).toUpperCase().replace(/[\s-]/g, '');
  return VIN_RE.test(v) ? v : null;
}

function normalizeOem(code) {
  return String(code || '').toUpperCase().replace(/[\s.-]/g, '');
}

// ─── COOKIE JAR ─────────────────────────────────────────────────────────────
// The site runs a bot-check on first visit: a couple of 302s that set
// session cookies. fetch() doesn't keep cookies across redirects, so we
// follow redirects manually and keep a jar for the life of the process.
const cookieJar = new Map(); // name -> value

function storeCookies(res) {
  let list = [];
  if (typeof res.headers.getSetCookie === 'function') {
    list = res.headers.getSetCookie();
  } else {
    const raw = res.headers.get('set-cookie');
    // Split a merged header on commas that start a new "name=" pair, not
    // the commas inside "Expires=Wed, 21 Oct ...".
    if (raw) list = raw.split(/,(?=\s*[^;,=\s]+=)/);
  }
  for (const c of list) {
    const pair = c.split(';')[0].trim();
    const eq = pair.indexOf('=');
    if (eq > 0) cookieJar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}

function cookieHeader() {
  return [...cookieJar].map(([k, v]) => `${k}=${v}`).join('; ');
}

// ─── GLOBAL PACING + CIRCUIT BREAKER ────────────────────────────────────────
let queue = Promise.resolve();
let lastRequestAt = 0;
let consecutiveFailures = 0;
let breakerOpenUntil = 0;

function breakerOpen() {
  return Date.now() < breakerOpenUntil;
}

function recordFailure(reason) {
  consecutiveFailures++;
  if (consecutiveFailures >= BREAKER_FAILS) {
    breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
    console.error(`[laximo] circuit breaker OPEN for ${BREAKER_COOLDOWN_MS / 60000} min after ${consecutiveFailures} consecutive failures (last: ${reason})`);
    consecutiveFailures = 0;
  }
}

/**
 * Fetch one /laximo page as HTML. All calls are serialized through a single
 * queue with MIN_INTERVAL_MS between them, regardless of how many chats are
 * running at once.
 */
function fetchPage(pathOrUrl) {
  const run = async () => {
    if (breakerOpen()) throw new Error('laximo circuit breaker open');

    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));

    let url = new URL(pathOrUrl, SITE_URL).toString();
    try {
      for (let hop = 0; hop < 6; hop++) {
        lastRequestAt = Date.now();
        const res = await fetch(url, {
          redirect: 'manual',
          headers: { ...BROWSER_HEADERS, ...(cookieJar.size ? { Cookie: cookieHeader() } : {}) },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        });
        storeCookies(res);

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) throw new Error(`redirect ${res.status} without Location`);
          url = new URL(location, url).toString();
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 120)}`);

        const html = await res.text();
        consecutiveFailures = 0;
        return html;
      }
      throw new Error('redirect chain did not resolve within 6 hops (bot-check loop?)');
    } catch (err) {
      recordFailure(err.message);
      throw err;
    }
  };

  const p = queue.then(run, run);
  queue = p.catch(() => {}); // a failure must not stall the queue
  return p;
}

// ─── CACHE (memory + Postgres) ──────────────────────────────────────────────
// Laximo/ETK data for a given VIN or search barely changes, so results are
// kept for CACHE_TTL_MS. The Postgres table means a container restart or
// redeploy doesn't send everyone back to the live site.
const memCache = new Map(); // key -> { data, at }
let tableReady = null;

async function withDb(fn) {
  if (!DB_URL) return null;
  const client = new Client({ connectionString: DB_URL, ssl: false });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

function ensureTable() {
  if (!tableReady) {
    tableReady = withDb(c => c.query(`
      create table if not exists laximo_cache (
        key        text primary key,
        data       jsonb not null,
        fetched_at timestamptz not null default now()
      )`)).catch(err => {
      console.error('[laximo] could not create laximo_cache table:', err.message);
      tableReady = null; // retry on a later call
    });
  }
  return tableReady;
}

async function cacheGet(key) {
  const m = memCache.get(key);
  if (m && Date.now() - m.at < CACHE_TTL_MS) return m.data;
  try {
    await ensureTable();
    const row = await withDb(async c => {
      const r = await c.query('select data, fetched_at from laximo_cache where key = $1', [key]);
      return r.rows[0];
    });
    if (row && Date.now() - new Date(row.fetched_at).getTime() < CACHE_TTL_MS) {
      memCache.set(key, { data: row.data, at: new Date(row.fetched_at).getTime() });
      return row.data;
    }
  } catch (err) {
    console.error('[laximo] cache read error:', key, err.message);
  }
  return undefined;
}

async function cacheSet(key, data) {
  memCache.set(key, { data, at: Date.now() });
  try {
    await ensureTable();
    await withDb(c => c.query(
      `insert into laximo_cache (key, data, fetched_at) values ($1, $2, now())
       on conflict (key) do update set data = excluded.data, fetched_at = now()`,
      [key, JSON.stringify(data)]
    ));
  } catch (err) {
    console.error('[laximo] cache write error:', key, err.message);
  }
}

// ─── PARSERS (pure functions -- testable against saved page sources) ────────
const clean = s => (s || '').replace(/\s+/g, ' ').trim();

/** findByVIN page -> [{ name, modelCode, options: {label: value}, href }] */
function parseVinResults(html) {
  const $ = cheerio.load(html);
  const vehicles = [];
  $('tr').each((_, tr) => {
    const link = $(tr).find('a[href*="lp=vehicle"]').first();
    if (!link.length) return;
    const tds = $(tr).find('td');
    const options = {};
    $(tr).find('li').each((__, li) => {
      const label = clean($(li).find('b').first().text());
      const value = clean($(li).text().replace($(li).find('b').first().text(), '').replace(/^\s*:/, ''));
      // "Модель" appears twice (code and full name) -- keep both
      if (label) options[options[label] ? `${label} (2)` : label] = value;
    });
    vehicles.push({
      name: clean(link.text()),
      modelCode: clean($(tds[2]).text()),
      options,
      href: link.attr('href'),
    });
  });
  return vehicles;
}

/**
 * vehicle page -> { query: {lp,c,vid,cid,gid,ssd,slp,vin}, title, categories, units }
 * `query` is the inline `const data = {...}` the page's own name-search uses.
 */
function parseVehiclePage(html) {
  const $ = cheerio.load(html);
  let query = null;
  const m = html.match(/const\s+data\s*=\s*\{([\s\S]*?)\};/);
  if (m) {
    query = {};
    for (const [, k, v] of m[1].matchAll(/(\w+)\s*:\s*"([^"]*)"/g)) query[k] = v;
  }

  const categories = [];
  $('li.laximoCategoriesAsideList__item > a').each((_, a) => {
    const href = $(a).attr('href') || '';
    const cid = (href.match(/[?&](?:amp;)?cid=(-?\d+)/) || [])[1];
    categories.push({ name: clean($(a).text()), cid, href });
  });

  const units = [];
  $('.laximoNexusList__item').each((_, li) => {
    const a = $(li).find('a[href*="lp=unit"]').first();
    if (a.length) {
      const href = a.attr('href');
      units.push({
        name: clean(a.find('span').text() || a.text()),
        uid: (href.match(/[?&]uid=(\d+)/) || [])[1],
        href,
      });
      return;
    }
    // Units that depend on an equipment option the catalog doesn't know
    // for this vehicle (only seen on the parameter-wizard path, e.g.
    // "Активная защита пешеходов (S8TFA)") have no direct link -- the site
    // opens an "Уточнение параметров автомобиля" popup instead. A VIN
    // already carries these options, so the VIN path shouldn't hit this.
    const sel = $(li).find('a.selectBlock').first();
    if (sel.length) {
      units.push({
        name: clean(sel.find('span').text() || sel.text()),
        uid: ((sel.attr('href') || '').match(/unitFilter_(\d+)/) || [])[1],
        href: null,
        needsOptions: true,
      });
    }
  });

  const title = clean($('h1').first().text());
  return { query, title, categories, units };
}

/**
 * Any page with an OEM parts table ->
 *   [{ position, oem, name, qty, notes: {label: value}, unit }]
 *
 * Two layouts exist (both confirmed from saved page sources, Oct 2026):
 *   unit page     columns: № | OEM | Наименование детали | Кол-во | (info)
 *                 OEM link: /search/BMW/<OEM>; info popup holds notes such
 *                 as "comment1: Для автомобилей с ... = да"
 *   details page  (the part-name search -- what the chat actually uses)
 *                 columns: OEM | Наименование детали | (Схема button)
 *                 OEM link: /search?pcode=<OEM>; flat list, no qty/unit/notes
 * So columns are located by their HEADER TEXT, not by position, and a row
 * counts as a part row when it links to the site's price search.
 */
function parsePartRows(html) {
  const $ = cheerio.load(html);
  const pageUnit = clean($('h1, h2, h3').filter((_, h) => /Узел/.test($(h).text())).first().text())
    .replace(/^Узел\s*/, '') || null;

  const parts = [];
  $('table').each((_, table) => {
    const headers = $(table).find('tr').first().find('th').map((__, th) => clean($(th).text()).toLowerCase()).get();
    if (!headers.length) return;
    const col = re => headers.findIndex(h => re.test(h));
    const iPos  = col(/^№$/);
    const iOem  = col(/^oem$/);
    const iName = col(/наименование/);
    const iQty  = col(/кол-во|количество/);
    if (iOem < 0) return; // not a parts table

    $(table).find('tr').slice(1).each((__, tr) => {
      const tds = $(tr).find('> td');
      if (!tds.length) return;
      const oemCell = $(tds[iOem]);
      const link = oemCell.find('a[href*="/search"]').first();
      const oem = normalizeOem(link.length ? link.text() : oemCell.text());
      if (!oem || !/^[A-Z0-9]{5,}$/.test(oem)) return;

      const notes = {};
      $(tr).find('div.hidden li').each((___, li) => {
        const b = $(li).find('.fr-text-bold').first();
        const label = clean(b.text());
        const value = clean($(li).text().replace(b.text(), '').replace(/^\s*:/, ''));
        if (label && value) notes[label] = value;
      });

      parts.push({
        position: iPos >= 0 ? clean($(tds[iPos]).text()) || null : null,
        oem,
        name: iName >= 0 ? clean($(tds[iName]).text()) || null : null,
        qty: iQty >= 0 ? clean($(tds[iQty]).text()) || null : null,
        notes,
        unit: pageUnit,
      });
    });
  });
  return parts;
}

// ─── HIGH-LEVEL STEPS ───────────────────────────────────────────────────────
async function findVehicleByVin(vin) {
  const key = `vin:${CATALOG}:${vin}`;
  const cached = await cacheGet(key);
  if (cached !== undefined) return cached;

  const html = await fetchPage(`/laximo?vin=${encodeURIComponent(vin)}&lp=findByVIN&c=${encodeURIComponent(CATALOG)}`);
  const vehicles = parseVinResults(html);
  if (!vehicles.length) {
    // Cache "not found" too, but only briefly in memory -- a typo'd VIN
    // shouldn't be re-fetched on every message of the same conversation.
    memCache.set(key, { data: null, at: Date.now() - CACHE_TTL_MS + 60 * 60 * 1000 });
    return null;
  }

  const v = vehicles[0]; // a VIN resolves to one vehicle
  const vehiclePage = parseVehiclePage(await fetchPage(v.href.replace(/&amp;/g, '&')));
  if (!vehiclePage.query || !vehiclePage.query.vid || !vehiclePage.query.ssd) {
    throw new Error('vehicle page parsed without vid/ssd -- markup changed?');
  }
  const result = {
    vin,
    name: v.name,
    modelCode: v.modelCode,
    options: v.options,
    query: vehiclePage.query,
  };
  await cacheSet(key, result);
  return result;
}

function detailsSearchUrl(vehicleQuery, text) {
  const params = new URLSearchParams({ ...vehicleQuery, lp: 'details', detailsQuery: text });
  return `/laximo?${params.toString()}`;
}

async function searchDetails(vehicle, text) {
  const key = `details:${CATALOG}:${vehicle.vin}:${text.toLowerCase()}`;
  const cached = await cacheGet(key);
  if (cached !== undefined) return cached;

  const parts = parsePartRows(await fetchPage(detailsSearchUrl(vehicle.query, text)));
  await cacheSet(key, parts);
  return parts;
}

/**
 * Main entry point for chat.js.
 *   findPartsByVin('WBS11CS0609158489', ['масляный фильтр', 'воздушный фильтр'])
 * -> { vehicle: {vin, name, modelCode, options}, parts: [{oem, name, qty, notes, unit, query}] }
 * Returns null if Laximo can't help (bad VIN, not found, breaker open);
 * throws only on unexpected errors -- callers should still wrap it.
 */
async function findPartsByVin(rawVin, partKeywords) {
  const vin = normalizeVin(rawVin);
  if (!vin) return null;
  if (breakerOpen()) {
    console.warn('[laximo] skipped -- circuit breaker open');
    return null;
  }

  const vehicle = await findVehicleByVin(vin);
  if (!vehicle) return null;

  const queries = [...new Set((partKeywords || []).map(k => clean(k).toLowerCase()).filter(Boolean))]
    .slice(0, MAX_QUERIES);

  const parts = [];
  const seen = new Set();
  for (const q of queries) {
    try {
      for (const p of await searchDetails(vehicle, q)) {
        const dedupeKey = `${p.oem}|${p.unit}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        parts.push({ ...p, query: q });
      }
    } catch (err) {
      console.error('[laximo] details search failed:', q, err.message);
      if (breakerOpen()) break;
    }
  }

  const { query, ...vehiclePublic } = vehicle;
  return { vehicle: vehiclePublic, parts };
}

module.exports = {
  findPartsByVin,
  normalizeVin,
  normalizeOem,
  // exported for tests
  parseVinResults,
  parseVehiclePage,
  parsePartRows,
  detailsSearchUrl,
};
