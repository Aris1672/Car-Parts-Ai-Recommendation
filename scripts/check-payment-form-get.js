/** Read-only payment-form GET diagnostic. Never submits or clicks. */
const { chromium } = require('playwright');
const proxy = String(process.env.ABCP_BROWSER_PROXY_SERVER || '').trim();
const orderId = String(process.argv[2] || '').trim();
if (!/^\d+$/.test(orderId)) throw new Error('usage: node scripts/check-payment-form-get.js <approved-order-id>');
if (process.env.ORDER_AUTOPILOT_ENABLED === '1' && process.env.ORDER_AUTOPILOT_DRY_RUN === '0') throw new Error('refusing while live actions enabled');
(async () => {
  const launchOptions = { headless: process.env.ABCP_BROWSER_HEADLESS !== '0' };
  if (proxy) launchOptions.proxy = { server: proxy };
  const context = await chromium.launchPersistentContext(process.env.ABCP_BROWSER_PROFILE_DIR || '/data/abcp-browser', launchOptions);
  try {
    const page = context.pages()[0] || await context.newPage();
    const response = await page.goto('https://cp.abcp.ru/orders/' + orderId + '/sendBill', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const status = response && response.status();
    const title = await page.title().catch(() => '');
    const formCount = await page.locator('form').count();
    const submitCount = await page.locator('button[type="submit"], input[type="submit"]').count();
    console.log(JSON.stringify({ orderId, status, url: page.url(), title, formCount, submitCount, submitted: false }));
  } finally { await context.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
