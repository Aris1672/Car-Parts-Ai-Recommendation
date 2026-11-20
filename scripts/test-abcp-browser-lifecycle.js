/** Offline only: Playwright's persistent-context launcher is replaced before use. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { chromium } = require('playwright');
const browserPath = require.resolve('../lib/logistics/abcpBrowser');

const profile = 'offline-abcp-test-profile';
const ordersUrl = 'https://cp.abcp.ru/?page=orders';

function checkNoCallback() {
  assert.fail('unauthenticated session must not call the operation');
}

function scenario(t, { statuses = [200], navigationError, loggedOut = false, beforeClose, expireAfterFirstCheck = false } = {}) {
  const events = [];
  const originalLaunch = chromium.launchPersistentContext;
  const env = {
    ABCP_BROWSER_PROFILE_DIR: profile,
    ABCP_BROWSER_PROXY_SERVER: '',
    ABCP_BROWSER_USERNAME: 'offline-user',
    ABCP_BROWSER_PASSWORD: 'offline-placeholder',
  };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
    process.env[key] = value;
  }
  let launchCount = 0;
  chromium.launchPersistentContext = async () => {
    const id = ++launchCount;
    assert.ok(id <= statuses.length, 'unexpected persistent context launch');
    events.push(['launch', id]);
    let checks = 0;
    let needsLogin = loggedOut;
    const page = {
      goto: async () => {
        if (++checks === 2 && expireAfterFirstCheck) needsLogin = true;
        events.push(['goto', id]);
        if (navigationError) throw navigationError;
        return { status: () => statuses[id - 1] };
      },
      waitForFunction: async () => { events.push(['ready', id]); },
      content: async () => 'offline html',
      url: () => needsLogin ? 'https://cp.abcp.ru/login' : ordersUrl,
      waitForLoadState: async () => {},
      locator: selector => ({
        count: async () => {
          assert.ok([
            'input[type="password"]:visible',
            'a[href*="page=orders"]:visible',
          ].includes(selector), 'unexpected authentication-state locator: ' + selector);
          return Number(needsLogin ? selector.includes('password') : selector.includes('page=orders'));
        },
        first: () => {
          assert.ok(expireAfterFirstCheck, 'read-only checks must not access credential fields');
          return { count: async () => 1, fill: async () => {}, click: async () => {
            events.push(['submit', id]);
            needsLogin = false;
          } };
        },
      }),
    };
    return {
      pages: () => [page],
      close: async () => {
        events.push(['close', id]);
        if (beforeClose) await beforeClose();
      },
    };
  };
  t.after(() => {
    chromium.launchPersistentContext = originalLaunch;
    delete require.cache[browserPath];
  });
  return { browser: require(browserPath), events };
}

for (const status of [403, 414]) {
  test('HTTP ' + status + ' stops the operation without an in-call retry and closes the context', async t => {
    const { browser, events } = scenario(t, { statuses: [status] });
    await assert.rejects(browser.withAuthenticatedSession(checkNoCallback), { code: 'http_' + status, httpStatus: status });
    assert.deepEqual(events, [['launch', 1], ['goto', 1], ['close', 1]]);
  });
}

test('a logged-out read-only session never submits credentials and closes the context', async t => {
  const { browser, events } = scenario(t, { loggedOut: true });
  await assert.rejects(browser.withAuthenticatedSession(checkNoCallback), { code: 'session_not_authenticated' });
  assert.deepEqual(events, [['launch', 1], ['goto', 1], ['close', 1]]);
});

test('navigation failure preserves the cause and closes the context', async t => {
  const navigationError = new Error('offline navigation failure');
  const { browser, events } = scenario(t, { navigationError });
  await assert.rejects(browser.withAuthenticatedSession(checkNoCallback), { code: 'ABCP_NAVIGATION_FAILED', cause: navigationError });
  assert.deepEqual(events, [['launch', 1], ['goto', 1], ['close', 1]]);
});

test('operation failure closes its context before a later session runs', async t => {
  const { browser, events } = scenario(t, { statuses: [200, 200] });
  const callbackError = new Error('offline operation failure');
  await assert.rejects(browser.withAuthenticatedSession(async () => {
    events.push(['callback', 1]);
    throw callbackError;
  }), err => err === callbackError);
  assert.equal(await browser.withAuthenticatedSession(async () => {
    events.push(['callback', 2]);
    return 'ok';
  }), 'ok');
  assert.deepEqual(events, [
    ['launch', 1], ['goto', 1], ['callback', 1], ['close', 1],
    ['launch', 2], ['goto', 2], ['callback', 2], ['close', 2],
  ]);
});

test('a successful operation does not settle while context close is pending', async t => {
  let startClose;
  const closing = new Promise(resolve => { startClose = resolve; });
  let finishClose;
  const closeGate = new Promise(resolve => { finishClose = resolve; });
  const { browser, events } = scenario(t, { beforeClose: () => { startClose(); return closeGate; } });
  let settled = false;
  const operation = browser.withAuthenticatedSession(async () => 'ok').finally(() => { settled = true; });
  try {
    await Promise.race([closing, operation]);
    // Give promise reactions a turn; no real-time sleep is needed.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    assert.deepEqual(events, [['launch', 1], ['goto', 1], ['close', 1]]);
  } finally {
    finishClose();
    await operation;
  }
  assert.equal(await operation, 'ok');
});

test('an idle watcher pass never opens a browser', async t => {
  const { browser, events } = scenario(t, { statuses: [] });
  await browser.withWatcherSession(async () => {});
  assert.deepEqual(events, []);
});

test('sequential watcher reads share one context and close it at pass end', async t => {
  const { browser, events } = scenario(t);
  await browser.withWatcherSession(async () => {
    assert.equal(await browser.getOrdersHtml(), 'offline html');
    assert.equal(await browser.getOrdersHtml(), 'offline html');
    assert.equal(events.some(([event]) => event === 'close'), false);
  });
  assert.deepEqual(events, [['launch', 1], ['goto', 1], ['goto', 1], ['ready', 1], ['goto', 1], ['ready', 1], ['close', 1]]);
});

test('watcher auth failure prevents a second login in the pass and during backoff', async t => {
  const { browser, events } = scenario(t, { statuses: [403] });
  await browser.withWatcherSession(async () => {
    await assert.rejects(browser.getOrdersHtml(), { code: 'http_403' });
    await assert.rejects(browser.getOrdersHtml(), { code: 'ABCP_WATCHER_SESSION_STOPPED' });
  });
  await assert.rejects(browser.withWatcherSession(() => browser.getOrdersHtml()), { code: 'ABCP_REFUSAL_BACKOFF' });
  assert.deepEqual(events, [['launch', 1], ['goto', 1], ['close', 1]]);
});

test('expired watcher session does not start another browser operation', async t => {
  const { browser, events } = scenario(t);
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  t.after(() => { Date.now = realNow; });
  await browser.withWatcherSession(async () => {
    await browser.getOrdersHtml();
    now += 90000;
    await assert.rejects(browser.getOrdersHtml(), { code: 'ABCP_WATCHER_SESSION_STOPPED' });
  });
  assert.deepEqual(events, [['launch', 1], ['goto', 1], ['goto', 1], ['ready', 1], ['close', 1]]);
});

for (const expireAfterFirstCheck of [false, true]) {
  test(expireAfterFirstCheck ? 'expired session signs in once on the next cycle' : 'healthy session survives multiple live cycles without credential submission', async t => {
    const { browser, events } = scenario(t, { expireAfterFirstCheck });
    const flags = { ORDER_AUTOPILOT_ENABLED: '1', ORDER_AUTOPILOT_DRY_RUN: '0' };
    for (const [key, value] of Object.entries(flags)) {
      const previous = process.env[key];
      t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
      process.env[key] = value;
    }
    const run = () => browser.withWatcherSession(() => browser.getOrdersHtml(), { retainBetweenPasses: true });
    for (let i = 0; i < 3; i++) assert.equal(await run(), 'offline html');
    assert.equal(events.filter(([event]) => event === 'launch').length, 1);
    assert.equal(events.filter(([event]) => event === 'goto').length, 3);
    assert.equal(events.filter(([event]) => event === 'submit').length, Number(expireAfterFirstCheck));
    assert.equal(events.filter(([event]) => event === 'close').length, 0);
    process.env.ORDER_AUTOPILOT_ENABLED = '0';
    await browser.withWatcherSession(async () => {}, { retainBetweenPasses: true });
    assert.deepEqual(events.at(-1), ['close', 1]);
  });
}
