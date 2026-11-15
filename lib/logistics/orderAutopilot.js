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

const ENV = (typeof process !== 'undefined' && process.env) ? process.env : {};
const parsedAmount = Number(ENV.ORDER_AUTOPILOT_AMOUNT || 2000);
const AMOUNT = Number.isInteger(parsedAmount) && parsedAmount > 0 && parsedAmount <= 100000 ? parsedAmount : 2000;
const enabled = () => ENV.ORDER_AUTOPILOT_ENABLED === '1';
const dryRun = () => ENV.ORDER_AUTOPILOT_DRY_RUN !== '0';

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
function webPost(path, body) {
  const base = String(process.env.ORDER_AUTOPILOT_BASE_URL || 'https://cp.abcp.ru').replace(/\/$/, '');
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
  return !!(response && Array.isArray(response.message) && response.message.some(x => /письмо успешно отправлено/i.test(String(x))));
}

function telegramFailed(response) {
  return !!(response && Array.isArray(response.errMessage) && response.errMessage.some(x => /telegram/i.test(String(x))));
}

/** Process one normalized/ described order. Dry-run returns a plan only. */
async function process(order) {
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
  if (p.guest && (!state || state.registration_status !== 'succeeded')) {
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

module.exports = { AMOUNT, enabled, dryRun, isGuest, registrationBody, billBody, plan, emailSucceeded, telegramFailed, process };
