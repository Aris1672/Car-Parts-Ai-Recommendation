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
const progress = require('./progress'); // live step lines for the chat widget
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

// Normalisers live in lib/normalize.js (one contract for the whole app).
const { normalizeVin, normalizeOem, latinizeCodes, VIN_RE } = require('./normalize');
const laximoApi = require('./laximoApi');

// LAXIMO_SOURCE=api: the Laximo web service directly (lib/laximoApi.js) instead
// of the site's /laximo pages. Every page-reading function below has an API
// branch returning the SAME shape, so the logic above them is shared. Cache
// keys get an "ax:" prefix in API mode (site and API ssd tokens never mix).
const API = () => String(process.env.LAXIMO_SOURCE || 'site').toLowerCase() === 'api';
const ck = key => (API() ? `ax:${key}` : key);

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
    if (API()) kind = 'api';
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
    if (API()) return apiBlocked();
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
      if (API()) {
        console.error(`[laximo] BUG: site page requested in API mode: ${String(pathOrUrl).slice(0, 100)}`);
        throw new LaximoSkip('site page requested in API mode');
      }
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
    // Timeouts (04.11, live: a hung Postgres connection held a catalog lookup ~90 s
  // until the server killed it -> the chat's 75 s budget ran out). The cache is
  // optional: a slow database is skipped and memory serves.
  const client = new Client({ connectionString: DB_URL, ssl: false, connectionTimeoutMillis: 3000, query_timeout: 4000, statement_timeout: 4000 });
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
    key = ck(key);
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
    key = ck(key);
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
    if (API()) return apiSchemaInfo(schema);
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
  // ─── SERVICE UNIT, OPENED DIRECTLY FROM THE CAR'S CATALOGUE PAGE ────────────
  // BMW lists the whole service kit in the unit "ТО по регл.Oelservice /
  // Inspektion" (filters, plugs, wipers, brake fluid, coolant, washer fluid,
  // CHF). Until 26.10 the bot reached it only via the "Схема" button of a found
  // part -- on the X5 G05 the oil filter element's button opens it, on the X5
  // E70 it opens the oil filter's own unit, so the E70 got no kit (wipers and
  // fluids went to the manager). Now the car's catalogue page (lp=vehicle) is
  // read and the service unit is opened by its NAME: first among the units on
  // that page, then in at most 2 categories whose name suggests service.
  // Returns the same shape as getPartDiagram() (marker on the oil filter
  // element), or null. ~2 requests the first time, cached per car.
  const SERVICE_UNIT_NAME_RE = /oelservice|inspektion|(^|[^а-яё])то\s+по\s+регл/i;
  // Categories that may hold the service unit, best first (live 26.10, X5 E70:
  // the car page lists "Parts Repair Service", "К-ты для регламентных работ",
  // "Детали и пакеты: ремонт и обслуживание", "Инспекционные комплекты" ...).
  const SERVICE_CATEGORY_PRIORITY = [
    /oelservice|inspektion|(^|[^а-яё])то\s+по\s+регл/i,
    /service|сервис/i,
    /инспекц|inspection/i,
    /регламент|обслуж|(^|[^А-ЯЁа-яё])ТО([^А-ЯЁа-яё]|$)/,
  ];
  const MAX_SERVICE_CATEGORIES = 4;
  const unescapeHref = h => String(h || '').replace(/&amp;/g, '&');
  // opts.stop: () => true once another route already found the unit (30.10: the
  // chat runs this and the "Схема"-button route side by side). Checked before every
  // page request, so the losing route makes at most the one request already queued;
  // a stopped run returns null and caches nothing.
  /** Saves a service unit found another way (the "Схема" route) for this car, so the
   *  next ТО request for it is answered from cache without any Laximo request. */
  async function rememberServiceUnit(query, result) {
    if (!query || !query.vid || !result || !Array.isArray(result.unitParts) || result.unitParts.length < 2) return;
    await cacheSet(`service4:${query.c || ''}:${query.vid}`, result).catch(() => {});
  }

  async function getServiceUnit(query, opts = {}) {
    if (!query || !query.vid || !query.ssd) return null;
    const stopped = () => typeof opts.stop === 'function' && opts.stop();
    const key = `service4:${query.c || ''}:${query.vid}`;
    const cached = await cacheGet(key);
    if (cached !== undefined) return cached;

    if (stopped()) return null;
    progress.step('Открываю регламент ТО вашего автомобиля в каталоге');
    let unit, where = 'car page';
    if (API()) {
      const found = await apiFindServiceUnit(query, stopped);
      if (found === 'stopped') return null;
      if (!found) {
        memCache.set(ck(key), { data: null, at: Date.now() - CACHE_TTL_MS + 6 * 60 * 60 * 1000 });
        return null;
      }
      ({ unit, where } = found);
    } else {
    const vehicleUrl = `/laximo?${new URLSearchParams({ ...query, lp: 'vehicle' }).toString()}`;
    const page = parseVehiclePage(await fetchPage(vehicleUrl));
    unit = page.units.find(u => u.href && SERVICE_UNIT_NAME_RE.test(u.name || ''));
    if (!unit) {
      const rank = c => { const i = SERVICE_CATEGORY_PRIORITY.findIndex(re => re.test(c.name || '')); return i < 0 ? 99 : i; };
      const seenCat = new Set();
      const cats = page.categories
        .filter(c => c.href && rank(c) < 99 && !seenCat.has(c.cid || c.href) && seenCat.add(c.cid || c.href))
        .sort((a, b) => rank(a) - rank(b))
        .slice(0, MAX_SERVICE_CATEGORIES);
      const checked = [];
      for (const cat of cats) {
        if (stopped()) return null;
        checked.push(cat.name);
        const catHtml = await fetchPage(unescapeHref(cat.href));
        const cp = parseVehiclePage(catHtml);
        unit = cp.units.find(u => u.href && SERVICE_UNIT_NAME_RE.test(u.name || ''));
        // The service "unit" is a SUB-CATEGORY of "Объем работ по обслуживанию и
        // ремонту" (owner's screenshot, X5 E70, 26.10). If that sub-category's own
        // name is the service name, take its only unit even if it's named
        // differently, or read its parts table if the page shows one directly.
        const isServiceCat = SERVICE_UNIT_NAME_RE.test(cat.name || '');
        if (!unit && isServiceCat && cp.units.filter(u => u.href).length === 1) unit = cp.units.find(u => u.href);
        if (!unit && isServiceCat) {
          const direct = parseUnitDiagram(catHtml);
          if (direct.rows.length > 1) { unit = { name: cat.name, href: null, page: direct }; }
        }
        if (unit) { where = `category "${cat.name}"`; break; }
      }
      if (!unit) {
        console.log(`[laximo] service unit not found (car page: ${page.units.length} units; checked categories: ${checked.join(' | ') || 'none'}; ${page.categories.length} categories: ${page.categories.map(c => c.name).join(' | ')})`);
        memCache.set(ck(key), { data: null, at: Date.now() - CACHE_TTL_MS + 6 * 60 * 60 * 1000 }); // "not found": retry after 6 h
        return null;
      }
    }
  }

  if (!unit.page && stopped()) return null;
  const d = unit.page || await unitDiagram(unit.href);
  if (!d.rows.length) {
    console.log(`[laximo] service unit "${unit.name}" opened but has no parts table`);
    return null;
  }
  const unitParts = d.rows.map(r => {
    const notes = { ...(r.notes || {}) };
    for (const k of Object.keys(notes)) if (/^количество$/i.test(k)) delete notes[k];
    return { position: r.position || (r.code ? String(r.code).replace(/^\D+/, '') : null), oem: r.oem, name: r.name, qty: r.qty, notes, code: r.code || null,
      ...(r.code && d.boxes[r.code] ? { box: d.boxes[r.code] } : {}) }; // ТО cards mark their own position (30.10)
  });
  const mark = unitParts.find(p => /масл/i.test(p.name || '') && /элемент|вставк|сменн/i.test(p.name || '')) || unitParts[0];
  const result = {
    image: d.image, unitName: (unit.forceName && unit.name) || d.unitName || unit.name, position: mark.position, oem: mark.oem, name: mark.name,
    qty: mark.qty, notes: mark.notes, box: (mark.code && d.boxes[mark.code]) || null,
    unitParts: unitParts.map(({ code, ...p }) => p),
  };
  console.log(`[laximo] service unit opened directly (${where}): "${result.unitName}", ${unitParts.length} rows`);
  await cacheSet(key, result);
  return result;
}

