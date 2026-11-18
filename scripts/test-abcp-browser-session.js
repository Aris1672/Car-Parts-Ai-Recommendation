const assert = require('assert');
const vm = require('vm');
const browser = require('../lib/logistics/abcpBrowser');

function fakePage({ status = 200, url = 'https://cp.abcp.ru/?page=orders', orders = 1, password = 0 } = {}) {
  const calls = [];
  const page = {
    goto: async target => { calls.push(['goto', target]); return { status: () => status }; },
    url: () => url,
    locator: selector => ({ count: async () => selector.includes('page=orders') ? orders : password }),
  };
  return { page, calls };
}

(async () => {
  let result = await browser.login(fakePage({ status: 403 }).page);
  assert.deepStrictEqual(result, { authenticated: false, manualRequired: true, reason: 'http_403', httpStatus: 403 });
  result = await browser.login(fakePage({ status: 414 }).page);
  assert.strictEqual(result.reason, 'http_414');
  result = await browser.login(fakePage({ status: 200, orders: 0, password: 0 }).page);
  assert.strictEqual(result.reason, 'login_state_unknown');
  console.log('ABCP browser session tests passed (offline mocks)');
})().catch(error => { console.error(error); process.exitCode = 1; });
