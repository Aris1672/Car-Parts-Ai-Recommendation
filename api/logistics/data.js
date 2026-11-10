/**
 * api/logistics/data.js — the /logistics page (managers' workplace, phase 1:
 * read-only towards ABCP; writes only our own notes / acks).
 *
 * POST { password, action, ... }
 *   action 'list'                          -> { orders, stats, stages, watcher }
 *   action 'order', number                 -> { order (+ live status history), notes, alerts, actions }
 *   action 'note', number, author, text    -> { success }
 *   action 'ack', id, author               -> { success }   («Принято, занимаюсь»)
 *   action 'unack', number, author        -> { reset }  (undo «Беру в работу» on the order)
 *   action 'offers', number                -> scored supplier offers per position (read-only)
 *   action 'suppliers', days               -> supplier reliability from status history
 *   action 'statuses'                      -> ABCP statuses with the stage each one maps to
 *   action 'run'                           -> one watcher pass now (admin / client only)
 *
 * Auth: DASHBOARD_LOGISTICS_PASSWORD (managers: role «logistics», this page
 * only), DASHBOARD_CLIENT_PASSWORD (Михаил), DASHBOARD_ADMIN_PASSWORD (us).
 */

const store = require('../../lib/logistics/store');
const stages = require('../../lib/logistics/stages');
const watch = require('../../lib/logistics/watch');
const abcp = require('../../lib/abcpOrders');
const suppliers = require('../../lib/logistics/suppliers');
const decisions = require('../../lib/logistics/decisions');
const shadow = require('../../lib/logistics/shadow');

function roleOf(password) {
  const p = String(password || '');
  if (!p) return null;
  if (process.env.DASHBOARD_ADMIN_PASSWORD && p === process.env.DASHBOARD_ADMIN_PASSWORD) return 'admin';
  if (process.env.DASHBOARD_CLIENT_PASSWORD && p === process.env.DASHBOARD_CLIENT_PASSWORD) return 'client';
  if (process.env.DASHBOARD_LOGISTICS_PASSWORD && p === process.env.DASHBOARD_LOGISTICS_PASSWORD) return 'logistics';
  return null;
}

const stageOfPos = p => stages.stageOfStatus(p.status);
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

