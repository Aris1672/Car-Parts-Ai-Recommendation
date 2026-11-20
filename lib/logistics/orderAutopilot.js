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
const abcpCustomerApi = require('../abcpCustomerApi');
const abcpBrowser = require('./abcpBrowser');
const { stageOfStatus } = require('./stages');
const plannedThisProcess = new Set();

function envValue(name) {
  return (typeof process !== 'undefined' && process.env) ? String(process.env[name] || '') : '';
}
const parsedAmount = Number(envValue('ORDER_AUTOPILOT_AMOUNT') || 2000);
const AMOUNT = Number.isInteger(parsedAmount) && parsedAmount > 0 && parsedAmount <= 100000 ? parsedAmount : 2000;
const enabled = () => envValue('ORDER_AUTOPILOT_ENABLED') === '1';
const dryRun = () => envValue('ORDER_AUTOPILOT_DRY_RUN') !== '0';

function utcMillis(raw) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw)) return NaN;
  const ms = Date.parse(raw);
  const canonical = raw.includes('.') ? raw : raw.replace(/Z$/, '.000Z');
  return Number.isFinite(ms) && new Date(ms).toISOString() === canonical ? ms : NaN;
}

const startAt = () => utcMillis(envValue('ORDER_AUTOPILOT_START_AT'));

function eligibleForLaunch(order, cutoff, now = Date.now()) {
  if (!Number.isFinite(cutoff) || !/^\d+$/.test(String(order.number))) return false;
  const raw = String(order.date || '').trim();
  // Legacy cp/orders timestamps without an offset are Moscow wall time.
  const moscow = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/.exec(raw);
  const created = moscow ? utcMillis(moscow[1] + 'T' + moscow[2] + ':' + (moscow[3] || '00') + 'Z') - 10800000 : utcMillis(raw);
  return created >= cutoff && created <= now && ['new', 'payment'].includes(order.stage) &&
    (order.positions || []).some(p => ['new', 'payment'].includes(stageOfStatus(p.status)));
}

