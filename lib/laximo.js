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
// Catalog codes are per brand and versioned by release (BMW202601, AU1587,
// MB201810, ...). They are NOT hardcoded: VIN lookups use the site's general
// VIN search (c= empty, Laximo detects the brand), and the model path reads
// the brand -> code list from the /laximo start page (cached, BRANDS_TTL_MS).
const BRANDS_TTL_MS   = 7 * 24 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = Number(process.env.LAXIMO_MIN_INTERVAL_MS || 3000);
// Max requests to the site in any rolling 60 minutes. For scale: a new VIN +
// one part = 3 requests, + a maintenance set = 6, a new model via the
// parameter search = up to 11; cached repeats = 0.
const MAX_PER_HOUR    = Number(process.env.LAXIMO_MAX_REQUESTS_PER_HOUR || 60);
// How long ALL Laximo requests stop once the site shows its browser check.
const CHALLENGE_PAUSE_MS = Number(process.env.LAXIMO_CHALLENGE_PAUSE_HOURS || 6) * 60 * 60 * 1000;
// During a pause, ONE real customer request may go through every
// PROBE_INTERVAL_MS to see whether the check is gone (e.g. a short-lived
// flag on ABCP's side). Passes -> pause lifted at once; check shown again ->
// pause restarts. At most ~2 requests/hour to the site while paused.
const PROBE_INTERVAL_MS = Number(process.env.LAXIMO_PROBE_MINUTES || 30) * 60 * 1000;
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

// ─── SITE-WIDE PAUSE + HOURLY BUDGET ────────────────────────────────────────
// The site's bot protection answers with a "Мы проверяем ваш браузер" page
// (HTTP 403 + a JavaScript check that real browsers pass automatically; we
// don't run JS and must not try to get around it). Oct 16 2026: after an
// evening of testing, the site started showing it to this server on EVERY
// /laximo page, VIN search included. So: the moment it appears, ALL Laximo
// requests stop for CHALLENGE_PAUSE_MS. The pause is stored in Postgres so a
// redeploy doesn't lift it; /api/admin/clear-cache lifts it (resetPause).
// Normal pages never contain the phrase (checked on all saved page sources).
const CHALLENGE_RE = /Мы проверяем ваш браузер/i;
const PAUSE_KEY = 'state:pause-until';
let pauseUntil = 0;
let pauseLoaded = false;
let nextProbeAt = 0; // in-memory: a redeploy simply allows one probe right away
const requestTimes = []; // timestamps of requests in the last hour

/** Thrown when we deliberately don't contact the site -- not a site failure, so it never counts toward a breaker. */
class LaximoSkip extends Error {}

function budgetLeft() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  while (requestTimes.length && requestTimes[0] < cutoff) requestTimes.shift();
  return MAX_PER_HOUR - requestTimes.length;
}

/**
 * Why Laximo must not be used right now, or null if it may.
 * While paused, returns null when a probe is due (so a lookup goes ahead);
 * only fetchPage passes { forRequest: true }, which takes the probe slot.
 */
async function unavailableReason({ forRequest = false } = {}) {
  if (!pauseLoaded) {
    pauseLoaded = true;
    try {
      const saved = await cacheGet(PAUSE_KEY);
      if (saved && saved.until > pauseUntil) pauseUntil = saved.until;
    } catch { /* cache unavailable -- memory state only */ }
  }
  if (Date.now() < pauseUntil) {
    if (Date.now() >= nextProbeAt) {
      if (forRequest) {
        nextProbeAt = Date.now() + PROBE_INTERVAL_MS;
        probing = true;
        console.log('[laximo] paused -- letting one probe request through to see if the browser check is gone');
      }
      // probe due: fall through to the budget check
    } else {
      return `paused after the site's browser check, until ${new Date(pauseUntil).toISOString()} (next probe ${new Date(nextProbeAt).toISOString()})`;
    }
  }
  if (budgetLeft() <= 0) return `hourly budget of ${MAX_PER_HOUR} requests used up`;
  return null;
}

let probing = false;

function startPause(url) {
  probing = false;
  pauseUntil = Date.now() + CHALLENGE_PAUSE_MS;
  nextProbeAt = Date.now() + PROBE_INTERVAL_MS;
  console.error(`[laximo] BROWSER CHECK detected ("Мы проверяем ваш браузер") on ${url.slice(0, 100)} -- ALL Laximo requests paused until ${new Date(pauseUntil).toISOString()} (${CHALLENGE_PAUSE_MS / 3600000} h; one probe every ${PROBE_INTERVAL_MS / 60000} min). Chat falls back to the compatibility table. Permanent fix: ABCP exempting this server's IP from the browser check.`);
  cacheSet(PAUSE_KEY, { until: pauseUntil }).catch(() => {});
}

