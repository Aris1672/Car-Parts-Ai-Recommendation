/**
 * lib/logistics/decisions.js — «Нужно ваше решение» (logistics agent, phase 2):
 * paid positions that are not ordered from a supplier yet, grouped per order
 * and supplier; the manager confirms and the agent sends them to the supplier
 * through ABCP (cp/orders/online POST, lib/abcpWrite.js).
 *
 * Safety (ABCP docs «Отправка online-заказа поставщику», 07.11):
 *   - sending only with LOGISTICS_SEND_ENABLED=1; otherwise «Подтвердить» is a
 *     dry run that shows exactly what would be sent;
 *   - right before sending: the order is re-read from ABCP — positions still
 *     not ordered, same supplier, same purchase price; otherwise stop;
 *   - every position at most once (logistics_sends primary key);
 *   - one send per supplier at a time (the supplier's cart is shared);
 *   - an unclear answer (confirmSend false / timeout) is marked «уточнить» and
 *     NEVER retried automatically — the manager checks on the supplier's side.
 */
const abcp = require('../abcpOrders');
const write = require('../abcpWrite');
const stages = require('./stages');
const { withDb, ensureTables } = require('./store');
const { nameKey } = require('./suppliers');

let ready = null;
function ensureSendTable() {
  if (!ready) {
    ready = ensureTables().then(() => withDb(c => c.query(`
      create table if not exists logistics_sends (
        position_id text primary key,
        number      text not null,
        supplier    text,
        status      text not null,            -- sending | sent | unclear | manual
        actor       text,
        request     jsonb,
        response    jsonb,
        created_at  timestamptz not null default now(),
        updated_at  timestamptz not null default now()
      );
      create index if not exists idx_logistics_sends_number on logistics_sends (number);
    `))).catch(err => { ready = null; throw err; });
  }
  return ready;
}

// ─── pure: queue from the board rows ───────────────────────────────────────
/**
 * rows: logistics_orders rows ({ number, summary, stage, alerts, finished_at }),
 * handled: Map position_id -> status from logistics_sends.
 * -> items [{ key, number, supplier, supplierId, positions, sendable, forgotten, loss, ... }]
 */
function buildQueue(rows, handled = new Map(), now = Date.now()) {
  const items = [];
  for (const r of rows) {
    if (r.finished_at) continue;
    const sm = r.summary || {};
    const pay = sm.payState || stages.payStateOf(sm);
    const kinds = new Set((r.alerts || []).map(a => a.kind));
    const forgotten = kinds.has('forgotten');
    if (pay === 'unpaid' && !forgotten && process.env.LOGISTICS_ORDER_UNPAID !== '1') continue; // waits for the customer's money
    const groups = new Map();
    for (const p of sm.positions || []) {
      if (!p.id || stages.stageOfStatus(p.status) !== 'new' || handled.has(p.id)) continue;
      const k = p.supplierId || nameKey(p.supplier) || '?';
      if (!groups.has(k)) groups.set(k, { supplier: p.supplier || 'поставщик не указан', supplierId: p.supplierId || null, positions: [] });
      groups.get(k).positions.push(p);
    }
    for (const [k, g] of groups) {
      const created = stages.ts(sm.date);
      items.push({
        key: `${r.number}|${k}`,
        number: r.number,
        customer: sm.customer || null,
        date: sm.date || null,
        ageHours: created ? Math.round((now - created) / 3600000) : null,
        payState: pay,
        carrier: sm.carrier || null,
        supplier: g.supplier,
        supplierId: g.supplierId,
        positions: g.positions.map(p => ({ id: p.id, brand: p.brand, number: p.number, description: p.description, quantity: p.quantity, price: p.price, priceIn: p.priceIn, dsRouteId: p.dsRouteId, status: p.status })),
        sum: g.positions.reduce((a, p) => a + (p.price || 0) * (p.quantity || 1), 0),
        cost: g.positions.reduce((a, p) => a + (p.priceIn || 0) * (p.quantity || 1), 0),
        sendable: g.positions.every(p => p.dsRouteId),
        forgotten,
        loss: g.positions.some(p => p.priceIn && p.price && p.priceIn > p.price + 0.5),
      });
    }
  }
  // forgotten first, then oldest
  return items.sort((a, b) => (b.forgotten - a.forgotten) || ((b.ageHours || 0) - (a.ageHours || 0)));
}

