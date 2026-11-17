/** One durable reminder, at least 65 minutes after a newly recorded first email.
 * Live reminders require verified payment-cell selectors; default is off.
 */
const cheerio = require('cheerio');
const store = require('./store');
const browser = require('./abcpBrowser');

function paymentReceived(html, number, selectors = {}) {
  if (!/^[0-9]+$/.test(String(number))) return 'unknown';
  const $ = cheerio.load(String(html || ''));
  const markers = $('input').filter((_, el) => $(el).attr('id') === 'inWorkSelectedOrders' + number);
  if (markers.length !== 1) return 'unknown';
  const row = markers.closest('tr');
  const table = row.closest('table');
  const headers = table.find('tr').filter((_, el) => $(el).closest('table')[0] === table[0] && $(el).children('th').length).first().children('th,td');
  const indexes = [];
  headers.each((i, el) => { if ($(el).text().replace(/\s+/g, ' ').trim() === 'Платежи') indexes.push(i); });
  if (indexes.length !== 1) return 'unknown';
  // Ambiguous spans are not safe to map by array index.
  if (headers.toArray().some(el => Number($(el).attr('colspan') || 1) !== 1)) return 'unknown';
  const cell = row.children('td').eq(indexes[0]);
  if (!cell.length || cell.attr('colspan')) return 'unknown';
  // Both paid indicators must be explicitly configured from real ABCP HTML.
  if (!selectors.green || !selectors.red) return 'unknown';
  try {
    if (cell.find(selectors.green).length || cell.find(selectors.red).length) return 'paid';
  } catch { return 'unknown'; }
  // An empty, identified payment cell is unpaid; unfamiliar markup is unknown.
  return cell.html().trim() === '' ? 'unpaid' : 'unknown';
}

async function run() {
  if (process.env.PREPAYMENT_REMINDERS_ENABLED !== '1') return;
  const rows = await store.dueReminders();
  for (const row of rows) {
    const id = row.order_number;
    try {
      const html = await browser.getOrdersHtml();
      const state = paymentReceived(html, id, {
        green: process.env.ABCP_PREPAYMENT_GREEN_SELECTOR,
        red: process.env.ABCP_PREPAYMENT_RED_SELECTOR,
      });
      if (state === 'unknown') { console.log('[prepayment-reminder] ' + id + ': payment_unknown'); continue; }
      if (state === 'paid') { await store.finishReminder(id, 'paid', {}); continue; }
      if (process.env.ORDER_AUTOPILOT_ENABLED !== '1' || process.env.ORDER_AUTOPILOT_DRY_RUN !== '0') {
        console.log('[prepayment-reminder] ' + id + ': dry_run'); continue;
      }
      // Claim BEFORE external send. A crash/uncertain response cannot cause a retry.
      if (!await store.claimReminder(id)) continue;
      try {
        const result = await browser.sendAdvanceLink(id, 2000);
        await store.finishReminder(id, 'sent', result);
        console.log('[prepayment-reminder] ' + id + ': sent');
      } catch (error) {
        await store.finishReminder(id, 'uncertain', { message: error.message });
        console.error('[prepayment-reminder] ' + id + ': uncertain; manual review required');
      }
    } catch (error) { console.error('[prepayment-reminder] ' + id + ': ' + error.message); }
  }
}
module.exports = { paymentReceived, run };
