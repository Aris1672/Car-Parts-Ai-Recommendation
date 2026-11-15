/**
 * Delete autopilot state for an explicitly supplied batch of order numbers.
 * This does not touch ABCP orders or logistics_orders.
 * Usage: node scripts/clear-autopilot-batch.js 123 456 ...
 */
const store = require('../lib/logistics/store');

(async () => {
  const numbers = [...new Set(process.argv.slice(2).map(String).filter(x => /^\d{5,12}$/.test(x)))];
  if (!numbers.length) throw new Error('Provide one or more numeric order numbers');
  if (numbers.length > 20) throw new Error('Refusing to clear more than 20 orders at once');
  await store.ensureTables();
  const result = await store.withDb(c => c.query(
    'delete from logistics_autopilot where order_number = any($1::text[]) returning order_number',
    [numbers]
  ));
  console.log(JSON.stringify({ requested: numbers, deleted: result.rows.map(r => r.order_number) }, null, 2));
})().catch(err => { console.error(err.message); process.exit(1); });