/** Lift the pause by hand (e.g. after ABCP confirmed the exemption). */
async function resetPause() {
  pauseUntil = 0;
  probing = false;
  pauseLoaded = true;
  await cacheSet(PAUSE_KEY, { until: 0 }).catch(() => {});
  console.log('[laximo] pause lifted by hand');
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
    if (breakerOpen(kind)) throw new LaximoSkip(`laximo circuit breaker '${kind}' open`);
    const why = await unavailableReason({ forRequest: true });
    if (why) throw new LaximoSkip(`laximo ${why}`);

    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));

    let url = new URL(pathOrUrl, SITE_URL).toString();
    const headers = {
      ...BROWSER_HEADERS,
      ...(opts.ajax ? {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${SITE_URL}/laximo`,
      } : {}),
    };
    try {
      for (let hop = 0; hop < 6; hop++) {
        lastRequestAt = Date.now();
        requestTimes.push(lastRequestAt);
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
        const html = await res.text().catch(() => '');
        if (CHALLENGE_RE.test(html)) {
          startPause(url);
          throw new LaximoSkip(`site browser check (HTTP ${res.status}) -- Laximo paused`);
        }
        if (!res.ok) {
          // The explanatory text of the page: tells a block page apart from
          // the site rejecting our parameters.
          const body = errorSnippet(html);
          throw new Error(`HTTP ${res.status} for ${url.slice(0, 120)}${body ? ` -- body: ${body}` : ''}`);
        }

        breakerState(kind).fails = 0;
        if (pauseUntil && (probing || Date.now() >= pauseUntil)) {
          // A page came back without the browser check: the block is gone.
          probing = false;
          pauseUntil = 0;
          cacheSet(PAUSE_KEY, { until: 0 }).catch(() => {});
          console.log('[laximo] probe passed -- no browser check any more, pause lifted');
        }
        return html;
      }
      throw new Error('redirect chain did not resolve within 6 hops (bot-check loop?)');
    } catch (err) {
      if (!(err instanceof LaximoSkip)) recordFailure(kind, err.message);
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
    const href = link.attr('href');
    vehicles.push({
      brand: clean($(tds[0]).text()) || null,
      catalog: (String(href).replace(/&amp;/g, '&').match(/[?&]c=([^&]+)/) || [])[1] || null,
      name: clean(link.text()),
      modelCode: clean($(tds[2]).text()),
      options,
      href,
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

      // Details page: the "Схема" button carries what the site's JS needs to
      // find the part's unit page. Unit page: the row's code on the diagram.
      const sb = $(tr).find('a.checkSchema').first();
      const schema = sb.length ? {
        number: sb.attr('data-number') || oem, catalog: sb.attr('data-catalog-code') || null,
        vid: sb.attr('data-vid') || null, ssd: sb.attr('data-ssd') || null,
      } : null;
      parts.push({
        position: iPos >= 0 ? clean($(tds[iPos]).text()) || null : null,
        oem,
        name: iName >= 0 ? clean($(tds[iName]).text()) || null : null,
        qty: iQty >= 0 ? clean($(tds[iQty]).text()) || null : null,
        notes,
        unit: pageUnit,
        ...(schema ? { schema } : {}),
        ...($(tr).attr('data-code-on-image') ? { code: $(tr).attr('data-code-on-image') } : {}),
      });
    });
  });
  return parts;
}

// ─── UNIT DIAGRAM (for parts without a product photo) ──────────────────────
/**
 * Unit page -> { image, unitName, boxes: {code: {x, y, w, h}}, rows }.
 * The diagram is <img class="mapBlockImage" src="https://img.laximo.ru/...">
 * and each position is a <div class="mapObjects" data-code-on-image="a01"
 * style="left:455px; top:67px; width:12px; height:20px">, matching the
 * parts row <tr data-code-on-image="a01">. Pure -- exported for tests.
 */
function parseUnitDiagram(html) {
  const $ = cheerio.load(html);
  const image = $('img.mapBlockImage').first().attr('src') || null;
  const unitName = clean($('h1, h2, h3').filter((_, h) => /Узел/.test($(h).text())).first().text()).replace(/^Узел\s*/, '') || null;
  const boxes = {};
  $('.mapObjects[data-code-on-image]').each((_, el) => {
    const st = String($(el).attr('style') || '');
    const num = k => { const m = st.match(new RegExp(`${k}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)px`)); return m ? Number(m[1]) : null; };
    const box = { x: num('left'), y: num('top'), w: num('width'), h: num('height') };
    const code = $(el).attr('data-code-on-image');
    if (code && box.x != null && box.y != null && !boxes[code]) boxes[code] = box;
  });
  return { image, unitName, boxes, rows: parsePartRows(html) };
}

/**
 * The details row's "Схема" button (number + catalog + vid + ssd). The site's
 * JS (seen in the details page, 23.10.2026) calls
 *   GET /?action=article/getSchemaApplicabilityLink&number&c&vid&ssd   (XHR)
 * -> {"success":true,"unit":{"unitid","name","imageurl" (with %size%),
 *     "ssd","details":[{"oem","name","codeonimage","attributes":[…]}]}}
 * and opens /laximo?lp=unit&c=&vid=&uid=<unitid>&detailCodeOnImage=<code>&ssd=<unit.ssd>.
 * LAXIMO_SCHEMA_URL can override the lookup address (placeholders {number}
 * {catalog} {vid} {ssd}).
 */
const SCHEMA_URL = process.env.LAXIMO_SCHEMA_URL
  || '/?action=article%2FgetSchemaApplicabilityLink&number={number}&c={catalog}&vid={vid}&ssd={ssd}';

// Laximo attribute keys that come without a Russian name (seen 24.10:
// name "end_of_production", value "Не производятся с: 20211116").
const NOTE_LABELS = { end_of_production: 'Не производится с', note: 'Примечание', start_of_production: 'Производится с' };
const ymd = v => String(v).replace(/\b(\d{4})(\d{2})(\d{2})\b/g, '$3.$2.$1');
/** One attribute -> { label, value } with readable label and dates. */
function noteLabel(a) {
  const raw = String(a.name || a.key || '').trim();
  const technical = !raw || /^[a-z0-9_]+$/i.test(raw);
  let value = ymd(String(a.value).trim());
  let label = technical ? (NOTE_LABELS[a.key] || NOTE_LABELS[raw] || '') : raw;
  // "Не производятся с: 16.11.2021" -> label from the value itself
  const m = value.match(/^([^:]{3,40}):\s*(.+)$/);
  if (!label && m) { label = m[1].trim(); value = m[2].trim(); }
  else if (label && m && /производ/i.test(m[1])) value = m[2].trim();
  return { label: label || 'Примечание', value };
}

/** Pure: schema JSON (+ the part) -> { unitUrl, image, unitName, position, notes } | null. Exported for tests. */
function parseSchemaAnswer(body, schema) {
  let data;
  try { data = typeof body === 'string' ? JSON.parse(body) : body; } catch { return null; }
  const u = data && data.success && data.unit;
  if (!u || !u.unitid) return null;
  const detail = (u.details || []).find(d => normalizeOem(d.oem) === normalizeOem(schema.number)) || (u.details || [])[0] || {};
  const notes = {};
  for (const a of detail.attributes || []) {
    if (!a || !a.value || a.key === 'amount') continue;
    const n = noteLabel(a);
    notes[n.label] = n.value;
  }
  const qty = ((detail.attributes || []).find(a => a && a.key === 'amount') || {}).value || null;
  // The whole unit (e.g. "ТО по регл.Oelservice / Inspektion": filters, plugs,
  // wipers, fluids) -- used to show a full service kit.
  const unitParts = (u.details || []).filter(d => d && normalizeOem(d.oem).length >= 5).map(d => {
    const n = {};
    for (const a of d.attributes || []) { if (a && a.value && a.key !== 'amount') { const x = noteLabel(a); n[x.label] = x.value; } }
    return { position: d.codeonimage || null, oem: normalizeOem(d.oem), name: d.name || null,
      qty: ((d.attributes || []).find(a => a && a.key === 'amount') || {}).value || null, notes: n };
  });
  const params = new URLSearchParams({ lp: 'unit', c: schema.catalog || '', vid: schema.vid || '', uid: String(u.unitid),
    detailCodeOnImage: detail.codeonimage || '', ssd: u.ssd || '' });
  return {
    unitUrl: `/laximo?${params}`,
    image: u.imageurl ? String(u.imageurl).replace('%size%', 'source') : null,
    unitName: u.name || null,
    position: detail.codeonimage || null,
    name: detail.name || null,
    qty,
    notes,
    unitParts,
  };
}

async function resolveSchema(schema) {
  if (!schema || !schema.number) return null;
  const url = SCHEMA_URL.replace(/\{(number|catalog|vid|ssd)\}/g, (_, k) => encodeURIComponent(schema[k] || ''));
  const body = await fetchPage(url, { kind: 'core', ajax: true });
  const info = parseSchemaAnswer(body, schema);
  if (!info) console.warn(`[laximo] diagrams: unexpected schema answer: ${String(body).replace(/\s+/g, ' ').slice(0, 200)}`);
  return info;
}

/** Schema lookup only (1 request, cached 7 days): which unit a part's "Схема" opens. */
async function getPartSchemaInfo(part) {
  if (!part || !part.oem || !part.schema) return null;
  const key = `schema1:${part.schema.catalog}:${part.schema.vid}:${part.oem}`;
  const cached = await cacheGet(key);
  if (cached !== undefined) return cached;
  const info = await resolveSchema(part.schema);
  if (info) await cacheSet(key, info);
  return info;
}

/**
 * Diagram for one part found by a details search:
 * -> { image, unitName, position, oem, name, qty, notes, box } | null. Cached 7 days.
 * Request 1 (schema lookup) gives image/name/position; request 2 (unit page)
 * only adds the box for the red marker -- if it fails, the card has no marker.
 */
async function getPartDiagram(part) {
  if (!part || !part.oem || !part.schema) return null;
  const key = `diagram5:${part.schema.catalog}:${part.schema.vid}:${part.oem}`; // v5: unitParts from the unit page
  const cached = await cacheGet(key);
  if (cached !== undefined) return cached;
  const info = await getPartSchemaInfo(part);
  if (!info || !info.image) return null;
  let box = null, image = info.image, unitName = info.unitName;
  let unitParts = info.unitParts || [];
  try {
    const d = parseUnitDiagram(await fetchPage(info.unitUrl));
    if (d.image) image = d.image;               // the unit page's own (same picture, page-signed link)
    if (!unitName) unitName = d.unitName;
    // The schema JSON only lists the asked part (live test 25.10: no ТО kit);
    // the unit page's table has every position of the unit.
    if (d.rows.length > unitParts.length) {
      unitParts = d.rows.map(r => {
        const notes = { ...(r.notes || {}) };
        for (const k of Object.keys(notes)) if (/^количество$/i.test(k)) delete notes[k];
        return { position: r.position || (r.code ? String(r.code).replace(/^\D+/, '') : null), oem: r.oem, name: r.name, qty: r.qty, notes };
      });
    }
    const row = d.rows.find(r => r.oem === part.oem && r.code);
    const want = String(info.position || '').replace(/^0+/, '');
    const code = row ? row.code : Object.keys(d.boxes).find(k => k.replace(/^\D+/, '').replace(/^0+/, '') === want);
    box = code ? d.boxes[code] || null : null;
  } catch (err) {
    console.error('[laximo] diagram unit page failed (card without marker):', err.message);
  }
  const result = { image, unitName, position: info.position, oem: part.oem, name: info.name || part.name || null,
    qty: info.qty, notes: info.notes, box, unitParts };
  await cacheSet(key, result);
  return result;
}

// ─── HIGH-LEVEL STEPS ───────────────────────────────────────────────────────
async function findVehicleByVin(vin) {
  const key = `vin:any:${vin}`;
  const cached = await cacheGet(key);
  if (cached !== undefined) return cached;

  // General VIN search over ALL brands (c= empty, exactly what the start
  // page's "Поиск по VIN" box sends). Laximo detects the brand; the result
  // links carry that brand's catalog code. Seen working for BMW and Audi.
  const html = await fetchPage(`/laximo?vin=${encodeURIComponent(vin)}&lp=findByVIN&c=`);
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
    brand: v.brand,
    catalog: v.catalog || vehiclePage.query.c || null,
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
  const key = `details:${vehicle.query.c || ''}:${vehicle.cacheId || vehicle.vin}:${text.toLowerCase()}`;
  const cached = await cacheGet(key);
  if (cached !== undefined) return cached;

  const parts = parsePartRows(await fetchPage(detailsSearchUrl(vehicle.query, text)));
  await cacheSet(key, parts);
  return parts;
}

// The catalog's own names for parts customers call something else. Laximo's
// part search matches NAMES, and e.g. BMW calls the air filter "Сменный
// элемент фильтра" (no word "воздушный" -- seen 22.10: G42 220d,
// 13718594535 in stock but "воздушный фильтр" found nothing) and the cabin
// filter "Микрофильтр". Run ONLY when the customer's own words found
// nothing, so the extra request is spent only when it's needed; `keep`
// drops rows that matched the broader words but are a different part.
const FALLBACK_QUERIES = [
  {
    when: /воздушн\S*\s+фильтр|фильтр\S*\s+воздушн/,
    query: 'элемент фильтра',
    keep: p => /^сменный элемент фильтра$/i.test(clean(p.name)) || /воздуш/i.test(p.name || '') || /всасыв|воздуш/i.test(p.unit || ''),
  },
  {
    when: /салонн\S*\s+фильтр|фильтр\S*\s+салон/,
    query: 'микрофильтр',
    keep: () => true,
  },
  // Brake discs (live 26.10, VIN X4XZW61140L560928, X5 E70): "тормозные диски"
  // found nothing -- the search is literal and BMW names the part in the
  // singular, "Тормозной диск (вентилируемый)". Tried in order until one finds
  // something; the broad "диск" keeps only brake rows (not clutch/wheel discs).
  {
    when: /торм\S*\s+диск|диск\S*\s+торм/,
    query: ['тормозной диск', 'диск'],
    keep: p => /диск/i.test(p.name || '') && /торм/i.test(`${p.name || ''} ${p.unit || ''}`),
  },
];
const MAX_FALLBACK_QUERIES = 3; // requests in total for all fallbacks of one answer

// Broad words that also hit unrelated parts: "накладки" (the catalog's word
// for brake pads, "рем.к-т торм.накладок") also matches body trim
// ("Накладка порога" ...) -- 22.10: 214 OEMs for a 4-part request. Keep only
// rows that are about brakes (name or unit).
const QUERY_KEEP = {
  'накладки': p => /торм/i.test(`${p.name || ''} ${p.unit || ''}`),
  'накладка': p => /торм/i.test(`${p.name || ''} ${p.unit || ''}`),
};

// Abbreviations: the catalog uses BOTH forms -- "Датчик температуры ОГ" (BMW
// E70, seen 23.10) but "Нейтрализация ОГ"/"отработавших газов" elsewhere, and
// the name search is literal. So the customer's spelling is searched first;
// if it finds nothing, the other spelling is tried (both directions).
const ABBREVIATIONS = [
  ['ог', 'отработавших газов'],
  ['гбц', 'головки блока цилиндров'],
  ['шрус', 'шарнир равных угловых скоростей'],
  ['дмрв', 'расходомер воздуха'],
  ['акпп', 'автоматической коробки передач'],
  ['мкпп', 'механической коробки передач'],
];
const wordRe = w => new RegExp(`(^|\\s)${w}(?=\\s|$)`, 'g');
/** The same query with abbreviations expanded or contracted (other spellings), or []. */
function spellingVariants(q) {
  const out = new Set();
  let expanded = q, contracted = q;
  for (const [abbr, full] of ABBREVIATIONS) {
    expanded = expanded.replace(wordRe(abbr), `$1${full}`);
    contracted = contracted.split(full).join(abbr);
  }
  if (expanded !== q) out.add(expanded);
  if (contracted !== q) out.add(contracted);
  return [...out];
}
const expandAbbr = q => spellingVariants(q).find(v => v.length > q.length) || q; // kept for tests/back-compat

/** Run the part-name searches for an already-resolved vehicle. */
async function searchPartsForVehicle(vehicle, partKeywords) {
  const queries = [...new Set((partKeywords || []).map(k => clean(k).toLowerCase()).filter(Boolean))]
    .slice(0, MAX_QUERIES);

  const parts = [];
  const seen = new Set();
  const add = (rows, tag) => {
    for (const p of rows) {
      const dedupeKey = `${p.oem}|${p.unit}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      parts.push({ ...p, query: tag });
    }
  };
  const empty = []; // customer keywords that found nothing
  let stopped = false;
  let failed = false; // a search errored (site block, pause...) -- "nothing found" would be wrong
  for (const q of queries) {
    try {
      const rows = (await searchDetails(vehicle, q)).filter(QUERY_KEEP[q] || (() => true));
      if (!rows.length) empty.push(q);
      add(rows, q);
    } catch (err) {
      failed = true;
      console.error('[laximo] details search failed:', q, err.message);
      if (err instanceof LaximoSkip || breakerOpen()) { stopped = true; break; } // paused/budget/breaker: don't try the other keywords
    }
  }

  // Other spelling of an abbreviation ("ОГ" <-> "отработавших газов") for keywords that found nothing.
  let spellings = 0;
  for (const q of stopped ? [] : [...empty]) {
    for (const v of spellingVariants(q)) {
      if (spellings >= 2 || queries.includes(v)) continue;
      spellings++;
      try {
        const rows = (await searchDetails(vehicle, v)).filter(QUERY_KEEP[q] || (() => true));
        console.log(`[laximo] "${q}" found nothing; other spelling "${v}" -> ${rows.length} part(s)`);
        if (rows.length) { add(rows, q); empty.splice(empty.indexOf(q), 1); break; }
      } catch (err) {
        console.error('[laximo] details search failed:', v, err.message);
        if (err instanceof LaximoSkip || breakerOpen()) { stopped = true; break; }
      }
    }
  }

  // Second chance for keywords that found nothing, under the catalog's name
  // (one name, or several tried in order until one finds something).
  let fallbacks = 0;
  outer:
  for (const q of stopped ? [] : empty) {
    const fb = FALLBACK_QUERIES.find(f => f.when.test(q));
    if (!fb) continue;
    for (const name of [].concat(fb.query)) {
      if (queries.includes(name)) continue;
      if (fallbacks >= MAX_FALLBACK_QUERIES) break outer;
      fallbacks++;
      try {
        const rows = (await searchDetails(vehicle, name)).filter(fb.keep);
        console.log(`[laximo] "${q}" found nothing; catalog name "${name}" -> ${rows.length} part(s)`);
        add(rows, q); // tagged with the customer's keyword
        if (rows.length) break;
      } catch (err) {
        console.error('[laximo] details search failed:', name, err.message);
        if (err instanceof LaximoSkip || breakerOpen()) break outer;
      }
    }
  }

  // Interleave by keyword (1st of each, then 2nd of each, ...): chat.js caps
  // what goes into the prompt, and the cap must not cut off the keyword that
  // happened to be searched last.
  const byQuery = new Map();
  for (const p of parts) (byQuery.get(p.query) || byQuery.set(p.query, []).get(p.query)).push(p);
  const lists = [...byQuery.values()];
  const mixed = [];
  for (let i = 0; mixed.length < parts.length; i++) for (const l of lists) if (l[i]) mixed.push(l[i]);
  if (failed || stopped) mixed.searchFailed = true;
  return mixed;
}