async function handledMap() {
  await ensureSendTable();
  return withDb(async c => new Map((await c.query('select position_id, status from logistics_sends')).rows.map(r => [r.position_id, r.status])));
}

async function queue(rows) {
  return buildQueue(rows, await handledMap());
}

/** Supplier's extra order fields (read-only GET helper). */
async function orderParamsFor(positionIds) {
  try { return { ok: true, params: await abcp.apiGet('cp/orders/online', { positionIds }) }; }
  catch (err) { return { ok: false, error: err.message }; }
}

// ─── pure: re-check one item against the fresh ABCP order ─────────────────
/** -> null if OK, else a reason string. Exported for tests. */
function recheck(item, freshOrder) {
  if (!freshOrder) return 'заказ не найден в ABCP';
  const fresh = new Map((freshOrder.positions || []).map(p => [String(p.id), p]));
  for (const p of item.positions) {
    const f = fresh.get(String(p.id));
    if (!f || Number(f.isDelete)) return `позиция ${p.number} удалена из заказа`;
    if (stages.stageOfStatus(f.status) !== 'new') return `позиция ${p.number} уже не новая (статус «${f.status}») — возможно, её уже заказали`;
    const fSup = f.distributorId != null ? String(f.distributorId) : null;
    if (item.supplierId && fSup && fSup !== item.supplierId) return `у позиции ${p.number} сменился поставщик — откройте заказ заново`;
    if (p.priceIn && Number(f.priceIn) && Math.abs(Number(f.priceIn) - p.priceIn) > 0.5) return `у позиции ${p.number} изменилась закупочная цена (${Math.round(p.priceIn)} → ${Math.round(Number(f.priceIn))} ₽)`;
    if (!f.dsRouteId) return `позицию ${p.number} нельзя отправить онлайн (нет кода склада поставщика) — заказ вручную в ABCP`;
  }
  return null;
}

/** ABCP answer -> per position result. Exported for tests. */
function parseSendAnswer(answer, positionIds) {
  const res = new Map(positionIds.map(id => [String(id), { status: 'unclear', message: 'нет ответа по позиции' }]));
  const orders = Array.isArray(answer) ? answer : answer && typeof answer === 'object' ? Object.values(answer) : [];
  for (const o of orders) {
    for (const p of (o && o.positions) || []) {
      const id = String(p.reference);
      if (!res.has(id)) continue;
      const msgs = (Array.isArray(p.status) ? p.status : [p.status]).filter(Boolean).map(x => (typeof x === 'string' ? x : x.message || JSON.stringify(x)));
      res.set(id, p.confirmSend === true || p.confirmSend === 1 || p.confirmSend === '1'
        ? { status: 'sent', supplierOrder: o.number || null, message: msgs.join('; ') || o.status || 'заказано' }
        : { status: 'unclear', supplierOrder: o.number || null, message: msgs.join('; ') || o.status || 'поставщик не подтвердил' });
    }
  }
  return res;
}

const locks = new Set();

/**
 * Manager pressed «Подтвердить». item comes from the client (key) and is
 * rebuilt from our DB, then re-checked against ABCP.
 */
