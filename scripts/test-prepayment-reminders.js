const assert = require('assert');
const store = require('../lib/logistics/store');
const browser = require('../lib/logistics/abcpBrowser');
const reminders = require('../lib/logistics/prepaymentReminders');
const selectors = { green: '.paid-plus', red: '.paid-cross' }; // synthetic fixtures, not production selectors
const html = content => '<table><tr><th>Заказ</th><th>Платежи</th></tr><tr><td><input id="inWorkSelectedOrders42"></td><td>' + content + '</td></tr></table>';
assert.strictEqual(reminders.paymentReceived(html('<span class="paid-plus">+</span>'), '42', selectors), 'paid');
assert.strictEqual(reminders.paymentReceived(html('<span class="paid-cross">X</span>'), '42', selectors), 'paid');
assert.strictEqual(reminders.paymentReceived(html(''), '42', selectors), 'unpaid');
assert.strictEqual(reminders.paymentReceived(html('<span>?</span>'), '42', selectors), 'unknown');
assert.strictEqual(reminders.paymentReceived(html(''), '99', selectors), 'unknown');
assert.strictEqual(reminders.paymentReceived(html(''), '42', {}), 'unknown');
// Sanitized real ABCP markup supplied 17.11: no customer names or IDs.
const green = '<div class="cp-flex gap5" style="min-width: 53px;"><button class="bp3-button bp3-icon-plus bp3-intent-success bp3-small linkPaymentBtn" title="Привязать к заказам"></button></div>';
const red = '<div class="cp-flex gap5" style="min-width: 53px;"><button type="button" class="bp3-button bp3-icon-cross bp3-intent-danger bp3-small ml-a-xs ml-a-sm delete-payment-order-links" title="Удалить все привязки платежей"></button></div>';
const empty = '<div class="cp-flex gap5" style="min-width: 53px;">   </div>';
assert.strictEqual(reminders.paymentReceived(html(green), '42'), 'paid');
assert.strictEqual(reminders.paymentReceived(html(red), '42'), 'paid');
assert.strictEqual(reminders.paymentReceived(html(empty), '42'), 'unpaid');
assert.strictEqual(reminders.paymentReceived(html('<div class="cp-flex gap5"><button class="other"></button></div>'), '42'), 'unknown');
assert.strictEqual(reminders.paymentReceived(html('<div class="other"></div>'), '42'), 'unknown');
async function testCutoff() {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const module = { exports: {} };
  const env = { SUPABASE_DB_URL: 'unused' };
  const queries = [];
  class Pool {
    on() {}
    async connect() {
      return { release() {}, async query(sql, params) {
        if (params) queries.push({ sql, params });
        return { rows: [] };
      } };
    }
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../lib/logistics/store'), 'utf8'), {
    module, process: { env }, require(name) {
      assert.strictEqual(name, 'pg');
      return { Pool };
    }
  });
  const ledger = module.exports;
  for (const invalid of [undefined, '2026-11-20', '2026-11-20T10:30:00+03:00', '2026-11-31T07:30:00Z']) {
    env.PREPAYMENT_REMINDERS_START_AT = invalid;
    await assert.rejects(ledger.dueReminders(), /valid fixed UTC timestamp/);
    await assert.rejects(ledger.claimReminder('42'), /valid fixed UTC timestamp/);
  }
  assert.strictEqual(queries.length, 0);
  env.PREPAYMENT_REMINDERS_START_AT = '2026-11-20T07:30:00Z';
  await ledger.dueReminders();
  assert.strictEqual(await ledger.claimReminder('42'), false);
  assert.strictEqual(queries.length, 2);
  for (const [i, { sql, params }] of queries.entries()) {
    assert.ok(sql.includes("status = 'pending'"));
    assert.ok(sql.includes("initial_sent_at <= now() - interval '65 minutes'"));
    assert.ok(sql.includes('initial_sent_at >= $' + (i + 1) + '::timestamptz'));
    assert.deepStrictEqual(Array.from(params), i ? ['42', '2026-11-20T07:30:00.000Z'] : ['2026-11-20T07:30:00.000Z']);
  }
}

(async () => {
  await testCutoff();
  process.env.PREPAYMENT_REMINDERS_ENABLED = '1';
  process.env.ORDER_AUTOPILOT_ENABLED = '1';
  process.env.ORDER_AUTOPILOT_DRY_RUN = '0';
  process.env.ABCP_PREPAYMENT_GREEN_SELECTOR = selectors.green;
  process.env.ABCP_PREPAYMENT_RED_SELECTOR = selectors.red;
  let status = 'pending', sends = 0, claims = 0;
  store.dueReminders = async () => status === 'pending' ? [{ order_number: '42' }] : [];
  store.claimReminder = async () => { claims++; if (status !== 'pending') return false; status = 'started'; return true; };
  store.finishReminder = async (_, value) => { status = value; };
  browser.getOrdersHtml = async () => html('');
  browser.sendAdvanceLink = async () => { assert.strictEqual(status, 'started'); sends++; return { emailSent: true }; };
  for (const [flag, paused, live] of [
    ['PREPAYMENT_REMINDERS_ENABLED', '0', '1'],
    ['ORDER_AUTOPILOT_ENABLED', '0', '1'],
    ['ORDER_AUTOPILOT_DRY_RUN', '1', '0'],
  ]) {
    const due = store.dueReminders;
    const read = browser.getOrdersHtml;
    let calls = 0;
    store.dueReminders = async () => { calls++; return due(); };
    browser.getOrdersHtml = async () => { calls++; return read(); };
    process.env[flag] = paused;
    await reminders.run();
    process.env[flag] = live;
    store.dueReminders = due;
    browser.getOrdersHtml = read;
    assert.strictEqual(calls, 0, flag + ' must prevent queue and browser reads');
    assert.strictEqual(claims + sends, 0);
    assert.strictEqual(status, 'pending');
  }
  await reminders.run(); await reminders.run();
  assert.strictEqual(sends, 1); assert.strictEqual(status, 'sent');
  status = 'pending'; browser.getOrdersHtml = async () => html('<span class="paid-cross">X</span>');
  await reminders.run(); assert.strictEqual(status, 'paid'); assert.strictEqual(sends, 1);
  status = 'pending'; browser.getOrdersHtml = async () => html('<span>unknown</span>');
  await reminders.run(); assert.strictEqual(status, 'pending'); assert.strictEqual(claims, 1);
  browser.getOrdersHtml = async () => html('');
  browser.sendAdvanceLink = async () => { sends++; throw new Error('timeout after possible send'); };
  await reminders.run(); await reminders.run();
  assert.strictEqual(status, 'uncertain'); assert.strictEqual(sends, 2);
  console.log('prepayment reminder tests passed');
})().catch(error => { console.error(error); process.exit(1); });
