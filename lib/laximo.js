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

// For error logs: the visible text of an error page, centred on the words
// that explain it. The site's 403 page is its normal template, so the first
// characters are just header/JSON-LD -- useless (seen live, Oct 2026).
function errorSnippet(html) {
  const txt = String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const i = txt.search(/доступ|запрещ|лимит|превыш|авториз|войдите|forbidden|denied|блок/i);
  return i >= 0 ? txt.slice(Math.max(0, i - 120), i + 280) : txt.slice(0, 300);
}

// ─── GLOBAL PACING + CIRCUIT BREAKERS ───────────────────────────────────────
// One request queue for everything (pacing protects the site), but separate
// breakers per kind of request: 'core' (VIN search, vehicle page, part-name
// search) and 'wizard' (parameter search). A broken wizard step must not
// switch off VIN lookups -- it did once: three wizard 403s (stale tokens)
// opened the single shared breaker and blocked the working VIN path too.
let queue = Promise.resolve();
let lastRequestAt = 0;
const breakers = {}; // kind -> { fails, openUntil }

function breakerState(kind) {
  return breakers[kind] || (breakers[kind] = { fails: 0, openUntil: 0 });
}

function breakerOpen(kind = 'core') {
  return Date.now() < breakerState(kind).openUntil;
}

function recordFailure(kind, reason) {
  const b = breakerState(kind);
  b.fails++;
  if (b.fails >= BREAKER_FAILS) {
    b.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    console.error(`[laximo] circuit breaker '${kind}' OPEN for ${BREAKER_COOLDOWN_MS / 60000} min after ${b.fails} consecutive failures (last: ${reason})`);
    b.fails = 0;
  }
}

/**
 * Fetch one /laximo page (HTML, or JSON text for wizard steps). All calls
 * are serialized through a single queue with MIN_INTERVAL_MS between them,
 * regardless of how many chats are running at once.
 *   opts.kind  'core' | 'wizard' -- which breaker this request counts toward
 *   opts.ajax  send the headers the site's own jQuery sends for XHR calls
 */
function fetchPage(pathOrUrl, opts = {}) {
  const kind = opts.kind || 'core';
  const run = async () => {
    if (breakerOpen(kind)) throw new Error(`laximo circuit breaker '${kind}' open`);

    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));

    let url = new URL(pathOrUrl, SITE_URL).toString();
    const headers = {
      ...BROWSER_HEADERS,
      ...(opts.ajax ? {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${SITE_URL}/laximo?lp=catalog&c=${encodeURIComponent(CATALOG)}`,
      } : {}),
    };
    try {
      for (let hop = 0; hop < 6; hop++) {
        lastRequestAt = Date.now();
        const res = await fetch(url, {
          redirect: 'manual',
          headers: { ...headers, ...(cookieJar.size ? { Cookie: cookieHeader() } : {}) },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        });
        storeCookies(res);

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) throw new Error(`redirect ${res.status} without Location`);
          url = new URL(location, url).toString();
          continue;
        }
        if (!res.ok) {
          // Include the start of the body: tells a WAF block page apart from
          // the site rejecting our parameters.
          const body = errorSnippet(await res.text().catch(() => ''));
          throw new Error(`HTTP ${res.status} for ${url.slice(0, 120)}${body ? ` -- body: ${body}` : ''}`);
        }

        const html = await res.text();
        breakerState(kind).fails = 0;
        return html;
      }
      throw new Error('redirect chain did not resolve within 6 hops (bot-check loop?)');
    } catch (err) {
      recordFailure(kind, err.message);
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
  // VIN vehicles keep their original cache key (vehicle.vin); model-path
  // vehicles use their chosen-values path (vehicle.cacheId).
  const key = `details:${CATALOG}:${vehicle.cacheId || vehicle.vin}:${text.toLowerCase()}`;
  const cached = await cacheGet(key);
  if (cached !== undefined) return cached;

  const parts = parsePartRows(await fetchPage(detailsSearchUrl(vehicle.query, text)));
  await cacheSet(key, parts);
  return parts;
}

/** Run the part-name searches for an already-resolved vehicle. */
async function searchPartsForVehicle(vehicle, partKeywords) {
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
  return parts;
}

/**
 * Main entry point for chat.js (VIN path).
 *   findPartsByVin('WBS11CS0609158489', ['масляный фильтр', 'воздушный фильтр'])
 * -> { vehicle: {vin, name, modelCode, options}, parts: [{oem, name, qty, notes, unit, query}] }
 * Returns null if Laximo can't help (bad VIN, not found, breaker open);
 * throws only on unexpected errors -- callers should still wrap it.
 */
async function findPartsByVin(rawVin, partKeywords) {
  const vin = normalizeVin(rawVin);
  if (!vin) return null;
  if (breakerOpen()) {
    console.warn("[laximo] VIN path skipped -- circuit breaker 'core' open");
    return null;
  }

  const vehicle = await findVehicleByVin(vin);
  if (!vehicle) return null;

  const parts = await searchPartsForVehicle(vehicle, partKeywords);
  const { query, cacheId, ...vehiclePublic } = vehicle;
  return { vehicle: vehiclePublic, parts };
}

// ─── MODEL PATH (no VIN): the site's "Поиск автомобиля по параметрам" ──────
// The wizard is a chain of dropdowns (Серия → Тип кузова → Модель →
// Рулевое управление → [Трансмиссия] → Рынок; the set varies by series).
// Each option carries an ssd token; choosing one means requesting
//   /laximo?lp=wizard&c=<catalog>&ssd=<option token>&ajax=1
// which returns JSON: { wizardSteps: [{conditionId, name, determined, value,
// automatic, options: [{key, value}]}], vehicles: [...], determined }.
// The first step (Серия) is only in the HTML of the catalog start page.
// When enough is chosen, /laximo?lp=wizard&...&ssd=<last token>&searchNow=1
// lists the vehicles in the same table layout as the VIN result page.
//
// Tokens differ on every request even for the same option (seen in real
// responses, Oct 2026), so caching is keyed by the CHOSEN VALUES path,
// e.g. "2' G42|купе|220i|Левый руль|ЕЭК", never by token.

const BODY_SYNONYMS = {
  'универсал': ['touring', 'туринг', 'универсал'],
  'купе': ['coupe', 'купе'],
  'кабриолет': ['cabrio', 'кабрио', 'кабриолет', 'convertible', 'родстер', 'roadster'],
  'седан': ['sedan', 'седан'],
  'хэтчбек': ['hatchback', 'хэтчбек', 'хетчбек'],
};

/** Lowercase, drop apostrophes, everything else to single spaces; padded for whole-word checks. */
function norm(s) {
  return ' ' + String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[’'`´]/g, '')
    .replace(/[^a-zа-я0-9]+/g, ' ').trim() + ' ';
}

