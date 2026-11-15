/** Safe read-only diagnostic for documented ABCP 2.0 admin API. */
const abcp = require('../lib/abcpCustomerApi');
const orderId = process.argv[2];
(async () => {
  if (!abcp || !abcp.listOrders) throw new Error('adapter unavailable');
  if (!process.env.ABCP_API_HOST || !process.env.ABCP_API_LOGIN || !process.env.ABCP_API_PASSWORD_MD5) {
    throw new Error('ABCP API env not set');
  }
  if (!orderId) {
    const r = await abcp.listOrders({ limit: 3, positionStatuses: 'new,prepayment' });
    console.log(JSON.stringify({ total: r.total, sample: (r.list || []).map(x => ({ id: x.id, number: x.number, clientId: x.clientId, createTime: x.createTime })) }, null, 2));
    return;
  }
  const order = await abcp.getOrder(orderId, 'amounts,posInfo,tags,agreement');
  console.log(JSON.stringify({ id: order.id, number: order.number, clientId: order.clientId, createTime: order.createTime, updateTime: order.updateTime, positions: order.posInfo, amounts: order.amounts }, null, 2));
})().catch(err => { console.error(err.message); process.exit(1); });
