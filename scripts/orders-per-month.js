/**
 * Incoming orders per month (BMW Club77, ABCP). READ-ONLY. Run in the app's Terminal in Coolify:
 *
 *   node scripts/orders-per-month.js        # last 12 full months + the current one
 *   node scripts/orders-per-month.js 24     # last 24 months
 *
 * Counts every order created in the month (active + archive, deleted ones excluded),
 * and the order sum. No customer data printed.
 */
const abcp = require('../lib/abcpOrders');
const stages = require('../lib/logistics/stages');

const MONTHS = Math.min(36, Math.max(1, Number(process.argv[2]) || 12));
const PAGE = 1000;

// ABCP: «Диапазон выбора даты создания заказа не должен превышать 1 год» → one request range per month.
async function fetchAll(start, end, isArchive) {
  const all = [];
  for (let page = 0; page < 200; page++) {
    const data = await abcp.apiGet('cp/orders', { dateCreatedStart: start, dateCreatedEnd: end, isArchive, limit: PAGE, skip: page * PAGE });
    const list = Array.isArray(data) ? data : (data && data.items) || [];
    all.push(...list);
    if (list.length < PAGE) return all;
  }
  console.warn('stopped at 200 pages — counts may be incomplete');
  return all;
}

(async () => {
  if (!abcp.enabled()) { console.error('ABCP API env not set'); process.exit(1); }
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - MONTHS, 1));
  const seen = new Map();
  for (let i = 0; i <= MONTHS; i++) {
    const a = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1)), b = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 0));
    const start = a.toISOString().slice(0, 10) + ' 00:00:00', end = b.toISOString().slice(0, 10) + ' 23:59:59';
    for (const isArchive of [0, 1]) for (const o of await fetchAll(start, end, isArchive)) if (o && o.number && !Number(o.isDelete)) seen.set(String(o.number), o);
    process.stderr.write('.');
  }
  process.stderr.write('\n');

  const months = new Map();
  for (const o of seen.values()) {
    const t = stages.ts(o.date);
    if (!t) continue;
    const d = new Date(t + 3 * 3600000); // Moscow month
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const m = months.get(key) || { n: 0, sum: 0 };
    m.n++; m.sum += Number(o.sum) || 0;
    months.set(key, m);
  }
  const keys = [...months.keys()].sort();
  const curKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  console.log('Месяц     Заказов   Сумма, ₽');
  for (const k of keys) console.log(`${k}${k === curKey ? '*' : ' '}  ${String(months.get(k).n).padStart(7)}   ${fmt(months.get(k).sum).padStart(12)}`);
  const full = keys.filter(k => k !== curKey);
  if (full.length) {
    const tot = full.reduce((a, k) => a + months.get(k).n, 0), sum = full.reduce((a, k) => a + months.get(k).sum, 0);
    console.log(`\nВ среднем за ${full.length} полн. мес.: ${fmt(tot / full.length)} заказов в месяц, средний месячный оборот ${fmt(sum / full.length)} ₽, средний чек ${fmt(sum / tot)} ₽`);
  }
  console.log('* текущий месяц, неполный. Всего заказов:', seen.size);
})().catch(e => { console.error(e.message); process.exit(1); });