// One request chain per part at a time: the chat's background job and the
// widget's diagram-card request must not both ask Laximo for the same part.
const diagramInflight = new Map();
function getPartDiagram(part) {
  if (!part || !part.oem || !part.schema) return Promise.resolve(null);
  const k = `${part.schema.catalog}:${part.schema.vid}:${part.oem}`;
  if (diagramInflight.has(k)) return diagramInflight.get(k);
  const p = getPartDiagramOnce(part).finally(() => diagramInflight.delete(k));
  diagramInflight.set(k, p);
  return p;
}
async function getPartDiagramOnce(part) {
  if (!part || !part.oem || !part.schema) return null;
  const key = `diagram5:${part.schema.catalog}:${part.schema.vid}:${part.oem}`; // v5: unitParts from the unit page
  const cached = await cacheGet(key);
  // Saved before 30.10 (no box per unit position): rebuilt from the cached schema
  // info and unit page -- no new site request -- so ТО cards can mark every position.
  const stale = cached && cached.box && Array.isArray(cached.unitParts) && cached.unitParts.length > 1 && !cached.unitParts.some(p => p && p.box);
  if (cached !== undefined && !stale) return cached;
  progress.step(`Загружаю схему узла для ${part.oem}`);
  const info = await getPartSchemaInfo(part);
  if (!info || !info.image) return null;
  let box = null, image = info.image, unitName = info.unitName;
  let unitParts = info.unitParts || [];
  try {
    // Parts of the same unit share its page (26.10: a diagram for every
    // offered part -- rear left/right shock absorber + bump stop = 1 page).
    const pageKey = `unitpage1:${info.unitUrl}`;
    let d = await cacheGet(pageKey);
    if (d === undefined || !d) {
      d = await unitDiagram(info.unitUrl);
      await cacheSet(pageKey, d);
    }
    if (d.image) image = d.image;               // the unit page's own (same picture, page-signed link)
    if (!unitName) unitName = d.unitName;
    // The schema JSON only lists the asked part (live test 25.10: no ТО kit);
    // the unit page's table has every position of the unit.
    if (d.rows.length > unitParts.length) {
      unitParts = d.rows.map(r => {
        const notes = { ...(r.notes || {}) };
        for (const k of Object.keys(notes)) if (/^количество$/i.test(k)) delete notes[k];
        return { position: r.position || (r.code ? String(r.code).replace(/^\D+/, '') : null), oem: r.oem, name: r.name, qty: r.qty, notes,
          ...(r.code && d.boxes[r.code] ? { box: d.boxes[r.code] } : {}) };
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

// ─── LAXIMO WEB SERVICE (LAXIMO_SOURCE=api) ─────────────────────────────────
// Same outputs as the site functions above; see lib/laximoApi.js for the
// protocol, the ssd rule and billing. Pacing: laximoApi's own queue (300 ms),
// no browser check, no hourly budget -- the monthly CAR cap is what protects
// the licence. One breaker 'api' for every call.
const carStore = { get: k => cacheGet(k), set: (k, v) => cacheSet(k, v) };
const API_LIMIT_KEY = 'state:api-limit-until';
let apiLimitUntil = 0, apiLimitLoaded = false;

/** Why the API must not be used now, or null. */
let apiAnnounced = false;
async function apiBlocked() {
  if (!apiAnnounced) { apiAnnounced = true; console.log(`[laximo] source: api (Laximo web service; monthly bot cap ${process.env.LAXIMO_MONTHLY_CAR_CAP || 400} cars)`); }
  if (!laximoApi.configured()) return 'LAXIMO_LOGIN / LAXIMO_KEY not set (LAXIMO_SOURCE=api)';
  if (!apiLimitLoaded) {
    apiLimitLoaded = true;
    try { const s = await cacheGet(API_LIMIT_KEY); if (s && s.until > apiLimitUntil) apiLimitUntil = s.until; } catch { /* memory only */ }
  }
  if (Date.now() < apiLimitUntil) return `Laximo licence limit reached (E_ACCESSLIMITREACHED) -- API off until ${new Date(apiLimitUntil).toISOString()}`;
  if (breakerOpen('api')) return "circuit breaker 'api' open";
  return null;
}

/** Start of the next billing period (Moscow midnight of the billing day). */
function nextBillingStart() {
  const [y, m, d] = laximoApi.billingPeriod().split('-').map(Number);
  return Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, d) - 3 * 3600 * 1000;
}

/** One Laximo command. Laximo's "your request is wrong" errors are thrown as is; service failures count toward the breaker. */
async function api(name, params) {
  const why = await apiBlocked();
  if (why) throw new LaximoSkip(`laximo ${why}`);
  const request = laximoApi.command(name, params);
  for (let attempt = 0; ; attempt++) {
    try {
      const xml = await laximoApi.call(request);
      breakerState('api').fails = 0;
      return xml;
    } catch (err) {
      const code = err.code;
      if (code === 'E_TOO_MANY_REQUESTS' && attempt === 0) { await new Promise(r => setTimeout(r, 3000)); continue; }
      if (code === 'E_ACCESSLIMITREACHED') {
        apiLimitUntil = nextBillingStart();
        cacheSet(API_LIMIT_KEY, { until: apiLimitUntil }).catch(() => {});
        console.error(`[laximo-api] LICENCE LIMIT REACHED (E_ACCESSLIMITREACHED) -- API off until ${new Date(apiLimitUntil).toISOString()}. Lower LAXIMO_MONTHLY_CAR_CAP.`);
        throw new LaximoSkip('Laximo licence limit reached');
      }
      if (/^E_(INVALIDPARAMETER|GROUP_IS_NOT_SEARCHABLE|STANDARD_PART_SEARCH|CATALOG_NOT_EXISTS|NOT_SUPPORTED|UNKNOWN_COMMAND)/.test(code || '')) throw err;
      if (code === 'E_ACCESSDENIED') console.error(`[laximo-api] ACCESS DENIED for ${name}: ${err.message} (login/key, or this function is not in the licence)`);
      recordFailure('api', `${name}: ${err.message}`);
      throw err;
    }
  }
}

/**
 * A command about the CAR (car ssd). If Laximo rejects a cached car ssd
 * (E_INVALIDPARAMETER:SSD -- tokens may age), a VIN car is looked up again
 * (no new car for the licence: it's already counted) and the call retried once.
 */
async function apiCar(q, name, params) {
  try {
    return await api(name, { ...params, ssd: q.ssd });
  } catch (err) {
    if (!(err.code === 'E_INVALIDPARAMETER' && /SSD/i.test(err.message) && q.vin)) throw err;
    console.warn(`[laximo-api] car ssd rejected for ${name} -- refreshing VIN ${q.vin}`);
    const fresh = laximoApi.parseVehicles(await api('FindVehicleByVIN', { Locale: 'ru_RU', VIN: q.vin, Localized: 'true' }))[0];
    if (!fresh || !fresh.ssd) throw err;
    q.ssd = fresh.ssd; // the caller's query object (cached copies are refreshed below)
    const cached = await cacheGet(`vin:any:${q.vin}`);
    if (cached && cached.query) await cacheSet(`vin:any:${q.vin}`, { ...cached, query: { ...cached.query, ssd: fresh.ssd } });
    return api(name, { ...params, ssd: q.ssd });
  }
}

/** VIN -> the same vehicle object as the site path; counts the car for the monthly cap. */
async function apiFindVehicleByVin(vin, key) {
  const capped = await laximoApi.carCounter.check(carStore, null);
  if (capped) throw new LaximoSkip(capped);
  const v = laximoApi.parseVehicles(await api('FindVehicleByVIN', { Locale: 'ru_RU', VIN: vin, Localized: 'true' }))[0];
  if (!v || !v.vid || !v.ssd) {
    memCache.set(ck(key), { data: null, at: Date.now() - CACHE_TTL_MS + 60 * 60 * 1000 });
    return null;
  }
  await laximoApi.carCounter.add(carStore, `${v.catalog}:${v.vid}`);
  const result = { vin, brand: v.brand, catalog: v.catalog, name: v.name, modelCode: v.modelCode, options: v.options,
    query: { c: v.catalog, vid: v.vid, ssd: v.ssd, vin } };
  await cacheSet(key, result);
  return result;
}

const schemaOf = (q, oem) => ({ number: oem, catalog: q.c || null, vid: q.vid || null, ssd: q.ssd || null });

/** Name search («Поиск по названию детали») -> the site's details rows (oem + name, schema for the diagram). */
async function apiNameSearch(q, text) {
  const rows = laximoApi.parseNameSearch(await apiCar(q, 'SearchVehicleDetails', { Catalog: q.c, VehicleId: q.vid, Query: text, Locale: 'ru_RU' }));
  return rows.map(r => ({ position: null, oem: r.oem, name: r.name, qty: null, notes: {}, unit: null, schema: schemaOf(q, r.oem) }));
}

/** Unit reference stored where the site path keeps a unit page URL: "api:<catalog>:<vid>:<unitid>:<unit ssd>". */
const unitRef = (q, unit) => `api:${q.c || ''}:${q.vid || ''}:${unit.uid}:${unit.ssd || ''}`;
function parseUnitRef(ref) {
  const [, c, vid, uid, ...rest] = String(ref).split(':');
  return { c, vid, uid, ssd: rest.join(':') };
}

/** A unit page by URL (site) or by reference (API) -> { image, unitName, boxes, rows }. */
async function unitDiagram(href) {
  if (String(href || '').startsWith('api:')) return apiUnitPage(href);
  return parseUnitDiagram(await fetchPage(unescapeHref(href)));
}

async function apiUnitPage(ref) {
  const u = parseUnitRef(ref);
  const key = `axunit1:${u.c}:${u.vid}:${u.uid}`;
  const cached = await cacheGet(key);
  if (cached) return cached;
  const P = { Catalog: u.c, UnitId: u.uid, ssd: u.ssd };
  const info = laximoApi.parseUnits(await api('GetUnitInfo', { Locale: 'ru_RU', ...P, Localized: 'true' }))[0] || {};
  const unit = { name: info.name || null };
  const rows = laximoApi.parseUnitParts(await api('ListDetailByUnit', { Locale: 'ru_RU', ...P, Localized: 'true', WithLinks: 'true' }), noteLabel, unit);
  let boxes = {};
  try {
    boxes = laximoApi.parseImageMap(await api('ListImageMapByUnit', { ...P, WithLinks: 'true' }));
  } catch (err) {
    if (err instanceof LaximoSkip) throw err;
    console.error('[laximo-api] diagram map failed (no markers):', err.message);
  }
  const d = { image: info.image || null, unitName: info.name || null, boxes, rows };
  if (rows.length) await cacheSet(key, d);
  return d;
}

/**
 * Group parts (ListQuickDetail) -> the site's group-page units. Laximo returns
 * every part of each unit and marks the group's own parts with match="t"; only
 * those are kept (all of them when a unit has no mark). Units of the
 * «Объем работ по обслуживанию» section (codes 02xx) repeat parts that also sit
 * in their own ETK unit, so they come last.
 */
async function apiGroupUnits(q, gid, modification) {
  let xml;
  try {
    const P = { Locale: 'ru_RU', Catalog: q.c, VehicleId: q.vid, QuickGroupId: gid, Localized: 'true', All: '1' };
    // After an equipment answer: Laximo's own sample (guayaquillib unitfilter.php)
    // APPENDS the option's ssdmodification to the current ssd: ssd = car ssd + ssdmodification.
    // (04.11 live: the ssdmodification alone -> E_INVALIDPARAMETER:ssd.)
    xml = modification ? await api('ListQuickDetail', { ...P, ssd: `${q.ssd || ''}${modification}` }) : await apiCar(q, 'ListQuickDetail', P);
  } catch (err) {
    if (err.code === 'E_GROUP_IS_NOT_SEARCHABLE') return [];
    throw err;
  }
  const blocks = laximoApi.parseUnitBlocks(xml, noteLabel);
  // Diagnostics (04.11): how Laximo marks equipment-dependent rows, before / after an answer
  if (process.env.LAXIMO_API_DEBUG === '1') console.log(`[laximo-api] group ${gid}${modification ? ' (with equipment answer)' : ''}: ${blocks.length} unit(s): ` +
    blocks.map(b => `"${b.unit.name}" uid ${b.unit.uid}${b.unit.filter ? ` filter=${String(b.unit.filter).slice(0, 40)}` : ''} rows ${b.rows.length}/${b.rows.filter(r => r.match).length} match [${b.rows.filter(r => r.match).map(r => r.oem + (r.filter ? '*' : '')).join(' ')}]`).join(' | '));
  const service = b => /^02/.test(b.category.code || '') || /^02_/.test(b.unit.code || '');
  const ordered = [...blocks.filter(b => !service(b)), ...blocks.filter(service)];
  const out = [];
  let filterCalls = 0;
  for (const b of ordered) {
    const marked = b.rows.filter(r => r.match);
    const rows = (marked.length ? marked : b.rows).map(({ match, filter, ...r }) => ({ ...r, unit: b.unit.name, ...(b.unit.image ? { unitImage: b.unit.image } : {}) }));
    if (!rows.length) continue;
    // Equipment selector (the site's «Спортивные тормоза M (S2NHA)» да/нет): only
    // cars found by model have it; at most 4 extra calls per group, never after an answer.
    let filters = [];
    if (b.unit.filter && !modification && filterCalls < 4) {
      filterCalls++;
      filters = await apiUnitFilters(q, b.unit).catch(err => {
        if (err instanceof LaximoSkip) throw err;
        console.error(`[laximo-api] equipment filter of "${b.unit.name}" failed: ${err.message}`);
        return [];
      });
      if (filters.length && process.env.LAXIMO_API_DEBUG === '1') console.log(`[laximo-api] equipment filter in "${b.unit.name}": ${filters.map(f => `${f.label} (${f.options.map(o => o.text).join('/')})`).join('; ')}`);
    }
    out.push({ name: b.unit.name, filters, rows });
  }
  const all = out.flatMap(u => u.filters);
  for (const u of out) u.filters = withAutoAnswers(u.filters, all);
  return out;
}

// Equipment the bot can answer itself for this shop's cars (European market, the
// wizard path picks ЕЭК): China / CKD-assembly variants = нет. Laximo's sample
// appends EVERY chosen option to the ssd, so these «нет» ride along with the
// customer's answer (live 04.11, X5 G05 LCI 40iX: after S2NHA = нет the front
// discs were still split by S9C6A «Монтаж CKD Таиланд» and S3M2A).
const AUTO_NO_RE = /китай|china|l8aaa|ckd|s9c6a|таиланд|thailand/i;
const RED_M_RE = /красн|s3m2a/i;

/**
 * Laximo filters -> the site's selector: auto-answered filters are not offered as
 * questions; every remaining option's value carries the auto «нет» tokens, and a
 * «нет» to the M brakes also carries «нет» to the red M brakes. Pure.
 */
function withAutoAnswers(filters, groupFilters = filters) {
  const no = f => (f.options.find(o => /^нет$/i.test(o.text)) || {}).value || '';
  // «нет» of every auto-answered filter in the WHOLE group, one per label (04.11 live:
  // the M-brakes answer came from a unit without the CKD filter, so CKD stayed open)
  const seen = new Set();
  const auto = groupFilters.filter(f => AUTO_NO_RE.test(f.label) && !seen.has(f.label) && seen.add(f.label)).map(no).join('');
  const redNo = no(filters.find(f => RED_M_RE.test(f.label)) || { options: [] });
  return filters.filter(f => !AUTO_NO_RE.test(f.label)).map(f => ({
    ...f,
    options: f.options.map(o => ({ ...o, value: o.value + auto + (/^нет$/i.test(o.text) && !RED_M_RE.test(f.label) && /s2nha|спортивн\S* тормоз/i.test(f.label) ? redNo : '') })),
  }));
}

/** GetFilterByUnit with the car ssd; Laximo wanting the unit's own ssd -> retried with it. */
async function apiUnitFilters(q, unit) {
  const P = { Locale: 'ru_RU', Catalog: q.c, VehicleId: q.vid, UnitId: unit.uid, Filter: unit.filter };
  try {
    const xml = await api('GetFilterByUnit', { ...P, ssd: q.ssd });
    if (process.env.LAXIMO_API_DEBUG === '1') console.log(`[laximo-api] GetFilterByUnit "${unit.name}": ${String(xml).replace(/\s+/g, ' ').replace(/(ssd(?:modification)?="[^"]{10})[^"]*"/g, '$1…"').slice(0, 700)}`);
    return laximoApi.parseFilter(xml);
  } catch (err) {
    if (!(err.code === 'E_INVALIDPARAMETER' && /SSD/i.test(err.message) && unit.ssd)) throw err;
    return laximoApi.parseFilter(await api('GetFilterByUnit', { ...P, ssd: unit.ssd }));
  }
}

/** Car categories (ListCategories) -> the site's category list shape; href = category reference for apiUnitsOf. */
async function apiCategories(q) {
  const cats = laximoApi.parseCategories(await apiCar(q, 'ListCategories', { Locale: 'ru_RU', Catalog: q.c, VehicleId: q.vid, CategoryId: '-1' }));
  return cats.filter(c => c.leaf).map(c => ({ name: c.name, cid: c.cid, href: `apicat:${c.cid}`, ssd: c.ssd }));
}

/** Units of one category (category ssd!) -> [{ name, uid, href: unit reference }] */
async function apiUnitsOf(q, cat) {
  const units = laximoApi.parseUnits(await api('ListUnits', { Locale: 'ru_RU', Catalog: q.c, VehicleId: q.vid, CategoryId: cat.cid, ssd: cat.ssd, Localized: 'true' }));
  return units.map(u => ({ name: u.name, uid: u.uid, href: unitRef(q, u), image: u.image }));
}

/** Which unit a part's diagram should show: the service unit for ТО parts, else its own ETK unit (not the 02xx service section). Pure. */
function pickSchemaBlock(blocks) {
  if (!blocks.length) return null;
  return blocks.find(b => SERVICE_UNIT_NAME_RE.test(b.unit.name || '') || SERVICE_UNIT_NAME_RE.test(b.category.name || ''))
    || blocks.find(b => !/^02/.test(b.category.code || '') && !/^02_/.test(b.unit.code || ''))
    || blocks[0];
}

/** The «Схема» lookup (GetOEMPartApplicability) -> the same shape as parseSchemaAnswer. */
async function apiSchemaInfo(schema) {
  const q = { c: schema.catalog, vid: schema.vid, ssd: schema.ssd };
  let xml;
  try {
    xml = await api('GetOEMPartApplicability', { Catalog: q.c, OEM: normalizeOem(schema.number), ssd: q.ssd, Locale: 'ru_RU' });
  } catch (err) {
    if (err.code === 'E_INVALIDPARAMETER') { console.warn(`[laximo-api] schema lookup for ${schema.number}: ${err.message}`); return null; }
    throw err;
  }
  const blocks = laximoApi.parseUnitBlocks(xml, noteLabel);
  const b = pickSchemaBlock(blocks);
  if (!b) return null;
  const want = normalizeOem(schema.number);
  const row = b.rows.find(r => r.oem === want) || b.rows[0] || {};
  return {
    unitUrl: unitRef(q, b.unit),
    image: b.unit.image,
    unitName: b.unit.name || null,
    position: row.position || null,
    name: row.name || null,
    qty: row.qty || null,
    notes: row.notes || {},
    unitParts: b.rows.map(({ match, code, unit, ...r }) => r),
  };
}

/** ТО: the service unit from the car's categories -> { unit: {name, href}, where } | null | 'stopped'. */
async function apiFindServiceUnit(q, stopped) {
  const cats = await apiCategories(q);
  const rank = c => { const i = SERVICE_CATEGORY_PRIORITY.findIndex(re => re.test(c.name || '')); return i < 0 ? 99 : i; };
  const picked = cats.filter(c => rank(c) < 99).sort((a, b) => rank(a) - rank(b)).slice(0, MAX_SERVICE_CATEGORIES);
  for (const cat of picked) {
    if (stopped()) return 'stopped';
    const units = await apiUnitsOf(q, cat);
    const isServiceCat = SERVICE_UNIT_NAME_RE.test(cat.name || '');
    const unit = units.find(u => SERVICE_UNIT_NAME_RE.test(u.name || '')) || (isServiceCat && units.length === 1 ? units[0] : null);
    if (unit) {
      const own = SERVICE_UNIT_NAME_RE.test(unit.name || '');
      return { unit: { name: own ? unit.name : cat.name, href: unit.href, forceName: true }, where: `category "${cat.name}"` };
    }
  }
  console.log(`[laximo-api] service unit not found (checked: ${picked.map(c => c.name).join(' | ') || 'none'}; ${cats.length} categories)`);
  return null;
}

/** Wizard vehicle list: make "name modelCode" labels unique (they become buttons). Pure. */
function apiDistinctLabels(list) {
  const label = c => `${c.name} ${c.modelCode}`.trim();
  const count = new Map();
  for (const c of list) count.set(label(c), (count.get(label(c)) || 0) + 1);
  return list.map(c => (count.get(label(c)) > 1 && c.model ? { ...c, modelCode: `${c.modelCode} ${c.model}`.trim() } : c));
}

// ─── HIGH-LEVEL STEPS ───────────────────────────────────────────────────────
async function findVehicleByVin(vin) {
  const key = `vin:any:${vin}`;
  const cached = await cacheGet(key);
  if (cached !== undefined) return cached;
  if (API()) return apiFindVehicleByVin(vin, key);

  // General VIN search over ALL brands (c= empty, exactly what the start
  // page's "Поиск по VIN" box sends). Laximo detects the brand; the result
  // links carry that brand's catalog code. Seen working for BMW and Audi.
  const html = await fetchPage(`/laximo?vin=${encodeURIComponent(vin)}&lp=findByVIN&c=`);
  const vehicles = parseVinResults(html);
  if (!vehicles.length) {
    // Cache "not found" too, but only briefly in memory -- a typo'd VIN
    // shouldn't be re-fetched on every message of the same conversation.
    memCache.set(ck(key), { data: null, at: Date.now() - CACHE_TTL_MS + 60 * 60 * 1000 });
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

  progress.step(`Ищу в каталоге: ${progress.quote(text)}`);
  const parts = API() ? await apiNameSearch(vehicle.query, text) : parsePartRows(await fetchPage(detailsSearchUrl(vehicle.query, text)));
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
  // Brake calipers (live 27.10, same X5 E70 VIN): "тормозной суппорт" found
  // nothing -- BMW names the caliper differently («Корпус тормозного суппорта»,
  // «Тормозная скоба», «Тормозной механизм» depending on the catalog language
  // version). Tried in order; only brake rows are kept (BMW/MINI numbers of
  // main group 34, or "торм" in the name/unit for other makes).
  {
    when: /суппорт|тормозн\S*\s+скоб|скоб\S*\s+тормоз/,
    query: ['суппорт', 'скоба', 'тормозной механизм'],
    keep: p => /суппорт|скоб|тормозн\S*\s+механизм/i.test(p.name || '') && isBrakePart(p),
  },
];
// BMW/MINI part number -> normalized 11 characters, or null. Classic numbers are
// 11 digits; newer ones mix in letters after the first five digits (30.10:
// 61615A3F9D8 «Накладка оси стеклоочистителя», 64115A1BDB6, 11425B4C845). Before
// 30.10 only the all-digit form was recognised, so letter numbers skipped the group,
// brake, axle and suspension checks -- a wiper part came through a brake-pad search.
function bmwNumber(oem) {
  const n = String(oem || '').replace(/[\s.-]/g, '').toUpperCase();
  return /^\d{5}[0-9A-Z]{6}$/.test(n) ? n : null;
}
function isBrakePart(p) {
  const oem = bmwNumber(p.oem);
  if (oem) return /^34/.test(oem); // BMW / MINI: 34 = brakes
  return /торм/i.test(`${p.name || ''} ${p.unit || ''}`);
}
const MAX_FALLBACK_QUERIES = 3; // requests in total for all fallbacks of one answer

// Broad words that also hit unrelated parts: "накладки" (the catalog's word
// for brake pads, "рем.к-т торм.накладок") also matches body trim
// ("Накладка порога" ...) -- 22.10: 214 OEMs for a 4-part request. Keep only
// rows that are about brakes (name or unit).
const QUERY_KEEP = {
  'накладки': p => /торм/i.test(`${p.name || ''} ${p.unit || ''}`),
  'накладка': p => /торм/i.test(`${p.name || ''} ${p.unit || ''}`),
};

// Suspension shock absorbers (live 26.10, X5 E70 VIN X4XZW61140L560928,
// «Подвеска → Амортизаторы»): the literal search "амортизатор" also returns
// the fuel-line damper (13537812878, unit «Ресивер/инжектор/провод»), the door
// check damper (51717164838) and the tailgate gas struts (51479149120 ...),
// and it misses the FRONT struts, which BMW calls «Амортизаторная стойка».
// For a plain shock-absorber request (no door/tailgate/bonnet/fuel words):
//  - keep only suspension parts: BMW numbers start with the main group --
//    31 front axle, 33 rear axle, 37 suspension electronics (adaptive dampers);
//    other makes: drop rows whose name/unit is door, tailgate, bonnet, fuel...
//  - also search the strut name (one extra request).
const NOT_SUSPENSION_RE = /двер|багаж|капот|крышк|люк|топлив|форсун|инжект|ресивер|рул|сиден|педал|бардач/i;
function isSuspensionDamperQuery(q) {
  // «амортизатор», «амортизаторные стойки», «стойки задние» -- one family for the
  // customer (28.10: «Амортизаторные стойки задние» found only the front strut;
  // the X5 E70 rear part is «Амортизатор Зд»). Not stabilizer links.
  return /амортиз|(^|\s)стойк/.test(q) && !/стабилиз/.test(q) && !NOT_SUSPENSION_RE.test(q);
}
function isSuspensionPart(p) {
  const oem = bmwNumber(p.oem);
  if (oem) return /^(31|33|37)/.test(oem); // BMW / MINI numbering
  return !NOT_SUSPENSION_RE.test(`${p.name || ''} ${p.unit || ''}`);
}
// Tried in order until one finds something (the strut's catalog name varies:
// «Амортизаторная стойка …», «Амортиз.стойка …»); the broad «стойка» keeps
// only suspension rows that are not stabilizer links.
// Both kinds are always searched for a damper/strut request: shock absorbers, and struts
// (the strut's catalog name varies: «Амортизационная стойка», «Амортизаторная стойка», «Амортиз.стойка»).
const DAMPER_FAMILY = [['амортизатор'], ['стойка', 'амортизационная стойка', 'амортизаторная стойка']];
const DAMPER_EXTRA_QUERIES = DAMPER_FAMILY.flat(); // kept for older references
const keepStrut = p => isSuspensionPart(p) && !/стабилиз/i.test(p.name || '');
// BMW's «Дополнительный амортизатор» (Zusatzdämpfer) is the bump stop, not a
// shock absorber: say so in the name the AI sees, so it is not offered as one.
const markBumpStop = p => (/^дополнительный амортизатор/i.test(clean(p.name)) ? { ...p, name: `${clean(p.name)} (отбойник / буфер сжатия, не сам амортизатор)` } : p);

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
// Catalog names written by the AI (extraction field partSearchNames): for each
// customer keyword, 1-3 names the original catalog may use -- first the main
// noun alone ("тормозной суппорт" -> "суппорт"), then other catalog names
// ("скоба"). Normalised to { keyword: [names...] } without the keyword itself.
function normalizeSearchNames(searchNames, keywords) {
  const out = {};
  if (!searchNames || typeof searchNames !== 'object' || Array.isArray(searchNames)) return out;
  const byKw = new Map(Object.entries(searchNames).map(([k, v]) => [clean(k).toLowerCase(), v]));
  for (const kw of keywords) {
    const list = [].concat(byKw.get(kw) || [])
      .map(n => clean(String(n || '')).toLowerCase())
      .filter(n => n && n.length >= 3 && n.length <= 40); // the keyword itself may be the best name ("глушитель")
    if (list.length) out[kw] = [...new Set(list)].slice(0, 3);
  }
  return out;
}
const MAX_NAME_RETRIES = 2; // extra AI-name searches per answer when the first name finds nothing

// ─── BMW / MINI MAIN GROUPS: a free sanity check on every row ────────────────
// An 11-digit BMW/MINI number starts with its main group (11 28 7 802 640 =
// engine, belt drive). A request for engine belts that returns 82… (roof box
// straps), 51… (boot trim) or 61… (fibre-optic cable) is wrong by definition
// (live 27.10, X5 E70: «Ремень и ролики» showed exactly those). Table checked
// by the agency 28.10.
const BMW_MAIN_GROUPS = {
  '01': 'Техническая литература', '07': 'Нормали (болты, гайки, клипсы)', '11': 'Двигатель',
  '12': 'Электрооборудование двигателя', '13': 'Подготовка топлива / впрыск', '16': 'Топливоснабжение',
  '17': 'Охлаждение', '18': 'Выпуск ОГ', '21': 'Сцепление', '22': 'Подвеска двигателя / КПП',
  '23': 'МКПП', '24': 'АКПП', '25': 'Переключение передач', '26': 'Карданный вал', '27': 'Раздаточная коробка',
  '31': 'Передний мост', '32': 'Рулевое управление', '33': 'Задний мост', '34': 'Тормоза', '35': 'Педали',
  '36': 'Колёса и шины', '37': 'Электроника подвески', '41': 'Кузов', '51': 'Оборудование кузова / отделка',
  '52': 'Сиденья', '54': 'Люк / складной верх', '61': 'Общее электрооборудование', '62': 'Приборы',
  '63': 'Освещение', '64': 'Отопление и кондиционер', '65': 'Аудио, навигация, электроника',
  '66': 'Парктроник, круиз-контроль', '71': 'Оснащение автомобиля', '72': 'Подушки и ремни безопасности',
  '82': 'Оригинальные аксессуары BMW', '83': 'Масла, жидкости, вспомогательные материалы', '84': 'Телефон / связь',
};
// Fixed groups for the most common parts -- they stay right even if the AI
// slips. First match wins, so the specific rules come before the general ones.
const KEYWORD_GROUPS = [
  [/ремн\S*\s+безопасн|ремень\s+безопасн|подушк\S*\s+безопасн|airbag/, ['72']],
  [/масл\S*\s+фильтр|фильтр\S*\s+масл/, ['11']],
  [/воздушн\S*\s+фильтр|фильтр\S*\s+воздушн|элемент\S*\s+фильтр/, ['13']],
  [/салонн\S*\s+фильтр|фильтр\S*\s+салон|микрофильтр|угольн\S*\s+фильтр/, ['64']],
  [/топливн\S*\s+фильтр|фильтр\S*\s+топлив/, ['13', '16']],
  [/жидкост|антифриз|охлаждающ|тосол|смазк|герметик|(^|\s)chf|моторн\S*\s+масл|^масло(\s|$)|трансмиссионн\S*\s+масл/, ['83']],
  [/двер|багажник|капот|крышк\S*\s+багаж/, null], // door / tailgate dampers, struts, locks: no fixed group, the AI decides
  [/(глушител|шумоглуш)\S*.*(впуск|всасыв)|(впуск|всасыв)\S*.*(глушител|шумоглуш)/, ['13']],
  [/глушител|резонатор|выхлопн|катализатор|сажев/, ['18']],
  [/порог|бампер|молдинг|зеркал|решетк|решётк/, ['51']],
  [/щетк|щётк|дворник|стеклоочист/, ['61']],
  [/торм|колодк|накладк|суппорт|скоб/, ['34']],
  [/амортиз|амортизационн|(^|\s)стойк|пружин|стабилизатор|рычаг|сайлент|шаров\S*\s+опор|ступиц|опор\S*\s+стойк/, ['31', '33', '37']],
  [/ремен|ремн|ролик|натяжител|обводн/, ['11', '64', '32']],
  [/свеч/, ['12']],
  [/помп|водян\S*\s+насос|термостат/, ['11', '17']],
  [/(^|\s)фар[аыуе]?(\s|$)|фонар|ламп/, ['63']],
  [/опор\S*\s+двигат|подушк\S*\s+двигат|опор\S*\s+(кпп|коробк)/, ['22']],
  [/сцеплен/, ['21']],
  [/рулев|рейк/, ['32']],
];
/** Fixed main groups for a customer keyword, or null (no rule). */
function groupsForKeyword(kw) {
  const t = String(kw || '').toLowerCase();
  for (const [re, groups] of KEYWORD_GROUPS) if (re.test(t)) return groups;
  return null;
}
/** { keyword: Set(groups) } -- fixed rules first, else the AI's partGroups (only real groups). */
function resolveGroups(aiGroups, keywords) {
  const ai = new Map();
  if (Array.isArray(aiGroups)) {
    // Live 28.10: the AI sometimes answers ["18"] instead of {"глушитель":["18"]} -- one list for all keywords.
    for (const kw of keywords) ai.set(kw, aiGroups);
  } else if (aiGroups && typeof aiGroups === 'object') {
    for (const [k, v] of Object.entries(aiGroups)) ai.set(clean(k).toLowerCase(), v);
  }
  const out = {};
  for (const kw of keywords) {
    let g = groupsForKeyword(kw);
    if (!g) {
      g = [].concat(ai.get(kw) || []).map(x => String(x).replace(/\D/g, '').padStart(2, '0').slice(0, 2)).filter(x => BMW_MAIN_GROUPS[x]);
    }
    if (g && g.length) out[kw] = new Set(g);
  }
  return out;
}
// Front / rear axle from the BMW/MINI number itself (owner 28.10): 31 = front
// axle, 33 = rear axle; brakes 34 1x = front wheel brake, 34 2x = rear. Live:
// the bot said «каталог не разделяет передние/задние» for 34116889585 (front)
// and 34216890353 (rear), and sent strut-mount kits 31…/33… to the manager.
function axleOf(oem) {
  const n = bmwNumber(oem);
  if (!n) return null;
  if (/^31/.test(n)) return 'передняя ось';
  if (/^33/.test(n)) return 'задняя ось';
  if (/^341/.test(n)) return 'передняя ось';
  if (/^342/.test(n)) return 'задняя ось';
  return null;
}
const bmwGroupOf = p => { const oem = bmwNumber(p.oem); return oem ? oem.slice(0, 2) : null; };

// ─── SEARCH BY GROUP («Поиск по группам», lp=qgroups) ────────────────────────
// Owner 30.10 (335Li F35, saved pages gid=545 «Колодки тормозные дисковые» and
// gid=544 «Диск тормозной»): the site's own parts tree gives exactly the parts
// BMW lists for the car under each group -- no word guessing («накладка» also
// hit a wiper cover), and fewer requests (one page per group instead of 3-5
// word searches). Page layout (from the saved sources):
//   - the whole tree is inline JS: `data: [{text, href:"…gid=N…", nodes, aliases}]`
//   - each unit is <div class="laximoGeneralNexusList__item"> with the unit
//     name in .block_header b, an optional equipment selector
//     (<label>Спортивные тормоза M (S2NHA)</label><select name="ssdmodification">
//     <option value="~$…$">да</option>…) and the usual OEM table;
//   - choosing an option reloads the same URL + &ssdmodification=<value>.
// Used for plain part requests only (not ТО, not article checks); anything that
// matches no group, or a group page that fails, goes to the word search below.
// LAXIMO_GROUPS=false switches it off.
const GROUPS_ENABLED = () => process.env.LAXIMO_GROUPS !== 'false';
const MAX_GROUPS = 4; // group pages per answer (same budget idea as MAX_QUERIES)

function qgroupsUrl(q, gid, modification) {
  const p = new URLSearchParams({ lp: 'qgroups', c: q.c || '', vid: q.vid || '', ...(gid ? { gid: String(gid) } : {}), ssd: q.ssd || '', vin: q.vin || '' });
  if (modification) p.set('ssdmodification', modification);
  return `/laximo?${p.toString()}`;
}

/** Pure: qgroups page -> [{ gid, name, aliases, path }] for every selectable node with a gid. */
function parseGroupTree(html) {
  const src = String(html || '');
  const at = src.indexOf('data: [');
  if (at < 0) return [];
  let i = at + 'data: '.length, depth = 0, inStr = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (inStr) { if (c === '\\') j++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) break; }
  }
  let data;
  try { data = JSON.parse(src.slice(i, j + 1)); } catch { return []; }
  const out = [];
  const walk = (nodes, path) => {
    for (const n of nodes || []) {
      const m = String(n.href || '').match(/[?&]gid=(\d+)/);
      const name = clean(n.text || '');
      if (m) out.push({ gid: m[1], name, aliases: (n.aliases || []).map(a => clean(a)).filter(Boolean), path: path.join(' › ') });
      walk(n.nodes, [...path, name]);
    }
  };
  walk(data, []);
  return out;
}

/** Pure: qgroups page -> { tree, units: [{ name, filters: [{label, options:[{text, value}]}], rows }] }. */
function parseGroupPage(html) {
  const $ = cheerio.load(html);
  const units = [];
  $('.laximoGeneralNexusList__item').each((_, item) => {
    const name = clean($(item).find('.block_header b').first().text()) || null;
    const filters = [];
    $(item).find('.fr-form-group').each((__, g) => {
      const label = clean($(g).find('label').first().text());
      const options = $(g).find('select[name="ssdmodification"] option').map((___, o) => ({ text: clean($(o).text()), value: $(o).attr('value') || '' })).get().filter(o => o.text && o.value);
      if (label && options.length && !filters.some(f => f.label === label)) filters.push({ label, options });
    });
    // The unit's diagram (full size) is on the group page itself -- a diagram
    // card can show it with no extra request (30.10, diagram cards).
    const zoom = $(item).find('img.laximoNexusList__zoomImage').first().attr('src') || $(item).find('.laximoNexusList__item img').first().attr('src') || null;
    const unitImage = zoom && /^https:\/\/img\.laximo\.ru\//.test(zoom) ? zoom : null;
    const rows = parsePartRows($.html(item)).map(r => ({ ...r, unit: name, ...(unitImage ? { unitImage } : {}) }));
    units.push({ name, filters, rows });
  });
  return { tree: parseGroupTree(html), units };
}

// Customer words -> the tree node to open (matched by the node NAME, so the
// rule survives another catalog numbering). First match wins.
const GROUP_RULES = [
  { kw: /(колодк|накладк).*(ручник|стояноч)|(ручник|стояноч).*(колодк|накладк)/, group: /^колодки стояночного тормоза$/i },
  { kw: /датчик\S*\s+износ/, group: /^датчик износа тормозных колодок$/i },
  { kw: /колодк|^накладк|тормозн\S*\s+накладк/, group: /^колодки тормозные дисковые$/i, not: /ручник|стояноч|парков/ }, // XM G09 (04.11): no handbrake-shoe group -> must not fall to the disc pads
  { kw: /торм\S*\s+диск|диск\S*\s+торм|^(передн\S*\s+|задн\S*\s+)?диск(и|а|ов)?$/, group: /^диск тормозной$/i },
  { kw: /суппорт/, group: /^суппорт тормозной$/i },
  { kw: /тормозн\S*\s+жидкост|жидкост\S*\s+тормоз/, group: /^жидкость тормозная$/i },
  { kw: /масл\S*\s+фильтр|фильтр\S*\s+масл/, group: /^фильтр масляный$/i },
  { kw: /воздушн\S*\s+фильтр|фильтр\S*\s+воздушн/, group: /^фильтр воздушный$/i },
  { kw: /салонн\S*\s+фильтр|фильтр\S*\s+салон|микрофильтр/, group: /^фильтр салонный$/i },
  { kw: /топливн\S*\s+фильтр|фильтр\S*\s+топлив/, group: /^фильтр топливный$/i },
  { kw: /свеч\S*(\s+зажиган)?$|^свеч/, group: /^свечи зажигания$/i, not: /накал/ },
  { kw: /щетк|щётк|дворник/, group: /^щетки стеклоочистителя$/i },
  { kw: /опор\S*\s+(амортиз|стойк)/, group: /^опора амортизатора/i },
  { kw: /амортиз|(^|\s)стойк|(^|\s)аморт/, group: /^амортизатор$/i, not: /стабилиз|двер|багаж|капот|опор/ },
  { kw: /помп|водян\S*\s+насос|насос\S*\s+охлажд/, group: /^насос системы охлаждения$/i },
  { kw: /термостат/, group: /^термостат$/i },
  { kw: /приводн\S*\s+рем|рем\S*\s+(генератор|приводн|поликлин)/, group: /^ремень приводной$/i },
  { kw: /антифриз|охлаждающ\S*\s+жидкост/, group: /^жидкость охлаждающая$/i },
  { kw: /лямбда|кислородн|датчик\S*\s+кислород/, group: /^датчик кислорода$/i },
  { kw: /аккумулятор|акб/, group: /^аккумулятор$/i },
  // Suspension arms (live 04.11, 530iX G30 LCI «поперечный рычаг переднего моста»: the word
  // search «рычаг» misses «Нижн.попереч.рычаг…» / «Тяга с резинометалл.шарниром» -- the
  // catalog glues the abbreviations to the word -- and found only a mounting kit).
  // Group names not seen live yet: several spellings, first match wins; see the
  // «no group» log below to tighten them.
  { kw: /рычаг|(^|\s)тяг[аиу]/, group: /^рычаг(и)?\s+(передней\s+)?подвески$/i, not: /стеклоочист|дворник|ручн|переключ|кпп|стояноч|педал|капот|двер|рулев/ },
  { kw: /рычаг|(^|\s)тяг[аиу]/, group: /^рычаг(и)?(\s|$)|рычаг.*подвеск|подвеск.*рычаг/i, not: /стеклоочист|дворник|ручн|переключ|кпп|стояноч|педал|капот|двер|рулев/ },
  { kw: /^(основн\S*\s+|головн\S*\s+|передн\S*\s+)?фар[аыу]?$/, group: /^фары передние$/i },
  // Mirror: the body group, not the electric «Зеркало» (drive, door panel) -- XM G09 04.11.
  { kw: /зеркал/, group: /^зеркала$/i, not: /стекл|элемент|привод|салон|внутрен/ },
  { kw: /зеркал/, group: /^зеркало наружное$/i, not: /стекл|элемент|привод|салон|внутрен/ },
  { kw: /сайлент|резинометалл/, group: /сайлент|резинометалл/i },
  { kw: /шаров/, group: /шаров/i },
  { kw: /стойк\S*\s+стабил|тяг\S*\s+стабил|линк/, group: /(стойк|тяг)\S*\s+стабилизатор/i },
  { kw: /втулк\S*\s+стабил/, group: /втулк\S*\s+стабилизатор/i },
  { kw: /ступиц|подшипник\S*\s+(ступиц|колес)/, group: /ступиц|подшипник\S*\s+(ступиц|колес)/i },
];
const PADS_GROUP_RE = /^колодки тормозные дисковые$/i;
const SENSOR_GROUP_RE = /^датчик износа тормозных колодок$/i;
const stripAxleWords = kw => String(kw || '').toLowerCase().replace(/(^|\s)(передн|задн|лев|прав)\S*/g, ' ').replace(/\s+/g, ' ').trim();

/** Pure: customer keyword -> tree node or null (rules first, then an exact name/alias match). */
function findGroupFor(keyword, tree) {
  const kw = String(keyword || '').toLowerCase().replace(/ё/g, 'е');
  for (const r of GROUP_RULES) {
    if (!r.kw.test(kw) || (r.not && r.not.test(kw))) continue;
    const node = (tree || []).find(n => r.group.test(n.name));
    if (node) return node;
  }
  const bare = stripAxleWords(kw);
  return (tree || []).find(n => [n.name, ...n.aliases].some(a => a.toLowerCase().replace(/ё/g, 'е') === bare))
    || matchGroupByWords(kw, tree);
}

// ─── Generic word match against the group tree (04.11, coverage run on X5 E70:
// 27 of 93 typical requests found nothing because no hand-written rule named their
// group, e.g. «рулевой наконечник» vs «Наконечник рулевой тяги», «прокладка
// поддона» vs «Прокладка масляного поддона»). Every word of the request (stem of
// 5 letters) must appear in the group's name, synonyms or parent section; among
// those, the group whose own name has the fewest other words wins. Customer
// jargon is translated to the catalog's words first (GROUP_JARGON).
const GROUP_JARGON = [
  [/шрус\S*/g, 'привод'],
  [/маслоохладител\S*|масляный радиатор/g, 'радиатор масляный'],
  [/подкрыл\S*|локер\S*/g, 'колесная ниша'],
  [/парктроник\S*|парковочн\S*/g, 'парковке'],
  [/моторчик\S*/g, 'двигатель'],
  [/стекл\S*\s+зеркал\S*|зеркальн\S*\s+элемент\S*/g, 'зеркальный элемент'],
  [/масл\S*\s+(акпп|кпп|коробк\S*)(\s+передач)?/g, 'масло трансмиссионное'],
  [/(задн\S*|передн\S*)\s+редуктор\S*|редуктор\S*\s+(задн|передн)\S*/g, 'дифференциал'],
  [/гур/g, 'гидроусилителя'],
  [/(клапан\S*\s+)?вентиляц\S*\s+картер\S*/g, 'вентиляция'],
  [/опор\S*\s+(акпп|мкпп|кпп|коробк\S*(\s+передач)?)/g, 'опоры двигателя'],
  [/бач\S*\s+омывател\S*/g, 'бачок стеклоочистителя'],
  [/колесн\S*\s+болт\S*|болт\S*\s+колес\S*|колесн\S*\s+гайк\S*/g, 'болты гайки'],
  [/датчик\S*\s+(парктроник\S*|парковк\S*)/g, 'помощи парковке'],
  [/ступичн\S*\s+подшипник\S*/g, 'подшипник ступичный'],
];
// Groups that share the customer's word but are a different thing (XM G09 04.11:
// «генератор» -> «Генератор импульсов» = crankshaft/camshaft sensors).
const GROUP_NOT_FOR = [
  [/генератор/, /импульс/i],
  [/^(?!.*импульс).*генератор/, /колебан/i],
];
const GROUP_STOP = new Set(['для', 'на', 'и', 'с', 'в', 'со', 'от', 'bmw', 'бмв', 'комплект', 'новый', 'оригинал', 'оригинальный']);
const stemsOf = text => String(text || '').toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/)
  .filter(w => w.length >= 3 && !GROUP_STOP.has(w)).map(w => (w.length > 5 ? w.slice(0, 5) : w.slice(0, Math.max(3, w.length - 1)))); // фара/фары, лампа/лампы
const stemHit = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));
function matchGroupByWords(keyword, tree) {
  let kw = String(keyword || '').toLowerCase().replace(/ё/g, 'е');
  for (const [re, to] of GROUP_JARGON) kw = kw.replace(re, to); // before the axle words go («задний редуктор»)
  kw = stripAxleWords(kw);
  const want = [...new Set(stemsOf(kw))];
  if (!want.length) return null;
  let best = null;
  for (const n of tree || []) {
    const own = stemsOf(n.name);
    // The parent section counts only for one-word groups («Пыльник» under «Привод колеса»,
    // «Лампы» under «Фары…»); «Свечи накаливания» under «Система зажигания, накаливания»
    // must not answer «свечи зажигания».
    const all = [...own, ...(n.aliases || []).flatMap(stemsOf), ...(own.length === 1 ? stemsOf(String(n.path || '').split('›').pop()) : [])];
    if (!want.every(w => all.some(x => stemHit(w, x)))) continue;
    if (GROUP_NOT_FOR.some(([req, grp]) => req.test(kw) && grp.test(n.name))) continue;
    const inOwn = want.filter(w => own.some(x => stemHit(w, x))).length;
    const extra = own.filter(x => !want.some(w => stemHit(w, x))).length;
    const score = inOwn * 10 - extra * 3 + (n.aliases || []).some(a => stemsOf(a).some(x => want.some(w => stemHit(w, x)))) * 2;
    // «Крыло» exists under «Автомобиль, задняя часть» and under «Кузовные детали»:
    // a section limited to one end of the car only when the customer said so.
    const k = String(keyword || '').toLowerCase(), pth = String(n.path || '').toLowerCase();
    const askF = /передн|перед/.test(k), askR = /задн|зад(?!еж)/.test(k);
    const secF = /передняя\s+часть/.test(pth), secR = /задняя\s+часть/.test(pth);
    const total = score - ((secF && askR && !askF) || (secR && askF && !askR) ? 5 : (secF || secR) && !askF && !askR ? 1 : 0);
    if (!best || total > best.score) best = { node: n, score: total };
  }
  return best ? best.node : null;
}

