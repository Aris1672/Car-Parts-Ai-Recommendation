/**
 * ABCP customer-order autopilot.
 *
 * The browser procedure is intentionally disabled by default. Set
 * ORDER_AUTOPILOT_ENABLED=1 and ORDER_AUTOPILOT_DRY_RUN=0 only after the
 * authenticated ABCP transport has been configured and tested manually.
 *
 * Confirmed browser requests:
 *   POST /ajaxRoute/orders/changeOrderClient/regGuestAsCustomer
 *     orderId=<order id>
 *   POST /orders/<order id>/sendBill/ajax
 *     sendType=advanceLink, advanceLinkAmount=2000, email=on, telegram=on
 */
const https = require('https');
const store = require('./store');

function envValue(name) {
  return (typeof process !== 'undefined' && process.env) ? String(process.env[name] || '') : '';
}
const parsedAmount = Number(envValue('ORDER_AUTOPILOT_AMOUNT') || 2000);
const AMOUNT = Number.isInteger(parsedAmount) && parsedAmount > 0 && parsedAmount <= 100000 ? parsedAmount : 2000;
const enabled = () => envValue('ORDER_AUTOPILOT_ENABLED') === '1';
const dryRun = () => envValue('ORDER_AUTOPILOT_DRY_RUN') !== '0';

function isGuest(order) {
  return !order.customerId;
}

function registrationBody(orderId) {
  return new URLSearchParams({ orderId: String(orderId) }).toString();
}

function billBody(amount = AMOUNT) {
  return new URLSearchParams({
    billType: 'pdf', cashMemoType: 'pdf', expenditureWaybillType: 'pdf',
    updType: 'pdf', sendBlankType: 'pdf', linkType: 'pdf',
    email: 'on', telegram: 'on', advanceLinkAmount: String(amount),
    sendType: 'advanceLink',
  }).toString();
}

function paymentStateFromHtml(html, orderId) {
  const src = String(html || '');
  const id = String(orderId || '').replace(/[^0-9]/g, '');
  if (!src || !id) return 'unknown';
  const row = src.match(new RegExp('<tr\\b[\\s\\S]*?inWorkSelectedOrders' + id + '[\\s\\S]*?</tr>', 'i'))?.[0] || '';
  if (!row) return 'unknown';
  if (/mail-closed-send-disabled\.svg/i.test(row) || /уже была отправлена/i.test(row)) return 'sent';
  if (/mail-closed-send\.svg/i.test(row) && /sendBill\s*\(\s*['"]?[0-9]+/i.test(row)) return 'pending';
  return 'unknown';
}

function customerStateFromHtml(html, orderId) {
  const src = String(html || '');
  const id = String(orderId || '').replace(/[^0-9]/g, '');
  const row = src.match(new RegExp('<tr\\b[\\s\\S]*?inWorkSelectedOrders' + id + '[\\s\\S]*?</tr>', 'i'))?.[0] || '';
  if (!row) return 'unknown';
  return /href=["']\/clientinfo\//i.test(row) ? 'registered' : 'guest';
}

function plan(order) {
  const id = order.number;
  return {
    orderId: String(id),
    guest: isGuest(order),
    registration: isGuest(order) ? {
      method: 'POST', path: '/ajaxRoute/orders/changeOrderClient/regGuestAsCustomer',
      body: registrationBody(id),
    } : null,
    bill: {
      method: 'POST', path: `/orders/${encodeURIComponent(String(id))}/sendBill/ajax`,
      body: billBody(),
    },
  };
}

/**
 * Optional live transport. It requires a web-panel cookie, because these are
 * browser routes rather than the read-only ABCP admin API. Never enable this
 * implicitly from the watcher.
 */
function webGet(path) {
  const cookie = envValue('ORDER_AUTOPILOT_COOKIE').trim();
  if (!cookie) throw new Error('ORDER_AUTOPILOT_COOKIE is not configured');
  const url = new URL('https://cp.abcp.ru' + path);
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers: { Cookie: cookie, Accept: 'text/html,application/xhtml+xml' }, timeout: 15000 }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', c => { size += c.length; if (size <= 5 * 1024 * 1024) chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('autopilot request timeout')));
    req.on('error', reject); req.end();
  });
}

function webPost(path, body) {
  const base = 'https://cp.abcp.ru';
  const cookie = String(process.env.ORDER_AUTOPILOT_COOKIE || '').trim();
  if (!cookie) throw new Error('ORDER_AUTOPILOT_COOKIE is not configured');
  const url = new URL(base + path);
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body), Cookie: cookie,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
    }, timeout: 15000 }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data });
      });
    });
    req.on('timeout', () => req.destroy(new Error('autopilot request timeout')));
    req.on('error', reject); req.end(body);
  });
}

