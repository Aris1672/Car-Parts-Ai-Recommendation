/**
 * lib/managerRequests.js — customers' requests to a manager (the widget's
 * request form), stored in our own Postgres: the self-hosted Supabase on
 * assistant_vps_3, in Russia (152-ФЗ: personal data of Russian citizens is
 * stored in Russia). Name / phone / email come from the form only; they are
 * never sent to the LLM.
 *
 * Table manager_requests (created on first use):
 *   id, session_id, name, phone, email, message,
 *   consent_at, consent_policy_url, ip, user_agent,
 *   status ('new' | 'done'), created_at
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
      create table if not exists manager_requests (
        id                 bigserial primary key,
        session_id         text,
        name               text not null,
        phone              text,
        email              text,
        message            text,
        consent_at         timestamptz not null,
        consent_policy_url text,
        ip                 text,
        user_agent         text,
        status             text not null default 'new',
        created_at         timestamptz not null default now()
      );
      create index if not exists idx_manager_requests_created on manager_requests (created_at);
    `)).catch(err => {
      tableReady = null; // retry on a later call
      throw err;
    });
  }
  return tableReady;
}

async function addRequest(r) {
  await ensureTable();
  return withDb(async c => {
    const { rows } = await c.query(
      `insert into manager_requests
         (session_id, name, phone, email, message, consent_at, consent_policy_url, ip, user_agent)
       values ($1, $2, $3, $4, $5, now(), $6, $7, $8)
       returning id`,
      [r.session_id, r.name, r.phone, r.email, r.message, r.consent_policy_url, r.ip, r.user_agent]
    );
    return rows[0].id;
  });
}

async function listRequests(days) {
  await ensureTable();
  return withDb(async c => {
    const { rows } = await c.query(
      `select id, session_id, name, phone, email, message, status, created_at, consent_at
         from manager_requests
        where created_at >= now() - ($1::int * interval '1 day')
        order by created_at desc
        limit 1000`,
      [days]
    );
    return rows;
  });
}

async function setStatus(id, status) {
  await ensureTable();
  return withDb(c => c.query('update manager_requests set status = $2 where id = $1', [id, status]));
}

module.exports = { addRequest, listRequests, setStatus };