async function getGroupTree(q) {
  // API: ListQuickGroup is per car (VehicleId) -- a petrol car has «Свечи зажигания»,
  // a diesel «Свечи накаливания». Cached per car since 04.11 (before: per catalog, so
  // the XM G09 coverage run used the X5 E70 diesel tree and missed its spark plugs).
  const key = API() ? `qtree2:${q.c || ''}:${q.vid || ''}` : `qtree:${q.c || ''}`;
  const cached = await cacheGet(key);
  if (cached !== undefined && cached && cached.length) return cached;
  const tree = API() ? laximoApi.parseQuickGroups(await apiCar(q, 'ListQuickGroup', { Locale: 'ru_RU', Catalog: q.c, VehicleId: q.vid })) : parseGroupTree(await fetchPage(qgroupsUrl(q)));
  if (tree.length) await cacheSet(key, tree);
  return tree;
}

async function getGroupPage(vehicle, gid, modification) {
  const q = vehicle.query || {};
  const key = `${API() ? 'qgroup6' : 'qgroup2'}:${q.c || ''}:${vehicle.cacheId || vehicle.vin || q.vid}:${gid}:${modification || ''}`; // v2: rows carry unitImage; API v3: equipment filters
  const cached = await cacheGet(key);
  if (cached !== undefined) return cached;
  if (API()) {
    const out = { units: await apiGroupUnits(q, gid, modification) };
    await cacheSet(key, out);
    return out;
  }
  const html = await fetchPage(qgroupsUrl(q, gid, modification));
  const page = parseGroupPage(html);
  const out = { units: page.units };
  if (page.tree.length) await cacheSet(`qtree:${q.c || ''}`, page.tree);
  await cacheSet(key, out);
  return out;
}

