const assert = require('assert');
const browser = require('../lib/logistics/abcpBrowser');

const previous = process.env.ABCP_BROWSER_PROXY_SERVER;
try {
  delete process.env.ABCP_BROWSER_PROXY_SERVER;
  assert.strictEqual(browser.browserProxy(), undefined);
  process.env.ABCP_BROWSER_PROXY_SERVER = 'socks5://127.0.0.1:1080';
  assert.deepStrictEqual(browser.browserProxy(), { server: 'socks5://127.0.0.1:1080' });
  for (const value of ['not-a-url', 'ftp://127.0.0.1:1080', 'socks5://user:pass@127.0.0.1:1080']) {
    process.env.ABCP_BROWSER_PROXY_SERVER = value;
    assert.throws(() => browser.browserProxy(), /ABCP_BROWSER_PROXY_SERVER/);
  }
  console.log('ABCP browser proxy configuration tests passed');
} finally {
  if (previous === undefined) delete process.env.ABCP_BROWSER_PROXY_SERVER;
  else process.env.ABCP_BROWSER_PROXY_SERVER = previous;
}
