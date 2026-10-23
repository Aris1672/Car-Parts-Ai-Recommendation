/**
 * lib/abcpCatalogCheck.js -- for the dashboard's "Нет фото" tab: does ABCP's
 * own product catalog have a photo / description for each missing article?
 *
 * Read-only: uses `articles/info` (general interface, API-administrator,
 * one article per call, ~0.7 s apart) via lib/abcpOrders.js. (The batch
 * method cp/articles/info/batch needs the paid ABCP add-on "Каталоги в
 * товарных группах через API" -- not enabled, see README session 18.) Results are stored in Postgres table
 * `abcp_article_info` (created automatically), so opening the tab costs no
 * ABCP requests. A run checks, most-requested first:
 *   - articles never checked,
 *   - articles checked more than RECHECK_DAYS ago that had no photo / weren't found.
 * Runs in the background inside the server process; progress via status().
 * Kept outside api/ so server.js never mounts it as a route.
 */

const { Client } = require('pg');
const abcp = require('./abcpOrders');

const DB_URL = process.env.SUPABASE_DB_URL;
// ABCP limits requests per minute/hour/day per API account (error 303,
// seen 23.10 at 0.7 s per call) -- and the SAME account serves the chat's
// order-status lookups. So: slow pace, a daily cap, and on 303 a pause of
// an hour with automatic resume.
const PAUSE_MS = Number(process.env.ABCP_CHECK_PAUSE_MS || 3000);       // between calls
const DAILY_LIMIT = Number(process.env.ABCP_CHECK_DAILY_LIMIT || 500);  // articles per Moscow day
const BLOCK_PAUSE_MS = 60 * 60 * 1000;                                  // after error 303
const SAVE_EVERY = 25;           // write results to the DB in chunks
const MAX_CONSECUTIVE_ERRORS = 5;
const RECHECK_DAYS = 7;
const IMG_BASE = 'https://imgcdn.abcp.ru/p/';

/** Placeholder codes from the old compatibility table: 00000000000, 01104444444... */
function isJunkCode(code) {
  const c = String(code || '').replace(/[\s\-.]/g, '');
  return c.length < 5 || /^0+$/.test(c) || /(\d)\1{6,}/.test(c);
}

async function withDb(fn) {
  if (!DB_URL) throw new Error('SUPABASE_DB_URL not set');
  const client = new Client({ connectionString: DB_URL, ssl: false });
  try { await client.connect(); return await fn(client); }
  finally { await client.end().catch(() => {}); }
}

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = withDb(c => c.query(`
      create table if not exists abcp_article_info (
        vendor_code  text primary key,
        brand        text,
        found        boolean not null default false,
        images_count integer not null default 0,
        image        text,
        descr        text,
        checked_at   timestamptz not null default now()
      );
    `)).catch(err => { tableReady = null; throw err; });
  }
  return tableReady;
}

/** vendor_code -> { found, imagesCount, image (full URL), descr, brand, checkedAt } */
async function getInfoMap() {
  await ensureTable();
  const rows = await withDb(async c => (await c.query('select * from abcp_article_info')).rows);
  return new Map(rows.map(r => [r.vendor_code, {
    found: r.found, imagesCount: r.images_count, image: r.image ? IMG_BASE + r.image : null,
    descr: r.descr, brand: r.brand, checkedAt: r.checked_at,
  }]));
}

// Brand for the ABCP lookup: the part's maker isn't stored, so take the
// customer's car brand (BMW parts -> "BMW"). Wrong guesses show as "не найден".
const BRAND_FOR_ABCP = { 'бмв': 'BMW', 'bmw': 'BMW', 'mini': 'BMW', 'мини': 'BMW', 'ауди': 'Audi', 'audi': 'Audi',
  'мерседес': 'Mercedes-Benz', 'mercedes': 'Mercedes-Benz', 'mercedes-benz': 'Mercedes-Benz',
  'фольксваген': 'VW', 'volkswagen': 'VW', 'vw': 'VW', 'порше': 'Porsche', 'porsche': 'Porsche',
  'land rover': 'Land Rover', 'ленд ровер': 'Land Rover', 'range rover': 'Land Rover' };