async function confirm(item, actor, orderParams = {}) {
  await ensureSendTable();
  const fresh = await abcp.apiGet('cp/order', { number: item.number, format: 'additional' }).catch(() => null);
  const freshOrder = Array.isArray(fresh) ? fresh[0] : fresh;
  const problem = recheck(item, freshOrder);
  const request = { positions: item.positions.map(p => ({ id: p.id })), orderParams };
  if (problem) return { ok: false, stopped: problem };

  if (!write.sendEnabled()) {
    await logAction(item.number, actor, 'dry_run', { supplier: item.supplier, request });
    return { ok: true, dryRun: true, request, message: 'Проверка пройдена. Отправка выключена (LOGISTICS_SEND_ENABLED) — ничего не отправлено. Вот что ушло бы поставщику.' };
  }

  const lockKey = item.supplierId || nameKey(item.supplier);
  if (locks.has(lockKey)) return { ok: false, stopped: 'этому поставщику сейчас уже отправляется другой заказ — подождите минуту' };
  locks.add(lockKey);
  try {
    // claim every position first: the primary key makes a second send impossible
    const claimed = await withDb(async c => {
      const ids = [];
      for (const p of item.positions) {
        const r = await c.query(`insert into logistics_sends (position_id, number, supplier, status, actor, request) values ($1,$2,$3,'sending',$4,$5) on conflict do nothing returning position_id`,
          [p.id, item.number, item.supplier, actor, JSON.stringify(request)]);
        if (r.rows[0]) ids.push(p.id);
      }
      return ids;
    });
    if (claimed.length !== item.positions.length) {
      return { ok: false, stopped: 'часть позиций уже отправлялась раньше — обновите страницу' };
    }
    let answer, error = null;
    try { answer = await write.sendOnline(request.positions, orderParams); }
    catch (err) { error = err.message; }
    const results = error ? new Map(claimed.map(id => [String(id), { status: 'unclear', message: `ошибка: ${error}` }])) : parseSendAnswer(answer, claimed);
    await withDb(async c => {
      for (const [id, r] of results) {
        await c.query('update logistics_sends set status = $2, response = $3, updated_at = now() where position_id = $1', [id, r.status, JSON.stringify({ ...r, raw: error ? null : answer })]);
      }
    });
    await logAction(item.number, actor, 'send', { supplier: item.supplier, results: Object.fromEntries(results), error });
    const sent = [...results.values()].filter(r => r.status === 'sent').length;
    console.log(`[logistics] SENT to supplier: order ${item.number}, ${item.supplier}, ${sent}/${results.size} confirmed${error ? ', error: ' + error : ''}`);
    return { ok: true, sent, total: results.size, results: Object.fromEntries(results), error };
  } finally {
    locks.delete(lockKey);
  }
}

/** «Сделаю сам в ABCP»: the agent stops proposing these positions. */
async function markManual(item, actor, reason) {
  await ensureSendTable();
  await withDb(async c => {
    for (const p of item.positions) {
      await c.query(`insert into logistics_sends (position_id, number, supplier, status, actor, response) values ($1,$2,$3,'manual',$4,$5) on conflict do nothing`,
        [p.id, item.number, item.supplier, actor, JSON.stringify({ reason: reason || null })]);
    }
  });
  await logAction(item.number, actor, 'manual', { supplier: item.supplier, reason });
}

/** Manager checked an «уточнить» position on the supplier's side. */
async function resolveUnclear(positionId, actor, ordered) {
  await ensureSendTable();
  await withDb(c => ordered
    ? c.query("update logistics_sends set status = 'sent', actor = $2, updated_at = now() where position_id = $1 and status = 'unclear'", [positionId, actor])
    : c.query("delete from logistics_sends where position_id = $1 and status = 'unclear'", [positionId]));
}

async function unclearList() {
  await ensureSendTable();
  return withDb(async c => (await c.query("select * from logistics_sends where status in ('unclear','sending') order by updated_at desc limit 100")).rows);
}

async function logAction(number, actor, action, details) {
  return withDb(c => c.query('insert into logistics_actions (number, actor, action, details) values ($1,$2,$3,$4)', [number, actor, action, JSON.stringify(details)]));
}

module.exports = { buildQueue, queue, orderParamsFor, recheck, parseSendAnswer, confirm, markManual, resolveUnclear, unclearList, sendEnabled: write.sendEnabled };
