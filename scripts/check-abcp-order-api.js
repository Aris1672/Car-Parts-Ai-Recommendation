/**
 * Is «отправка заказов поставщикам через API» (cp/orders/online) available
 * on the shop's ABCP tariff? SAFE: every call is a bare GET with no
 * parameters — nothing can be created, changed or sent. Run once in the app's
 * Terminal in Coolify:
 *
 *   node scripts/check-abcp-order-api.js
 *
 * How to read it: a made-up operation answers «Unknown operation». If a real
 * operation answers the same, it is NOT on the tariff. Any OTHER answer
 * (missing parameter, wrong method, an empty list…) = the operation exists for
 * this API user. No secrets are printed.
 */
const abcp = require('../lib/abcpOrders');

const OPS = [
  ['cp/orders/doesNotExist123', 'контроль: несуществующая операция'],
  ['cp/orders', 'список заказов (мы уже читаем — должно работать)'],
  ['cp/orders/online', 'ОТПРАВКА ЗАКАЗОВ ПОСТАВЩИКАМ — то, что проверяем'],
  ['cp/order', 'изменение / чтение одного заказа'],
  ['cp/distributors', 'список поставщиков'],
  ['cp/routes', 'маршруты поставщиков'],
];

const short = s => String(s).replace(/\s+/g, ' ').slice(0, 220);

(async () => {
  if (!abcp.enabled()) { console.error('ABCP API env not set (ABCP_API_HOST / ABCP_API_LOGIN / ABCP_API_PASSWORD_MD5)'); process.exit(1); }
  const res = {};
  for (const [op, label] of OPS) {
    const r = await abcp.probeOperation(op);
    res[op] = r;
    const ans = r.ok ? `ответ получен (${Array.isArray(r.data) ? r.data.length + ' записей' : typeof r.data})` : short(r.error);
    console.log(`\n${op}\n  ${label}\n  → ${ans}`);
  }
  const unknown = r => !r.ok && /unknown operation|неизвестн/i.test(r.error || '');
  const ctrl = res['cp/orders/doesNotExist123'], online = res['cp/orders/online'];
  console.log('\n──────────────');
  if (!unknown(ctrl)) console.log('⚠ Контрольная операция ответила необычно — пришлите весь вывод в чат, разберём вручную.');
  else if (unknown(online)) console.log('❌ cp/orders/online: «Unknown operation» — отправка заказов поставщикам через API на тарифе НЕ подключена.');
  else console.log('✅ cp/orders/online существует для этого API-пользователя (ответ отличается от несуществующей операции). Отправка поставщикам через API доступна — дальше нужен тестовый заказ.');
  console.log('Ничего не создано и не отправлено: только GET без параметров.');
})();