/** Does normalized text contain `phrase` as whole word(s)? */
function textHas(ntext, phrase) {
  const p = norm(phrase).trim();
  return !!p && ntext.includes(` ${p} `);
}

/**
 * Choose an option for one wizard step from what the customer wrote.
 * Returns { choice: {key, value} } | { ask: [option values] } | null (can't help).
 * Pure function -- see scripts/test-laximo-parsers.js.
 */
function pickWizardOption(step, ntext, answers = new Set()) {
  const opts = (step.options || []).filter(o => o && o.key && o.value);
  if (!opts.length) return null;
  if (opts.length === 1) return { choice: opts[0] };

  // 0. A message that IS one option (a clarification button click, or the
  //    same text typed alone) is a definite answer -- take it, even when it
  //    prefixes other options. Without this, clicking "X5 G05" re-asked
  //    "X5 G05 or X5 G05 LCI?" forever (first live test, Oct 2026).
  const answered = opts.filter(o => answers.has(norm(o.value)));
  if (answered.length === 1) return { choice: answered[0] };

  const name = String(step.name || '').toLowerCase();
  const askAmong = list => ({ ask: list.map(o => o.value) });

  // 1. Options the customer named outright (or a synonym of them).
  const direct = opts.filter(o =>
    textHas(ntext, o.value) || (BODY_SYNONYMS[o.value.toLowerCase()] || []).some(syn => textHas(ntext, syn)));
  if (direct.length) {
    const longest = Math.max(...direct.map(o => o.value.length));
    const best = direct.filter(o => o.value.length === longest);
    if (best.length > 1) return askAmong(best);
    // "M240i" also prefixes "M240i B58C"/"M240i B58D" -- different engines.
    // If the customer only wrote the short form, ask rather than guess.
    const extended = opts.filter(o => o !== best[0] && norm(o.value).startsWith(norm(best[0].value).slice(0, -1) + ' '));
    if (extended.length) return askAmong([best[0], ...extended]);
    return { choice: best[0] };
  }

  // 2. Серия: match the chassis code ("G42" in "2' G42"), handle LCI.
  if (/серия/.test(name)) {
    // A chassis code is a letter + 2-3 digits (E70, F15, G05, U06). Anything
    // else in the name ("MS BMW Motorsport", "X5 M F85"'s "M") must not count,
    // or a customer writing "BMW" would match "MS BMW Motorsport".
    const code = v => (v.split(/\s+/).slice(1).find(t => /^[a-z]\d{2,3}$/i.test(t)) || '').toLowerCase();
    let cands = opts.filter(o => code(o.value) && textHas(ntext, code(o.value)));
    if (cands.length > 1) {
      const lci = cands.filter(o => /\blci\b/i.test(o.value));
      if (textHas(ntext, 'lci') && lci.length === 1) return { choice: lci[0] };
    }
    if (cands.length === 1) return { choice: cands[0] };
    if (cands.length > 1) return askAmong(cands);
    // No chassis code: offer the generations of the named family ("X5", "2").
    const family = v => norm(v.split(/\s+/)[0]).trim();
    const fam = opts.filter(o => {
      if (!code(o.value)) return false; // only real series ("X5 F15"), not "BMW Classic Motorsport"
      const f = family(o.value);
      return /[a-z]/.test(f) ? textHas(ntext, f) : (textHas(ntext, `bmw ${f}`) || textHas(ntext, `бмв ${f}`) || textHas(ntext, `${f} series`) || textHas(ntext, `${f} серия`) || textHas(ntext, `${f}er`) || new RegExp(` ${f} [a-z]?\\d{2,3}[a-z]* `).test(ntext));
    });
    if (fam.length && fam.length <= 16) return askAmong(fam);
    return null;
  }

  // 3. Sensible defaults for this shop (Moscow, mostly EU-market cars).
  if (/рул/.test(name)) {
    const left = opts.find(o => /лев/i.test(o.value));
    if (left) return { choice: left };
  }
  if (/рынок/.test(name)) {
    const pref = opts.find(o => /^еэк$/i.test(o.value)) || opts.find(o => /европ|eu|ece/i.test(o.value))
      || opts.find(o => /рос|rus/i.test(o.value));
    if (pref) return { choice: pref };
  }

  return opts.length <= 16 ? askAmong(opts) : null;
}