/** Equipment options that decide between parts: named in a row condition or offered in 2+ units. */
// Battery group (live 04.11, X5 G05 LCI 40iX «АКБ»): the group «Аккумулятор»
// also holds the auxiliary 12 V lithium battery and the 48 V battery (mild
// hybrid / Executive Drive); the 48 V unit's selector made the bot ask about
// «Спортивная ходовая часть M Professional (S2VWA)». A plain «АКБ /
// аккумулятор» request means the main 12 V starter battery: those units are
// dropped (before the equipment question) unless the customer names them.
// Kept if nothing else is left.
const BATTERY_KW_RE = /акб|аккумулятор|батаре/i;
const BATTERY_EXTRA_RE = /48\s*в|48\s*v|дополнительн|лити|li-?ion|буферн|сдвоен|двойн/i; // «Сдвоенная литиевая АКБ 12 В» (G30 LCI, live 04.11)
function narrowUnits(page, kws, customerText) {
  if (!page || !Array.isArray(page.units) || !(kws || []).some(k => BATTERY_KW_RE.test(k))) return page;
  if (BATTERY_EXTRA_RE.test(`${(kws || []).join(' ')} ${customerText || ''}`)) return page;
  const isExtra = u => BATTERY_EXTRA_RE.test(`${u.name || ''} ${(u.rows || []).map(r => r.name || '').join(' ')}`);
  const kept = page.units.filter(u => !isExtra(u));
  if (!kept.length || kept.length === page.units.length) return page;
  console.log(`[laximo] battery: main 12 V battery only, dropped units ${page.units.filter(isExtra).map(u => `"${u.name}"`).join(', ')}`);
  return { ...page, units: kept };
}