function isGuest(order) {
  const id = String(order && order.customerId || '').trim();
  const name = String(order && order.customer || '').trim().toLowerCase();
  // ABCP uses customer 426394 / «Гость» for guest orders.
  return !id || id === '426394' || name === 'гость' || name.startsWith('гость,');
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

function apiOrderState(order) {
  if (!order || !(order.id || order.internalNumber || order.number)) return 'unknown';
  const positions = order.posInfo || order.positions || order.items || [];
  const statuses = positions.map(p => String(p.status || p.positionStatus || '')).filter(Boolean);
  const pending = statuses.some(s => /^(prepayment|new)$/i.test(s));
  // Legacy cp/order fallback returns localized status names (e.g. «Заказ
  // принят», «Ждем предоплату»), not the /cp/ts enum. A non-empty position
  // list is still a known readable state; keep the exact payment/icon check
  // as the final eligibility gate.
  if (pending) return 'pending';
  if (statuses.length) return 'readable';
  return 'unknown';
}

function paymentStateFromHtml(html, orderId) {
  const src = String(html || '');
  const id = String(orderId || '').replace(/[^0-9]/g, '');
  if (!src || !id) return 'unknown';
  const markerText = `sendBill(${id})`;
  const hitIndex = src.indexOf(markerText);
  if (hitIndex < 0) return 'unknown';
  const chunk = src.slice(Math.max(0, hitIndex - 450), Math.min(src.length, hitIndex + 450));
  const icon = chunk.match(/mail-closed-send(?:-disabled)?.svg/i)?.[0] || '';
  if (/mail-closed-send-disabled\.svg/i.test(icon) || /уже была отправлена/i.test(chunk)) return 'sent';
  if (/mail-closed-send\.svg/i.test(icon)) return 'pending';
  return 'unknown';
}

function customerStateFromHtml(html, orderId) {
  const src = String(html || '');
  const id = String(orderId || '').replace(/[^0-9]/g, '');
  if (!src || !id) return 'unknown';
  const cheerio = require('cheerio');
  const $ = cheerio.load(src);
  const input = $("input[id='inWorkSelectedOrders" + id + "']").first();
  const row = input.closest('tr');
  if (!row.length) return 'unknown';
  const table = row.closest('table');
  if (!table.length) return 'unknown';
  const headers = table.find('tr').filter((_, tr) => $(tr).find('th').length).first().children('th,td').toArray();
  let clientIndex = -1;
  headers.forEach((cell, i) => { if (/клиент/i.test($(cell).text())) clientIndex = i; });
  if (clientIndex < 0) return 'unknown';
  const cell = row.children('td,th').toArray()[clientIndex];
  if (!cell) return 'unknown';
  const clientCell = $(cell);
  if (clientCell.find("a[href^='/clientinfo/']").length || clientCell.find('a[href^=\"/clientinfo/\"]').length) return 'registered';
  return clientCell.text().replace(/\s+/g, ' ').trim() ? 'guest' : 'unknown';
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
async function processOrder(order, phase = 'full', automatic = false) {
  const p = plan(order);
  if (!enabled()) return { status: 'disabled', plan: p };
  if (automatic && (!['register', 'payment'].includes(phase) || !eligibleForLaunch(order, startAt()))) {
    return { status: 'outside_launch_policy', plan: p };
  }
  const state = await store.autopilotState(order.number);
  if (automatic && state?.registration_status === 'started') return { status: 'recheck_required', plan: p };
  if (state && state.bill_status === 'sent') return { status: 'already_sent', plan: p };
  if (state && state.last_action === 'bill_email_sent') return { status: 'already_sent', plan: p };
  if (plannedThisProcess.has(String(order.number))) return { status: 'already_planned', plan: p };
  if (state && (['started', 'uncertain'].includes(state.bill_status) || ['bill_started', 'bill_uncertain', 'recheck_required'].includes(state.last_action))) {
    return { status: 'recheck_required', plan: p };
  }
  if (plannedThisProcess.has(String(order.number))) return { status: 'already_planned', plan: p };
  if (dryRun() && state && state.last_action === 'dry_run') return { status: 'already_planned', plan: p };
  let currentId = String((state && state.transferred_order_number) || order.number);
  const apiOrderId = currentId || order.id || order.orderId;
  const apiOrder = await abcpCustomerApi.getOrder(apiOrderId, 'amounts,posInfo,tags,agreement').catch(err => { console.error(`[order-autopilot] API get failed for ${currentId}: ${err.message}`); return null; });
  if (!apiOrder) {
    if (!automatic) await store.autopilotAction(currentId, 'blocked_api_order_unavailable', {});
    return { status: 'blocked_api_order_unavailable' };
  }
  const apiState = apiOrderState(apiOrder);
  if (apiState === 'unknown') {
    if (!automatic) await store.autopilotAction(currentId, 'blocked_api_unknown_state', {});
    return { status: 'blocked_api_unknown_state' };
  }
  const pageText = await abcpBrowser.getOrdersHtml().catch(err => {
    console.error(`[order-autopilot] browser orders page failed for ${currentId}: ${err.message}`);
    return null;
  });
  if (!pageText) return { status: 'orders_page_failed' };
  const customerState = customerStateFromHtml(pageText, currentId);
  const paymentState = paymentStateFromHtml(pageText, currentId);
  if (customerState === 'unknown' || paymentState === 'unknown') {
    if (!automatic) await store.autopilotAction(currentId, 'blocked_unknown_html_state', { customerState, paymentState });
    return { status: 'blocked_unknown_html_state', customerState, paymentState };
  }
  if (automatic) {
    const { paymentReceived } = require('./prepaymentReminders');
    const payment = paymentReceived(pageText, currentId);
    if (payment !== 'unpaid') return { status: 'payment_' + payment, plan: p };
  }
  if (paymentState === 'sent') return { status: 'already_sent', plan: p };
  if (state?.transferred_order_number && customerState !== 'registered') return { status: 'blocked_after_transfer', orderId: currentId };
  if (phase === 'register') {
    if (customerState === 'registered') return { status: 'already_registered', plan: p };
    if (dryRun()) { if (!automatic) await store.autopilotAction(order.number, 'dry_run_registration', { plan: p }); return { status: 'dry_run_registration', plan: p }; }
    if (automatic && !await store.claimAutomaticTransfer(order.number)) return { status: 'transfer_not_claimed', plan: p };
    const transfer = await abcpBrowser.transferGuestOrder(currentId);
    if (automatic && (!/^\d+$/.test(String(transfer.orderId || '')) || String(transfer.orderId) === currentId)) {
      return { status: 'recheck_required', plan: p };
    }
    await store.autopilotAction(order.number, 'registration_succeeded', { newOrderId: transfer.orderId, ...(automatic ? { authorization: 'launch_policy' } : { response: { url: transfer.url } }) });
    return { status: 'registered', orderId: transfer.orderId };
  }
  if (phase === 'payment' && customerState === 'guest') return { status: 'blocked_guest_not_registered', plan: p };
  if (dryRun()) {
    if (!automatic) await store.autopilotAction(order.number, 'dry_run', { plan: p, apiState, customerState, paymentState });
    plannedThisProcess.add(String(order.number));
    return { status: 'dry_run', plan: p, apiState, customerState, paymentState };
  }
  if (customerState === 'guest') {
    const transfer = await abcpBrowser.transferGuestOrder(currentId);
    currentId = transfer.orderId || '';
    if (!currentId) {
      await store.autopilotAction(order.number, 'registration_failed', { reason: 'transferred_order_number_missing', response: { url: transfer.url } });
      return { status: 'blocked_after_transfer', orderId: null };
    }
    await store.autopilotAction(order.number, 'registration_succeeded', { newOrderId: currentId, response: { url: transfer.url } });
    const after = await abcpBrowser.getOrdersHtml().catch(() => null);
    if (!after || customerStateFromHtml(after, currentId) !== 'registered' || paymentStateFromHtml(after, currentId) !== 'pending') return { status: 'blocked_after_transfer', orderId: currentId };
  }
  const amount = automatic ? 2000 : AMOUNT;
  if (!automatic && (!state || state.last_action !== 'bill_approved_once')) return { status: 'approval_required', plan: p };
  const claimed = automatic
    ? await store.claimAutomaticInitialBill(order.number, currentId)
    : await store.claimInitialBill(order.number, amount, currentId);
  if (!claimed) return { status: 'already_claimed', plan: p };
  let sent;
  try {
    sent = await abcpBrowser.sendAdvanceLink(currentId, amount);
  } catch (error) {
    await store.autopilotAction(order.number, 'bill_uncertain', { paymentOrderId: currentId, amount, errorCode: error.code || null, httpStatus: error.httpStatus || null });
    throw error;
  }
  await store.autopilotAction(order.number, 'bill_email_sent', { ...sent, paymentOrderId: currentId, amount });
  await store.recordInitialBill(currentId);
  return { status: 'sent', ...sent };
}

module.exports = { AMOUNT, enabled, dryRun, startAt, eligibleForLaunch, isGuest, registrationBody, billBody, plan, apiOrderState, paymentStateFromHtml, customerStateFromHtml, emailSucceeded, telegramFailed, process: processOrder };
