/**
 * Documented ABCP Учет PRO 2.0 administrative API adapter.
 * Read-only for now. Customer transfer and sendBill are browser routes and
 * are intentionally not emulated by undocumented API calls.
 */
const abcp = require('./abcpOrders');

function boundedInt(value, fallback, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
}

async function listOrders(params = {}) {
  const limit = boundedInt(params.limit, 100, 100);
  const skip = boundedInt(params.skip, 0, 100000);
  return abcp.listCustomerOrders({ ...params, limit, skip });
}

async function getOrder(orderId, fields = 'amounts,posInfo,tags') {
  if (!orderId) throw new Error('orderId is required');
  // The watcher has the customer-facing order number; /cp/ts/orders/get
  // requires the internal numeric id. Resolve number -> id via list first.
  const list = await listOrders({ number: String(orderId), limit: 1 });
  const item = Array.isArray(list.list) ? list.list[0] : null;
  const internalId = item && (item.id || item.orderId);
  if (internalId) return abcp.getCustomerOrder(internalId, fields);
  // API 2.0 may be unavailable for this reseller while the legacy
  // administrative read API remains enabled (the logistics watcher already
  // uses it). Fall back to the documented legacy read, never to a write.
  return abcp.apiGet('cp/order', { number: String(orderId), format: 'additional' });
}

async function listPayments(params = {}) {
  return abcp.listPayments(params);
}

module.exports = { listOrders, getOrder, listPayments };
