/** Read-only shape diagnostic for legacy cp/order. Prints keys and statuses only. */
const abcp = require('../lib/abcpOrders');
const number = process.argv[2];
(async () => {
  if (!number) throw new Error('Usage: node scripts/debug-abcp-legacy-order.js ORDER_NUMBER');
  const raw = await abcp.apiGet('cp/order', { number: String(number), format: 'additional' });
  const root = Array.isArray(raw) ? raw[0] : raw;
  const positions = root?.positions || root?.items || root?.order?.positions || [];
  const compact = {
    rootType: Array.isArray(raw) ? 'array' : typeof raw,
    rootKeys: root && typeof root === 'object' ? Object.keys(root).sort() : [],
    arrayLength: Array.isArray(raw) ? raw.length : null,
    orderKeys: root?.order && typeof root.order === 'object' ? Object.keys(root.order).sort() : [],
    positionContainer: Array.isArray(root?.positions) ? 'positions' : Array.isArray(root?.items) ? 'items' : Array.isArray(root?.order?.positions) ? 'order.positions' : 'none',
    positions: Array.isArray(positions) ? positions.slice(0, 5).map(p => ({
      keys: p && typeof p === 'object' ? Object.keys(p).sort() : [],
      status: p?.status ?? null,
      statusCode: p?.statusCode ?? null,
      id: p?.id ?? null,
      number: p?.number ?? null,
    })) : [],
  };
  console.log(JSON.stringify(compact, null, 2));
})().catch(err => { console.error(err.message); process.exit(1); });