/**
 * Main entry point for chat.js (VIN path).
 *   findPartsByVin('WBS11CS0609158489', ['масляный фильтр', 'воздушный фильтр'])
 * -> { vehicle: {vin, name, modelCode, options}, parts: [{oem, name, qty, notes, unit, query}] }
 * Returns null if the VIN isn't found, { unavailable } if Laximo can't be
 * used right now (paused, over budget, breaker open);
 * throws only on unexpected errors -- callers should still wrap it.
 */
async function findPartsByVin(rawVin, partKeywords) {
  const vin = normalizeVin(rawVin);
  if (!vin) return null;
  // "Can't look it up now" must stay distinguishable from "VIN not found"
  // (null) -- otherwise the customer is told to re-check a valid VIN.
  const why = await unavailableReason();
  if (why) {
    console.warn(`[laximo] VIN path skipped -- ${why}`);
    return { unavailable: why };
  }
  if (breakerOpen()) {
    console.warn("[laximo] VIN path skipped -- circuit breaker 'core' open");
    return { unavailable: "circuit breaker 'core' open" };
  }

  const vehicle = await findVehicleByVin(vin);
  if (!vehicle) return null;

  const parts = await searchPartsForVehicle(vehicle, partKeywords);
  const { query, cacheId, ...vehiclePublic } = vehicle;
  return { vehicle: vehiclePublic, parts, searchFailed: !!parts.searchFailed };
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

  // 4. Generic brands (Audi, Mercedes, VW, ...): model names like
  //    "A4/S4/Avant/qu." or "C-Class (W204)". Score options by how many of
  //    their words the customer used; several equally good -> ask with
  //    buttons. Never guess between them: a wrong model = wrong parts.
  const words = new Set(ntext.trim().split(' ').filter(Boolean));
  const scored = opts.map(o => {
    const toks = [...new Set(o.value.toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/)
      .filter(t => t.length >= 2 && !GENERIC_WORDS.has(t)))];
    return { o, score: toks.filter(t => words.has(t)).length };
  }).filter(x => x.score > 0);
  if (scored.length) {
    const top = Math.max(...scored.map(x => x.score));
    const best = scored.filter(x => x.score === top).map(x => x.o);
    if (best.length === 1) return { choice: best[0] };
    if (best.length <= 16) return askAmong(best);
  }

  // 5. Year with no year given: ask, offering the most recent years as
  //    buttons (a typed year is matched by step 1 on the next turn).
  if (/год/.test(name) && opts.every(o => /^\d{4}$/.test(o.value))) {
    return askAmong([...opts].sort((a, z) => Number(z.value) - Number(a.value)).slice(0, 16));
  }

  return opts.length <= 16 ? askAmong(opts) : null;
}

