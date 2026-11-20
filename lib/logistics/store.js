/**
 * lib/logistics/store.js — the logistics watcher's tables in our own Postgres
 * (SUPABASE_DB_URL, self-hosted in Russia: orders hold customers' names and
 * contacts, 152-ФЗ). Created on first use.
 *
 *   logistics_orders   one row per ABCP order: summary (jsonb), stage, health,
 *                      first_seen, updated_at, finished_at (done/cancelled)
 *   logistics_alerts   one row per (order, position, kind) while it is open:
 *                      created_at, resolved_at, notified_at, ack_by, ack_at
 *   logistics_notes    managers' notes on an order (author, text, created_at)
 *   logistics_actions  audit log of everything done by people or the agent
 *                      (phase 1: only «ack» and «note»; phase 2+ adds writes)
 */

const { Pool } = require('pg');

const DB_URL = process.env.SUPABASE_DB_URL;

// 08.11: one shared pool for all logistics code (was: a new connection per query — hundreds per
// watcher pass, «timeout expired» at login and pressure on the same DB the chat bot uses).
let pool = null;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: DB_URL, ssl: false,
      max: Number(process.env.LOGISTICS_DB_POOL) || 4,
      connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000, query_timeout: 30000,
    });
    pool.on('error', err => console.error('[logistics] db pool error:', err.message));
  }
  return pool;
}

