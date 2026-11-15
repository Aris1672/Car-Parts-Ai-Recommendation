/**
 * lib/logistics/watch.js — logistics agent, phase 1: READ-ONLY watcher.
 *
 * Every LOGISTICS_POLL_MIN minutes (default 2): ABCP active orders of the
 * last LOGISTICS_DAYS days (default 60) via the read-only client
 * (lib/abcpOrders.js apiGet, operation cp/orders) -> stage + alerts
 * (lib/logistics/stages.js) -> our Postgres (lib/logistics/store.js) ->
 * new alerts as ONE short MAX message with a link to /logistics.
 * Nothing is ever written to ABCP.
 *
 * Switched on by LOGISTICS_ENABLED=1 (Coolify), started from server.js.
 * ABCP limits: cp/orders counts as «orders» (1 000/min, 20 000/h) — one pass
 * = 1–3 calls, 30 passes/h. Status history is loaded only when a manager
 * opens an order (api/logistics/data.js).
 */

const abcp = require('../abcpOrders');
const stages = require('./stages');
const store = require('./store');
const max = require('../maxNotify');
const suppliers = require('./suppliers');
const shadow = require('./shadow');
const orderAutopilot = require('./orderAutopilot');

const PAGE = 500;
const AUTOPILOT_DAYS = 1;
const AUTOPILOT_MAX_ORDERS = 7;
const MAX_PAGES = 6;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://bmwclub77.assistant24info.ru').replace(/\/+$/, '');

const state = { lastRun: null, lastOk: null, lastError: null, orders: 0, running: false };