// Values-only copy for the cache. Wizard option tokens are issued per
// request/session: a token cached earlier is rejected later with HTTP 403
// (seen live, Oct 2026 -- a cached "X5 G05" token failed after a redeploy).
// So the cache only ever holds option NAMES, used to plan the path and ask
// questions; real tokens come from a fresh walk (liveTo) when needed.
function stripTokens(step) {
  return { ...step, ssd: '', options: step.options ? step.options.map(o => ({ key: 'cached', value: o.value })) : step.options };
}

const seriesCacheKey = () => `wiz-series-v2:${CATALOG}`;
const stepCacheKey = path => `wizv:${CATALOG}:${path.join('|')}`;
const wizardAjaxUrl = token => `/laximo?lp=wizard&c=${encodeURIComponent(CATALOG)}&ssd=${encodeURIComponent(token)}&ajax=1`;

async function fetchSeriesLive() {
  const $ = cheerio.load(await fetchPage(`/laximo?lp=catalog&c=${encodeURIComponent(CATALOG)}`, { kind: 'wizard' }));
  const select = $('#wizardForm select').first();
  const step = {
    conditionId: select.attr('name'),
    name: clean($('#wizardForm label').first().text()) || 'Серия',
    options: select.find('option').map((_, o) => ({ key: $(o).attr('value'), value: clean($(o).text()) })).get()
      .filter(o => o.key && o.key !== 'null' && o.value),
  };
  if (!step.options.length) throw new Error('wizard series list empty -- markup changed?');
  await cacheSet(seriesCacheKey(), stripTokens(step));
  return step;
}

/**
 * Bring a live walk (fresh tokens, this process's session, seconds apart)
 * to the state after choosing `path`. Extends the current walk when it is a
 * prefix of `path`, otherwise starts over from the catalog page.
 */
async function liveTo(live, path) {
  const isPrefix = live.path && live.path.length <= path.length && live.path.every((v, i) => v === path[i]);
  if (!isPrefix) {
    const series = await fetchSeriesLive();
    live.path = [];
    live.data = { wizardSteps: [series], vehicles: [] };
    live.token = null;
  }
  while (live.path.length < path.length) {
    const want = path[live.path.length];
    const opt = live.data.wizardSteps
      .filter(st => !st.determined || st === live.data.wizardSteps[0])
      .flatMap(st => st.options || [])
      .find(o => o.value === want);
    if (!opt) throw new Error(`wizard option "${want}" is not offered any more`);
    const raw = await fetchPage(wizardAjaxUrl(opt.key), { kind: 'wizard', ajax: true });
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error(`wizard step did not return JSON (got: ${clean(raw).slice(0, 80)})`); }
    if (!Array.isArray(data.wizardSteps)) throw new Error('wizard JSON without wizardSteps');
    live.path.push(want);
    live.token = opt.key;
    live.data = data;
    await cacheSet(stepCacheKey(live.path), {
      wizardSteps: data.wizardSteps.map(stripTokens),
      vehicleCount: (data.vehicles || []).length,
    });
  }
  return live;
}

