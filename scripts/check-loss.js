/**
 * Why so many «Продаём в минус» alerts? READ-ONLY. Run in the app's Terminal in Coolify:
 *
 *   node scripts/check-loss.js        # 8 orders with open «loss» alerts
 *   node scripts/check-loss.js 20
 *
 * For each: the raw ABCP price fields of the alerted positions (cp/order) —
 * priceIn, priceOut, price, priceRate, currency ids, quantity — plus the
 * order's sum. No names, phones or addresses are printed.
 */
const abcp = require('../lib/abcpOrders');
const { withDb } = require('../lib/logistics/store');

const N = Number(process.argv[2]) || 8;
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));

(async () => {
  if (!abcp.enabled()) { console.error('ABCP API env not set'); process.exit(1); }
  const alerts = await withDb(async c => (await c.query(
    `select number, position, detail from logistics_alerts where kind = 'loss' and resolved_at is null order by created_at desc limit 200`)).rows);
  const byOrder = new Map();
  for (const a of alerts) { if (!byOrder.has(a.number)) byOrder.set(a.number, []); byOrder.get(a.number).push(a); }
  console.log(`open «loss» alerts: ${alerts.length} (showing ${Math.min(N, byOrder.size)} orders)\n`);
  for (const [number, list] of [...byOrder].slice(0, N)) {
    let o;
    try { o = await abcp.apiGet('cp/order', { number, format: 'additional' }); o = Array.isArray(o) ? o[0] : o; }
    catch (err) { console.log(`order ${number}: ${err.message}\n`); continue; }
    if (!o) { console.log(`order ${number}: not found\n`); continue; }
    console.log(`ORDER ${number}`, JSON.stringify(pick(o, ['sum', 'debt', 'paid', 'deliveryCost', 'discount', 'currencyId', 'margin', 'income'])));
    const arts = new Set(list.map(a => a.position));
    for (const p of (o.positions || []).filter(p => arts.has(p.number))) {
      console.log('  ', p.number, JSON.stringify(pick(p, ['status', 'quantity', 'quantityFinal', 'priceIn', 'priceOut', 'price', 'oldPriceOut', 'priceRate', 'currencyInId', 'currencyOutId', 'distributorName', 'isDelete'])));
    }
    console.log('   our alert:', list[0].detail, '\n');
  }
  process.exit(0);
})().catch(err => { console.error(err.message); process.exit(1); });
