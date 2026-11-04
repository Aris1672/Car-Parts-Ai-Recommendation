/**
 * lib/chatTurns.js — every chat message and what the bot did with it, for the
 * ADMIN-ONLY dashboard tab «Диалоги» (owner 04.11: "we do not know what answer
 * each visitor gets"). One row per /api/chat call:
 *   customer's last message (phones/emails already masked, lib/pii.js),
 *   what the code understood (car, part), the catalog trace (the [laximo] /
 *   [catalog] / [chat] / DIAG log lines of that message), the reply text,
 *   buttons, card numbers, status, time.
 * The owner marks each reply ✓ / ✗ with a note; ✓ chats become replay tests
 * (scripts/replay-chats.js, later), ✗ chats are the fix list.
 *
 * Table chat_turns in our Postgres (created on first use). Rows older than
 * CHAT_TURNS_KEEP_DAYS (default 180) are deleted once a day.
 * Best effort: a database error never breaks a chat reply.
 */

const { Client } = require('pg');

const DB_URL = process.env.SUPABASE_DB_URL;
const KEEP_DAYS = Math.max(7, Number(process.env.CHAT_TURNS_KEEP_DAYS || 180));
const enabled = () => !!DB_URL && String(process.env.CHAT_TURNS || '').toLowerCase() !== 'false';

async function withDb(fn) {
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
      create table if not exists chat_turns (
        id          bigserial primary key,
        conv_id     text,
        session_id  text,
        created_at  timestamptz not null default now(),
        user_text   text,
        reply       text,
        buttons     jsonb,
        cards       jsonb,
        understood  jsonb,
        trace       jsonb,
        status      int,
        ms          int,
        review      text,
        review_note text,
        reviewed_at timestamptz
      );
      create index if not exists idx_chat_turns_conv on chat_turns (conv_id);
      create index if not exists idx_chat_turns_created on chat_turns (created_at);
    `)).catch(err => { tableReady = null; throw err; });
  }
  return tableReady;
}

let lastCleanup = 0;
async function cleanup() {
  if (Date.now() - lastCleanup < 24 * 3600 * 1000) return;
  lastCleanup = Date.now();
  await withDb(c => c.query(`delete from chat_turns where created_at < now() - ($1 || ' days')::interval`, [String(KEEP_DAYS)]));
}

const cut = (v, n) => (v == null ? null : String(v).slice(0, n));
const ID_RE = /^[a-z0-9_]{3,60}$/i;

/** Splits the reply's in-band blocks: text, buttons, card numbers. */
function parseReply(reply) {
  const r = String(reply || '');
  let buttons = null, cards = null;
  const b = r.match(/<<<BUTTONS>>>([\s\S]*?)<<<END_BUTTONS>>>/);
  if (b) { try { buttons = JSON.parse(b[1]); } catch { buttons = null; } }
  const p = r.match(/<<<PRODUCTS>>>([\s\S]*?)<<<END_PRODUCTS>>>/);
  if (p) {
    try {
      const arr = JSON.parse(p[1]);
      if (Array.isArray(arr)) cards = arr.map(x => ({ article: x.article || null, name: cut(x.name, 120), price: x.price || null, diagram: !!x.diagram })).slice(0, 30);
    } catch { cards = null; }
  }
  const text = r.replace(/<<<[A-Z_]+>>>[\s\S]*?<<<END_[A-Z_]+>>>/g, '').replace(/<<<[A-Z_]+>>>/g, '').trim();
  return { text, buttons, cards };
}

/** Saves one turn. Never throws. */
async function record(t) {
  if (!enabled()) return;
  try {
    await ensureTable();
    const { text, buttons, cards } = parseReply(t.reply);
    await withDb(c => c.query(
      `insert into chat_turns (conv_id, session_id, user_text, reply, buttons, cards, understood, trace, status, ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [ID_RE.test(t.convId || '') ? t.convId : null, ID_RE.test(t.sessionId || '') ? t.sessionId : null,
        cut(t.userText, 2000), cut(text || t.error || '', 6000),
        buttons ? JSON.stringify(buttons) : null, cards ? JSON.stringify(cards) : null,
        t.understood ? JSON.stringify(t.understood) : null, t.trace && t.trace.length ? JSON.stringify(t.trace) : null,
        t.status || null, t.ms || null]));
    cleanup().catch(() => {});
  } catch (err) {
    console.error('[turns] save failed:', err.message);
  }
}

/** Conversations of the last `days`, newest first, each with its turns. */
async function listConversations({ days = 7, filter = 'all', limit = 200 } = {}) {
  await ensureTable();
  const rows = await withDb(c => c.query(
    `select id, coalesce(conv_id, 'turn_' || id) as conv, session_id, created_at, user_text, reply, buttons, cards,
            understood, trace, status, ms, review, review_note
       from chat_turns where created_at > now() - ($1 || ' days')::interval
      order by created_at asc`, [String(days)]));
  const convs = new Map();
  for (const r of rows.rows) {
    if (!convs.has(r.conv)) convs.set(r.conv, { conv_id: r.conv, session_id: null, started: r.created_at, last: r.created_at, turns: [] });
    const c = convs.get(r.conv);
    c.session_id = c.session_id || r.session_id;
    c.last = r.created_at;
    c.turns.push(r);
  }
  let list = [...convs.values()].map(c => ({ ...c, flags: flagsOf(c.turns) }));
  if (filter === 'problems') list = list.filter(c => c.flags.length);
  if (filter === 'unreviewed') list = list.filter(c => c.turns.some(t => !t.review));
  if (filter === 'bad') list = list.filter(c => c.turns.some(t => t.review === 'bad'));
  if (filter === 'good') list = list.filter(c => c.turns.some(t => t.review === 'ok'));
  return list.sort((a, b) => new Date(b.last) - new Date(a.last)).slice(0, limit);
}

/** Automatic warning flags for a conversation (shown as badges). */
function flagsOf(turns) {
  const f = new Set();
  for (const t of turns) {
    const tr = (t.trace || []).join('\n');
    if (t.status && t.status >= 400) f.add('ошибка');
    if (/no catalog group/.test(tr)) f.add('нет группы');
    if (/"oemCount":0/.test(tr) && /"found":true/.test(tr)) f.add('ничего не найдено');
    if (/compatibility table used|Laximo blocked/.test(tr)) f.add('каталог недоступен');
    if (/менеджер/i.test(t.reply || '') && !(t.cards && t.cards.length)) f.add('менеджер');
    if (t.review === 'bad') f.add('✗ отмечено');
  }
  const last = turns[turns.length - 1];
  if (last && Array.isArray(last.buttons) && last.buttons.length) f.add('ушёл после вопроса');
  return [...f];
}

async function setReview(id, review, note) {
  await ensureTable();
  const r = review === 'ok' || review === 'bad' ? review : null;
  await withDb(c => c.query(
    'update chat_turns set review = $2, review_note = $3, reviewed_at = case when $2::text is null then null else now() end where id = $1',
    [id, r, cut(note, 1000)]));
}

module.exports = { enabled, record, listConversations, setReview, parseReply, flagsOf };
