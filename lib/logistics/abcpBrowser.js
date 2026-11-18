/**
 * Controlled ABCP browser session.
 * Uses a persistent profile but exposes no order actions yet.
 * Live operations remain disabled by policy in this module.
 */
const { chromium } = require('playwright');

const profileDir = () => process.env.ABCP_BROWSER_PROFILE_DIR || '/data/abcp-browser';
const baseUrl = 'https://cp.abcp.ru';

function browserProxy() {
  const server = String(process.env.ABCP_BROWSER_PROXY_SERVER || '').trim();
  if (!server) return undefined;
  let parsed;
  try { parsed = new URL(server); } catch { throw new Error('ABCP_BROWSER_PROXY_SERVER must be a valid proxy URL'); }
  if (!['socks5:', 'socks5h:', 'http:'].includes(parsed.protocol)) {
    throw new Error('ABCP_BROWSER_PROXY_SERVER must use socks5://, socks5h://, or http://');
  }
  if (parsed.username || parsed.password) {
    throw new Error('ABCP_BROWSER_PROXY_SERVER must not contain credentials; use an authenticated tunnel separately');
  }
  return { server };
}

async function open() {
  const launchOptions = {
    headless: process.env.ABCP_BROWSER_HEADLESS !== '0',
    viewport: { width: 1440, height: 900 },
  };
  const proxy = browserProxy();
  if (proxy) launchOptions.proxy = proxy;
  const context = await chromium.launchPersistentContext(profileDir(), launchOptions);
  const page = context.pages()[0] || await context.newPage();
  return { context, page };
}

async function login(page) {
  await page.goto(baseUrl + '/?page=orders', { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (!/login|Войти/i.test(page.url()) && await page.locator('a[href*="page=orders"]').count()) return { authenticated: true, manualRequired: false };
  const user = process.env.ABCP_BROWSER_USERNAME;
  const pass = process.env.ABCP_BROWSER_PASSWORD;
  if (!user || !pass) return { authenticated: false, manualRequired: true, reason: 'credentials_missing' };
  const loginInput = page.locator('input[type="email"]:visible, input[type="text"]:visible, input:not([type]):visible').first();
  if (!await loginInput.count()) return { authenticated: false, manualRequired: true, reason: 'login_form_not_found' };
  await loginInput.fill(user);
  const passwordInput = page.locator('input[type="password"]:visible').first();
  if (!await passwordInput.count()) return { authenticated: false, manualRequired: true, reason: 'password_field_not_found' };
  await passwordInput.fill(pass);
  const submit = page.locator('button[type="submit"]:visible, input[type="submit"]:visible, button:visible').first();
  if (!await submit.count()) return { authenticated: false, manualRequired: true, reason: 'login_button_not_found' };
  await submit.click();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  const authenticated = !/login|Войти/i.test(page.url()) && await page.locator('a[href*="page=orders"]').count() > 0;
  return { authenticated, manualRequired: !authenticated, reason: authenticated ? null : 'manual_2fa_or_captcha' };
}

async function bootstrap() {
  const session = await open();
  const result = await login(session.page);
  if (!result.authenticated) {
    await session.context.close();
    return result;
  }
  await session.context.close();
  return { ...result, profileDir: profileDir() };
}

function liveActionsEnabled() {
  return process.env.ORDER_AUTOPILOT_ENABLED === '1' && process.env.ORDER_AUTOPILOT_DRY_RUN === '0';
}

async function withSession(fn) {
  const session = await open();
  const auth = await login(session.page);
  if (!auth.authenticated) { await session.context.close(); throw new Error(auth.reason || 'ABCP authentication required'); }
  try { return await fn(session.page); } finally { await session.context.close(); }
}

function transferredOrderIdFromUrl(value) {
  const url = String(value || '');
  const match = url.match(/[?&]id_order=(\d+)/i) || url.match(/\/(\d+)(?:[/?#]|$)/);
  return match ? match[1] : null;
}

async function transferGuestOrder(orderId) {
  if (!liveActionsEnabled()) throw new Error('browser actions disabled');
  return withSession(async page => {
    const response = await page.request.post(baseUrl + '/ajaxRoute/orders/changeOrderClient/regGuestAsCustomer', { form: { orderId: String(orderId) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok() || !data.url) throw new Error('guest transfer failed');
    return { url: data.url, orderId: transferredOrderIdFromUrl(data.url) };
  });
}

async function getOrdersHtml() {
  return withSession(async page => {
    await page.goto(baseUrl + '/?page=orders', { waitUntil: 'domcontentloaded', timeout: 30000 });
    // ABCP renders orders asynchronously, even after document.readyState is
    // complete. Do not give the state parsers the initial empty app shell.
    try {
      await page.waitForFunction(() => {
        const markers = document.querySelectorAll('input[id^="inWorkSelectedOrders"]');
        return Array.from(markers).some(marker => {
          const row = marker.closest('tr');
          const table = row && row.closest('table');
          if (!table) return false;
          const headings = Array.from(table.querySelectorAll('th'))
            .filter(th => th.closest('table') === table)
            .map(th => th.textContent.replace(/\s+/g, ' ').trim());
          return headings.some(text => /клиент/i.test(text)) && headings.includes('Платежи');
        });
      }, undefined, { timeout: 20000 });
    } catch (error) {
      if (error.name !== 'TimeoutError') throw error;
      // An empty/filtered page is not proof that any order is unpaid.
      throw new Error('ABCP orders page readiness timeout: order rows and client/payment headings not loaded');
    }
    return await page.content();
  });
}

async function sendAdvanceLink(orderId, amount = 2000) {
  if (!liveActionsEnabled()) throw new Error('browser actions disabled');
  return withSession(async page => {
    const response = await page.request.post(baseUrl + `/orders/${encodeURIComponent(String(orderId))}/sendBill/ajax`, { form: {
      billType: 'pdf', cashMemoType: 'pdf', expenditureWaybillType: 'pdf', updType: 'pdf', sendBlankType: 'pdf', linkType: 'pdf',
      email: 'on', telegram: 'on', advanceLinkAmount: String(amount), sendType: 'advanceLink',
    } });
    const data = await response.json().catch(() => ({}));
    const values = Array.isArray(data.message) ? data.message : data.message ? [data.message] : [];
    if (!response.ok() || !values.some(x => /письмо успешно отправлено/i.test(String(x)))) throw new Error('payment-link email failed');
    return { emailSent: true, telegramFailed: JSON.stringify(data.errMessage || '').match(/telegram/i) != null, response: data };
  });
}

module.exports = { profileDir, browserProxy, open, login, bootstrap, liveActionsEnabled, getOrdersHtml, transferGuestOrder, transferredOrderIdFromUrl, sendAdvanceLink };
