const browser = require('../lib/logistics/abcpBrowser');
const auto = require('../lib/logistics/orderAutopilot');
const store = require('../lib/logistics/store');
const stages = require('../lib/logistics/stages');

(async () => {
  const nowMsk = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const cutoff = Date.UTC(
    nowMsk.getUTCFullYear(), nowMsk.getUTCMonth(), nowMsk.getUTCDate()
  ) - 3 * 60 * 60 * 1000;

  const rows = await store.listOrders(1);
  const candidates = rows.filter(o => {
    const s = o.summary || {};
    const time = stages.ts(s.date);
    const active = (s.positions || []).some(p =>
      !['done', 'cancelled'].includes(stages.stageOfStatus(p.status))
    );
    return time >= cutoff && ['new', 'payment'].includes(o.stage) && active;
  });

  const html = await browser.getOrdersHtml();
  const result = candidates.map(o => {
    const number = String(o.number);
    const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rowFound = new RegExp(`sendBill\\s*\\(\\s*['"]?${escaped}\\s*\\)`, 'i').test(html);
    return {
      order: number,
      stage: o.stage,
      customerState: auto.customerStateFromHtml(html, number),
      paymentState: auto.paymentStateFromHtml(html, number),
      rowFound
    };
  });

  console.log(JSON.stringify({
    cutoffMoscow: new Date(cutoff).toISOString(),
    candidateCount: candidates.length,
    result
  }, null, 2));
})().catch(err => { console.error(err.message); process.exit(1); });
