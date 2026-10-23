/**
 * lib/abcpCatalogCheck.js -- for the dashboard's "Нет фото" tab: does ABCP's
 * own product catalog have a photo / description for each missing article?
 *
 * Read-only: uses cp/articles/info/batch (POST, max 100 articles per call)
 * via lib/abcpOrders.js. Results are stored in Postgres table
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
const BATCH = 100;               // API maximum
const PAUSE_MS = 1500;           // between batches -- don't flood ABCP
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
      descr: c && c.descr ? String(c.descr).slice(0, 300) : null,
    };
  });
}

// ─── Job state (one run at a time) ──────────────────────────────────────────
const job = { running: false, total: 0, done: 0, found: 0, withPhoto: 0, startedAt: null, finishedAt: null, error: null };
function status() { return { ...job }; }

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
  const due = (await selectDue()).filter(r => !isJunkCode(r.vendor_code));
  Object.assign(job, { running: true, total: due.length, done: 0, found: 0, withPhoto: 0, startedAt: new Date().toISOString(), finishedAt: null, error: null });
  console.log(`[abcp-check] start: ${due.length} article(s) to check`);
  (async () => {
    try {
      for (let i = 0; i < due.length; i += BATCH) {
        const batch = due.slice(i, i + BATCH).map(r => ({ code: r.vendor_code, brand: brandOf(r) }));
        const response = await abcp.apiPost('cp/articles/info/batch', {
          articles: batch.map(b => ({ number: b.code, brand: b.brand })),
          locale: 'ru_RU',
        });
        const rows = parseBatch(response, batch);
        await saveRows(rows);
        job.done += rows.length;
        job.found += rows.filter(r => r.found).length;
        job.withPhoto += rows.filter(r => r.images_count > 0).length;
        if (i + BATCH < due.length) await new Promise(r => setTimeout(r, PAUSE_MS));
      }
      console.log(`[abcp-check] done: ${job.done} checked, ${job.found} found in ABCP, ${job.withPhoto} with photo`);
    } catch (err) {
      // Error 3 "Unknown operation": cp/articles/info/batch belongs to the paid
      // ABCP add-on "Каталоги в товарных группах через API" (not enabled).
      job.error = err.abcpCode == 3
        ? 'NOT_ENABLED'
        : err.message;
      console.error('[abcp-check] stopped:', err.message);
    } finally {
      job.running = false;
      job.finishedAt = new Date().toISOString();
    }
  })();
  return status();
}

module.exports = { start, status, getInfoMap, isJunkCode, parseBatch, brandOf, IMG_BASE };