async function liveHistory(summary) {
  const ids = (summary.positions || []).map(p => p.id).filter(Boolean).slice(0, 100);
  if (!ids.length || !abcp.enabled()) return null;
  try {
    const map = abcp.parseHistory(await abcp.apiGet('cp/orders/statusHistory', { positionsId: ids }));
    return Object.fromEntries([...map]);
  } catch (err) {
    console.error('[logistics] statusHistory failed:', err.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body || {};
  const role = roleOf(body.password);
  if (!role) return res.status(401).json({ error: 'Invalid password' });

  try {
    switch (body.action || 'list') {
      case 'list': {
        const [orders, st] = await Promise.all([store.listOrders(Math.min(60, Math.max(1, parseInt(body.finishedDays, 10) || 7))), store.stats()]);
        return res.json({ success: true, role, stats: st, stages: stages.STAGES, watcher: watch.state, enabled: process.env.LOGISTICS_ENABLED === '1', orders });
      }
      case 'order': {
        const number = clean(body.number, 20);
        const o = await store.getOrder(number);
        if (!o) return res.status(404).json({ error: 'Заказ не найден' });
        o.history = await liveHistory(o.summary);
        return res.json({ success: true, role, order: o });
      }
      case 'note': {
        const number = clean(body.number, 20), text = clean(body.text, 2000);
        if (!number || !text) return res.status(400).json({ error: 'number and text required' });
        await store.addNote(number, clean(body.author, 60) || role, text);
        return res.json({ success: true });
      }
      case 'ack': {
        const id = parseInt(body.id, 10);
        if (!id) return res.status(400).json({ error: 'id required' });
        return res.json({ success: await store.ackAlert(id, clean(body.author, 60) || role) });
      }
      case 'unack': {
        const number = clean(body.number, 20);
        if (!number) return res.status(400).json({ error: 'number required' });
        return res.json({ success: true, reset: await store.unackOrder(number, clean(body.author, 60) || role) });
      }
      case 'offers': {
        // Supplier offers for every live position of an order, scored (read-only preview of phase 2).
        const o = await store.getOrder(clean(body.number, 20));
        if (!o) return res.status(404).json({ error: 'Заказ не найден' });
        // 07.11: offers only for positions not ordered yet (the decision card shows the same ones);
        // positions already with a supplier are listed without offers.
        const live = (o.summary.positions || []).filter(p => p.number && !['done', 'cancelled'].includes(stages.stageOfStatus(p.status)));
        const pos = live.filter(p => ['new', 'payment', 'problem'].includes(stageOfPos(p))).slice(0, 6);
        const ordered = live.filter(p => !['new', 'payment', 'problem'].includes(stageOfPos(p))).map(p => ({ number: p.number, brand: p.brand, supplier: p.supplier, status: p.status }));
        const out = await Promise.all(pos.map(async p => {
          try {
            const all0 = await suppliers.offersFor(p.number, p.brand || 'BMW', p.quantity || 1, false, { supplier: p.supplier, supplierId: p.supplierId });
            // the customer chose the order's offer: slower offers can't be the pick (shown last, marked)
            const od = stages.ts(o.summary.date);
            const okList = all0.filter(x => !decisions.slowerThanPromised(p, x, od));
            const slow = all0.filter(x => decisions.slowerThanPromised(p, x, od)).map(o => ({ ...o, slower: true, reasons: [`медленнее срока, который выбрал клиент (до ${Math.ceil((p.deadlineMaxHours || p.deadlineHours) / 24)} дн.)`, ...o.reasons] }));
            const kept = suppliers.preferCurrent(okList, { supplier: p.supplier, supplierId: p.supplierId, priceOut: p.price, priceIn: p.priceIn });
            const offers = [...kept, ...slow];
            offers.fetchedAt = all0.fetchedAt;
            const k = suppliers.nameKey(p.supplier);
            const curOffer = offers.find(x => suppliers.sameSup(x.supplier, x.supplierId, p.supplier, p.supplierId)) || null;
            if (kept.length) offers[0] = { ...offers[0], pickWhy: suppliers.explainPick(kept, { supplier: p.supplier, supplierId: p.supplierId, priceIn: p.priceIn }) };
            else if (offers[0]) offers[0] = { ...offers[0], noPick: true };
            // 08.11 (order 286730444): same rules as the decision card — no «agent's pick» above the customer's price
            const pick = kept[0] || null;
            const pickIsCurrent = !!(pick && suppliers.sameSup(pick.supplier, pick.supplierId, p.supplier, p.supplierId));
            const overPrice = !!(pick && p.price && (pick.priceIn || pick.price) > p.price + 0.5);
            if (overPrice && !pickIsCurrent) offers[0] = { ...offers[0], noPick: true };
            const replacements = all0.length ? null : await suppliers.replacementsFor(p.number, p.brand || 'BMW').catch(() => null);
            return { id: p.id, number: p.number, brand: p.brand, overPrice, pickIsCurrent, customerPrice: p.price || null, replacements,
              current: { supplier: p.supplier, supplierId: p.supplierId, price: p.price, priceIn: p.priceIn, deadlineMaxHours: p.deadlineMaxHours, offer: curOffer }, offers: offers.slice(0, 40), fetchedAt: offers.fetchedAt };
          }
          catch (err) { return { id: p.id, number: p.number, brand: p.brand, error: err.message }; }
        }));
        return res.json({ success: true, positions: out, ordered });
      }
      case 'suppliers': {
        const days = Math.min(365, Math.max(14, parseInt(body.days, 10) || 120));
        return res.json({ success: true, days, suppliers: (await suppliers.supplierStats(days)).map(x => ({ ...x, trusted: suppliers.isTrusted(x.supplier), earned: !suppliers.isTrusted(x.supplier) && suppliers.isEarned(x) })) });
      }
      // ─── «Нужно ваше решение» (phase 2) ───
      case 'decisions': {
        const items = await decisions.queue(await store.listOrders(1));
        return res.json({ success: true, sendEnabled: decisions.sendEnabled(), total: items.length, items: items.slice(0, 60), unclear: await decisions.unclearList() });
      }
      case 'decisionPrepare': {
        const item = (await decisions.queue(await store.listOrders(1))).find(i => i.key === clean(body.key, 80));
        if (!item) return res.status(404).json({ error: 'Уже не в очереди — обновите страницу' });
        const [params, offers] = await Promise.all([
          item.sendable ? decisions.orderParamsFor(item.positions.map(p => p.id)) : Promise.resolve({ ok: false, error: 'нет кода склада поставщика — онлайн-отправка невозможна' }),
          Promise.all(item.positions.map(async p => {
            try {
              const all = await suppliers.offersFor(p.number, p.brand || 'BMW', p.quantity || 1, false, { supplier: item.supplier, supplierId: item.supplierId });
              // the customer chose the order's offer (price + delivery): only offers not slower than that promise may be picked
              const od = stages.ts(item.date);
              const list = suppliers.preferCurrent(all.filter(o => !decisions.slowerThanPromised(p, o, od)), { supplier: item.supplier, supplierId: item.supplierId, priceOut: p.price, priceIn: p.priceIn });
              list.fetchedAt = all.fetchedAt;
              if (list[0]) list[0] = { ...list[0], pickWhy: suppliers.explainPick(list, { supplier: item.supplier, supplierId: item.supplierId, priceIn: p.priceIn }) };
              const k = suppliers.nameKey(item.supplier);
              const cur = all.find(x => suppliers.sameSup(x.supplier, x.supplierId, item.supplier, item.supplierId)) || null;
              const repl = all.length ? null : await suppliers.replacementsFor(p.number, p.brand || 'BMW').catch(() => null);
              const fastest = all.length ? [...all].sort((a, b) => (a.hoursMax || a.hours || 0) - (b.hoursMax || b.hours || 0))[0] : null;
              // 08.11 (RAF FILTER RSTC067BM): the order's supplier has no offer any more and every offer is above the
              // customer's price -> no switch to recommend; the card asks to agree the price with the customer.
              // same supplier = by id / normalized name (08.11: object identity never matched after preferCurrent's copy)
              const pickIsCurrent = !!(list[0] && suppliers.sameSup(list[0].supplier, list[0].supplierId, item.supplier, item.supplierId));
              const overPrice = !!(list[0] && p.price && (list[0].priceIn || list[0].price) > p.price + 0.5);
              return { id: p.id, pick: list[0] || null, overPrice, pickIsCurrent, customerPrice: p.price || null, current: cur, count: list.length, total: all.length, slower: all.length - list.length,
                promisedDays: p.deadlineMaxHours ? Math.ceil(p.deadlineMaxHours / 24) : null, promiseExpired: decisions.promiseExpired(p, od),
                fastest: fastest ? { supplier: fastest.supplier, days: fastest.daysMax, priceIn: fastest.priceIn || fastest.price } : null, replacements: repl, fetchedAt: list.fetchedAt };
            } catch (err) { return { id: p.id, error: err.message }; }
          })),
        ]);
        return res.json({ success: true, item, params, offers });
      }
      case 'decisionConfirm': {
        const item = (await decisions.queue(await store.listOrders(1))).find(i => i.key === clean(body.key, 80));
        if (!item) return res.status(404).json({ error: 'Уже не в очереди — обновите страницу' });
        const orderParams = {};
        for (const [k, v] of Object.entries(body.orderParams || {})) if (/^[A-Za-z0-9_]{1,40}$/.test(k)) orderParams[k] = clean(v, 200);
        return res.json({ success: true, result: await decisions.confirm(item, clean(body.author, 60) || role, orderParams) });
      }
      case 'decisionSwitch': {
        const item = (await decisions.queue(await store.listOrders(1))).find(i => i.key === clean(body.key, 80));
        if (!item) return res.status(404).json({ error: 'Уже не в очереди — обновите страницу' });
        const chosen = { supplier: clean(body.supplier, 120), supplierId: clean(body.supplierId, 30) || null, priceIn: Number(body.priceIn) || null };
        return res.json({ success: true, result: await decisions.switchSupplier(item, clean(body.positionId, 30), chosen, clean(body.author, 60) || role) });
      }
      case 'decisionManual': {
        const item = (await decisions.queue(await store.listOrders(1))).find(i => i.key === clean(body.key, 80));
        if (!item) return res.status(404).json({ error: 'Уже не в очереди — обновите страницу' });
        await decisions.markManual(item, clean(body.author, 60) || role, clean(body.reason, 300));
        return res.json({ success: true });
      }
      case 'unclearResolve': {
        await decisions.resolveUnclear(clean(body.positionId, 30), clean(body.author, 60) || role, !!body.ordered);
        return res.json({ success: true });
      }
      case 'shadowStats': {
        const days = Math.min(180, Math.max(7, parseInt(body.days, 10) || 60));
        const [rows, sup] = await Promise.all([shadow.rows(days), suppliers.supplierStats(120).catch(() => [])]);
        return res.json({ success: true, role, days, rows, backfill: shadow.backfill, suppliers: sup, margin: Number(process.env.LOGISTICS_SWITCH_MARGIN) || 0.05,
          reasons: shadow.REASONS, ownStock: String(process.env.LOGISTICS_OWN_STOCK || 'наше наличие').split(',').map(x => x.trim()).filter(Boolean) });
      }
      case 'shadowBackfill': {
        if (role === 'logistics') return res.status(403).json({ error: 'Только для владельца' });
        const days = Math.min(14, Math.max(1, parseInt(body.days, 10) || 3));
        return res.json({ success: true, result: await shadow.runBackfill(await store.listOrders(days + 1), days, clean(body.author, 60) || role) });
      }
      case 'shadowReason': {
        const n = await shadow.setReason(clean(body.positionId, 30), clean(body.reason, 30), clean(body.note, 300), clean(body.author, 60) || role);
        return res.json({ success: true, updated: n });
      }
      case 'shadowReset': {
        // Михаил / owner only — managers can't wipe the statistics
        if (role === 'logistics') return res.status(403).json({ error: 'Только для владельца' });
        return res.json({ success: true, deleted: await shadow.reset(clean(body.author, 60) || role) });
      }
      case 'statuses': {
        const list = await abcp.apiGet('cp/statuses');
        return res.json({
          success: true,
          stages: stages.STAGES,
          statuses: (Array.isArray(list) ? list : []).map(s => ({ id: s.id, name: s.name, stage: stages.stageOfStatus(s.name) })),
        });
      }
      case 'run': {
        if (role === 'logistics') return res.status(403).json({ error: 'forbidden' });
        return res.json({ success: true, result: await watch.runOnce() });
      }
      default:
        return res.status(400).json({ error: 'unknown action' });
    }
  } catch (err) {
    console.error('[logistics] api error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