function brandOf(row) {
  const ex = Array.isArray(row.vehicle_examples) ? row.vehicle_examples : [];
  const b = String((ex.find(v => v && v.brand) || {}).brand || '').trim().toLowerCase();
  return BRAND_FOR_ABCP[b] || (b ? b.charAt(0).toUpperCase() + b.slice(1) : 'BMW');
}

const normNum = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Description from a card: cp batch has `descr`; articles/info keeps it in properties. */
function descrOf(c) {
  if (!c) return null;
  const p = c.properties && typeof c.properties === 'object' ? c.properties : {};
  const v = c.descr || c.description || p.descr || p.description || p['Описание'] || p['Наименование'] || p['Название'];
  return v ? String(Array.isArray(v) ? v[0] : v).slice(0, 300) : null;
}

/** Pure: API response + requested batch -> rows to store. Exported for tests. */
function parseBatch(response, batch) {
  const cards = Array.isArray(response) ? response : (response && typeof response === 'object' ? Object.values(response) : []);
  const byNum = new Map();
  for (const c of cards) if (c && c.number) {
    const k = normNum(c.number);
    // Prefer the card with photos if ABCP returns several for one number.
    const prev = byNum.get(k);
    if (!prev || (Number(c.images_count) || 0) > (Number(prev.images_count) || 0)) byNum.set(k, c);
  }
  return batch.map(({ code, brand }) => {
    const c = byNum.get(normNum(code));
    const images = c && Array.isArray(c.images) ? [...c.images].sort((a, b) => (a.order || 0) - (b.order || 0)) : [];
    return {
      vendor_code: code,
      brand,
      found: !!c,
      images_count: c ? (Number(c.images_count) || images.length) : 0,
      image: images[0] ? images[0].name : null,
      descr: descrOf(c),
    };
  });
}

// ─── Job state (one run at a time) ──────────────────────────────────────────
const job = { running: false, total: 0, done: 0, found: 0, withPhoto: 0, startedAt: null, finishedAt: null, error: null,
  resumeAt: null, remaining: null, dailyLimit: DAILY_LIMIT };
function status() { return { ...job }; }

// Automatic continuation (after a 303 block or the daily cap).
let resumeTimer = null;
function scheduleResume(ms) {
  clearTimeout(resumeTimer);
  job.resumeAt = new Date(Date.now() + ms).toISOString();
  resumeTimer = setTimeout(() => { start().catch(e => console.error('[abcp-check] auto-resume failed:', e.message)); }, ms);
  if (resumeTimer.unref) resumeTimer.unref();
  console.log(`[abcp-check] will continue automatically at ${job.resumeAt}`);
}

/** Start of the current day in Moscow (UTC+3, no DST). */
function moscowMidnight(now = Date.now()) {
  const MSK = 3 * 3600 * 1000;
  return new Date(Math.floor((now + MSK) / 86400000) * 86400000 - MSK);
}

async function checkedToday() {
  await ensureTable();
  return withDb(async c => Number((await c.query('select count(*) as n from abcp_article_info where checked_at >= $1', [moscowMidnight().toISOString()])).rows[0].n));
}

async function selectDue() {
  await ensureTable();
  return withDb(async c => (await c.query(`
    select m.vendor_code, m.vehicle_examples, m.request_count
      from missing_articles m
      left join abcp_article_info i on i.vendor_code = m.vendor_code
     where coalesce(m.resolved, false) = false
       and (i.vendor_code is null
            or ((not i.found or i.images_count = 0) and i.checked_at < now() - interval '${RECHECK_DAYS} days'))
     order by m.request_count desc nulls last`)).rows);
}