// Words that appear in many option names and say nothing about the model.
const GENERIC_WORDS = new Set(['qu', 'lim', 'the', 'and', 'with', 'для', 'без']);

// Values-only copy for the cache. Wizard option tokens are issued per
// request/session: a token cached earlier is rejected later with HTTP 403
// (seen live, Oct 2026 -- a cached "X5 G05" token failed after a redeploy).
// So the cache only ever holds option NAMES, used to plan the path and ask
// questions; real tokens come from a fresh walk (liveTo) when needed.
function stripTokens(step) {
  return { ...step, ssd: '', options: step.options ? step.options.map(o => ({ key: 'cached', value: o.value })) : step.options };
}

const seriesCacheKey = cat => `wiz-series-v2:${cat}`;
const stepCacheKey = (cat, path) => `wizv:${cat}:${path.join('|')}`;
const wizardAjaxUrl = (cat, token) => `/laximo?lp=wizard&c=${encodeURIComponent(cat)}&ssd=${encodeURIComponent(token)}&ajax=1`;

async function fetchSeriesLive(cat) {
  const $ = cheerio.load(await fetchPage(`/laximo?lp=catalog&c=${encodeURIComponent(cat)}`, { kind: 'wizard' }));
  const select = $('#wizardForm select').first();
  const step = {
    conditionId: select.attr('name'),
    name: clean($('#wizardForm label').first().text()) || 'Серия',
    options: select.find('option').map((_, o) => ({ key: $(o).attr('value'), value: clean($(o).text()) })).get()
      .filter(o => o.key && o.key !== 'null' && o.value),
  };
  if (!step.options.length) throw new Error('wizard series list empty -- markup changed?');
  await cacheSet(seriesCacheKey(cat), stripTokens(step));
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
    const series = await fetchSeriesLive(live.cat);
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
    const raw = await fetchPage(wizardAjaxUrl(live.cat, opt.key), { kind: 'wizard', ajax: true });
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error(`wizard step did not return JSON (got: ${clean(raw).slice(0, 80)})`); }
    if (!Array.isArray(data.wizardSteps)) throw new Error('wizard JSON without wizardSteps');
    live.path.push(want);
    live.token = opt.key;
    live.data = data;
    await cacheSet(stepCacheKey(live.cat, live.path), {
      wizardSteps: data.wizardSteps.map(stripTokens),
      vehicleCount: (data.vehicles || []).length,
    });
  }
  return live;
}

