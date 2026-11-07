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

const { Client } = require('pg');

const DB_URL = process.env.SUPABASE_DB_URL;

async function withDb(fn) {
  if (!DB_URL) throw new Error('SUPABASE_DB_URL not set');
  const client = new Client({ connectionString: DB_URL, ssl: false, connectionTimeoutMillis: 10000, query_timeout: 20000 });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
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
      create table if not exists logistics_notes (
        id         bigserial primary key,
        number     text not null,
        author     text,
        text       text not null,
        created_at timestamptz not null default now()
      );
      create index if not exists idx_logistics_notes_number on logistics_notes (number);
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
async function savePass(described, now = Date.now()) {
  await ensureTables();
  return withDb(async c => {
    const opened = [];
    await c.query('begin');
    try {
      for (const o of described) {
        const finished = ['done', 'cancelled'].includes(o.stage);
        const { alerts, ...summary } = o;
        await c.query(
          `insert into logistics_orders (number, summary, stage, health, order_date, updated_at, finished_at)
           values ($1, $2, $3, $4, $5, now(), $6)
           on conflict (number) do update set summary = excluded.summary, stage = excluded.stage,
             health = excluded.health, order_date = excluded.order_date, updated_at = now(),
             finished_at = case when excluded.finished_at is null then null
                                else coalesce(logistics_orders.finished_at, excluded.finished_at) end`,
          [o.number, summary, o.stage, o.health, toTs(require('./stages').ts(o.date)), finished ? toTs(now) : null]
        );
        const keys = alerts.map(a => `${a.position || ''}|${a.kind}`);
        const { rows: open } = await c.query(
          'select id, position, kind from logistics_alerts where number = $1 and resolved_at is null', [o.number]);
        for (const r of open) {
          if (!keys.includes(`${r.position}|${r.kind}`)) await c.query('update logistics_alerts set resolved_at = now() where id = $1', [r.id]);
        }
        for (const a of alerts) {
          const { rows } = await c.query(
            `insert into logistics_alerts (number, position, kind, text, detail, since)
             values ($1, $2, $3, $4, $5, $6)
             on conflict (number, position, kind) where resolved_at is null
             do update set detail = excluded.detail
             returning id, (xmax = 0) as inserted`,
            [o.number, a.position || '', a.kind, a.text, a.detail || null, toTs(a.since)]
          );
          if (rows[0] && rows[0].inserted) opened.push({ id: rows[0].id, number: o.number, ...a });
        }
      }
      await c.query('commit');
    } catch (err) {
      await c.query('rollback').catch(() => {});
      throw err;
    }
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

/** Open alerts not yet pushed to MAX; marks them notified. */
async function takeUnnotified() {
  await ensureTables();
  return withDb(async c => {
    const { rows } = await c.query(
      `update logistics_alerts set notified_at = now()
        where resolved_at is null and notified_at is null and kind <> 'unknown_status'
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
         (select count(*)::int from logistics_alerts where resolved_at is null and kind <> 'unknown_status') as alerts,
         (select count(*)::int from logistics_alerts where resolved_at is null and kind <> 'unknown_status' and ack_at is null) as alerts_new`);
    return rows[0];
  });
}

module.exports = { ensureTables, savePass, finishMissing, listOrders, getOrder, addNote, ackAlert, takeUnnotified, stats, withDb };
