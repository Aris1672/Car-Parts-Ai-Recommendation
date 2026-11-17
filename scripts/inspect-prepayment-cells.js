/** Read-only: print only payment-cell HTML, never customer credentials. */
const cheerio = require('cheerio');
const browser = require('../lib/logistics/abcpBrowser');
(async () => {
  const ids = process.argv.slice(2);
  if (!ids.length || ids.some(id => !/^[0-9]+$/.test(id))) throw new Error('Provide numeric order numbers');
  const $ = cheerio.load(await browser.getOrdersHtml());
  for (const id of ids) {
    const row = $('input').filter((_, el) => $(el).attr('id') === 'inWorkSelectedOrders' + id).closest('tr');
    const table = row.closest('table');
    const headers = table.find('tr').filter((_, el) => $(el).children('th').length).first().children('th,td');
    let index = -1;
    headers.each((i, el) => { if ($(el).text().trim() === 'Платежи') index = i; });
    console.log(JSON.stringify({ order: id, found: row.length === 1 && index >= 0, paymentCell: index >= 0 ? row.children('td').eq(index).html() : null }));
  }
})().catch(error => { console.error(error.message); process.exit(1); });