async function saveRows(rows) {
  if (!rows.length) return;
  const vals = [], args = [];
  rows.forEach((r, i) => {
    const o = i * 6;
    vals.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},now())`);
    args.push(r.vendor_code, r.brand, r.found, r.images_count, r.image, r.descr);
  });
  await withDb(c => c.query(`
    insert into abcp_article_info (vendor_code, brand, found, images_count, image, descr, checked_at)
    values ${vals.join(',')}
    on conflict (vendor_code) do update set brand = excluded.brand, found = excluded.found,
      images_count = excluded.images_count, image = excluded.image, descr = excluded.descr, checked_at = now()`, args));
}

/** Start a background run. Returns the status right away. */
async function start() {
  if (job.running) return status();
  if (!abcp.enabled()) throw new Error('ABCP API not configured (ABCP_API_* env vars)');
  const allDue = (await selectDue()).filter(r => !isJunkCode(r.vendor_code));
  const left = Math.max(0, DAILY_LIMIT - await checkedToday());
  const due = allDue.slice(0, left);
  clearTimeout(resumeTimer);
  Object.assign(job, { running: true, total: due.length, done: 0, found: 0, withPhoto: 0, startedAt: new Date().toISOString(),
    finishedAt: null, error: null, resumeAt: null, remaining: allDue.length });
  console.log(`[abcp-check] start: ${due.length} of ${allDue.length} due article(s) (daily limit ${DAILY_LIMIT}, ${left} left today)`);
  if (!due.length && allDue.length) {
    job.running = false; job.finishedAt = new Date().toISOString(); job.error = 'DAILY_LIMIT';
    scheduleResume(moscowMidnight().getTime() + 86400000 + 5 * 60000 - Date.now());
    return status();
  }
  (async () => {
    let pending = [], errorsInRow = 0;
    const flush = async () => { if (pending.length) { const rows = pending; pending = []; await saveRows(rows); } };
    try {
      for (let i = 0; i < due.length; i++) {
        const item = { code: due[i].vendor_code, brand: brandOf(due[i]) };
        let row;
        try {
          const response = await abcp.apiGet('articles/info', { brand: item.brand, number: item.code, format: 'bnhi', locale: 'ru_RU' });
          row = parseBatch(response, [item])[0];
          errorsInRow = 0;
        } catch (err) {
          if (err.abcpCode == 301) { row = parseBatch([], [item])[0]; errorsInRow = 0; }   // not in ABCP's catalog
          else if (err.abcpCode == 3 || err.abcpCode == 103 || err.abcpCode == 303) throw err; // not available / rate-limited: stop
          else {
            console.error(`[abcp-check] ${item.code}: ${err.message}`);
            if (++errorsInRow >= MAX_CONSECUTIVE_ERRORS) throw err;
            continue; // stays unchecked, picked up by the next run
          }
        }
        pending.push(row);
        job.done++;
        job.remaining = Math.max(0, job.remaining - 1);
        if (row.found) job.found++;
        if (row.images_count > 0) job.withPhoto++;
        if (pending.length >= SAVE_EVERY) await flush();
        if (i + 1 < due.length) await new Promise(r => setTimeout(r, PAUSE_MS));
      }
      await flush();
      console.log(`[abcp-check] done: ${job.done} checked, ${job.found} found in ABCP, ${job.withPhoto} with photo, ${job.remaining} left`);
      if (job.remaining > 0) {  // daily cap reached: continue tomorrow
        job.error = 'DAILY_LIMIT';
        scheduleResume(moscowMidnight().getTime() + 86400000 + 5 * 60000 - Date.now());
      }
    } catch (err) {
      // Error 3 "Unknown operation" / 103 "Доступ запрещён": method not available for this site.
      if (err.abcpCode == 303) {
        job.error = 'RATE_LIMITED';
        scheduleResume(BLOCK_PAUSE_MS);
      } else {
        job.error = err.abcpCode == 3 || err.abcpCode == 103 ? 'NOT_ENABLED' : err.message;
      }
      console.error('[abcp-check] stopped:', err.message);
    } finally {
      await flush().catch(e => console.error('[abcp-check] save failed:', e.message)); // keep what was checked
      job.running = false;
      job.finishedAt = new Date().toISOString();
    }
  })();
  return status();
}

module.exports = { start, status, moscowMidnight, getInfoMap, isJunkCode, parseBatch, brandOf, IMG_BASE };
