/**
 * lib/abcpOrders.js -- order status from the shop's ABCP admin API, for
 * customers who ask the chat "где мой заказ?".
 *
 * READ-ONLY by construction: apiGet() refuses every operation except the
 * three GET methods below, although the API-administrator account itself
 * could change orders, balances, etc. Docs: ABCP API -> Административный
 * интерфейс (cp/order, cp/users, cp/statuses).
 *
 * Privacy: an order is only described after the customer proves it's theirs
 * -- order number PLUS the phone or email on that order (or on the customer
 * account that placed it). "Not found" and "doesn't match" give the same
 * answer, and failed attempts are rate-limited per IP, so order numbers
 * can't be probed.
 *
 * Config (Coolify env vars only -- never in code or README):
 *   ABCP_API_HOST          e.g. xxx.public.api.abcp.ru (no https://); several
 *                          hosts may be given comma-separated -- tried in order,
 *                          the first one that answers is remembered
 *   ABCP_API_LOGIN         API-administrator login
 *   ABCP_API_PASSWORD_MD5  MD5 password from Настройка -> Система -> Данные для доступа к API
 * Kept outside api/ so server.js never mounts it as a route.
 */

const HOSTS = (process.env.ABCP_API_HOST || '').split(',')
  .map(h => h.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')).filter(Boolean);
let workingHost = null; // first host that answered
const LOGIN = process.env.ABCP_API_LOGIN || '';
const PSW   = process.env.ABCP_API_PASSWORD_MD5 || '';
const TIMEOUT_MS = 10000;

const READ_ONLY_OPS = new Set(['cp/order', 'cp/users', 'cp/statuses']);

function enabled() { return !!(HOSTS.length && LOGIN && PSW); }

/** Node's fetch says only "fetch failed"; the real reason is in err.cause. */
function netReason(err) {
  const c = err && err.cause;
  if (!c) return err.message;
  return [c.code, c.reason || c.message].filter(Boolean).join(': ') || err.message;
}

class AbcpError extends Error {}

/** GET one of the whitelisted read operations. Never logs the password. */
async function apiGet(op, params = {}) {
  if (!READ_ONLY_OPS.has(op)) throw new AbcpError(`operation ${op} is not allowed (read-only client)`);
  if (!enabled()) throw new AbcpError('ABCP API not configured');
  const qs = new URLSearchParams({ userlogin: LOGIN, userpsw: PSW });
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x, i) => qs.append(`${k}[${i}]`, String(x)));
    else if (v != null) qs.append(k, String(v));
  }
  // Try the remembered host first, then the others. Only network/TLS errors
  // move on to the next host; any HTTP answer is final.
  const order = workingHost ? [workingHost, ...HOSTS.filter(h => h !== workingHost)] : HOSTS;
  let res, lastErr;
  for (const host of order) {
    try {
      res = await fetch(`https://${host}/${op}?${qs}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (workingHost !== host) console.log(`[abcp] using API host ${host}`);
      workingHost = host;
      break;
    } catch (err) {
      lastErr = err;
      console.error(`[abcp] ${op} via ${host} failed: ${netReason(err)}`);
    }
  }
  if (!res) throw new AbcpError(`network: ${netReason(lastErr)}`);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new AbcpError(`${op}: HTTP ${res.status}, not JSON: ${text.slice(0, 150)}`); }
  // ABCP reports errors as { errorCode, errorMessage } (sometimes with HTTP 200).
  if (data && typeof data === 'object' && !Array.isArray(data) && data.errorCode) {
    const e = new AbcpError(`${op}: ABCP error ${data.errorCode}: ${data.errorMessage || ''}`);
    e.abcpCode = data.errorCode;
    throw e;
  }
  if (!res.ok) throw new AbcpError(`${op}: HTTP ${res.status}`);
  return data;
}

// ─── Status descriptions ("Описание для клиента"), cached 6 h ───────────────
let statusCache = null, statusCachedAt = 0;
async function statusComments() {
  if (statusCache && Date.now() - statusCachedAt < 6 * 3600 * 1000) return statusCache;
  try {
    const list = await apiGet('cp/statuses');
    statusCache = new Map((Array.isArray(list) ? list : []).map(s => [String(s.id), (s.comment || '').trim()]));
    statusCachedAt = Date.now();
  } catch (err) {
    console.error('[abcp] cp/statuses failed:', err.message);
    statusCache = statusCache || new Map();
  }
  return statusCache;
}

// ─── Ownership check helpers (pure, exported for tests) ─────────────────────
const PHONE_RE = /(?:\+?\d[\s\-()]*)?\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/g;
const EMAIL_RE = /[^\s@,;:<>()"']+@[^\s@,;:<>()"']+\.[a-z]{2,}/gi;

/** Last 10 digits of a Russian phone: "+7 (903) 671-31-25", "89036713125" -> "9036713125". */
function phoneKey(s) {
  const d = String(s || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
}

/** Every string inside a value (order, notes, additional...), flattened. */
function strings(v, out = []) {
  if (v == null) return out;
  if (typeof v === 'string' || typeof v === 'number') out.push(String(v));
  else if (Array.isArray(v)) v.forEach(x => strings(x, out));
  else if (typeof v === 'object') Object.values(v).forEach(x => strings(x, out));
  return out;
}

/** Phones and emails stored on the order and its customer. */
function contactsOf(order, user) {
  const sources = [
    order.userEmail, order.userMobile, order.userName, order.userFullName,
    order.additional, (order.notes || []).map(n => n && n.value),
    user && [user.email, user.phone, user.mobile],
  ];
  const phones = new Set(), emails = new Set();
  for (const s of strings(sources)) {
    for (const m of s.match(PHONE_RE) || []) { const k = phoneKey(m); if (k) phones.add(k); }
    for (const m of s.match(EMAIL_RE) || []) emails.add(m.toLowerCase());
  }
  return { phones, emails };
}

/** Does the customer's phone/email match the order? */
function contactMatches(order, user, given) {
  const { phones, emails } = contactsOf(order, user);
  const p = phoneKey(given.phone);
  const e = String(given.email || '').trim().toLowerCase();
  return !!((p && phones.has(p)) || (e && emails.has(e)));
}

// ─── Brute-force guard: failed checks per IP ────────────────────────────────
const FAIL_WINDOW_MS = 60 * 60 * 1000;
const MAX_FAILS = 5;
const fails = new Map(); // ip -> [timestamps]
function failCount(ip) {
  const now = Date.now();
  const list = (fails.get(ip) || []).filter(t => now - t < FAIL_WINDOW_MS);
  fails.set(ip, list);
  return list.length;
}
function addFail(ip) {
  failCount(ip);
  fails.get(ip).push(Date.now());
  if (fails.size > 5000) fails.clear();
}

/** Order number as the customer typed it -> digits only, or null. */
function normalizeOrderNumber(s) {
  const d = String(s || '').replace(/\D/g, '');
  return d.length >= 5 && d.length <= 12 ? d : null;
}

/**
 * Look up an order for the chat.
 *   lookupOrder({ number, phone, email, ip })
 * -> { status: 'ok', order: {...safe summary} }
 *  | { status: 'no_match' }        (not found OR contact doesn't match -- same answer on purpose)
 *  | { status: 'rate_limited' }
 *  | { status: 'unavailable', reason }
 */
async function lookupOrder({ number, phone, email, ip }) {
  if (!enabled()) return { status: 'unavailable', reason: 'not configured' };
  const num = normalizeOrderNumber(number);
  if (!num) return { status: 'no_match' };
  if (failCount(ip || '?') >= MAX_FAILS) return { status: 'rate_limited' };

  let order;
  try {
    order = await apiGet('cp/order', { number: num, format: 'additional' });
  } catch (err) {
    // An unknown number comes back as an ABCP error, not as an outage.
    if (err.abcpCode) { addFail(ip || '?'); console.log(`[abcp] order ${num}: ${err.message}`); return { status: 'no_match' }; }
    console.error('[abcp] cp/order failed:', err.message);
    return { status: 'unavailable', reason: err.message };
  }
  if (!order || typeof order !== 'object' || !order.number) { addFail(ip || '?'); return { status: 'no_match' }; }

  let user = null;
  if (!contactMatches(order, null, { phone, email }) && order.userId) {
    try {
      const users = await apiGet('cp/users', { customersIds: [order.userId] });
      user = (Array.isArray(users) ? users : users?.items || [])[0] || null;
    } catch (err) {
      console.error('[abcp] cp/users failed:', err.message);
    }
  }
  if (!contactMatches(order, user, { phone, email })) {
    addFail(ip || '?');
    console.log(`[abcp] order ${num}: contact does not match`);
    return { status: 'no_match' };
  }

  const comments = await statusComments();
  const positions = (order.positions || []).filter(p => !Number(p.isDelete)).map(p => ({
    brand: p.brand || null,
    number: p.number || null,
    description: p.description || null,
    quantity: Number(p.quantityFinal || p.quantity) || null,
    status: p.status || null,
    statusInfo: comments.get(String(p.statusCode)) || null,
    statusDate: p.statusChangeDate || null,
    deliveryDays: Number(p.deadline) ? Math.ceil(Number(p.deadline) / 24) : null,
    deliveryDaysMax: Number(p.deadlineMax) ? Math.ceil(Number(p.deadlineMax) / 24) : null,
  }));
  console.log(`[abcp] order ${num}: verified, ${positions.length} position(s)`);
  return {
    status: 'ok',
    order: {
      number: String(order.number),
      date: order.date || null,
      sum: Number(order.sum) || null,
      debt: Number(order.debt) || 0,
      paid: !!Number(order.paid) || order.paid === true,
      deliveryType: order.deliveryType || null,
      deliveryOffice: order.deliveryOffice || null,
      shipmentDate: order.shipmentDate || null,
      positions,
    },
  };
}

module.exports = {
  enabled, lookupOrder, normalizeOrderNumber,
  // exported for tests
  apiGet, phoneKey, contactsOf, contactMatches,
};
