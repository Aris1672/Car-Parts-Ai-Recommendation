/**
 * lib/chatEvents.js — what happened in a chat, for the dashboard's
 * "Подбор" tab: the customer's first message, the product cards the agent
 * showed, and which cards the customer opened ("Подробнее →").
 *
 * Stored in Postgres table `chat_events` (created automatically on first
 * use, same pattern as laximo_cache in lib/laximo.js), one row per event:
 *   type 'first_message'  data { text }
 *   type 'products_shown' data { products: [{ article, name, brand, price, url }] }
 *   type 'product_open'   data { article, name, url }
 *   type 'laximo'         data { status: 'ok'|'blocked', reason, mode, vehicle }
 *                         -- one per message that needed the original catalog;
 *                         api/chat.js returns it with the reply ("catalog") and
 *                         the widget logs it (the session exists only after the
 *                         first reply).
 * Kept outside api/ so server.js never mounts it as a route.
 */

const { Client } = require('pg');

const DB_URL = process.env.SUPABASE_DB_URL;

async function withDb(fn) {
  if (!DB_URL) throw new Error('SUPABASE_DB_URL not set');
  const client = new Client({ connectionString: DB_URL, ssl: false });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = withDb(c => c.query(`
      create table if not exists chat_events (
        id         bigserial primary key,
        session_id text not null,
        type       text not null,
        data       jsonb,
        created_at timestamptz not null default now()
      );
      create index if not exists idx_chat_events_session on chat_events (session_id);
      create index if not exists idx_chat_events_created on chat_events (created_at);
    `)).catch(err => {
      tableReady = null; // retry on a later call
      throw err;
    });
  }
  return tableReady;
}

// ─── Validation: this is fed by a public endpoint, so trust nothing ─────────
const TYPES = new Set(['first_message', 'products_shown', 'product_open', 'laximo']);
const SESSION_RE = /^s_\d{10,16}_[a-z0-9]{1,12}$/i;

const str = (v, max) => (v == null ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, max) || null);
const url = v => {
  const s = str(v, 500);
  return s && /^https?:\/\//i.test(s) ? s : null;
};
const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);

function cleanProduct(p) {
  if (!p || typeof p !== 'object') return null;
  const article = str(p.article, 40);
  if (!article) return null;
  return { article, name: str(p.name, 200), brand: str(p.brand, 60), price: num(p.price), url: url(p.url) };
}

/** Returns a clean { session_id, type, data } or null if invalid. */
function validateEvent(body) {
  const { session_id, type, data } = body || {};
  if (!SESSION_RE.test(String(session_id || '')) || !TYPES.has(type)) return null;
  const d = data && typeof data === 'object' ? data : {};
  if (type === 'first_message') {
    const text = str(d.text, 1000);
    // placement: where the chat was started -- the homepage block ("inline")
    // or the bubble. Older widgets send none.
    const placement = d.placement === 'inline' || d.placement === 'bubble' ? d.placement : null;
    return text ? { session_id, type, data: placement ? { text, placement } : { text } } : null;
  }
  if (type === 'products_shown') {
    const products = (Array.isArray(d.products) ? d.products : []).slice(0, 12).map(cleanProduct).filter(Boolean);
    return products.length ? { session_id, type, data: { products } } : null;
  }
  if (type === 'laximo') {
    if (d.status !== 'ok' && d.status !== 'blocked') return null;
    const mode = d.mode === 'vin' || d.mode === 'model' ? d.mode : null;
    return { session_id, type, data: { status: d.status, reason: str(d.reason, 200), mode, vehicle: str(d.vehicle, 120) } };
  }
  // product_open
  const p = cleanProduct(d);
  return p ? { session_id, type, data: { article: p.article, name: p.name, url: p.url } } : null;
}

async function insertEvent(ev) {
  await ensureTable();
  await withDb(c => c.query(
    'insert into chat_events (session_id, type, data) values ($1, $2, $3)',
    [ev.session_id, ev.type, JSON.stringify(ev.data)]
  ));
}

/**
 * Events of the last `days` days, grouped per chat session, newest first.
 * Joined with chat_sessions for the session's date/time and manager flag.
 */
async function listSessions(days) {
  await ensureTable();
  const rows = await withDb(async c => {
    const r = await c.query(`
      select e.session_id, e.type, e.data, e.created_at,
             s.date as s_date, s.time as s_time, s.manager_requested
        from chat_events e
        left join chat_sessions s on s.session_id = e.session_id
       where e.created_at >= $1
       order by e.created_at asc
       limit 20000`, [new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()]);
    return r.rows;
  });
  return groupEvents(rows);
}

/** Pure: event rows (oldest first) -> per-session summaries (newest first). */
function groupEvents(rows) {
  const bySession = new Map();
  for (const r of rows) {
    let s = bySession.get(r.session_id);
    if (!s) {
      s = {
        session_id: r.session_id,
        started_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
        date: r.s_date ? (r.s_date instanceof Date ? r.s_date.toISOString().slice(0, 10) : String(r.s_date)) : null,
        time: r.s_time ? String(r.s_time) : null,
        manager_requested: !!r.manager_requested,
        first_message: null,
        shown: new Map(),  // article -> { article, name, brand, price, url, times }
        opened: new Map(), // article -> { article, name, url, times }
        laximo: { ok: 0, blocked: 0, reasons: [], vehicle: null },
      };
      bySession.set(r.session_id, s);
    }
    const d = r.data || {};
    if (r.type === 'first_message' && !s.first_message) s.first_message = d.text || null;
    if (r.type === 'products_shown') {
      for (const p of d.products || []) {
        const cur = s.shown.get(p.article);
        if (cur) cur.times++;
        else s.shown.set(p.article, { ...p, times: 1 });
      }
    }
    if (r.type === 'laximo') {
      if (d.status === 'ok') { s.laximo.ok++; if (d.vehicle) s.laximo.vehicle = d.vehicle; }
      else { s.laximo.blocked++; if (d.reason && !s.laximo.reasons.includes(d.reason)) s.laximo.reasons.push(d.reason); }
    }
    if (r.type === 'product_open' && d.article) {
      const cur = s.opened.get(d.article);
      if (cur) cur.times++;
      else s.opened.set(d.article, { article: d.article, name: d.name || null, url: d.url || null, times: 1 });
    }
  }
  return [...bySession.values()]
    .map(s => {
      const opened = [...s.opened.values()];
      const shown = [...s.shown.values()].map(p => ({ ...p, opened: s.opened.has(p.article) }));
      // A card opened but not logged as shown (e.g. widget cached from an
      // older version): still list it so no click goes missing.
      for (const o of opened) if (!s.shown.has(o.article)) shown.push({ ...o, brand: null, price: null, times: 0, opened: true });
      // One status per chat for the dashboard dot: blocked (any message the
      // catalog couldn't answer) > ok > none (the catalog wasn't needed).
      const lx = s.laximo;
      const laximo = { status: lx.blocked ? 'blocked' : lx.ok ? 'ok' : 'none', ok: lx.ok, blocked: lx.blocked, reasons: lx.reasons.slice(0, 3), vehicle: lx.vehicle };
      return { ...s, shown, opened, laximo };
    })
    .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
}

module.exports = { validateEvent, insertEvent, listSessions, groupEvents };
