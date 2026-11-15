const browser = require('../lib/logistics/abcpBrowser');
const auto = require('../lib/logistics/orderAutopilot');
const ids = process.argv.slice(2);
(async () => {
  if (!ids.length) throw new Error('Provide order numbers');
  const html = await browser.getOrdersHtml();
  console.log(JSON.stringify(ids.map(order => ({ order, customer: auto.customerStateFromHtml(html, order), payment: auto.paymentStateFromHtml(html, order) })), null, 2));
})().catch(e => { console.error(e.message); process.exit(1); });
