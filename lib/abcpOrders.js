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

const READ_ONLY_OPS = new Set(['cp/order', 'cp/orders', 'cp/users', 'cp/statuses']);

function enabled() { return !!(HOSTS.length && LOGIN && PSW); }

/** Node's fetch says only "fetch failed"; the real reason is in err.cause. */
function netReason(err) {
  const c = err && err.cause;
  if (!c) return err.message;
  return [c.code, c.reason || c.message].filter(Boolean).join(': ') || err.message;
}

class AbcpError extends Error {}

// ─── TLS for the panel's host name ──────────────────────────────────────────
// The panel gives a host like "bmwmperformance.ru.public.api.abcp.ru", but
// ABCP's certificate is "*.public.api.abcp.ru", and a wildcard covers only ONE
// label -- so normal verification rejects it (ERR_TLS_CERT_ALTNAME_INVALID,
// seen 23.10). The certificate CHAIN is still fully verified; only the
// host-name rule is relaxed, and only for names under .public.api.abcp.ru
// presented with ABCP's own wildcard certificate.
const tls = require('tls');
const https = require('https');
const ABCP_SUFFIX = '.public.api.abcp.ru';

function checkAbcpIdentity(host, cert) {
  const err = tls.checkServerIdentity(host, cert);
  if (!err) return undefined;
  const h = String(host).replace(/\.$/, '').toLowerCase();
  const sans = String(cert && cert.subjectaltname || '').split(',').map(x => x.trim().toLowerCase());
  if (h.endsWith(ABCP_SUFFIX) && sans.includes('dns:*' + ABCP_SUFFIX)) return undefined;
  return err;
}

const needsRelaxedName = host => host.toLowerCase().endsWith(ABCP_SUFFIX) && host.slice(0, -ABCP_SUFFIX.length).includes('.');

/** GET returning a fetch-like { status, ok, text() }. */
function httpGet(url) {
  const host = new URL(url).hostname;
  if (!needsRelaxedName(host)) return fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  return new Promise((resolve, reject) => {
    const req = https.get(url, { checkServerIdentity: checkAbcpIdentity, timeout: TIMEOUT_MS }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, text: async () => body });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', err => reject(Object.assign(new TypeError('request failed'), { cause: err })));
  });
}

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
      res = await httpGet(`https://${host}/${op}?${qs}`);
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

// ─── "Код заказа" from the order note ───────────────────────────────────────
// Orders from another channel carry "Код заказа: 304981534, E-mail: …" in a
// note, and customers quote that code -- which ABCP doesn't know as an order
// number. Find it in recent orders' notes (one list call, cached 10 min).
const CODE_SCAN_DAYS = 90;
let recentOrders = null, recentAt = 0;
async function listRecentOrders() {
  if (recentOrders && Date.now() - recentAt < 10 * 60 * 1000) return recentOrders;
  const start = new Date(Date.now() - CODE_SCAN_DAYS * 86400000).toISOString().slice(0, 10) + ' 00:00:00';
  let list = await apiGet('cp/orders', { dateCreatedStart: start, format: 'short', limit: 1000, desc: 1 });
  list = Array.isArray(list) ? list : (list && list.items) || [];
  if (list.length && !list.some(o => o && 'notes' in o)) {
    // "short" may leave the notes out -- fall back to the full format.
    console.log('[abcp] cp/orders format=short has no notes, using full format');
    const full = await apiGet('cp/orders', { dateCreatedStart: start, limit: 1000, desc: 1 });
    list = Array.isArray(full) ? full : (full && full.items) || [];
  }
  recentOrders = list; recentAt = Date.now();
  return list;
}

/** Online order number for a "Код заказа" written in a note, or null. */
async function numberByNoteCode(code) {
  const re = new RegExp(`Код\\s*заказа\\s*[:№#]?\\s*${code}(?!\\d)`, 'i');
  try {
    const hit = (await listRecentOrders()).find(o => strings(o && o.notes).some(t => re.test(t)));
    return hit ? String(hit.number) : null;
  } catch (err) {
    console.error('[abcp] code search failed:', err.message);
    return null;
  }
}

/** Masked summary of what an order holds, for logs (never full contacts). */
function maskedContacts(order, user) {
  const { phones, emails } = contactsOf(order, user);
  return `phones=[${[...phones].map(p => '…' + p.slice(-2)).join(',')}] emails=[${[...emails].map(e => e[0] + '…@' + e.split('@')[1]).join(',')}]`;
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
  const getOrder = n => apiGet('cp/order', { number: n, format: 'additional' });
  try {
    order = await getOrder(num);
  } catch (err) {
    if (!err.abcpCode) {
      console.error('[abcp] cp/order failed:', err.message);
      return { status: 'unavailable', reason: err.message };
    }
    // Unknown online number: maybe it's the "Код заказа" from a note.
    console.log(`[abcp] order ${num}: ${err.message} -- trying it as "Код заказа"`);
    const real = await numberByNoteCode(num);
    if (!real) { addFail(ip || '?'); console.log(`[abcp] "Код заказа" ${num}: not found in the last ${CODE_SCAN_DAYS} days`); return { status: 'no_match' }; }
    console.log(`[abcp] "Код заказа" ${num} -> order ${real}`);
    try { order = await getOrder(real); }
    catch (e2) { console.error('[abcp] cp/order failed:', e2.message); return { status: e2.abcpCode ? 'no_match' : 'unavailable', reason: e2.message }; }
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
    console.log(`[abcp] order ${num}: contact does not match; order has ${maskedContacts(order, user)}; fields: ${Object.keys(order).join(',')}`);
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
  apiGet, phoneKey, contactsOf, contactMatches, checkAbcpIdentity, needsRelaxedName,
};
