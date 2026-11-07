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

const WRITE_OPS = new Set(['cp/orders/online']);

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

module.exports = { sendEnabled, sendOnline };