function equipmentFilters(units) {
  const count = new Map();
  for (const u of units) for (const f of u.filters) {
    const e = count.get(f.label) || { label: f.label, options: f.options, units: 0, named: false };
    e.units++;
    count.set(f.label, e);
  }
  for (const u of units) for (const r of u.rows) for (const v of Object.values(r.notes || {})) {
    for (const e of count.values()) if (String(v).includes(e.label)) e.named = true;
  }
  // Named in a row condition or offered in 2+ units: clearly decides between
  // parts. A selector in one unit only still counts (the 544 disc page has
  // S2NHA in one block), except trim packages («Modern Line», «Pakete ex.»)
  // that the catalog shows next to sensors -- unless a row names them.
  return [...count.values()].filter(e => e.named || e.units >= 2 || !/line|paket/i.test(e.label))
    .filter(e => e.options.some(o => /^да$/i.test(o.text)) && e.options.some(o => /^нет$/i.test(o.text)))
    .sort((a, b) => (b.named - a.named) || (b.units - a.units));
}

/** Rows of one group page -> unique part rows with flags; alternatives last. */
function groupRows(units, q) {
  const seen = new Set();
  const rows = [];
  for (const u of units) for (const r of u.rows) {
    if (seen.has(r.oem)) continue;
    seen.add(r.oem);
    const noteText = Object.values(r.notes || {}).join(' ');
    const cond = Object.values(r.notes || {}).map(v => String(v).match(/Для автомобилей с (.+?=\s*(?:да|нет))/i)).find(Boolean);
    rows.push({
      ...r,
      schema: { number: r.oem, catalog: q.c || null, vid: q.vid || null, ssd: q.ssd || null },
      ...(/альтернат/i.test(noteText) ? { alternative: true } : {}),
      ...(/value\s*(repair\s*)?parts/i.test(noteText) || /датч\S*\s*износа/i.test(r.name || '') ? { kitWithSensor: true } : {}),
      ...(cond ? { condition: cond[1].replace(/\s+/g, ' ').trim() } : {}),
    });
  }
  return [...rows.filter(r => !r.alternative), ...rows.filter(r => r.alternative)];
}

// ─── TYRES AND WHEELS (03.11) ────────────────────────────────────────────────
// Original BMW tyres, rims and complete wheels are in the car's catalogue, but
// neither the group rules nor the name search reached them; with nothing found
// DeepSeek told the customer «шины и диски в нашем каталоге не представлены».
// Two routes (owner's screenshots 03.11):
//  1) «Поиск по группам»: Ходовая часть › Колеса, шины › Шины / Диски /
//     Комплект колеса -- one group page, preferred;
//  2) fallback: the car page's category «36. Колеса с шинами» (X5 G05) or
//     «85. Колеса в сборе, диски и шины» -> its units: «Зимние шины», «Летние
//     шины», ~15 rim units named by diameter («BMW л/с диск … 740M - 20"»),
//     complete wheels («BMW кол.с л/с диск …», «BMW LM Rad …») and extras
//     (грузик, фиксаторы болтов, колпачки, аварийное колесо), opened by kind,
//     season and diameter, at most MAX_TIRE_UNITS unit pages.
// Rows are then narrowed to the customer's size (235/55 R18) or rim diameter.
const TIRE_CATEGORY_RE = /шин|колес|колёс|wheel|tyre|tire|reifen|räder/i;
const MAX_TIRE_UNITS = 4;
const NOT_TIRE_RE = /подшипник|ступиц|болт|гайк|шпильк|датчик|давлени|колпач|арк|торм|цилиндр|секретк|балансир|грузик|противовес|фиксатор|вентил|ниппел|ключ|домкрат|рулев|запаск|аварийн/;
const TIRE_GROUP_NAME = { tire: /^шины$/i, rim: /^диски(\s+колесные)?$/i, wheel: /^комплект(ы)?\s+колес[аё]?$/i };
const TIRE_EXTRA_RE = /грузик|противовес|фиксатор|колпач|болт|гайк|аварийн|ниппел|вентил|датчик/i;
const lc = s => String(s || '').toLowerCase().replace(/ё/g, 'е');