async function withDb(fn) {
  if (!DB_URL) throw new Error('SUPABASE_DB_URL not set');
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

let ready = null;
function ensureTables() {
  if (!ready) {
    ready = withDb(c => c.query(`
      create table if not exists logistics_orders (
        number      text primary key,
        summary     jsonb not null,
        stage       text not null,
        health      text not null default 'ok',
        order_date  timestamptz,
        first_seen  timestamptz not null default now(),
        updated_at  timestamptz not null default now(),
        finished_at timestamptz
      );
      create index if not exists idx_logistics_orders_stage on logistics_orders (stage);
      create table if not exists logistics_alerts (
        id          bigserial primary key,
        number      text not null,
        position    text not null default '',
        kind        text not null,
        text        text,
        detail      text,
        since       timestamptz,
        created_at  timestamptz not null default now(),
        resolved_at timestamptz,
        notified_at timestamptz,
        ack_by      text,
        ack_at      timestamptz
      );
      create unique index if not exists uq_logistics_alert_open
        on logistics_alerts (number, position, kind) where resolved_at is null;
      create index if not exists idx_logistics_alerts_number on logistics_alerts (number);
      create table if not exists logistics_notes (
        id         bigserial primary key,
        number     text not null,
        author     text,
        text       text not null,
        created_at timestamptz not null default now()
      );
      create index if not exists idx_logistics_notes_number on logistics_notes (number);
      create table if not exists logistics_prepayment_reminders (
        order_number text primary key,
        initial_sent_at timestamptz not null,
        status text not null default 'pending' check (status in ('pending', 'started', 'sent', 'paid', 'uncertain')),
        attempted_at timestamptz,
        details jsonb
      );
      create table if not exists logistics_actions (
        id         bigserial primary key,
        number     text,
        actor      text not null,
        action     text not null,
        details    jsonb,
        created_at timestamptz not null default now()
      );
    `)).catch(err => { ready = null; throw err; });
  }
  return ready;
}

const toTs = ms => (ms ? new Date(ms).toISOString() : null);

/**
 * Save one pass of the watcher: upsert every described order, open new
 * alerts, resolve alerts that are gone. Returns the alerts opened now.
 */
// Last saved state per order (in memory): unchanged orders are not written again (08.11: 1 600 upserts per pass).
const lastSaved = new Map();

async function savePass(described, now = Date.now()) {
  await ensureTables();
  const { ts } = require('./stages');
  return withDb(async c => {
    const opened = [];
    // all open alerts in ONE query
    const { rows: openRows } = await c.query('select id, number, position, kind, detail from logistics_alerts where resolved_at is null');
    const openBy = new Map();
    for (const r of openRows) { if (!openBy.has(r.number)) openBy.set(r.number, []); openBy.get(r.number).push(r); }
    let written = 0;
    await c.query('begin');
    try {
      for (const o of described) {
        const finished = ['done', 'cancelled'].includes(o.stage);
        const { alerts, ...summary } = o;
        const sig = JSON.stringify([summary, o.stage, o.health]);
        if (lastSaved.get(o.number) !== sig) {
          await c.query(
            `insert into logistics_orders (number, summary, stage, health, order_date, updated_at, finished_at)
             values ($1, $2, $3, $4, $5, now(), $6)
             on conflict (number) do update set summary = excluded.summary, stage = excluded.stage,
               health = excluded.health, order_date = excluded.order_date, updated_at = now(),
               finished_at = case when excluded.finished_at is null then null
                                  else coalesce(logistics_orders.finished_at, excluded.finished_at) end`,
            [o.number, summary, o.stage, o.health, toTs(ts(o.date)), finished ? toTs(now) : null]);
          written++;
        }
        const open = openBy.get(o.number) || [];
        const want = new Map(alerts.map(a => [`${a.position || ''}|${a.kind}`, a]));
        for (const r of open) {
          const a = want.get(`${r.position}|${r.kind}`);
          if (!a) await c.query('update logistics_alerts set resolved_at = now() where id = $1', [r.id]);
          else if ((a.detail || null) !== (r.detail || null)) await c.query('update logistics_alerts set detail = $2 where id = $1', [r.id, a.detail || null]);
        }
        const have = new Set(open.map(r => `${r.position}|${r.kind}`));
        for (const [key, a] of want) {
          if (have.has(key)) continue;
          const { rows } = await c.query(
            `insert into logistics_alerts (number, position, kind, text, detail, since)
             values ($1, $2, $3, $4, $5, $6) on conflict do nothing returning id`,
            [o.number, a.position || '', a.kind, a.text, a.detail || null, toTs(a.since)]);
          if (rows[0]) opened.push({ id: rows[0].id, number: o.number, ...a });
        }
      }
      await c.query('commit');
      for (const o of described) { const { alerts, ...summary } = o; lastSaved.set(o.number, JSON.stringify([summary, o.stage, o.health])); }
    } catch (err) {
      await c.query('rollback').catch(() => {});
      throw err;
    }
    opened.written = written;
    return opened;
  });
}

/** Open orders that left ABCP's active list (archived) -> finished; their alerts resolved. */
async function finishMissing(activeNumbers) {
  await ensureTables();
  return withDb(async c => {
    const { rows } = await c.query(
      `update logistics_orders set finished_at = now(), updated_at = now(),
              summary = summary || '{"archived": true}'::jsonb
        where finished_at is null and not (number = any($1::text[]))
        returning number`, [activeNumbers]);
    if (rows.length) await c.query('update logistics_alerts set resolved_at = now() where resolved_at is null and number = any($1::text[])', [rows.map(r => r.number)]);
    return rows.map(r => r.number);
  });
}

/** Orders for the board: everything not finished + finished in the last N days. */
async function listOrders(finishedDays = 7) {
  await ensureTables();
  return withDb(async c => {
    const { rows } = await c.query(
      `select o.number, o.summary, o.stage, o.health, o.first_seen, o.updated_at, o.finished_at,
              coalesce((select json_agg(json_build_object('id', a.id, 'kind', a.kind, 'text', a.text, 'detail', a.detail,
                         'position', a.position, 'since', a.since, 'created_at', a.created_at, 'ack_by', a.ack_by) order by a.created_at)
                        from logistics_alerts a where a.number = o.number and a.resolved_at is null), '[]') as alerts,
              (select count(*)::int from logistics_notes n where n.number = o.number) as notes
         from logistics_orders o
        where o.finished_at is null or o.finished_at > now() - ($1::int * interval '1 day')
        order by o.order_date desc nulls last
        limit 2000`, [finishedDays]);
    return rows;
  });
}

async function getOrder(number) {
  await ensureTables();
  return withDb(async c => {
    const { rows } = await c.query('select * from logistics_orders where number = $1', [number]);
    if (!rows[0]) return null;
    const alerts = (await c.query('select * from logistics_alerts where number = $1 order by created_at desc limit 100', [number])).rows;
    const notes = (await c.query('select * from logistics_notes where number = $1 order by created_at', [number])).rows;
    const actions = (await c.query('select * from logistics_actions where number = $1 order by created_at desc limit 100', [number])).rows;
    return { ...rows[0], alerts, notes, actions };
  });
}

async function addNote(number, author, text) {
  await ensureTables();
  return withDb(async c => {
    await c.query('insert into logistics_notes (number, author, text) values ($1, $2, $3)', [number, author, text]);
    await c.query('insert into logistics_actions (number, actor, action, details) values ($1, $2, $3, $4)', [number, author, 'note', { text }]);
  });
}

async function ackAlert(id, author) {
  await ensureTables();
  return withDb(async c => {
    const { rows } = await c.query('update logistics_alerts set ack_by = $2, ack_at = now() where id = $1 returning number, kind', [id, author]);
    if (rows[0]) await c.query('insert into logistics_actions (number, actor, action, details) values ($1, $2, $3, $4)', [rows[0].number, author, 'ack', { alert: id, kind: rows[0].kind }]);
    return !!rows[0];
  });
}

/** Undo «Беру в работу» for every open alert of an order. */
async function unackOrder(number, author) {
  await ensureTables();
  return withDb(async c => {
    const { rowCount } = await c.query('update logistics_alerts set ack_by = null, ack_at = null where number = $1 and resolved_at is null and ack_by is not null', [number]);
    if (rowCount) await c.query('insert into logistics_actions (number, actor, action, details) values ($1, $2, $3, $4)', [number, author, 'unack', { alerts: rowCount }]);
    return rowCount;
  });
}

/** Open alerts not yet pushed to MAX; marks them notified. */
async function takeUnnotified() {
  await ensureTables();
  return withDb(async c => {
    const { rows } = await c.query(
      `update logistics_alerts set notified_at = now()
        where resolved_at is null and notified_at is null and kind not in ('unknown_status', 'loss_small')
        returning id, number, position, kind, text, detail`);
    return rows;
  });
}

/** Stats for the header: open orders by stage, alerts, closed today. */
async function stats() {
  await ensureTables();
  return withDb(async c => {
    const { rows } = await c.query(
      `select
         (select count(*)::int from logistics_orders where finished_at is null) as open,
         (select count(*)::int from logistics_orders where finished_at > now() - interval '1 day') as finished_day,
         (select count(*)::int from logistics_alerts where resolved_at is null and kind not in ('unknown_status', 'loss_small')) as alerts,
         (select count(*)::int from logistics_alerts where resolved_at is null and kind not in ('unknown_status', 'loss_small') and ack_at is null) as alerts_new`);
    return rows[0];
  });
}

let autopilotReady = null;
function ensureAutopilotTable() {
  if (!autopilotReady) autopilotReady = ensureTables().then(() => withDb(c => c.query(`
    create table if not exists logistics_autopilot (
      order_number text primary key,
      registration_status text,
      transferred_order_number text,
      bill_status text,
      first_bill_sent_at timestamptz,
      last_action text,
      details jsonb,
      updated_at timestamptz not null default now()
    );
    alter table logistics_autopilot add column if not exists transferred_order_number text;
    alter table logistics_autopilot add column if not exists first_bill_sent_at timestamptz;
    alter table logistics_autopilot add column if not exists automatic_payment_target text;
    create unique index if not exists uq_logistics_automatic_payment_target
      on logistics_autopilot (automatic_payment_target);
  `))).catch(err => { autopilotReady = null; throw err; });
  return autopilotReady;
}
async function autopilotState(number) {
  await ensureAutopilotTable();
  return withDb(async c => (await c.query('select * from logistics_autopilot where order_number = $1', [String(number)])).rows[0] || null);
}
async function approveInitialBill(number, amount = 2000, details = {}) {
  await ensureAutopilotTable();
  return withDb(async c => {
    const { rows } = await c.query(`
      insert into logistics_autopilot (order_number, last_action, details, updated_at)
      values ($1, 'bill_approved_once', $2, now())
      on conflict (order_number) do update set
        last_action = 'bill_approved_once', details = excluded.details, updated_at = now()
      where coalesce(logistics_autopilot.bill_status, '') not in ('sent', 'started', 'uncertain')
      returning order_number
    `, [String(number), { ...details, orderId: String(number), amount }]);
    return !!rows[0];
  });
}

async function claimInitialBill(number, amount = 2000, targetNumber = number) {
  await ensureAutopilotTable();
  return withDb(async c => {
    const { rows } = await c.query(`
      update logistics_autopilot
      set bill_status = 'started', last_action = 'bill_started',
          details = details || jsonb_build_object('paymentOrderId', $3::text), updated_at = now()
      where order_number = $1 and last_action = 'bill_approved_once'
        and bill_status is null and first_bill_sent_at is null
        and details->>'orderId' = $1 and details->'amount' = to_jsonb($2::int)
        and coalesce(transferred_order_number, order_number) = $3
      returning order_number
    `, [String(number), amount, String(targetNumber)]);
    return !!rows[0];
  });
}

// Own the guest transfer before the browser write; an interrupted transfer is not retried.
async function claimAutomaticTransfer(number) {
  await ensureAutopilotTable();
  return withDb(async c => (await c.query(`
    insert into logistics_autopilot (order_number, registration_status)
    values ($1, 'started')
    on conflict (order_number) do nothing
    returning order_number
  `, [String(number)])).rowCount === 1);
}

async function claimAutomaticInitialBill(number, targetNumber) {
  await ensureAutopilotTable();
  try {
    return await withDb(async c => (await c.query(`
      insert into logistics_autopilot as a
        (order_number, automatic_payment_target, bill_status, last_action, details)
      select $1::text, $2::text, 'started', 'bill_started',
        jsonb_build_object('paymentOrderId', $2::text, 'amount', 2000, 'authorization', 'launch_policy')
      where ($1 = $2 or exists (
        select 1 from logistics_autopilot source
        where source.order_number = $1 and source.registration_status = 'succeeded'
          and source.transferred_order_number = $2
      )) and not exists (
        select 1 from logistics_prepayment_reminders where order_number = $2
      ) and not exists (
        select 1 from logistics_autopilot prior
        where prior.order_number <> $1 and (
          (prior.order_number = $2 and ($1 <> $2)) or prior.transferred_order_number = $1
        )
      )
      on conflict (order_number) do update set
        automatic_payment_target = excluded.automatic_payment_target,
        bill_status = 'started', last_action = 'bill_started',
        details = excluded.details, updated_at = now()
      where a.bill_status is null and a.first_bill_sent_at is null
        and a.last_action = 'registration_succeeded' and a.registration_status = 'succeeded'
        and a.transferred_order_number = $2 and a.details->>'authorization' = 'launch_policy'
      returning order_number
    `, [String(number), String(targetNumber)])).rowCount === 1);
  } catch (error) {
    if (error.code === '23505' && error.constraint === 'uq_logistics_automatic_payment_target') return false;
    throw error;
  }
}

async function autopilotAction(number, action, details = {}) {
  await ensureAutopilotTable();
  const registration = /registration_succeeded/.test(action) ? 'succeeded' : /registration_failed/.test(action) ? 'failed' : null;
  const bill = /bill_email_sent/.test(action) ? 'sent' : /bill_failed/.test(action) ? 'failed' : null;
  const transferred = details && details.newOrderId ? String(details.newOrderId) : null;
  return withDb(async c => c.query(`
    insert into logistics_autopilot (order_number, registration_status, transferred_order_number, bill_status, last_action, details, updated_at, first_bill_sent_at)
    values ($1, $2, $3, $4, $5, $6, now(), case when $4 = 'sent' then now() else null end)
    on conflict (order_number) do update set
      registration_status = coalesce(excluded.registration_status, logistics_autopilot.registration_status),
      transferred_order_number = coalesce(excluded.transferred_order_number, logistics_autopilot.transferred_order_number),
      bill_status = coalesce(excluded.bill_status, logistics_autopilot.bill_status),
      first_bill_sent_at = coalesce(logistics_autopilot.first_bill_sent_at, excluded.first_bill_sent_at),
      last_action = case
        when excluded.last_action = 'registration_succeeded'
         and logistics_autopilot.last_action = 'bill_approved_once'
        then logistics_autopilot.last_action
        else excluded.last_action
      end,
      details = case
        when excluded.last_action = 'registration_succeeded'
         and logistics_autopilot.last_action = 'bill_approved_once'
        then logistics_autopilot.details || excluded.details
        else excluded.details
      end,
      updated_at = now()
  `, [String(number), registration, transferred, bill, action, details]));
}

/** Called only after a new initial bill email was sent; never seeds historical sends. */
async function recordInitialBill(number) {
  await ensureTables();
  return withDb(c => c.query(`
    insert into logistics_prepayment_reminders (order_number, initial_sent_at)
    values ($1, now()) on conflict (order_number) do nothing
  `, [String(number)]));
}

// Require a fixed UTC instant; never fall back to midnight or include the backlog.
function reminderStartAt() {
  const raw = process.env.PREPAYMENT_REMINDERS_START_AT || '';
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw) ? Date.parse(raw) : NaN;
  const normalized = raw.includes('.') ? raw : raw.replace(/Z$/, '.000Z');
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== normalized) {
    throw new Error('PREPAYMENT_REMINDERS_START_AT must be a valid fixed UTC timestamp (YYYY-MM-DDTHH:mm:ssZ)');
  }
  return normalized;
}

