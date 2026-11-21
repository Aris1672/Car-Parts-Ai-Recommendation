/** Offline only: real watcher/reminder orchestration with mocked boundaries. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const now = Date.parse('2026-11-21T10:36:00Z');
const orders = ['101', '102'];
const reminders = ['201', '202'];
const privateDetail = 'synthetic upstream detail (must not escape through the scope guard)';

function load(relativePath, dependencies, env, log) {
  const filename = require.resolve(relativePath);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    process: { env },
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), 'Unexpected offline dependency: ' + name);
      return dependencies[name];
    },
    console: { log: (...args) => log.push(args.join(' ')), error: (...args) => log.push(args.join(' ')) },
  }, { filename });
  return module.exports;
}

function fixture({ backoff = false, failOrder, failReminder = false } = {}) {
  const calls = { api: [], candidate: [], phases: [], due: 0, reads: 0, claims: [], sends: [], finishes: [] };
  const log = [];
  const env = { PREPAYMENT_REMINDERS_ENABLED: '1', ORDER_AUTOPILOT_ENABLED: '1', ORDER_AUTOPILOT_DRY_RUN: '0' };
  let scope = null;

  const browser = {
    liveActionsEnabled: () => true,
    async withWatcherSession(fn) {
      assert.equal(scope, null);
      scope = { failed: false };
      try { return await fn(); } finally { scope = null; }
    },
    assertWatcherAvailable() {
      assert.ok(scope, 'guard must check the shared scope');
      if (backoff || scope.failed) {
        const code = backoff ? 'ABCP_REFUSAL_BACKOFF' : 'ABCP_WATCHER_SESSION_STOPPED';
        throw Object.assign(new Error('ABCP browser work unavailable'), { code, cause: new Error(privateDetail) });
      }
    },
    async getOrdersHtml() {
      assert.ok(scope, 'reminder reads must run in the shared scope');
      calls.reads++;
      if (failReminder && calls.reads === 1) {
        scope.failed = true;
        throw new Error('Synthetic browser read failed');
      }
      return '<table><tr><th>Заказ</th><th>Платежи</th></tr>' +
        reminders.map(id => '<tr><td><input id="inWorkSelectedOrders' + id + '"></td><td></td></tr>').join('') + '</table>';
    },
    async sendAdvanceLink(id, amount) {
      calls.sends.push([id, amount]);
      return { emailSent: true };
    },
  };
  const store = {
    async savePass(entries) { calls.api.push('save'); assert.deepEqual(Array.from(entries, o => o.number), orders); return []; },
    async finishMissing(numbers) { calls.api.push('archive'); assert.deepEqual(Array.from(numbers), orders); return []; },
    async autopilotState(id) { calls.candidate.push(id); return null; },
    async takeUnnotified() { calls.api.push('notify'); return []; },
    async dueReminders() { calls.due++; return reminders.map(order_number => ({ order_number })); },
    async claimReminder(id) { calls.claims.push(id); return true; },
    async finishReminder(id, status) { calls.finishes.push([id, status]); },
  };
  const reminderWorker = load('../lib/logistics/prepaymentReminders', {
    './store': store, './abcpBrowser': browser, cheerio: require('cheerio'),
  }, env, log);
  const watcher = load('../lib/logistics/watch', {
    '../abcpOrders': {
      enabled: () => true,
      async apiGet(name) {
        assert.equal(name, 'cp/orders');
        calls.api.push('fetch');
        return orders.map(number => ({ number }));
      },
    },
    './stages': {
      normalizeOrder: order => order,
      describe: order => ({ ...order, stage: 'payment', alerts: [], positions: [] }),
    },
    './store': store,
    '../maxNotify': { enabled: () => true },
    './suppliers': { async refreshHistory() { calls.api.push('history'); return { saved: 0 }; } },
    './shadow': { async step() { calls.api.push('shadow'); return { picked: 0, resolved: 0 }; } },
    './orderAutopilot': {
      enabled: () => true,
      startAt: () => now - 60000,
      eligibleForLaunch: () => true,
      async process(order, phase, automatic) {
        assert.ok(scope, 'order worker must run in the shared scope');
        assert.equal(automatic, true);
        calls.phases.push(phase + ':' + order.number);
        if (failOrder === phase && order.number === orders[0]) {
          // Mirrors orderAutopilot catching getOrdersHtml() and returning a status.
          // The caller must inspect the scope even when the promise resolves.
          scope.failed = true;
          return { status: 'orders_page_failed' };
        }
        return { status: 'already_sent' };
      },
    },
    './prepaymentReminders': reminderWorker,
    './abcpBrowser': browser,
  }, env, log);
  return { watcher, calls, log };
}

async function assertLogisticsCompleted({ watcher, calls, log }) {
  const report = await watcher.runOnce(now);
  assert.deepEqual({ ...report }, { orders: 2, late: 0, opened: 0, archived: 0, pushed: 0 });
  assert.deepEqual(calls.api, ['fetch', 'save', 'archive', 'history', 'shadow', 'notify']);
  assert.equal(watcher.state.lastOk, new Date(now).toISOString());
  assert.equal(watcher.state.lastError, null);
  assert.equal(watcher.state.running, false);
  assert.ok(log.some(line => line.startsWith('[logistics] pass: 2 active order(s)')));
  assert.ok(log.every(line => !line.includes(privateDetail)), 'scope errors must not log upstream details');
}

const allPhases = ['register:101', 'register:102', 'payment:101', 'payment:102'];

for (const [label, options, phases, candidates] of [
  ['pre-existing backoff skips candidate work, both phases and reminders', { backoff: true }, [], []],
  ['registration scope failure skips remaining orders, payments and reminders', { failOrder: 'register' }, allPhases.slice(0, 1), orders],
  ['payment scope failure skips remaining payments and reminders', { failOrder: 'payment' }, allPhases.slice(0, 3), orders],
]) {
  test(label, async () => {
    const run = fixture(options);
    await assertLogisticsCompleted(run);
    assert.deepEqual(run.calls.candidate, candidates);
    assert.deepEqual(run.calls.phases, phases);
    assert.equal(run.calls.due, 0);
    assert.equal(run.calls.reads, 0);
    assert.deepEqual(run.calls.claims, []);
    assert.deepEqual(run.calls.sends, []);
    assert.deepEqual(run.calls.finishes, []);
  });
}

test('reminder scope failure skips later reminders and leaves both unclaimed', async () => {
  const run = fixture({ failReminder: true });
  await assertLogisticsCompleted(run);
  assert.deepEqual(run.calls.phases, allPhases);
  assert.equal(run.calls.due, 1);
  assert.equal(run.calls.reads, 1);
  assert.deepEqual(run.calls.claims, []);
  assert.deepEqual(run.calls.sends, []);
  assert.deepEqual(run.calls.finishes, []);
});

test('healthy scope completes both order phases and due reminders', async () => {
  const run = fixture();
  await assertLogisticsCompleted(run);
  assert.deepEqual(run.calls.candidate, orders);
  assert.deepEqual(run.calls.phases, allPhases);
  assert.equal(run.calls.due, 1);
  assert.equal(run.calls.reads, reminders.length);
  assert.deepEqual(run.calls.claims, reminders);
  assert.deepEqual(run.calls.sends, reminders.map(id => [id, 2000]));
  assert.deepEqual(run.calls.finishes, reminders.map(id => [id, 'sent']));
});
