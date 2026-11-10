/**
 * lib/logistics/shadow.js — «Агент vs менеджер» (shadow mode, READ-ONLY).
 *
 * Nobody has to use the dashboard. In every watcher pass:
 *   1. a paid / part-paid (or forgotten) position that is still «new» and not
 *      recorded yet -> the agent looks up the offers NOW and stores what it
 *      would choose (same rules as «Нужно ваше решение»: delivery promise,
 *      5 % switch margin, trusted suppliers, suspicious prices …);
 *   2. a recorded position that moved to the supplier (or further) -> store
 *      the supplier and purchase price the MANAGER actually used;
 *   3. cancelled -> outcome «cancelled».
 * The statistics page (/logistics/stats) compares the two; arrival dates come
 * from logistics_pos_history (status history the watcher already loads).
 *
 * ABCP budget: one search/articles per new position (cached 20 min),
 * at most LOGISTICS_SHADOW_PER_PASS (default 20) per pass.
 */
const stages = require('./stages');
const suppliers = require('./suppliers');
const { withDb, ensureTables } = require('./store');

const PER_PASS = Number(process.env.LOGISTICS_SHADOW_PER_PASS) || 20;
const MOVED = ['supplier', 'transit', 'stock', 'shipped', 'done'];

let ready = null;
function ensureShadowTable() {
  if (!ready) {
    ready = ensureTables().then(() => withDb(c => c.query(`
      create table if not exists logistics_shadow (
        position_id      text primary key,
        number           text not null,
        article          text,
        brand            text,
        description      text,
        quantity         int,
        price_out        numeric,          -- customer price per unit
        order_date       timestamptz,
        cur_supplier     text,             -- in the order when the agent looked (the customer's / manager's first choice)
        cur_supplier_id  text,
        cur_price_in     numeric,
        promised_hours   int,
        agent_supplier   text,
        agent_supplier_id text,
        agent_price_in   numeric,
        agent_days       int,
        agent_trusted    boolean,
        agent_kept       boolean,          -- agent agreed with the supplier in the order
        agent_why        text,
        offers_count     int,
        picked_at        timestamptz not null default now(),
        mgr_supplier     text,             -- what the manager actually ordered
        mgr_supplier_id  text,
        mgr_price_in     numeric,
        ordered_at       timestamptz,
        outcome          text              -- null (waiting) | ordered | cancelled
      );
      create index if not exists idx_shadow_picked on logistics_shadow (picked_at);
      alter table logistics_shadow add column if not exists retro boolean not null default false;
      alter table logistics_shadow add column if not exists mgr_reason text;
      alter table logistics_shadow add column if not exists mgr_reason_note text;
      alter table logistics_shadow add column if not exists reason_by text;
      alter table logistics_shadow add column if not exists reason_at timestamptz;
    `))).catch(err => { ready = null; throw err; });
  }
  return ready;
}

const iso = ms => (ms ? new Date(ms).toISOString() : null);
const sameSupplier = (a, aId, b, bId) => suppliers.sameSup(a, aId, b, bId);

/** Pure: which positions need an agent pick now. Exported for tests. */
function toPick(described, known, now = Date.now()) {
  // 08.11: unpaid orders too (most new orders start unpaid; the manager may order after a deposit) — the pick is
  // only an observation. Unpaid ones only if created in the last LOGISTICS_SHADOW_DAYS (14) — skip abandoned ones.
  const freshDays = Number(process.env.LOGISTICS_SHADOW_DAYS) > 0 ? Number(process.env.LOGISTICS_SHADOW_DAYS) : 14;
  const out = [];
  for (const o of described) {
    if (['done', 'cancelled'].includes(o.stage)) continue;
    const pay = o.payState || stages.payStateOf(o);
    const forgotten = (o.alerts || []).some(a => a.kind === 'forgotten');
    const created = stages.ts(o.date);
    const fresh = created && now - created <= freshDays * 86400000;
    if (pay === 'unpaid' && !forgotten && !fresh) continue;
    for (const p of o.positions) {
      if (!p.id || known.has(p.id)) continue;
      if (!['new', 'payment'].includes(stages.stageOfStatus(p.status))) continue;
      out.push({ o, p });
    }
  }
  return out.sort((a, b) => (stages.ts(b.o.date) || 0) - (stages.ts(a.o.date) || 0));
}

/** Pure: positions recorded earlier whose manager decision is now visible. Exported for tests. */
function toResolve(described, waiting) {
  const out = [];
  for (const o of described) for (const p of o.positions) {
    if (!p.id || !waiting.has(p.id)) continue;
    const st = stages.stageOfStatus(p.status);
    if (MOVED.includes(st)) out.push({ o, p, outcome: 'ordered' });
    else if (st === 'cancelled') out.push({ o, p, outcome: 'cancelled' });
  }
  return out;
}

