const assert = require('assert');
const api = require('../lib/abcpCustomerApi');
assert.strictEqual(typeof api.listOrders, 'function');
assert.strictEqual(typeof api.getOrder, 'function');
assert.strictEqual(typeof api.listPayments, 'function');
assert.strictEqual(awaitable(), true);
function awaitable() { return true; }
api.getOrder().then(() => { throw new Error('expected orderId validation'); }, err => {
  assert.match(err.message, /orderId is required/);
  console.log('ABCP customer API adapter tests passed');
});
