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

function roleOf(password) {
  const p = String(password || '');
  if (!p) return null;
  if (process.env.DASHBOARD_ADMIN_PASSWORD && p === process.env.DASHBOARD_ADMIN_PASSWORD) return 'admin';
  if (process.env.DASHBOARD_CLIENT_PASSWORD && p === process.env.DASHBOARD_CLIENT_PASSWORD) return 'client';
  if (process.env.DASHBOARD_LOGISTICS_PASSWORD && p === process.env.DASHBOARD_LOGISTICS_PASSWORD) return 'logistics';
  return null;
}

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
        const pos = (o.summary.positions || []).filter(p => p.number && !['done', 'cancelled'].includes(stages.stageOfStatus(p.status))).slice(0, 6);
        const out = await Promise.all(pos.map(async p => {
          try {
            const offers = await suppliers.offersFor(p.number, p.brand || 'BMW', p.quantity || 1);
            const k = suppliers.nameKey(p.supplier);
            const curOffer = offers.find(x => (p.supplierId && x.supplierId === p.supplierId) || (k && suppliers.nameKey(x.supplier) === k)) || null;
            if (offers[0]) offers[0] = { ...offers[0], pickWhy: suppliers.explainPick(offers, { supplier: p.supplier, supplierId: p.supplierId, priceIn: p.priceIn }) };
            return { id: p.id, number: p.number, brand: p.brand, current: { supplier: p.supplier, supplierId: p.supplierId, price: p.price, priceIn: p.priceIn, deadlineMaxHours: p.deadlineMaxHours, offer: curOffer }, offers: offers.slice(0, 40) };
          }
          catch (err) { return { id: p.id, number: p.number, brand: p.brand, error: err.message }; }
        }));
        return res.json({ success: true, positions: out });
      }
      case 'suppliers': {
        const days = Math.min(365, Math.max(14, parseInt(body.days, 10) || 120));
        return res.json({ success: true, days, suppliers: await suppliers.supplierStats(days) });
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