/** Wizard state after choosing `path` -- from the names-only cache, or live. */
async function stepsAfter(path, live) {
  const cached = await cacheGet(stepCacheKey(path));
  if (cached !== undefined) return cached;
  await liveTo(live, path);
  return { wizardSteps: live.data.wizardSteps.map(stripTokens), vehicleCount: (live.data.vehicles || []).length };
}

/**
 * Resolve a vehicle from the customer's own words via the wizard.
 * Returns { vehicle } | { needsChoice: {step, options} } | null.
 * Planning (which option, what to ask) runs on cached option names; the site
 * is only touched for steps never seen before, or to get fresh tokens for
 * the final vehicle list of a path not resolved before.
 */
async function findVehicleByModel(customerText) {
  const ntext = norm(customerText);
  // Each line on its own (chat.js joins the customer's messages with
  // newlines), so a clicked button can be recognized as a whole answer.
  const answers = new Set(String(customerText || '').split(/\n/).map(norm).filter(l => l.trim()));
  const live = { path: null, data: null, token: null };

  let series = await cacheGet(seriesCacheKey());
  if (series === undefined) series = stripTokens(await fetchSeriesLive());
  const first = pickWizardOption(series, ntext, answers);
  if (!first) return null;
  if (first.ask) return { needsChoice: { step: series.name, options: first.ask } };

  const path = [first.choice.value];
  let data = await stepsAfter(path, live);

  for (let guard = 0; guard < 10; guard++) {
    const open = data.wizardSteps.filter(st => !st.determined && st.options && st.options.length);
    if (!open.length) break;
    const step = open[0];
    const pick = pickWizardOption(step, ntext, answers);
    if (!pick || pick.ask) {
      if (data.vehicleCount === 1) break; // the rest doesn't change the vehicle
      return pick ? { needsChoice: { step: step.name, options: pick.ask } } : null;
    }
    path.push(pick.choice.value);
    data = await stepsAfter(path, live);
  }

  const vehKey = `modelveh2:${CATALOG}:${path.join('|')}`;
  let candidates = await cacheGet(vehKey);
  if (candidates === undefined) {
    await liveTo(live, path); // fresh token for exactly this path
    candidates = parseVinResults(await fetchPage(
      `/laximo?lp=wizard&c=${encodeURIComponent(CATALOG)}&ssd=${encodeURIComponent(live.token)}&searchNow=1`, { kind: 'wizard' }));
    await cacheSet(vehKey, candidates);
  }
  if (!candidates.length) return null;

  let v = candidates[0];
  if (candidates.length > 1) {
    const label = c => `${c.name} ${c.modelCode}`.trim();
    const clicked = candidates.filter(c => answers.has(norm(label(c))));
    const named = clicked.length === 1 ? clicked
      : candidates.filter(c => textHas(ntext, label(c)) || textHas(ntext, c.modelCode));
    if (named.length !== 1) return { needsChoice: { step: 'Вариант автомобиля', options: candidates.map(label) } };
    v = named[0];
  }

  // The vehicle page's own vid/ssd are stable (unlike wizard option tokens),
  // so they can be cached long-term like on the VIN path.
  const pageKey = `modelvehpage:${CATALOG}:${path.join('|')}|${v.modelCode}`;
  let query = await cacheGet(pageKey);
  if (query === undefined) {
    query = parseVehiclePage(await fetchPage(v.href.replace(/&amp;/g, '&'))).query;
    if (!query || !query.vid || !query.ssd) throw new Error('vehicle page parsed without vid/ssd -- markup changed?');
    await cacheSet(pageKey, query);
  }
  return {
    vehicle: {
      name: v.name,
      modelCode: v.modelCode,
      options: v.options,
      path,
      query,
      cacheId: `model:${path.join('|')}|${v.modelCode}`,
    },
  };
}

/**
 * Entry point for chat.js (model path, no VIN).
 *   findPartsByModel('BMW 2 G42 220i ... набор на ТО', ['масляный фильтр', ...])
 * -> { vehicle, parts } | { needsChoice: {step, options} } | null
 */
async function findPartsByModel(customerText, partKeywords) {
  for (const kind of ['wizard', 'core']) {
    if (breakerOpen(kind)) {
      console.warn(`[laximo] model path skipped -- circuit breaker '${kind}' open`);
      return null;
    }
  }
  const found = await findVehicleByModel(customerText);
  if (!found || found.needsChoice) return found;

  const parts = await searchPartsForVehicle(found.vehicle, partKeywords);
  const { query, cacheId, ...vehiclePublic } = found.vehicle;
  return { vehicle: vehiclePublic, parts };
}

module.exports = {
  findPartsByVin,
  findPartsByModel,
  normalizeVin,
  normalizeOem,
  // exported for tests
  parseVinResults,
  parseVehiclePage,
  parsePartRows,
  detailsSearchUrl,
  pickWizardOption,
  norm,
};
