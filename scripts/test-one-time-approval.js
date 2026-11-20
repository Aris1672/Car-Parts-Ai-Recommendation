/** Acceptance gate: real processor, isolated workers, fake ledger and transport only. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../lib/logistics/orderAutopilot'), 'utf8');
const order = { number: '42', customerId: '7' };
const html = '<table><tr><th>Заказ</th><th>Клиент</th></tr><tr><td><input id="inWorkSelectedOrders42"><a onclick="sendBill(42)"><img src="mail-closed-send.svg"></a></td><td><a href="/clientinfo/7">Test</a></td></tr></table>';

function fixture(last_action, timeout = false, guest = false) {
  // Proposed approval is bound to a single initial payment, order and amount.
  const row = { last_action, details: { orderId: '42', amount: 2000 } };
  const sends = [];
  const reminders = [];
  const transfers = [];
  const sourceOrder = guest ? { number: order.number, customerId: null } : order;
  const testHtml = guest ? html.replace('<a href="/clientinfo/7">Test</a>', 'Гость') : html;
  const deps = {
    https: {}, cheerio: require('cheerio'),
    './store': {
      autopilotState: async (id) => id === order.number ? { ...row } : null,
      autopilotAction: async (id, action, details) => {
        assert.equal(id, order.number);
        if (action === 'registration_succeeded') {
          row.transferred_order_number = details.newOrderId;
          if (row.last_action === 'bill_approved_once') return;
        }
        row.last_action = action;
        row.details = details;
        if (action === 'bill_email_sent') row.bill_status = 'sent';
      },
      claimInitialBill: async (id, amount, target) => {
        if (id !== order.number || target !== (row.transferred_order_number || id) ||
            row.details.amount !== amount || row.last_action !== 'bill_approved_once' || row.bill_status) return false;
        row.last_action = 'bill_started'; row.bill_status = 'started'; row.details = { orderId: '42', amount };
        return true;
      },
      recordInitialBill: async (id) => { reminders.push(id); },
    },
    '../abcpCustomerApi': { getOrder: async (id) => ({ number: id, positions: [{ status: 'new' }] }) },
    './abcpBrowser': {
      getOrdersHtml: async () => transfers.length ? html.replaceAll('42', '43') : testHtml,
      transferGuestOrder: async (id) => { transfers.push(id); return { orderId: '43' }; },
      sendAdvanceLink: async (id, amount) => {
        sends.push([id, amount]);
        if (timeout) throw new Error('synthetic timeout');
        return { emailSent: true };
      },
    },
  };
  function pass(phase = 'payment') {
    const module = { exports: {} };
    vm.runInNewContext(source, { module, URLSearchParams, process: { env: {
      ORDER_AUTOPILOT_ENABLED: '1', ORDER_AUTOPILOT_DRY_RUN: '0', ORDER_AUTOPILOT_AMOUNT: '2000',
    } }, require(name) {
      if (!Object.hasOwn(deps, name)) throw new Error('Unexpected dependency: ' + name);
      return deps[name];
    } });
    return module.exports.process(sourceOrder, phase);
  }
  return { pass, sends, reminders, transfers, row };
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

test('guest transfer keeps the original approval and sends once to the registered order', async () => {
  const f = fixture('bill_approved_once', false, true);
  assert.equal((await f.pass('register')).status, 'registered');
  assert.equal(f.row.last_action, 'bill_approved_once');
  const results = await Promise.all([f.pass(), f.pass()]);
  assert.deepEqual(results.map(r => r.status).sort(), ['already_claimed', 'sent']);
  assert.equal((await f.pass()).status, 'already_sent');
  assert.deepEqual(f.transfers, ['42']);
  assert.deepEqual(f.sends, [['43', 2000]]);
  assert.deepEqual(f.reminders, ['43']);
  assert.equal(f.row.bill_status, 'sent');
  assert.equal(f.row.details.paymentOrderId, '43');
});

test('guest transfer without payment approval does not send or queue a reminder', async () => {
  const f = fixture('unapproved', false, true);
  assert.equal((await f.pass('register')).status, 'registered');
  assert.equal((await f.pass()).status, 'approval_required');
  assert.deepEqual(f.sends, []);
  assert.deepEqual(f.reminders, []);
});