/** Wizard state after choosing `path` -- from the names-only cache, or live. */
async function stepsAfter(path, live) {
  const cached = await cacheGet(stepCacheKey(live.cat, path));
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
/**
 * When pickWizardOption() finds nothing: match the customer's tokens that
 * contain a digit ("30d", "f15", "2015") as PART of an option -- BMW names
 * xDrive models "30dX", the customer writes "30d" (seen 23.10, X5 F15 30d).
 * One match -> take it; several -> ask among them; none -> ask all (<= 16).
 * Exported for tests.
 */
function partialWizardPick(step, ntext) {
  const opts = (step.options || []).filter(o => o && o.key && o.value);
  if (!opts.length) return null;
  const tokens = [...new Set(String(ntext).split(/\s+/).filter(t => /\d/.test(t) && t.length >= 2))];
  const hits = opts.filter(o => {
    const words = norm(o.value).split(/\s+/);
    return tokens.some(t => words.some(w => w !== t && (w.startsWith(t) || w.endsWith(t)) && w.length - t.length <= 6));
  });
  if (hits.length === 1) return { choice: hits[0] };
  if (hits.length > 1) return { ask: hits.slice(0, 16).map(o => o.value) };
  return opts.length <= 16 ? { ask: opts.map(o => o.value) } : null;
}

async function findVehicleByModel(customerText, cat, brandName) {
  const ntext = norm(customerText);
  // Each line on its own (chat.js joins the customer's messages with
  // newlines), so a clicked button can be recognized as a whole answer.
  const answers = new Set(String(customerText || '').split(/\n/).map(norm).filter(l => l.trim()));
  const live = { cat, path: null, data: null, token: null };

  let series = await cacheGet(seriesCacheKey(cat));
  if (series === undefined) series = stripTokens(await fetchSeriesLive(cat));
  const first = pickWizardOption(series, ntext, answers) || partialWizardPick(series, ntext);
  if (!first) {
    console.warn(`[laximo] model path: no "${series.name}" option matches the customer's text (${(series.options || []).length} options)`);
    return null;
  }
  if (first.ask) return { needsChoice: { step: series.name, options: first.ask } };

  const path = [first.choice.value];
  let data = await stepsAfter(path, live);

  for (let guard = 0; guard < 10; guard++) {
    const open = data.wizardSteps.filter(st => !st.determined && st.options && st.options.length);
    if (!open.length) break;
    const step = open[0];
    let pick = pickWizardOption(step, ntext, answers);
    if (!pick) pick = partialWizardPick(step, ntext);
    else if (pick.ask) {
      // "25dX | 30dX | 40dX?" while the customer wrote "30d": narrow it down.
      const narrowed = partialWizardPick({ ...step, options: step.options.filter(o => pick.ask.includes(o.value)) }, ntext);
      if (narrowed && narrowed.choice) pick = narrowed;
    }
    if (!pick || pick.ask) {
      if (data.vehicleCount === 1) break; // the rest doesn't change the vehicle
      if (!pick) console.warn(`[laximo] model path: no "${step.name}" option matches (${step.options.length} options: ${step.options.slice(0, 8).map(o => o.value).join(' | ')}${step.options.length > 8 ? ' …' : ''})`);
      return pick ? { needsChoice: { step: step.name, options: pick.ask } } : null;
    }
    path.push(pick.choice.value);
    data = await stepsAfter(path, live);
  }

  // v3: v2 also cached EMPTY lists (e.g. a page fetched during a site
  // block), which then failed that car instantly for days. Empty is never cached now.
  const vehKey = `modelveh3:${cat}:${path.join('|')}`;
  let candidates = await cacheGet(vehKey);
  if (candidates === undefined || !Array.isArray(candidates) || !candidates.length) {
    await liveTo(live, path); // fresh token for exactly this path
    candidates = parseVinResults(await fetchPage(
      `/laximo?lp=wizard&c=${encodeURIComponent(cat)}&ssd=${encodeURIComponent(live.token)}&searchNow=1`, { kind: 'wizard' }));
    if (candidates.length) await cacheSet(vehKey, candidates);
  }
  if (!candidates.length) {
    console.warn(`[laximo] model path: wizard path ${path.join(' › ')} returned no vehicles`);
    return null;
  }

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
  const pageKey = `modelvehpage:${cat}:${path.join('|')}|${v.modelCode}`;
  let query = await cacheGet(pageKey);
  if (query === undefined) {
    query = parseVehiclePage(await fetchPage(v.href.replace(/&amp;/g, '&'))).query;
    if (!query || !query.vid || !query.ssd) throw new Error('vehicle page parsed without vid/ssd -- markup changed?');
    await cacheSet(pageKey, query);
  }
  return {
    vehicle: {
      brand: v.brand || brandName,
      catalog: cat,
      name: v.name,
      modelCode: v.modelCode,
      options: v.options,
      path,
      query,
      cacheId: `model:${cat}:${path.join('|')}|${v.modelCode}`,
    },
  };
}

// ─── BRANDS: name -> catalog code, from the /laximo start page ──────────────
/** Pure: start page HTML -> [{ name, catalog }] (one per brand link). */
function parseBrandList(html) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const list = [];
  $('a[href*="lp=catalog"]').each((_, a) => {
    const catalog = (String($(a).attr('href')).replace(/&amp;/g, '&').match(/[?&]c=([^&]+)/) || [])[1];
    const name = clean($(a).text());
    if (catalog && name && !seen.has(catalog)) { seen.add(catalog); list.push({ name, catalog }); }
  });
  return list;
}