/** Pure: customer keyword -> { kind: 'tire'|'rim'|'wheel', season } or null. */
function tireRequest(keyword) {
  const kw = lc(keyword);
  if (NOT_TIRE_RE.test(kw)) return null;
  let kind = null;
  if (/шин|покрышк|резин|tire|tyre/.test(kw)) kind = 'tire';
  else if (/колес\S*\s+в\s+сбор|комплект\S*\s+колес|колес\S*\s+с\s+(шин|диск)|(^|\s)колес[аоы]?(\s|$)|wheel/.test(kw)) kind = 'wheel';
  else if (/колесн\S*\s+диск|диск\S*\s+колес|лит\S*\s+диск|кован\S*\s+диск|штампован\S*\s+диск|(^|\s)rim/.test(kw)) kind = 'rim';
  if (!kind) return null;
  const season = /зим|winter/.test(kw) ? 'winter' : /лет|summer/.test(kw) ? 'summer' : /всесезон/.test(kw) ? 'all' : null;
  return { kind, season };
}

/** Pure: every tyre size in a text, as "235/55 R18" (accepts 235/55R18, 235/55 ZR18, 235 55 18, 235/55-18). */
function tireSizes(text) {
  const out = [];
  const re = /(?<!\d)(\d{3})\s*[\/\\x×\s]\s*(\d{2})\s*(?:-|\s)?\s*(?:z?r|zr|r|р)?\s*-?\s*(\d{2})(?!\d)/gi;
  for (const m of String(text || '').matchAll(re)) {
    const w = Number(m[1]), h = Number(m[2]), d = Number(m[3]);
    if (w < 125 || w > 355 || h < 25 || h > 85 || d < 13 || d > 23) continue; // not a tyre size (part numbers etc.)
    const s = `${w}/${h} R${d}`;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** Pure: rim diameters (inches) named in a text: R18, 18", 18'', 18 дюймов, 8,5Jx18, from a tyre size too. */
function rimDiameters(text) {
  const t = String(text || '');
  const out = new Set(tireSizes(t).map(s => Number(s.split('R')[1])));
  for (const m of t.matchAll(/(?<![\d\/])(?:r|р)\s?(1[3-9]|2[0-3])(?!\d)|(?<![\d,.])(1[3-9]|2[0-3])\s*(?:"|''|″|”|дюйм|inch)|j\s*[x×х]\s*(1[3-9]|2[0-3])(?!\d)/gi)) {
    out.add(Number(m[1] || m[2] || m[3]));
  }
  return [...out];
}

/** Pure: kind of a tyre-category unit by its name. */
function tireUnitKind(name) {
  const n = lc(name);
  if (TIRE_EXTRA_RE.test(n)) return 'extra';
  if (/шин|tyre|tire|reifen/.test(n)) return 'tire';
  if (/кол\.?\s*с\s|колес\S*\s+с\s|комплект\S*\s+колес|lm\s*rad|(^|\s)rad(\s|$)|complete\s+wheel/.test(n)) return 'wheel';
  if (/диск|обод|felge|rim/.test(n)) return 'rim';
  return 'other';
}

/** Pure: units of the tyre category -> the ones to open for this request, best first. */
function pickTireUnits(units, req, diameters = []) {
  const usable = (units || []).filter(u => u.href);
  const season = u => /зим|winter/.test(lc(u.name)) ? 'winter' : /лет|summer/.test(lc(u.name)) ? 'summer' : /всесезон/.test(lc(u.name)) ? 'all' : null;
  let picked = usable.filter(u => tireUnitKind(u.name) === req.kind);
  // Complete wheels asked, none listed separately (or vice versa): rims and wheels are close enough.
  if (!picked.length && req.kind !== 'tire') picked = usable.filter(u => ['rim', 'wheel'].includes(tireUnitKind(u.name)));
  if (req.season) {
    const s = picked.filter(u => season(u) === req.season);
    if (s.length) picked = s;
  }
  if (req.kind !== 'tire' && diameters.length) {
    const d = picked.filter(u => rimDiameters(u.name).some(x => diameters.includes(x)));
    if (d.length) picked = d;
  }
  return picked.slice(0, MAX_TIRE_UNITS);
}

/** Pure: keeps the rows of the asked size / diameter; none match -> all rows, sizeMissing set. */
function filterTireRows(rows, sizes, req = { kind: 'tire' }, diameters = []) {
  rows = (rows || []).filter(r => tireUnitKind(r.name) !== 'extra' || req.kind !== 'tire'); // no valve caps among tyres
  if (req.kind === 'tire' && sizes && sizes.length) {
    const want = new Set(sizes);
    const kept = rows.filter(r => tireSizes(r.name).some(s => want.has(s)));
    return kept.length ? { rows: kept, sizeMissing: null } : { rows, sizeMissing: sizes.join(', ') };
  }
  if (req.kind !== 'tire' && diameters && diameters.length) {
    const kept = rows.filter(r => rimDiameters(`${r.name} ${r.unit || ''}`).some(d => diameters.includes(d)));
    return kept.length ? { rows: kept, sizeMissing: null } : { rows, sizeMissing: diameters.map(d => `R${d}`).join(', ') };
  }
  return { rows, sizeMissing: null };
}

async function getTireCategory(vehicle) {
  const q = vehicle.query || {};
  const key = `tirecat2:${q.c || ''}:${vehicle.cacheId || vehicle.vin || q.vid}`;
  const cached = await cacheGet(key);
  if (cached !== undefined) return cached;
  const page = API() ? { categories: await apiCategories(q) } : parseVehiclePage(await fetchPage(`/laximo?${new URLSearchParams({ ...q, lp: 'vehicle' }).toString()}`));
  const rank = c => /шин|tyre|tire|reifen/i.test(c.name || '') ? 0 : TIRE_CATEGORY_RE.test(c.name || '') ? 1 : 99;
  const cat = page.categories.filter(c => c.href && rank(c) < 99 && !NOT_TIRE_RE.test(lc(c.name))).sort((a, b) => rank(a) - rank(b))[0];
  let out = null;
  if (cat) {
    const cp = API() ? { units: await apiUnitsOf(q, cat) } : parseVehiclePage(await fetchPage(unescapeHref(cat.href)));
    out = { name: cat.name, units: cp.units.map(u => ({ name: u.name, uid: u.uid, href: u.href })) };
  } else {
    console.log(`[laximo] tyre category not found (${page.categories.length} categories: ${page.categories.map(c => c.name).join(' | ')})`);
  }
  await cacheSet(key, out);
  return out;
}

async function getTireUnit(vehicle, unit) {
  const q = vehicle.query || {};
  const key = `tireunit1:${q.c || ''}:${vehicle.cacheId || vehicle.vin || q.vid}:${unit.uid || unit.href}`;
  const cached = await cacheGet(key);
  if (cached !== undefined) return cached;
  const d = await unitDiagram(unit.href);
  const image = d.image && /^https:\/\/img\.laximo\.ru\//.test(d.image) ? d.image : null;
  const out = d.rows.map(r => ({
    ...r,
    unit: d.unitName || unit.name,
    position: r.position || (r.code ? String(r.code).replace(/^\D+/, '') : null),
    ...(image ? { unitImage: image } : {}),
    schema: { number: r.oem, catalog: q.c || null, vid: q.vid || null, ssd: q.ssd || null },
  }));
  await cacheSet(key, out);
  return out;
}

/** Route 1: «Поиск по группам» › Колеса, шины › Шины / Диски / Комплект колеса. null = no such group. */
async function tiresByGroup(vehicle, req) {
  const q = vehicle.query || {};
  if (!GROUPS_ENABLED()) return null;
  const tree = await getGroupTree(q);
  const inWheels = n => !n.path || /колес|колёс|шин/i.test(n.path);
  let node = tree.find(n => TIRE_GROUP_NAME[req.kind].test(n.name) && inWheels(n));
  if (!node && req.kind === 'wheel') node = tree.find(n => TIRE_GROUP_NAME.rim.test(n.name) && inWheels(n));
  if (!node) return null;
  progress.step(`Открываю раздел каталога ${progress.quote(node.name)}`);
  const page = await getGroupPage(vehicle, node.gid);
  let units = page.units;
  if (req.season) {
    const s = units.filter(u => (req.season === 'winter' ? /зим|winter/i : req.season === 'summer' ? /лет|summer/i : /всесезон/i).test(u.name || ''));
    if (s.length) units = s;
  }
  return { source: `${node.path ? node.path + ' › ' : ''}${node.name}`, units: [...new Set(units.map(u => u.name).filter(Boolean))], rows: groupRows(units, q) };
}

/** Route 2: the car page's tyre category and its units. null = no such category. */
async function tiresByCategory(vehicle, req, diameters) {
  const cat = await getTireCategory(vehicle);
  if (!cat || !cat.units.length) return null;
  const units = pickTireUnits(cat.units, req, diameters);
  const rows = [];
  const seen = new Set();
  for (const u of units) {
    progress.step(`Открываю раздел каталога ${progress.quote(u.name || cat.name)}`);
    for (const r of await getTireUnit(vehicle, u)) {
      if (seen.has(r.oem)) continue;
      seen.add(r.oem);
      rows.push(r);
    }
  }
  return { source: cat.name, units: units.map(u => u.name), rows };
}

/** Tyre / wheel rows for the request, or null when the car's catalogue has neither route. */
async function searchTires(vehicle, kw, req, customerText) {
  const text = `${kw} ${customerText || ''}`;
  const sizes = tireSizes(text);
  const diameters = rimDiameters(text);
  let found = null;
  try {
    found = await tiresByGroup(vehicle, req);
  } catch (err) {
    if (err instanceof LaximoSkip) throw err;
    console.error('[laximo] tyre group failed, trying the car page:', err.message);
  }
  if (!found || !found.rows.length) found = await tiresByCategory(vehicle, req, diameters) || found;
  if (!found) return null;
  const rows = found.rows.map(r => ({ ...r, query: kw }));
  const f = filterTireRows(rows, sizes, req, diameters);
  console.log(`[laximo] tyres "${kw}" (${req.kind}${req.season ? ', ' + req.season : ''}): "${found.source}", units ${found.units.map(u => `"${u}"`).join(', ')}: ${rows.length} row(s)` +
    (sizes.length || diameters.length ? `, asked ${(req.kind === 'tire' ? sizes : diameters.map(d => 'R' + d)).join(', ') || '-'}: ${f.sizeMissing ? 'not in the catalogue -- all rows kept' : f.rows.length + ' match'}` : ''));
  const offered = req.kind === 'tire'
    ? [...new Set(rows.flatMap(r => tireSizes(r.name)))]
    : [...new Set(rows.flatMap(r => rimDiameters(`${r.name} ${r.unit || ''}`)))].sort((a, b) => a - b).map(d => `R${d}`);
  return { rows: f.rows, info: { category: found.source, units: found.units, asked: req.kind === 'tire' ? sizes : diameters.map(d => `R${d}`), sizeMissing: f.sizeMissing, catalogSizes: offered } };
}

/**
 * Parts for the customer's keywords: by group where a group matches, by words
 * for the rest. opts.equipment = { label, answer: 'да' | 'нет' | 'unknown' }
 * (the customer's answer to the equipment question, see chat.js).
 * Extra fields on the returned array: searched, droppedByGroup, searchFailed,
 * broad (from the word search), groupSearched, equipmentQuestion
 * ({ label } -- ask the customer), equipmentAnswer.
 */
async function searchPartsForVehicle(vehicle, partKeywords, searchNames, partGroups, opts = {}) {
  const keywords = [...new Set((partKeywords || []).map(k => clean(k).toLowerCase()).filter(Boolean))];
  const q = vehicle.query || {};
  const byGroup = [];
  const crossSell = [];
  const viaGroup = new Set();
  const groupSearched = [];
  let equipmentQuestion = null;
  let tires = null;
  // Tyres / wheels: their own catalogue category (see searchTires). Before the
  // group tree, and also for ТО / article requests (partGroups null).
  if (q.vid && q.ssd) {
    // The AI adds synonyms («шины», «покрышки», «резина»): one search for all of them.
    const tireKws = keywords.filter(kw => tireRequest(kw));
    if (tireKws.length) {
      const reqs = tireKws.map(tireRequest);
      const req = { kind: reqs[0].kind, season: (reqs.find(r => r.season) || {}).season || null };
      try {
        const t = await searchTires(vehicle, tireKws.join(', '), req, opts.customerText);
        if (t) {
          tires = t.info;
          groupSearched.push(`${t.info.category} › ${t.info.units.join(', ')}`);
          if (t.rows.length) { byGroup.push(...t.rows); tireKws.forEach(k => viaGroup.add(k)); }
        }
      } catch (err) {
        if (err instanceof LaximoSkip) { const out = []; out.searchFailed = true; out.searched = []; return out; }
        console.error('[laximo] tyre search failed, using the word search:', err.message);
      }
    }
  }
  if (GROUPS_ENABLED() && partGroups != null && keywords.filter(k => !viaGroup.has(k)).length && q.vid && q.ssd) {
    try {
      const tree = await getGroupTree(q);
      const plan = new Map(); // gid -> { node, kws }
      for (const kw of keywords) {
        if (viaGroup.has(kw)) continue; // tyres: already found in their category
        const node = findGroupFor(kw, tree);
        if (!node) {
          // Which group names would fit? (helps to add a GROUP_RULES line)
          const noun = (stripAxleWords(String(kw).toLowerCase()).match(/[а-яё]{4,}/) || [])[0];
          const near = noun ? tree.filter(n => n.name.toLowerCase().includes(noun.slice(0, 5))).slice(0, 8).map(n => `${n.name} (${n.gid})`) : [];
          console.log(`[laximo] no catalog group for "${kw}" -- word search${near.length ? `; groups with "${noun.slice(0, 5)}": ${near.join(', ')}` : ''}`);
          continue;
        }
        if (!plan.has(node.gid)) plan.set(node.gid, { node, kws: [] });
        plan.get(node.gid).kws.push(kw);
      }
      // Cross-sell (owner 30.10): pads -> also the wear sensors (the catalog says
      // they are required with new pads). One extra group page, cached like the rest.
      const padsPlanned = [...plan.values()].some(x => PADS_GROUP_RE.test(x.node.name));
      const sensorNode = padsPlanned && opts.crossSell !== false && ![...plan.values()].some(x => SENSOR_GROUP_RE.test(x.node.name))
        ? tree.find(n => SENSOR_GROUP_RE.test(n.name)) : null;
      for (const { node, kws } of [...plan.values()].slice(0, MAX_GROUPS)) {
        progress.step(`Открываю раздел каталога ${progress.quote(node.name)}`);
        let page = narrowUnits(await getGroupPage(vehicle, node.gid), kws, opts.customerText);
        const eq = equipmentFilters(page.units);
        // The customer's answer applies to every page that offers that option,
        // even where it is not the question we would ask.
        const ans = opts.equipment && page.units.flatMap(u => u.filters).find(f => f.label === opts.equipment.label);
        if (ans && /^(да|нет)$/.test(opts.equipment.answer)) {
          const opt = ans.options.find(o => o.text.toLowerCase() === opts.equipment.answer);
          if (opt) {
            progress.step(`Учитываю комплектацию: ${progress.quote(opts.equipment.label)} — ${opts.equipment.answer}`);
            page = narrowUnits(await getGroupPage(vehicle, node.gid, opt.value), kws, opts.customerText);
          }
        } else if (eq.length && !vehicle.vin && !equipmentQuestion && !(opts.equipment && opts.equipment.label === eq[0].label)) {
          equipmentQuestion = { label: eq[0].label };
        }
        const rows = groupRows(page.units, q);
        groupSearched.push(`${node.name} (gid ${node.gid})`);
        console.log(`[laximo] group "${node.name}" (gid ${node.gid}) for "${kws.join(', ')}": ${rows.length} part(s)` + (ans ? `, ${opts.equipment.label} = ${opts.equipment.answer}` : '') + (eq.length ? `; equipment: ${eq.map(e => e.label).join(', ')}` : ''));
        if (!rows.length) continue;
        for (const r of rows) {
          const axle = axleOf(r.oem);
          byGroup.push({ ...r, query: kws.join(', '), ...(axle ? { axle } : {}) });
        }
        kws.forEach(k => viaGroup.add(k));
      }
      if (sensorNode) {
        progress.step('Проверяю датчики износа — они нужны при замене колодок');
        try {
          let page = await getGroupPage(vehicle, sensorNode.gid);
          const ans = opts.equipment && page.units.flatMap(u => u.filters).find(f => f.label === opts.equipment.label);
          const opt = ans && /^(да|нет)$/.test(opts.equipment.answer) && ans.options.find(o => o.text.toLowerCase() === opts.equipment.answer);
          if (opt) page = await getGroupPage(vehicle, sensorNode.gid, opt.value);
          for (const r of groupRows(page.units, q)) {
            if (!/датчик/i.test(r.name || '') || r.alternative) continue;
            const axle = axleOf(r.oem) || (/пер/i.test(r.unit || '') ? 'передняя ось' : /(^|[^а-яё])(зд|задн)/i.test(r.unit || '') ? 'задняя ось' : null);
            crossSell.push({ ...r, crossSell: 'sensor', ...(axle ? { axle } : {}) });
          }
          console.log(`[laximo] cross-sell group "${sensorNode.name}" (gid ${sensorNode.gid}): ${crossSell.length} sensor row(s)`);
        } catch (err) {
          if (err instanceof LaximoSkip) throw err;
          console.error('[laximo] cross-sell sensors failed:', err.message);
        }
      }
      // Pad paste named in the pad rows («только в комбинации с 83192158851: Паста …»).
      if (padsPlanned && opts.crossSell !== false) {
        for (const r of byGroup) for (const v of Object.values(r.notes || {})) {
          const m = String(v).match(/(\d{11})\s*:\s*(Паста[^(;]*)/i);
          if (m && !crossSell.some(c => c.oem === m[1])) crossSell.push({ oem: m[1], name: m[2].trim(), crossSell: 'paste', notes: {} });
        }
      }
    } catch (err) {
      console.error('[laximo] group search failed, using the word search:', err.message);
      if (err instanceof LaximoSkip) {
        const out = []; out.searchFailed = true; out.searched = []; return out;
      }
    }
  }
  const rest = keywords.filter(k => !viaGroup.has(k));
  const restNames = searchNames && Object.fromEntries(Object.entries(searchNames).filter(([k]) => rest.includes(clean(k).toLowerCase())));
  const restGroups = partGroups && Object.fromEntries(Object.entries(partGroups).filter(([k]) => rest.includes(clean(k).toLowerCase())));
  const words = rest.length ? await searchPartsByWords(vehicle, rest, restNames, restGroups) : Object.assign([], { searched: [], droppedByGroup: {} });
  const seen = new Set(byGroup.map(r => r.oem));
  const merged = [...byGroup, ...words.filter(r => !seen.has(r.oem))];
  return Object.assign(merged, {
    searched: [...groupSearched.map(g => `группа: ${g}`), ...(words.searched || [])],
    droppedByGroup: words.droppedByGroup || {},
    searchFailed: !!words.searchFailed,
    broad: words.broad,
    ...(groupSearched.length ? { groupSearched } : {}),
    ...(equipmentQuestion ? { equipmentQuestion } : {}),
    ...(opts.equipment ? { equipmentAnswer: opts.equipment } : {}),
    ...(crossSell.length ? { crossSell } : {}),
    ...(tires ? { tires } : {}),
  });
}

async function searchPartsByWords(vehicle, partKeywords, searchNames, partGroups) {
  const keywords = [...new Set((partKeywords || []).map(k => clean(k).toLowerCase()).filter(Boolean))];
  const names = normalizeSearchNames(searchNames, keywords);
  // Group check only when the caller asks for it (a plain part request):
  // partGroups undefined/null -> off (ТО kit route, article check, old callers).
  const groups = partGroups == null ? {} : resolveGroups(partGroups, keywords);
  const groupOk = kw => p => {
    const allowed = groups[kw];
    if (!allowed) return true;          // no rule for this keyword
    const g = bmwGroupOf(p);
    return g === null || allowed.has(g); // other makes' numbers: not checked here
  };
  const dropped = {}; // group -> rows dropped (log)
  const groupFilter = kws => rows => rows.filter(p => {
    if (kws.some(kw => groupOk(kw)(p))) return true;
    const g = bmwGroupOf(p); dropped[g] = (dropped[g] || 0) + 1;
    return false;
  });

  // One search per distinct FIRST catalog name (falls back to the customer's
  // keyword): "масляный/воздушный/салонный фильтр" -> one "фильтр" search.
  const plan = [];
  for (const kw of keywords) {
    const q = (names[kw] && names[kw][0]) || kw;
    const entry = plan.find(e => e.query === q);
    if (entry) entry.keywords.push(kw); else plan.push({ query: q, keywords: [kw] });
  }
  const planned = plan.slice(0, MAX_QUERIES);
  const queries = []; // everything searched (so later steps don't repeat a search)

  const parts = [];
  const seen = new Set();
  const add = (rows, tag, broad) => {
    for (const p of rows) {
      const dedupeKey = `${p.oem}|${p.unit}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const axle = axleOf(p.oem);
      parts.push({ ...p, query: tag, ...(broad ? { broad: true } : {}), ...(axle ? { axle } : {}) });
    }
  };
  // Brake pads (30.10): any customer phrase with «колодк» («передние тормозные
  // колодки», «колодки») keeps brake rows only -- before, only the bare word
  // «накладки» had this rule, and «передние тормозные колодки» let a wiper
  // «Накладка оси стеклоочистителя» through the «накладка» search.
  const keepFor = kw => QUERY_KEEP[kw] || (/колодк/.test(kw) ? isBrakePart : null) || (isSuspensionDamperQuery(kw) ? keepStrut : (() => true)); // keepStrut: suspension groups, no stabilizer links
  const keepAny = kws => p => kws.some(kw => keepFor(kw)(p));
  const empty = []; // customer keywords that found nothing
  let stopped = false;
  let failed = false; // a search errored (site block, pause...) -- "nothing found" would be wrong
  const foundBy = new Set(); // searches that returned rows
  const run = async (q, kws) => {
    queries.push(q);
    let rows = groupFilter(kws)(await searchDetails(vehicle, q)).filter(keepAny(kws));
    if (kws.some(isSuspensionDamperQuery)) rows = rows.map(markBumpStop);
    if (rows.length) foundBy.add(q);
    return rows;
  };
  for (const { query: q, keywords: kws } of planned) {
    try {
      const rows = await run(q, kws);
      add(rows, kws.join(', '), !kws.includes(q));
      if (!rows.length) empty.push(...kws);
    } catch (err) {
      failed = true;
      console.error('[laximo] details search failed:', q, err.message);
      if (err instanceof LaximoSkip || breakerOpen()) { stopped = true; break; } // paused/budget/breaker: don't try the other keywords
    }
  }

  // The AI's first catalog name found nothing: its other names, then the
  // customer's own words (the old behaviour), before the fixed fallbacks below.
  let retries = 0;
  for (const kw of stopped ? [] : [...empty]) {
    const tries = [...(names[kw] || []).slice(1), kw].filter(n => !queries.includes(n));
    for (const n of tries) {
      if (retries >= MAX_NAME_RETRIES + 1) break;
      retries++;
      try {
        const rows = await run(n, [kw]);
        console.log(`[laximo] "${kw}": also "${n}" -> ${rows.length} part(s)`);
        if (rows.length) { add(rows, kw, n !== kw); empty.splice(empty.indexOf(kw), 1); break; }
      } catch (err) {
        console.error('[laximo] details search failed:', n, err.message);
        if (err instanceof LaximoSkip || breakerOpen()) { stopped = true; break; }
      }
    }
    if (stopped) break;
  }

  // Other spelling of an abbreviation ("ОГ" <-> "отработавших газов") for keywords that found nothing.
  let spellings = 0;
  for (const q of stopped ? [] : [...empty]) {
    for (const v of spellingVariants(q)) {
      if (spellings >= 2 || queries.includes(v)) continue;
      spellings++;
      try {
        queries.push(v);
        const rows = groupFilter([q])(await searchDetails(vehicle, v)).filter(QUERY_KEEP[q] || (() => true));
        console.log(`[laximo] "${q}" found nothing; other spelling "${v}" -> ${rows.length} part(s)`);
        if (rows.length) { add(rows, q); empty.splice(empty.indexOf(q), 1); break; }
      } catch (err) {
        console.error('[laximo] details search failed:', v, err.message);
        if (err instanceof LaximoSkip || breakerOpen()) { stopped = true; break; }
      }
    }
  }

  // Suspension shock absorbers: also the front struts («Амортизаторная стойка»).
  const damperQ = keywords.find(isSuspensionDamperQuery);
  if (damperQ && !stopped) {
    family:
    for (const names of DAMPER_FAMILY) {
      if (names.some(n => foundBy.has(n))) continue; // this kind was already found by an earlier search
      for (const name of names) {
        if (queries.includes(name)) continue;
        try {
          queries.push(name);
          const rows = groupFilter([damperQ])(await searchDetails(vehicle, name)).filter(keepStrut).map(markBumpStop);
          console.log(`[laximo] "${damperQ}": also "${name}" -> ${rows.length} part(s)`);
          add(rows, damperQ, true);
          if (rows.length && empty.includes(damperQ)) empty.splice(empty.indexOf(damperQ), 1);
          if (rows.length) break; // next kind
        } catch (err) {
          console.error('[laximo] details search failed:', name, err.message);
          if (err instanceof LaximoSkip || breakerOpen()) { stopped = true; break family; }
        }
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
        queries.push(name);
        const rows = groupFilter([q])(await searchDetails(vehicle, name)).filter(fb.keep);
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
  if (Object.keys(dropped).length) {
    console.log(`[laximo] group check (${keywords.join(', ')} -> ${keywords.map(k => groups[k] ? [...groups[k]].join('/') : 'any').join(', ')}): dropped ` +
      Object.entries(dropped).map(([g, n]) => `${g}×${n}`).join(', '));
  }
  mixed.searched = queries;
  mixed.droppedByGroup = dropped;
  mixed.broad = parts.some(p => p.broad);
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
async function findPartsByVin(rawVin, partKeywords, searchNames, partGroups, opts = {}) {
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

  let vehicle;
  try {
    vehicle = await findVehicleByVin(vin);
  } catch (err) {
    if (err instanceof LaximoSkip) { console.warn(`[laximo] VIN path skipped -- ${err.message}`); return { unavailable: err.message }; }
    throw err;
  }
  if (!vehicle) return null;
  progress.step(`Нашёл автомобиль по VIN: ${[vehicle.brand, vehicle.name, vehicle.modelCode].filter(Boolean).join(' ')}`);

  const parts = await searchPartsForVehicle(vehicle, partKeywords, searchNames, partGroups, opts);
  const { query, cacheId, ...vehiclePublic } = vehicle;
  return { vehicle: vehiclePublic, vehicleQuery: query, parts, searchFailed: !!parts.searchFailed, searched: parts.searched, broad: parts.broad, droppedByGroup: parts.droppedByGroup, vehicleCacheId: cacheId, ...(parts.tires ? { tires: parts.tires } : {}) };
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
  return (' ' + latinizeCodes(s).toLowerCase().replace(/ё/g, 'е').replace(/[’'`´]/g, '')
    .replace(/[^a-zа-я0-9]+/g, ' ').trim() + ' ')
    // Old BMW naming / customer spelling of all-wheel drive (live 04.11: «530xi» on a
    // G30 LCI got ALPINA buttons instead of 530iX): 530xi, 530i xdrive, 530 xdrive -> 530ix.
    .replace(/ (\d{3})(i|d|e)? ?x ?drive /g, (m, n, f) => ` ${n}${f || 'i'}x `)
    .replace(/ (\d{3})x(i|d)/g, ' $1$2x')
    .replace(/ (\d{2})x(i|d) /g, ' $1$2x ');
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
      // Digit families ("5"): also a BMW model designation of that family --
      // 530i, 520d, 540xi, 118i, 330e (30.10, live: "BMW 530i" matched no series,
      // so the compatibility table asked the generation and Laximo asked again).
      // A latin letter suffix is required, so a power figure ("150 лс") or a
      // year never counts.
      return /[a-z]/.test(f) ? textHas(ntext, f) : (textHas(ntext, `bmw ${f}`) || textHas(ntext, `бмв ${f}`) || textHas(ntext, `${f} series`) || textHas(ntext, `${f} серия`) || textHas(ntext, `${f}er`) || new RegExp(` ${f} [a-z]?\\d{2,3}[a-z]* `).test(ntext) || new RegExp(` m?${f}\\d{2}[a-z]{1,3} `).test(ntext));
    });
    // Up to 32 generation buttons (30.10: the 5 Series alone has more than 16
    // generations/LCI variants in Laximo, so a "5 530i" request used to fall back
    // to the compatibility table's generation question and then get Laximo's own
    // question again). One complete list from Laximo beats two questions.
    if (fam.length && fam.length <= 32) return askAmong(fam);
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

  // 6. A model number the customer wrote («530») narrows the list (530d, 530i, 530iX…)
  //    before all options are offered.
  if (/модел/.test(name)) {
    const p = partialWizardPick(step, ntext);
    if (p && (p.choice || (p.ask && p.ask.length < opts.length))) return p;
  }
  return opts.length <= 16 ? askAmong(opts) : null;
}

// Words that appear in many option names and say nothing about the model.
// «bmw» (live 04.11, «Диалоги» ✗ ×4): every request says «BMW 530…», and on the G30 LCI only
// the ALPINA options contain the word («BMW ALPINA B5») -> only ALPINA buttons were offered.
const GENERIC_WORDS = new Set(['qu', 'lim', 'the', 'and', 'with', 'для', 'без', 'bmw', 'бмв', 'mini']);

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
  if (API()) {
    const first = laximoApi.parseWizard(await api('GetWizard2', { Locale: 'ru_RU', Catalog: cat, ssd: '' })).wizardSteps[0];
    if (!first || !first.options.length) throw new Error('API wizard: first step empty');
    const step = { conditionId: first.conditionId, name: first.name || 'Серия', options: first.options };
    await cacheSet(seriesCacheKey(cat), stripTokens(step));
    return step;
  }
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
    let data;
    if (API()) {
      data = { ...laximoApi.parseWizard(await api('GetWizard2', { Locale: 'ru_RU', Catalog: live.cat, ssd: opt.key })), vehicles: [] };
    } else {
      const raw = await fetchPage(wizardAjaxUrl(live.cat, opt.key), { kind: 'wizard', ajax: true });
      try { data = JSON.parse(raw); } catch { throw new Error(`wizard step did not return JSON (got: ${clean(raw).slice(0, 80)})`); }
    }
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
  if (hits.length > 1) return { ask: hits.slice(0, 32).map(o => o.value) };
  // Near miss (30.10, live: «535i F30» -- the F30 has a 335i, no 535i): a model
  // token one character away from an option ("535i" ~ "335i") -> offer those
  // options as buttons; never picked silently.
  const nearWords = new Set(opts.flatMap(o => norm(o.value).split(/\s+/)).filter(w => /\d/.test(w) && tokens.some(t => t.length >= 4 && w.length === t.length && editDistance(w, t) === 1)));
  // ... plus their longer forms (335i -> 335iX, the xDrive version).
  const near = opts.filter(o => norm(o.value).split(/\s+/).some(w => [...nearWords].some(n => w === n || (w.startsWith(n) && w.length - n.length <= 2))));
  if (near.length) return { ask: near.slice(0, 32).map(o => o.value) };
  // Up to 32 buttons (was 16; live 30.10: 3' F30 LCI has 33 «Модель» options and
  // the bot gave up on the catalog, so no group search, no axle question).
  if (opts.length <= 32) return { ask: opts.map(o => o.value) };
  return modelGroups(opts);
}

/**
 * A long «Модель» list (live 29.10: X4 G02 has 20 options -- 7 models, each
 * also listed with engine codes: «X4 20dX», «X4 20dX B47», «X4 20dX B47D»…):
 * more than 16 buttons is too many, and the bot used to give up there, so the
 * catalog search was skipped. Ask the model without the engine code instead;
 * a click on «X4 30iX» then narrows to its engine variants on the next turn
 * (scoring in pickWizardOption), or picks it outright when there is one.
 * Engine-code tokens: an upper-case letter or two + digits (+ 1-2 letters/digits):
 * B47, B47D, XD5O, B58C, N57S. The first word (the series, «X4») always stays.
 */
function modelGroups(opts) {
  const base = v => String(v).split(/\s+/).filter((t, i) => i === 0 || !/^[A-Z]{1,2}\d{1,2}[A-Z0-9]{0,2}$/.test(t)).join(' ');
  const bases = [...new Set(opts.map(o => base(o.value)))];
  return bases.length >= 2 && bases.length <= 32 ? { ask: bases } : null; // 32 since 30.10 (was 16)
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
  if (first && first.choice) progress.step(`Каталог: ${series.name || 'серия'} — ${first.choice.value}`);
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
      return pick ? { needsChoice: { step: step.name, options: pick.ask, chosen: [...path] } } : null;
    }
    path.push(pick.choice.value);
    progress.step(`Каталог: ${step.name} — ${pick.choice.value}`);
    data = await stepsAfter(path, live);
  }

  // v3: v2 also cached EMPTY lists (e.g. a page fetched during a site
  // block), which then failed that car instantly for days. Empty is never cached now.
  const vehKey = `modelveh3:${cat}:${path.join('|')}`;
  let candidates = await cacheGet(vehKey);
  if (candidates === undefined || !Array.isArray(candidates) || !candidates.length) {
    await liveTo(live, path); // fresh token for exactly this path
    candidates = API()
      ? apiDistinctLabels(laximoApi.parseVehicles(await api('FindVehicleByWizard2', { Locale: 'ru_RU', Catalog: cat, ssd: live.token, Localized: 'true' })))
      : parseVinResults(await fetchPage(
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
  if (query === undefined && API()) {
    const id = `${v.catalog || cat}:${v.vid}`;
    const capped = await laximoApi.carCounter.check(carStore, id);
    if (capped) { console.warn(`[laximo] model path stopped -- ${capped}`); return null; }
    query = { c: v.catalog || cat, vid: v.vid, ssd: v.ssd };
    await laximoApi.carCounter.add(carStore, id);
    await cacheSet(pageKey, query);
  }
  if (query === undefined) {
    query = parseVehiclePage(await fetchPage(v.href.replace(/&amp;/g, '&'))).query;
    if (!query || !query.vid || !query.ssd) throw new Error('vehicle page parsed without vid/ssd -- markup changed?');
    await cacheSet(pageKey, query);
  }
  progress.step(`Нашёл автомобиль в каталоге: ${[v.brand || brandName, v.name, v.modelCode].filter(Boolean).join(' ')}`);
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
  if (starts.length) return { name: starts[0].name, catalog: starts[0].catalog };
  // Typos (30.10: customer wrote "MBW X5", the model passed "MBW" through and the
  // model path found nothing): closest catalog name or alias by edit distance
  // (a swap of two neighbouring letters counts as one edit). Up to 1 edit for
  // names of 3-5 letters, 2 for longer ones; only a single unambiguous winner.
  if (b.length < 3) return null;
  const maxEd = b.length <= 5 ? 1 : 2;
  const cands = [
    ...byName.map(x => ({ key: x.n, target: x.n })),
    ...Object.entries(BRAND_ALIASES).map(([k, v]) => ({ key: k, target: v })),
  ];
  let best = null, bestD = Infinity, tie = false;
  for (const c of cands) {
    const d = editDistance(b, c.key);
    if (d < bestD) { best = c; bestD = d; tie = false; }
    else if (d === bestD && best && c.target !== best.target) tie = true;
  }
  if (!best || bestD > maxEd || tie) return null;
  const hit = byName.filter(x => x.n === best.target || x.n.startsWith(best.target + ' ')).sort((a, z) => a.n.length - z.n.length)[0];
  if (hit) console.log(`[laximo] brand "${brandText}" read as "${hit.name}" (typo)`);
  return hit ? { name: hit.name, catalog: hit.catalog } : null;
}

/** Optimal string alignment distance: insert/delete/replace + adjacent swap. */
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

async function getBrandList() {
  const cached = await cacheGet('brands:v1');
  if (cached && cached.at && Date.now() - cached.at < BRANDS_TTL_MS && cached.list.length) return cached.list;
  try {
    const list = API() ? laximoApi.parseCatalogs(await api('ListCatalogs', { Locale: 'ru_RU' })) : parseBrandList(await fetchPage('/laximo', { kind: 'wizard' }));
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
async function findPartsByModel(customerText, partKeywords, brandText, searchNames, partGroups, opts = {}) {
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

  const parts = await searchPartsForVehicle(found.vehicle, partKeywords, searchNames, partGroups, opts);
  const { query, cacheId, ...vehiclePublic } = found.vehicle;
  return { vehicle: vehiclePublic, vehicleQuery: query, parts, searchFailed: !!parts.searchFailed, searched: parts.searched, broad: parts.broad, droppedByGroup: parts.droppedByGroup, vehicleCacheId: cacheId, ...(parts.tires ? { tires: parts.tires } : {}) };
}

module.exports = {
  findPartsByVin,
  unavailableReason,
  breakerOpen,
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
  groupsForKeyword, resolveGroups, BMW_MAIN_GROUPS, axleOf,
  getPartDiagram, getPartSchemaInfo, getServiceUnit,
  parseUnitDiagram,
  parseSchemaAnswer,
  noteLabel,
  expandAbbr,
  spellingVariants,
  pickWizardOption,
  partialWizardPick,
  modelGroups,
  norm,
  parseBrandList,
  resolveBrand,
  parseGroupTree, parseGroupPage, findGroupFor, matchGroupByWords, equipmentFilters, groupRows,
  bmwNumber, isBrakePart,
  tireRequest, tireSizes, rimDiameters, tireUnitKind, pickTireUnits, filterTireRows,
  rememberServiceUnit,
  source: () => (API() ? 'api' : 'site'),
  apiCarsThisMonth: () => laximoApi.carCounter.list(carStore),
  pickSchemaBlock, withAutoAnswers, narrowUnits,
  _cacheSet: (k, v) => cacheSet(k, v), // tests
  findVehicleByVin, getGroupTree, // scripts/check-catalog-coverage.js
};
