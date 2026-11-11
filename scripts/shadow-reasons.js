/**
 * The managers' reasons («Почему менеджер выбрал иначе») as plain text to paste to Claude. READ-ONLY.
 * Run in the app's Terminal in Coolify:
 *
 *   node scripts/shadow-reasons.js          # every marked disagreement + a summary
 *   node scripts/shadow-reasons.js --all    # also the unmarked disagreements
 *
 * No customer data: order number, part, suppliers, prices, reason, comment.
 */
const { withDb } = require('../lib/logistics/store');
const { REASONS } = require('../lib/logistics/shadow');
const all = process.argv.includes('--all');
const rub = n => n == null ? '—' : Math.round(Number(n)).toLocaleString('ru-RU') + ' ₽';

(async () => {
  const rows = await withDb(async c => (await c.query(
    `select number, brand, article, agent_supplier, agent_price_in, mgr_supplier, mgr_price_in, mgr_reason, mgr_reason_note, reason_by, order_date
       from logistics_shadow
      where mgr_supplier is not null and agent_supplier is not null and lower(mgr_supplier) <> lower(agent_supplier)
        ${all ? '' : 'and mgr_reason is not null'}
      order by order_date desc nulls last limit 500`)).rows);
  const cnt = {};
  console.log('Заказ | Деталь | Менеджер | Агент | Причина | Комментарий');
  for (const r of rows) {
    const reason = r.mgr_reason ? (REASONS[r.mgr_reason] || r.mgr_reason) : '—';
    // «другое» + a comment that IS a listed reason (e.g. «нет доставки») counts as that reason; a comment equal to the reason is dropped
    const note = (r.mgr_reason_note || '').trim().toLowerCase();
    const listed = Object.values(REASONS).find(v => v.toLowerCase() === note);
    const base = r.mgr_reason === 'other' && listed ? listed : reason;
    const key = base + (note && note !== base.toLowerCase() ? ' — ' + note : '');
    if (r.mgr_reason) cnt[key] = (cnt[key] || 0) + 1;
    console.log([r.number, `${r.brand || ''} ${r.article || ''}`.trim(), `${r.mgr_supplier} ${rub(r.mgr_price_in)}`,
      `${r.agent_supplier} ${rub(r.agent_price_in)}`, reason, r.mgr_reason_note || ''].join(' | '));
  }
  console.log(`\nСтрок: ${rows.length}. Итог по причинам:`);
  for (const [k, n] of Object.entries(cnt).sort((a, b) => b[1] - a[1])) console.log(`  ${n} × ${k}`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