async function dueReminders() {
  const startAt = reminderStartAt();
  await ensureTables();
  return withDb(async c => (await c.query(`
    select * from logistics_prepayment_reminders
    where status = 'pending' and initial_sent_at <= now() - interval '65 minutes'
      and initial_sent_at >= $1::timestamptz
    order by initial_sent_at, order_number
  `, [startAt])).rows);
}

/** Atomic claim: started and uncertain reminders are deliberately never retried. */
async function claimReminder(number) {
  const startAt = reminderStartAt();
  await ensureTables();
  return withDb(async c => {
    const { rows } = await c.query(`
      update logistics_prepayment_reminders set status = 'started', attempted_at = now()
      where order_number = $1 and status = 'pending'
        and initial_sent_at <= now() - interval '65 minutes'
        and initial_sent_at >= $2::timestamptz
      returning order_number
    `, [String(number), startAt]);
    return !!rows[0];
  });
}

async function finishReminder(number, status, details = {}) {
  if (!['sent', 'paid', 'uncertain'].includes(status)) throw new Error('Invalid reminder completion status');
  await ensureTables();
  return withDb(c => c.query(`
    update logistics_prepayment_reminders set status = $2, details = $3
    where order_number = $1
      and (( $2 = 'paid' and status = 'pending')
        or ($2 in ('sent', 'uncertain') and status = 'started'))
  `, [String(number), status, details]));
}

module.exports = { unackOrder, ensureTables, savePass, finishMissing, listOrders, getOrder, addNote, ackAlert, takeUnnotified, stats, withDb, autopilotState, autopilotAction, approveInitialBill, claimInitialBill, claimAutomaticTransfer, claimAutomaticInitialBill, recordInitialBill, dueReminders, claimReminder, finishReminder };
