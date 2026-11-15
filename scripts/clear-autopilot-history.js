/** Clear autopilot history for orders in the last N days only. */
const store = require('../lib/logistics/store');
const stages = require('../lib/logistics/stages');
(async () => {
  const days = Math.min(1, Math.max(1, Number(process.argv[2]) || 1));
  const cutoff = Date.now() - days * 86400000;
  await store.ensureTables();
  const rows = await store.listOrders(days);
  const numbers = rows.filter(r => stages.ts(r.summary?.date) >= cutoff).map(r => String(r.number));
  const result = await store.withDb(c => c.query('delete from logistics_autopilot where order_number = any($1::text[]) returning order_number', [numbers]));
  console.log(JSON.stringify({ days, considered: numbers.length, deleted: result.rows.length }, null, 2));
})().catch(err => { console.error(err.message); process.exit(1); });
