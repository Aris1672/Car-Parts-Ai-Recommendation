/** Offline browser mock: no ABCP, persistent profile, database or sends. */
const assert = require('assert');
const vm = require('vm');
const cheerio = require('cheerio');
const { chromium } = require('playwright');
const browser = require('../lib/logistics/abcpBrowser');
const autopilot = require('../lib/logistics/orderAutopilot');
const reminders = require('../lib/logistics/prepaymentReminders');

const shell = '<html><body>Loading</body></html>';
const loaded = '<table><tr><th>Заказ</th><th>Клиент</th><th>Платежи</th></tr><tr><td><input id="inWorkSelectedOrders42"><a onclick="sendBill(42)"><img src="mail-closed-send.svg"></a></td><td><a href="/clientinfo/7">Test</a></td><td></td></tr></table>';

// Supply the DOM operations used by the real Playwright predicate, backed by
// parsed fixture HTML. Nested tables retain real element identity.
function documentFor(html) {
  const $ = cheerio.load(html);
  const cache = new Map();
  function wrap(el) {
    if (!el) return null;
    if (!cache.has(el)) cache.set(el, {
      closest: selector => wrap($(el).closest(selector)[0]),
      querySelectorAll: selector => $(el).find(selector).toArray().map(wrap),
      get textContent() { return $(el).text(); },
    });
    return cache.get(el);
  }
  return { querySelectorAll: selector => $(selector).toArray().map(wrap) };
}

async function scenario({ stages, waitError, navigationError }) {
  const originalLaunch = chromium.launchPersistentContext;
  const events = [];
  let html = shell;
  let navigations = 0;
  const page = {
    goto: async () => {
      events.push('goto');
      if (++navigations === 2 && navigationError) throw navigationError;
      html = shell;
    },
    url: () => 'https://cp.abcp.ru/?page=orders',
    locator: selector => ({ count: async () => Number(selector.includes('page=orders')) }),
    waitForFunction: async (predicate, arg, options) => {
      events.push('wait');
      assert.strictEqual(arg, undefined);
      assert.strictEqual(options.timeout, 20000);
      if (waitError) throw waitError;
      for (const stage of stages) {
        html = stage;
        const ready = vm.runInNewContext('(' + predicate.toString() + ')()', { document: documentFor(html) });
        events.push(ready ? 'ready' : 'not-ready');
        if (ready) return;
      }
      const error = new Error('mock timeout');
      error.name = 'TimeoutError';
      throw error;
    },
    content: async () => { events.push('content'); return html; },
  };
  chromium.launchPersistentContext = async () => ({
    pages: () => [page],
    close: async () => { events.push('close'); },
  });
  try {
    const result = await browser.getOrdersHtml();
    return { result, events };
  } catch (error) {
    return { error, events };
  } finally {
    chromium.launchPersistentContext = originalLaunch;
  }
}

(async () => {
  const delayed = await scenario({ stages: [shell, '<table><tr><th>Unrelated</th></tr></table>', loaded] });
  assert.ifError(delayed.error);
  assert.strictEqual(delayed.result, loaded);
  assert.deepStrictEqual(delayed.events, ['goto', 'goto', 'wait', 'not-ready', 'not-ready', 'ready', 'content', 'close']);
  assert.strictEqual(autopilot.customerStateFromHtml(delayed.result, 42), 'registered');
  assert.strictEqual(autopilot.paymentStateFromHtml(delayed.result, 42), 'pending');
  assert.strictEqual(reminders.paymentReceived(delayed.result, 42), 'unpaid');

  const immediate = await scenario({ stages: [loaded] });
  assert.ifError(immediate.error);
  assert.strictEqual(immediate.result, loaded);

  // Missing rows, missing headings, and headings only inside a nested table
  // must not release the initial app shell to the payment parsers.
  for (const incomplete of [shell, '<table><tr><th>Клиент</th><th>Платежи</th></tr></table>',
    '<table><tr><td><input id="inWorkSelectedOrders42"></td></tr></table>',
    '<table><tr><td><input id="inWorkSelectedOrders42"><table><tr><th>Клиент</th><th>Платежи</th></tr></table></td></tr></table>']) {
    const result = await scenario({ stages: [incomplete] });
    assert.match(result.error.message, /orders page readiness timeout/);
    assert.ok(!result.events.includes('content'));
    assert.strictEqual(result.events.at(-1), 'close');
  }

  for (const kind of ['waitError', 'navigationError']) {
    const failure = new Error('browser closed');
    const result = await scenario({ stages: [], [kind]: failure });
    assert.strictEqual(result.error, failure);
    assert.ok(!result.events.includes('content'));
    assert.strictEqual(result.events.at(-1), 'close');
  }
  console.log('ABCP browser readiness tests passed (offline mocks)');
})().catch(error => { console.error(error); process.exitCode = 1; });
