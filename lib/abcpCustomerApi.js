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
  return abcp.getCustomerOrder(orderId, fields).then(order => order);
}

async function listPayments(params = {}) {
  return abcp.listPayments(params);
}

module.exports = { listOrders, getOrder, listPayments };