function msk(ms) {
  // "YYYY-MM-DD HH:MM:SS" in Moscow time, ABCP's format
  return new Date(ms + 3 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

/** All active orders created in the window. Throws if the list may be incomplete. */
async function fetchActive(now = Date.now()) {
  const days = Number(process.env.LOGISTICS_DAYS) > 0 ? Number(process.env.LOGISTICS_DAYS) : 60;
  const start = msk(now - days * 86400000).slice(0, 10) + ' 00:00:00';
  const all = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await abcp.apiGet('cp/orders', { dateCreatedStart: start, isArchive: 0, limit: PAGE, skip: page * PAGE, desc: 1 });
    const list = Array.isArray(data) ? data : (data && data.items) || [];
    all.push(...list.filter(o => o && o.number && !Number(o.isDelete)));
    if (list.length < PAGE) return { orders: all, complete: true };
  }
  return { orders: all, complete: false };
}

const PRIORITY = ['loss', 'forgotten', 'no_stock', 'not_ordered', 'supplier_late', 'not_shipped', 'delivery_long', 'silent', 'loss_small'];
function alertsMessage(alerts) {
  const byOrder = new Map();
  const pr = k => { const i = PRIORITY.indexOf(k); return i < 0 ? 99 : i; };
  for (const a of [...alerts].sort((x, y) => pr(x.kind) - pr(y.kind))) {
    if (!byOrder.has(a.number)) byOrder.set(a.number, []);
    byOrder.get(a.number).push(a);
  }
  const store_ = (process.env.STORE_NAME || 'BMW Club77').trim();
  const lines = [`📦 <b>Логистика${store_ ? ` — ${store_}` : ''}: ${alerts.length} ${alerts.length === 1 ? 'новое предупреждение' : 'новых предупреждения'}</b>`, ''];
  for (const [num, list] of [...byOrder].slice(0, 8)) {
    lines.push(`• Заказ ${num}: ${[...new Set(list.map(a => a.text))].join(', ')}`);
  }
  if (byOrder.size > 8) lines.push(`… и ещё ${byOrder.size - 8} заказ(ов)`);
  lines.push('', `<a href="${PUBLIC_BASE_URL}/logistics">Открыть логистику</a>`);
  return lines.join('\n');
}

async function notify() {
  if (!max.enabled()) return 0;
  const alerts = await store.takeUnnotified();
  if (!alerts.length) return 0;
  const text = alertsMessage(alerts);
  const ids = String(process.env.LOGISTICS_MAX_CHAT_ID || process.env.MAX_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean);
  const res = await Promise.all(ids.map(id => max.sendText(id, text)));
  res.forEach((r, i) => { if (!r.ok) console.error(`[logistics] MAX to ${ids[i]} failed (HTTP ${r.status}): ${r.error}`); });
  return alerts.length;
}

/** One pass. Returns a short report. */
async function runOnce(now = Date.now()) {
  if (state.running) return { skipped: 'already running' };
  state.running = true;
  state.lastRun = new Date(now).toISOString();
  try {
    if (!abcp.enabled()) throw new Error('ABCP API not configured');
    const { orders, complete } = await fetchActive(now);
    const described = orders.map(o => stages.describe(stages.normalizeOrder(o), now));
    const opened = await store.savePass(described, now);
    const archived = complete ? await store.finishMissing(described.map(o => o.number)) : [];
    const hist = await suppliers.refreshHistory(described).catch(err => { console.error('[logistics] history refresh failed:', err.message); return { saved: 0, pending: 0 }; });
    if (hist.saved) console.log(`[logistics] status history: ${hist.saved} position(s) updated, ${hist.pending} still to load`);
    const sh = await shadow.step(described).catch(err => { console.error('[shadow] step failed:', err.message); return { picked: 0, resolved: 0 }; });
    if (sh.picked || sh.resolved) console.log(`[shadow] agent picks recorded: ${sh.picked}, manager decisions matched: ${sh.resolved}`);
    if (orderAutopilot.enabled()) {
      // Moscow calendar-day cutoff: today from 00:00 MSK, not a rolling 24h window.
      const nowMsk = new Date(Date.now() + 3 * 3600000);
      const cutoff = Date.UTC(nowMsk.getUTCFullYear(), nowMsk.getUTCMonth(), nowMsk.getUTCDate()) - 3 * 3600000;
      const eligible = described.filter(x => ['new', 'payment'].includes(x.stage) && stages.ts(x.date) >= cutoff && (x.positions || []).some(p => !['done', 'cancelled'].includes(stages.stageOfStatus(p.status))));
      const autopilotCandidates = [];
      for (const o of eligible) {
        if (autopilotCandidates.length >= AUTOPILOT_MAX_ORDERS) break;
        const state = await store.autopilotState(o.number).catch(() => null);
        if (state && ['dry_run', 'bill_email_sent'].includes(state.last_action)) continue;
        autopilotCandidates.push(o);
      }
      for (const o of autopilotCandidates) {
        await orderAutopilot.process(o).then(r => console.log(`[order-autopilot] ${o.number}: ${r.status}`)).catch(err => console.error(`[order-autopilot] ${o.number}: ${err.message}`));
      }
    }
    const pushed = await notify().catch(err => { console.error('[logistics] notify failed:', err.message); return 0; });
    state.lastOk = state.lastRun;
    state.lastError = null;
    state.orders = described.length;
    const late = described.filter(o => o.health === 'late').length;
    const count = list => Object.entries(list.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]);
    const byStage = count(described.map(o => o.stage));
    const byKind = count(described.flatMap(o => o.alerts.map(a => a.kind)));
    const byStatus = count(described.flatMap(o => o.positions.map(p => `${p.status || '—'}→${stages.stageOfStatus(p.status)}`)));
    state.summary = { byStage, byKind, byStatus: byStatus.slice(0, 30) };
    console.log(`[logistics] pass: ${described.length} active order(s)${complete ? '' : ' (list cut at ' + PAGE * MAX_PAGES + ')'}, ${opened.written ?? '?'} changed, ${late} late, ${opened.length} new alert(s), ${archived.length} archived, ${pushed} pushed to MAX, ${Date.now() - now} ms`);
    console.log(`[logistics] stages: ${byStage.map(([k, n]) => `${k} ${n}`).join(', ')} | alerts: ${byKind.map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
    console.log(`[logistics] top statuses (status→stage, positions): ${byStatus.slice(0, 15).map(([k, n]) => `${k} ${n}`).join('; ')}`);
    return { orders: described.length, late, opened: opened.length, archived: archived.length, pushed };
  } catch (err) {
    state.lastError = err.message;
    console.error('[logistics] pass failed:', err.message);
    return { error: err.message };
  } finally {
    state.running = false;
  }
}

let timer = null;
function start() {
  if (process.env.LOGISTICS_ENABLED !== '1') {
    console.log('[logistics] watcher off (LOGISTICS_ENABLED != 1)');
    return;
  }
  const min = Math.max(1, Number(process.env.LOGISTICS_POLL_MIN) || 2);
  console.log(`[logistics] watcher on: every ${min} min, read-only`);
  console.log(`[order-autopilot] config: enabled=${orderAutopilot.enabled()} dryRun=${orderAutopilot.dryRun()}`);
  setTimeout(() => runOnce(), 15000);
  timer = setInterval(() => runOnce(), min * 60000);
  timer.unref();
}

module.exports = { start, runOnce, state, alertsMessage, fetchActive };