// How customers write brands (Russian, short forms) -> the catalog's name.
const BRAND_ALIASES = {
  'бмв': 'bmw', 'мерседес': 'mercedes benz', 'мерс': 'mercedes benz', 'мерседес бенц': 'mercedes benz', 'mercedes': 'mercedes benz',
  'ауди': 'audi', 'фольксваген': 'volkswagen', 'фольц': 'volkswagen', 'vw': 'volkswagen', 'порше': 'porsche', 'порш': 'porsche',
  'ленд ровер': 'land rover', 'лэнд ровер': 'land rover', 'рендж ровер': 'land rover', 'range rover': 'land rover', 'landrover': 'land rover',
  'тойота': 'toyota', 'ниссан': 'nissan', 'хендай': 'hyundai', 'хендэ': 'hyundai', 'хёндай': 'hyundai', 'хундай': 'hyundai', 'хюндай': 'hyundai',
  'киа': 'kia', 'шкода': 'skoda', 'рено': 'renault', 'форд': 'ford', 'мини': 'mini', 'вольво': 'volvo', 'лексус': 'lexus', 'мазда': 'mazda',
  'митсубиси': 'mitsubishi', 'мицубиси': 'mitsubishi', 'митсубиши': 'mitsubishi', 'опель': 'opel', 'пежо': 'peugeot', 'ситроен': 'citroen',
  'ягуар': 'jaguar', 'инфинити': 'infiniti', 'хонда': 'honda', 'субару': 'subaru', 'сузуки': 'suzuki', 'сеат': 'seat', 'шевроле': 'chevrolet',
  'ролс ройс': 'rolls royce', 'роллс ройс': 'rolls royce', 'смарт': 'smart', 'фиат': 'fiat', 'джип': 'jeep', 'додж': 'dodge', 'крайслер': 'chrysler',
  'кадиллак': 'cadillac', 'дачия': 'dacia', 'дэу': 'daewoo', 'деу': 'daewoo', 'исузу': 'isuzu', 'санг йонг': 'ssangyong', 'ссангйонг': 'ssangyong',
};