async function pickFor(o, p, { retro = false } = {}) {
  const all = await suppliers.offersFor(p.number, p.brand || 'BMW', p.quantity || 1, false, { supplier: p.supplier, supplierId: p.supplierId });
  // 10.11: never record a pick made without the shop's supplier history (it judged autoeuro.ru «suspicious») — retry next pass
  if (all.noHistory) throw new Error('supplier history not available — pick postponed');
  const { slowerThanPromised } = require('./decisions');
  // retro: judge as at the moment of the decision -> the customer's delivery promise still applies in full
  const allowed = all.filter(x => !slowerThanPromised(p, x, retro ? Date.now() : stages.ts(o.date)));
  const list = suppliers.preferCurrent(allowed, { supplier: p.supplier, supplierId: p.supplierId, priceOut: p.price, priceIn: p.priceIn });
  const best = list[0] || null;
  const why = best ? suppliers.explainPick(list, { supplier: p.supplier, supplierId: p.supplierId, priceIn: p.priceIn }).join(' · ') : 'предложений нет';
  return { best, why, count: all.length };
}

/** Called by the watcher after each pass. */
async function step(described) {
  await ensureShadowTable();
  const rows = await withDb(async c => (await c.query('select position_id, outcome from logistics_shadow')).rows);
  const known = new Set(rows.map(r => r.position_id));
  const waiting = new Set(rows.filter(r => !r.outcome).map(r => r.position_id));

  let picked = 0, resolved = 0;
  for (const { o, p } of toPick(described, known).slice(0, PER_PASS)) {
    let r;
    try { r = await pickFor(o, p); } catch (err) { console.error('[shadow] offers failed:', err.message); break; }
    const b = r.best;
    await withDb(c => c.query(
      `insert into logistics_shadow (position_id, number, article, brand, description, quantity, price_out, order_date,
         cur_supplier, cur_supplier_id, cur_price_in, promised_hours,
         agent_supplier, agent_supplier_id, agent_price_in, agent_days, agent_trusted, agent_kept, agent_why, offers_count)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) on conflict do nothing`,
      [p.id, o.number, p.number, p.brand, p.description, p.quantity || 1, p.price || null, iso(stages.ts(o.date)),
       p.supplier, p.supplierId, p.priceIn || null, p.deadlineMaxHours || p.deadlineHours || null,
       b ? b.supplier : null, b ? b.supplierId : null, b ? (b.priceIn || b.price) : null, b ? b.daysMax : null,
       b ? !!b.trusted : null, b ? !!(b.keptCurrent || sameSupplier(b.supplier, b.supplierId, p.supplier, p.supplierId)) : null, r.why, r.count]));
    picked++;
  }
  const resolve = toResolve(described, waiting);
  if (resolve.length) await withDb(async c => { for (const { o, p, outcome } of resolve) {
    await c.query(
      `update logistics_shadow set outcome = $2, mgr_supplier = $3, mgr_supplier_id = $4, mgr_price_in = $5, ordered_at = now()
        where position_id = $1 and outcome is null`,
      [p.id, outcome, outcome === 'ordered' ? p.supplier : null, outcome === 'ordered' ? p.supplierId : null, outcome === 'ordered' ? (p.priceIn || null) : null]);
    resolved++;
  } });
  return { picked, resolved };
}

/** Rows for the statistics page (+ arrival from the status history). */
async function rows(days = 60) {
  await ensureShadowTable();
  return withDb(async c => (await c.query(
    `select s.*, h.arrived_at, h.ordered_at as hist_ordered_at, h.refused
       from logistics_shadow s
       left join logistics_pos_history h on h.position_id = s.position_id
      where s.picked_at > now() - ($1::int * interval '1 day')
      order by s.picked_at desc limit 5000`, [days])).rows).catch(async err => {
    // logistics_pos_history may not exist yet on a fresh DB
    if (!/logistics_pos_history/.test(err.message)) throw err;
    return withDb(async c => (await c.query(`select * from logistics_shadow where picked_at > now() - ($1::int * interval '1 day') order by picked_at desc limit 5000`, [days])).rows);
  });
}

// ─── «Ретро-проверка за N дней» (owner 10.11) ─────────────────────────────
// Positions of orders created in the last N days that managers ALREADY ordered: the agent picks with TODAY's
// offers (prices / stock may differ from the day of the decision -> rows marked retro, shown separately).
const backfill = { running: false, total: 0, done: 0, skipped: 0, errors: 0, startedAt: null, finishedAt: null, days: 0 };

