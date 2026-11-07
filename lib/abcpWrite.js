/**
 * lib/abcpWrite.js — the ONLY place that writes to ABCP (logistics agent,
 * phase 2). One operation: send order positions to their supplier
 * (cp/orders/online POST, «Отправка online-заказа поставщику»). Everything
 * else in the app uses the read-only client lib/abcpOrders.js.
 *
 * Switched off unless LOGISTICS_SEND_ENABLED=1 (Coolify). Called only by
 * api/logistics/data.js action «confirm», after a manager pressed
 * «Подтвердить», through lib/logistics/decisions.js which enforces:
 *   - every position is sent at most once (table logistics_sends),
 *   - one send per supplier at a time (the supplier's cart is shared),
 *   - an unclear answer is never retried automatically (ABCP docs: the
 *     order may still be created on the supplier's side minutes later).
 */
const abcp = require('./abcpOrders');

const WRITE_OPS = new Set(['cp/orders/online', 'cp/order']);

function sendEnabled() { return process.env.LOGISTICS_SEND_ENABLED === '1'; }

/**
 * positions: [{ id, positionParams? }], orderParams: {} (from the GET helper).
 * Returns ABCP's answer (array of supplier orders with positions[].confirmSend).
 */
async function sendOnline(positions, orderParams = {}) {
  if (!sendEnabled()) throw new Error('sending is switched off (LOGISTICS_SEND_ENABLED != 1)');
  if (!WRITE_OPS.has('cp/orders/online')) throw new Error('not allowed');
  if (!positions.length || positions.length > 20) throw new Error('1..20 positions per send');
  const params = { positions: positions.map(p => (p.positionParams ? { id: p.id, positionParams: p.positionParams } : { id: p.id })) };
  if (orderParams && Object.keys(orderParams).length) params.orderParams = orderParams;
  return abcp._writeCall('cp/orders/online', params);
}

/**
 * Switch ONE position of an existing order to another supplier offer
 * (cp/order POST «Сохранение заказа», edit mode: only the given fields change).
 * The customer price (priceOut), quantity and status are NOT sent, so they stay.
 * ABCP docs: do not run cp/order in parallel — callers hold a global lock.
 */
async function switchPositionSupplier(orderNumber, positionId, offer) {
  if (!sendEnabled()) throw new Error('writing is switched off (LOGISTICS_SEND_ENABLED != 1)');
  return abcp._writeCall('cp/order', { order: buildSwitchOrder(orderNumber, positionId, offer) });
}

/** Pure: the order object for cp/order POST. Exported for tests. */
function buildSwitchOrder(orderNumber, positionId, offer) {
  if (!offer || !offer.routeId || !offer.itemKey || !(offer.priceIn > 0)) throw new Error('offer without routeId / itemKey / purchase price');
  const pos = { id: String(positionId), routeId: offer.routeId, itemKey: offer.itemKey, priceIn: offer.priceIn, deadline: offer.hours || 0, deadlineMax: offer.hoursMax || offer.hours || 0 };
  return { number: String(orderNumber), positions: [pos] };
}

module.exports = { sendEnabled, sendOnline, switchPositionSupplier, buildSwitchOrder };