/** Pure: customer's brand text -> { name, catalog } or null. */
function resolveBrand(brandText, list) {
  if (!brandText || !list || !list.length) return null;
  let b = norm(brandText).trim();
  b = BRAND_ALIASES[b] || b;
  const byName = list.map(x => ({ ...x, n: norm(x.name).trim() }));
  const exact = byName.find(x => x.n === b);
  if (exact) return { name: exact.name, catalog: exact.catalog };
  // "mercedes" -> "Mercedes-Benz"; prefer the plain brand over variants
  // like "Citroen PSA" / "BMW Motorrad" (shortest matching name).
  const starts = byName.filter(x => x.n.startsWith(b + ' ') || b.startsWith(x.n + ' ')).sort((a, z) => a.n.length - z.n.length);
  return starts.length ? { name: starts[0].name, catalog: starts[0].catalog } : null;
}

async function getBrandList() {
  const cached = await cacheGet('brands:v1');
  if (cached && cached.at && Date.now() - cached.at < BRANDS_TTL_MS && cached.list.length) return cached.list;
  try {
    const list = parseBrandList(await fetchPage('/laximo', { kind: 'wizard' }));
    if (!list.length) throw new Error('brand list empty -- markup changed?');
    await cacheSet('brands:v1', { at: Date.now(), list });
    return list;
  } catch (err) {
    if (cached && cached.list && cached.list.length) return cached.list; // stale is better than nothing
    throw err;
  }
}

