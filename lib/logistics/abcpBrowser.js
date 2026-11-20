/**
 * Controlled ABCP browser session.
 * Uses a persistent profile but exposes no order actions yet.
 * Live operations remain disabled by policy in this module.
 */
const { chromium } = require('playwright');
const { AsyncLocalStorage } = require('node:async_hooks');

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
  try {
    const page = context.pages()[0] || await context.newPage();
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function login(page, options = {}) {
  const allowCredentialSubmit = options.allowCredentialSubmit !== false;
  let response;
  try {
    response = await page.goto(baseUrl + '/?page=orders', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (error) {
    throw Object.assign(new Error('ABCP orders navigation failed'), { code: 'ABCP_NAVIGATION_FAILED', cause: error });
  }
  const status = response && typeof response.status === 'function' ? response.status() : null;
  if (status !== null && status >= 400) {
    return { authenticated: false, manualRequired: true, reason: `http_${status}`, httpStatus: status };
  }
  const ordersLink = page.locator('a[href*="page=orders"]:visible');
  const loginMarker = page.locator('input[type="password"]:visible, text=Войти');
  const hasLoginMarker = await loginMarker.count();
  if (!hasLoginMarker && !/login|Войти/i.test(page.url()) && await ordersLink.count()) return { authenticated: true, manualRequired: false };
  if (!hasLoginMarker) return { authenticated: false, manualRequired: true, reason: 'login_state_unknown', httpStatus: status };
  if (!allowCredentialSubmit) return { authenticated: false, manualRequired: true, reason: 'session_not_authenticated', httpStatus: status };
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
  const authenticated = !/login|Войти/i.test(page.url()) && await page.locator('a[href*="page=orders"]:visible').count() > 0;
  return { authenticated, manualRequired: !authenticated, reason: authenticated ? null : 'manual_2fa_or_captcha' };
}

async function bootstrap() {
  const session = await open();
  try {
    const result = await login(session.page);
    return result.authenticated ? { ...result, profileDir: profileDir() } : result;
  } finally {
    await session.context.close();
  }
}

function liveActionsEnabled() {
  return process.env.ORDER_AUTOPILOT_ENABLED === '1' && process.env.ORDER_AUTOPILOT_DRY_RUN === '0';
}

// Serialize persistent browser sessions and pause after upstream refusals.
let sessionTail = Promise.resolve();
let refusalUntil = 0;
const REFUSAL_BACKOFF_MS = 30000;
function noteRefusal(error) {
  if (error && (error.httpStatus >= 400 || /^http_(401|403|414|5\d\d)$/.test(String(error.code || '')))) {
    const authenticationRefusal = [401, 403, 414, 429].includes(error.httpStatus);
    refusalUntil = Math.max(refusalUntil, Date.now() + (authenticationRefusal ? AUTH_BACKOFF_MS : REFUSAL_BACKOFF_MS));
  }
}
function enqueueSession(task, { lazy = false } = {}) {
  const run = sessionTail.then(async () => {
    if (!lazy && Date.now() < refusalUntil) { const error = new Error('ABCP browser refusal backoff active'); error.code = 'ABCP_REFUSAL_BACKOFF'; throw error; }
    try { return await task(); } catch (error) {
      noteRefusal(error);
      throw error;
    }
  });
  sessionTail = run.catch(() => {});
  return run;
}

const watcherScope = new AsyncLocalStorage();
const WATCHER_SESSION_MS = 90000;
const AUTH_BACKOFF_MS = 10 * 60000;
const WATCHER_IDLE_MS = 10 * 60000;
const WATCHER_MAX_AGE_MS = 60 * 60000;
let retained = null;
let idleTimer;

function takeRetained() {
  clearTimeout(idleTimer);
  const entry = retained;
  retained = null;
  return entry;
}

async function closeRetained() {
  const entry = takeRetained();
  if (entry) await entry.session.context.close();
}

function retain(entry) {
  retained = entry;
  idleTimer = setTimeout(() => {
    enqueueSession(async () => {
      if (retained === entry) await closeRetained();
    }, { lazy: true }).catch(error => console.error('[abcp-browser] idle close failed:', error.code || error.name));
  }, Math.max(0, Math.min(WATCHER_IDLE_MS, entry.openedAt + WATCHER_MAX_AGE_MS - Date.now())));
  idleTimer.unref();
}

async function authenticate(page, options) {
  try {
    const auth = await login(page, options);
    if (!auth.authenticated) {
      throw Object.assign(new Error(auth.reason || 'ABCP authentication required'), {
        code: auth.reason || 'ABCP_AUTH_REQUIRED', httpStatus: auth.httpStatus || null,
      });
    }
  } catch (error) {
    refusalUntil = Math.max(refusalUntil, Date.now() + AUTH_BACKOFF_MS);
    throw error;
  }
}

// Lazy, exclusive lease for one watcher pass. Never reopen inside a failed pass.
async function withWatcherSession(fn, { retainBetweenPasses = false } = {}) {
  return enqueueSession(async () => {
    const keep = retainBetweenPasses && liveActionsEnabled();
    if (!keep) await closeRetained();
    const scope = { session: null, openedAt: 0, keep, freshOrdersPage: false, deadline: 0, running: false, failed: false, closed: false };
    try {
      return await watcherScope.run(scope, fn);
    } catch (error) {
      scope.failed = true;
      throw error;
    } finally {
      scope.closed = true;
      if (scope.session) {
        if (keep && liveActionsEnabled() && !scope.failed && Date.now() < scope.openedAt + WATCHER_MAX_AGE_MS) {
          retain({ session: scope.session, openedAt: scope.openedAt });
        } else {
          await scope.session.context.close();
        }
      }
    }
  }, { lazy: true });
}

async function withSession(fn) {
  const scope = watcherScope.getStore();
  if (scope) {
    if (scope.closed || scope.failed || scope.running || (scope.deadline && Date.now() >= scope.deadline)) {
      throw Object.assign(new Error('ABCP watcher browser session unavailable for this pass'), { code: 'ABCP_WATCHER_SESSION_STOPPED' });
    }
    scope.running = true;
    try {
      if (!scope.session) {
        if (Date.now() < refusalUntil) throw Object.assign(new Error('ABCP browser refusal backoff active'), { code: 'ABCP_REFUSAL_BACKOFF' });
        scope.deadline = Date.now() + WATCHER_SESSION_MS;
        const entry = scope.keep ? takeRetained() : null;
        if (entry && (Date.now() >= entry.openedAt + WATCHER_MAX_AGE_MS || entry.session.page.isClosed?.())) {
          await entry.session.context.close();
        } else if (entry) {
          scope.session = entry.session;
          scope.openedAt = entry.openedAt;
        }
        const reused = !!scope.session;
        if (!reused) {
          scope.session = await open();
          scope.openedAt = Date.now();
        }
        await authenticate(scope.session.page, { allowCredentialSubmit: liveActionsEnabled() });
        scope.freshOrdersPage = scope.keep;
        console.log(reused ? '[abcp-browser] watcher context reused and checked' : '[abcp-browser] watcher session authenticated');
      }
      if (Date.now() >= scope.deadline) throw new Error('ABCP watcher browser session budget exceeded');
      return await fn(scope.session.page);
    } catch (error) {
      scope.failed = true;
      noteRefusal(error);
      throw error;
    } finally {
      scope.running = false;
    }
  }
  return enqueueSession(async () => {
    await closeRetained();
    const session = await open();
    try {
      await authenticate(session.page);
      return await fn(session.page);
    } finally {
      await session.context.close();
    }
  });
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
    const status = typeof response.status === 'function' ? response.status() : null;
    const raw = await response.text().catch(() => '');
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch {
      const error = new Error('guest transfer returned invalid JSON');
      error.code = 'ABCP_TRANSFER_INVALID_JSON'; error.httpStatus = status; throw error;
    }
    if (!response.ok()) {
      const error = new Error(`guest transfer HTTP ${status || 'unknown'}`);
      error.code = 'ABCP_TRANSFER_HTTP_ERROR'; error.httpStatus = status; throw error;
    }
    if (!data.url) {
      const error = new Error('guest transfer response missing order URL');
      error.code = 'ABCP_TRANSFER_MISSING_URL'; error.httpStatus = status; throw error;
    }
    return { url: data.url, orderId: transferredOrderIdFromUrl(data.url), httpStatus: status };
  });
}

async function withAuthenticatedSession(fn) {
  return enqueueSession(async () => {
    await closeRetained();
    const session = await open();
    try {
      const auth = await login(session.page, { allowCredentialSubmit: false });
      if (!auth.authenticated) { const error = new Error(auth.reason || 'ABCP authenticated session required'); error.code = auth.reason || 'ABCP_AUTH_REQUIRED'; error.httpStatus = auth.httpStatus || null; throw error; }
      return await fn(session.page);
    } finally { await session.context.close(); }
  });
}

async function checkSendBillPage(orderId) {
  const id = String(orderId || '').trim();
  if (!/^\d+$/.test(id)) throw new Error('approved numeric order id required');
  return withAuthenticatedSession(async page => {
    const response = await page.request.get(baseUrl + '/orders/' + encodeURIComponent(id) + '/sendBill', { headers: { Accept: 'text/html,application/xhtml+xml' }, timeout: 30000 });
    const status = typeof response.status === 'function' ? response.status() : null;
    const finalUrl = typeof response.url === 'function' ? response.url() : '';
    const body = typeof response.text === 'function' ? await response.text() : '';
    const bounded = String(body).slice(0, 200000);
    return { orderId: id, status, url: finalUrl, ok: status !== null ? status >= 200 && status < 400 : false, markers: { form: /<form\\b/i.test(bounded), payment: /sendBill|advanceLink|пополнения баланса/i.test(bounded) }, submitted: false };
  });
}

function assertResponseStatus(response) {
  const status = response && typeof response.status === 'function' ? response.status() : null;
  if (status >= 400) throw Object.assign(new Error('ABCP browser HTTP ' + status), { code: 'http_' + status, httpStatus: status });
}

async function getOrdersHtml() {
  return withSession(async page => {
    const scope = watcherScope.getStore();
    if (scope?.freshOrdersPage) {
      scope.freshOrdersPage = false;
    } else {
      const response = await page.goto(baseUrl + '/?page=orders', { waitUntil: 'domcontentloaded', timeout: 30000 });
      assertResponseStatus(response);
      if (scope && /login|Войти/i.test(page.url())) {
        refusalUntil = Math.max(refusalUntil, Date.now() + AUTH_BACKOFF_MS);
        throw Object.assign(new Error('ABCP session expired during watcher operation'), { code: 'ABCP_SESSION_EXPIRED' });
      }
    }
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
    assertResponseStatus(response);
    const data = await response.json().catch(() => ({}));
    const values = Array.isArray(data.message) ? data.message : data.message ? [data.message] : [];
    if (!response.ok() || !values.some(x => /письмо успешно отправлено/i.test(String(x)))) throw new Error('payment-link email failed');
    return { emailSent: true, telegramFailed: JSON.stringify(data.errMessage || '').match(/telegram/i) != null, response: data };
  });
}

module.exports = { profileDir, browserProxy, open, login, bootstrap, liveActionsEnabled, withWatcherSession, withAuthenticatedSession, checkSendBillPage, getOrdersHtml, transferGuestOrder, transferredOrderIdFromUrl, sendAdvanceLink };