function emailSucceeded(response) {
  const values = response && response.message;
  return (Array.isArray(values) ? values : values ? [values] : []).some(x => /письмо успешно отправлено/i.test(String(x)));
}

function telegramFailed(response) {
  const values = response && response.errMessage;
  return (Array.isArray(values) ? values : values ? [values] : []).some(x => /telegram/i.test(String(x)));
}

/** Process one normalized/ described order. Dry-run returns a plan only. */
async function processOrder(order) {
  const p = plan(order);
  if (!enabled()) return { status: 'disabled', plan: p };
  const state = await store.autopilotState(order.number);
  if (state && state.bill_status === 'sent') return { status: 'already_sent', plan: p };
  if (state && state.last_action === 'bill_email_sent') return { status: 'already_sent', plan: p };
  if (dryRun() && state && state.last_action === 'dry_run') return { status: 'already_planned', plan: p };
  if (dryRun()) {
    await store.autopilotAction(order.number, 'dry_run', { plan: p });
    return { status: 'dry_run', plan: p };
  }

  let currentId = String((state && state.transferred_order_number) || order.number);
  const page = await webGet('/?page=orders');
  if (!page.ok) return { status: 'orders_page_failed', response: { status: page.status } };
  const customerState = customerStateFromHtml(page.text, currentId);
  const paymentState = paymentStateFromHtml(page.text, currentId);
  if (customerState === 'unknown' || paymentState === 'unknown') {
    await store.autopilotAction(currentId, 'blocked_unknown_html_state', { customerState, paymentState });
    return { status: 'blocked_unknown_html_state', customerState, paymentState };
  }
  if (paymentState === 'sent') return { status: 'already_sent', plan: p };
  if (customerState === 'guest' && (!state || state.registration_status !== 'succeeded')) {
    await store.autopilotAction(currentId, 'registration_started', { path: p.registration.path });
    const reg = await webPost(p.registration.path, p.registration.body);
    if (!reg.ok || !reg.data || !reg.data.url) {
      await store.autopilotAction(currentId, 'registration_failed', { response: reg });
      return { status: 'registration_failed', response: reg };
    }
    const m = String(reg.data.url).match(/id_order=(\d+)/);
    currentId = m ? m[1] : currentId;
    await store.autopilotAction(order.number, 'registration_succeeded', { response: reg, newOrderId: currentId });
  }

  const billPath = `/orders/${encodeURIComponent(currentId)}/sendBill/ajax`;
  await store.autopilotAction(currentId, 'bill_started', { path: billPath, amount: AMOUNT });
  const bill = await webPost(billPath, billBody());
  if (!bill.ok || !emailSucceeded(bill.data)) {
    await store.autopilotAction(currentId, 'bill_failed', { response: bill, emailSucceeded: false });
    return { status: 'bill_failed', response: bill };
  }
  await store.autopilotAction(currentId, 'bill_email_sent', { response: bill, telegramFailed: telegramFailed(bill.data), amount: AMOUNT });
  return { status: 'sent', emailSucceeded: true, telegramFailed: telegramFailed(bill.data), response: bill };
}

module.exports = { AMOUNT, enabled, dryRun, isGuest, registrationBody, billBody, plan, paymentStateFromHtml, customerStateFromHtml, emailSucceeded, telegramFailed, process: processOrder };