/**
 * Entry point for chat.js (model path, no VIN).
 *   findPartsByModel('BMW 2 G42 220i ... набор на ТО', ['масляный фильтр', ...])
 * -> { vehicle, parts } | { needsChoice: {step, options} } | null
 */
async function findPartsByModel(customerText, partKeywords, brandText) {
  const why = await unavailableReason();
  if (why) {
    console.warn(`[laximo] model path skipped -- ${why}`);
    return null;
  }
  for (const kind of ['wizard', 'core']) {
    if (breakerOpen(kind)) {
      console.warn(`[laximo] model path skipped -- circuit breaker '${kind}' open`);
      return null;
    }
  }
  const brand = resolveBrand(brandText, await getBrandList());
  if (!brand) {
    console.warn(`[laximo] model path: brand "${brandText}" not in the Laximo catalog list`);
    return null;
  }
  const found = await findVehicleByModel(customerText, brand.catalog, brand.name);
  if (!found || found.needsChoice) return found;

  const parts = await searchPartsForVehicle(found.vehicle, partKeywords);
  const { query, cacheId, ...vehiclePublic } = found.vehicle;
  return { vehicle: vehiclePublic, parts, searchFailed: !!parts.searchFailed };
}

module.exports = {
  findPartsByVin,
  unavailableReason,
  resetPause,
  findPartsByModel,
  normalizeVin,
  normalizeOem,
  // exported for tests
  parseVinResults,
  parseVehiclePage,
  parsePartRows,
  detailsSearchUrl,
  searchPartsForVehicle,
  getPartDiagram, getPartSchemaInfo,
  parseUnitDiagram,
  parseSchemaAnswer,
  noteLabel,
  expandAbbr,
  spellingVariants,
  pickWizardOption,
  partialWizardPick,
  norm,
  parseBrandList,
  resolveBrand,
};
