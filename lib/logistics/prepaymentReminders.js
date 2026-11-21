/** One durable reminder, at least 65 minutes after a newly recorded first email.
 * Live reminders require verified payment-cell selectors; default is off.
 */
const cheerio = require('cheerio');
const store = require('./store');
const browser = require('./abcpBrowser');

const PAID_SELECTORS = {
  green: 'button.linkPaymentBtn.bp3-icon-plus.bp3-intent-success',
  red: 'button.delete-payment-order-links.bp3-icon-cross.bp3-intent-danger',
};

function paymentReceived(html, number, selectors = PAID_SELECTORS) {
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
  // ABCP wraps even an unpaid cell in an empty cp-flex gap5 div. Only
  // accept that verified structure (or a truly empty cell), not arbitrary UI.
  if (cell.html().trim() === '') return 'unpaid';
  const wrapper = cell.children();
  if (wrapper.length === 1 && wrapper.is('div.cp-flex.gap5') &&
      wrapper.children().length === 0 && wrapper.text().trim() === '' && cell.text().trim() === '') return 'unpaid';
  return 'unknown';
}

async function run() {
  // Browser reads can submit credentials. Pause before queue or browser work.
  if (process.env.PREPAYMENT_REMINDERS_ENABLED !== '1' || !browser.liveActionsEnabled()) return;
  const rows = await store.dueReminders();
  for (const row of rows) {
    browser.assertWatcherAvailable();
    const id = row.order_number;
    try {
      const html = await browser.getOrdersHtml();
      const state = paymentReceived(html, id, {
        green: process.env.ABCP_PREPAYMENT_GREEN_SELECTOR || PAID_SELECTORS.green,
        red: process.env.ABCP_PREPAYMENT_RED_SELECTOR || PAID_SELECTORS.red,
      });
      if (state === 'unknown') { console.log('[prepayment-reminder] ' + id + ': payment_unknown'); continue; }
      if (state === 'paid') { await store.finishReminder(id, 'paid', {}); continue; }
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
    } catch (error) {
      browser.assertWatcherAvailable();
      console.error('[prepayment-reminder] ' + id + ': operation failed');
    }
    browser.assertWatcherAvailable();
  }
}
module.exports = { paymentReceived, run };