/** Pure: retro candidates from the board rows (logistics_orders). Exported for tests. */
function retroCandidates(boardRows, known, days, now = Date.now()) {
  const out = [];
  for (const r of boardRows) {
    const sm = r.summary || {};
    const created = stages.ts(sm.date);
    if (!created || now - created > days * 86400000) continue;
    for (const p of sm.positions || []) {
      if (!p.id || known.has(p.id) || !p.supplier) continue;
      if (!MOVED.includes(stages.stageOfStatus(p.status))) continue; // the manager has decided
      if (suppliers.isOwnStock(p.supplier)) continue;
      out.push({ o: sm, p });
    }
  }
  return out;
}

async function runBackfill(boardRows, days, actor) {
  if (backfill.running) return { already: true, ...backfill };
  await ensureShadowTable();
  const known = new Set((await withDb(async c => (await c.query('select position_id from logistics_shadow')).rows)).map(r => r.position_id));
  const list = retroCandidates(boardRows, known, days);
  Object.assign(backfill, { running: true, total: list.length, done: 0, skipped: 0, errors: 0, startedAt: new Date().toISOString(), finishedAt: null, days });
  console.log(`[shadow] retro check started by ${actor}: ${list.length} position(s) from the last ${days} day(s)`);
  (async () => {
    for (const { o, p } of list) {
      try {
        const r = await pickFor(o, p, { retro: true });
        const b = r.best;
        if (!b) { backfill.skipped++; continue; }
        await withDb(c => c.query(
          `insert into logistics_shadow (position_id, number, article, brand, description, quantity, price_out, order_date,
             cur_supplier, cur_supplier_id, cur_price_in, promised_hours,
             agent_supplier, agent_supplier_id, agent_price_in, agent_days, agent_trusted, agent_kept, agent_why, offers_count,
             mgr_supplier, mgr_supplier_id, mgr_price_in, ordered_at, outcome, retro)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$9,$10,$11,$21,'ordered',true) on conflict do nothing`,
          [p.id, o.number, p.number, p.brand, p.description, p.quantity || 1, p.price || null, iso(stages.ts(o.date)),
           p.supplier, p.supplierId, p.priceIn || null, p.deadlineMaxHours || p.deadlineHours || null,
           b.supplier, b.supplierId, b.priceIn || b.price, b.daysMax ?? null, !!b.trusted, !!b.keptCurrent || suppliers.sameSup(b.supplier, b.supplierId, p.supplier, p.supplierId), r.why, r.count,
           iso(stages.ts(p.statusDate)) || new Date().toISOString()]));
        backfill.done++;
      } catch (err) {
        backfill.errors++;
        console.error('[shadow] retro position failed:', err.message);
        if (/history not available/.test(err.message)) await new Promise(res => setTimeout(res, 5000));
      }
      await new Promise(res => setTimeout(res, 400)); // gentle on ABCP search (limit 900 / min)
    }
    backfill.running = false; backfill.finishedAt = new Date().toISOString();
    console.log(`[shadow] retro check finished: ${backfill.done} recorded, ${backfill.skipped} without offers, ${backfill.errors} error(s)`);
  })();
  return { started: true, ...backfill };
}

// 11.11 (owner): don't copy the manager — learn WHY he chose differently; frequent reasons become rules.
const REASONS = {
  can_wait: 'дешевле достаточно — клиент подождёт',
  no_trust: 'не доверяю этому поставщику',
  one_shipment: 'остальные детали заказа у того же поставщика (одна доставка)',
  fake_stock: 'наличие на сайте не настоящее / цена не та',
  relationship: 'договорённость или бонус у поставщика',
  customer: 'так попросил клиент',
  agent_right: 'агент прав — в следующий раз выберу так',
  other: 'другое',
};
async function setReason(positionId, reason, note, actor) {
  if (reason && !REASONS[reason]) throw new Error('unknown reason');
  await ensureShadowTable();
  return withDb(async c => {
    const { rowCount } = await c.query('update logistics_shadow set mgr_reason = $2, mgr_reason_note = $3, reason_by = $4, reason_at = now() where position_id = $1',
      [positionId, reason || null, note || null, actor]);
    await c.query('insert into logistics_actions (number, actor, action, details) values ($1, $2, $3, $4)', [null, actor, 'shadow_reason', JSON.stringify({ positionId, reason, note })]);
    return rowCount;
  });
}

/** «Начать статистику заново» (owner 10.11): clears every recorded comparison; logged in logistics_actions. */
async function reset(actor) {
  await ensureShadowTable();
  return withDb(async c => {
    const { rowCount } = await c.query('delete from logistics_shadow');
    await c.query('insert into logistics_actions (number, actor, action, details) values ($1, $2, $3, $4)', [null, actor, 'shadow_reset', JSON.stringify({ deleted: rowCount })]);
    console.log(`[shadow] statistics reset by ${actor}: ${rowCount} row(s) deleted`);
    return rowCount;
  });
}

module.exports = { REASONS, setReason, step, rows, reset, runBackfill, backfill, retroCandidates, toPick, toResolve, sameSupplier };
