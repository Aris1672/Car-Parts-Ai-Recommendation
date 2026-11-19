/** Acceptance gate: real processor, isolated workers, fake ledger and transport only. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../lib/logistics/orderAutopilot'), 'utf8');
const order = { number: '42', customerId: '7' };
const html = '<table><tr><th>Заказ</th><th>Клиент</th></tr><tr><td><input id="inWorkSelectedOrders42"><a onclick="sendBill(42)"><img src="mail-closed-send.svg"></a></td><td><a href="/clientinfo/7">Test</a></td></tr></table>';

function fixture(last_action, timeout = false) {
  // Proposed approval is bound to a single initial payment, order and amount.
  const row = { last_action, details: { orderId: '42', amount: 2000 } };
  const sends = [];
  const deps = {
    https: {}, cheerio: require('cheerio'),
    './store': {
      autopilotState: async () => ({ ...row }),
      autopilotAction: async (_, action, details) => {
        row.last_action = action;
        row.details = details;
        if (action === 'bill_email_sent') row.bill_status = 'sent';
      },
      claimInitialBill: async (_, amount) => {
        if (row.last_action !== 'bill_approved_once' || row.bill_status) return false;
        row.last_action = 'bill_started'; row.bill_status = 'started'; row.details = { orderId: '42', amount };
        return true;
      },
      recordInitialBill: async () => {},
    },
    '../abcpCustomerApi': { getOrder: async () => ({ number: '42', positions: [{ status: 'new' }] }) },
    './abcpBrowser': {
      getOrdersHtml: async () => html,
      sendAdvanceLink: async (id, amount) => {
        sends.push([id, amount]);
        if (timeout) throw new Error('synthetic timeout');
        return { emailSent: true };
      },
    },
  };
  function pass() {
    const module = { exports: {} };
    vm.runInNewContext(source, { module, URLSearchParams, process: { env: {
      ORDER_AUTOPILOT_ENABLED: '1', ORDER_AUTOPILOT_DRY_RUN: '0', ORDER_AUTOPILOT_AMOUNT: '2000',
    } }, require(name) {
      if (!Object.hasOwn(deps, name)) throw new Error('Unexpected dependency: ' + name);
      return deps[name];
    } });
    return module.exports.process(order, 'payment');
  }
  return { pass, sends };
}

test('a reviewed dry run alone is not permission to send', async () => {
  const f = fixture('dry_run');
  await f.pass();
  assert.equal(f.sends.length, 0);
});

test('two workers sharing one approval make exactly one send attempt', async () => {
  const f = fixture('bill_approved_once');
  await Promise.all([f.pass(), f.pass()]);
  assert.deepEqual(f.sends, [['42', 2000]]);
});

test('timeout stays blocked through multiple restarted workers', async () => {
  const f = fixture('bill_approved_once', true);
  await assert.rejects(f.pass(), /synthetic timeout/);
  for (let i = 0; i < 3; i++) await f.pass().catch(e => { if (e.message !== 'synthetic timeout') throw e; });
  assert.equal(f.sends.length, 1);
});
