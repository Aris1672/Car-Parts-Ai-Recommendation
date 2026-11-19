const assert = require('assert');
const a = require('../lib/logistics/orderAutopilot');
const browser = require('../lib/logistics/abcpBrowser');
assert.strictEqual(browser.transferredOrderIdFromUrl('/orders/view?id_order=289831906'), '289831906');
assert.strictEqual(browser.transferredOrderIdFromUrl('/orders/289831906'), '289831906');
assert.strictEqual(browser.transferredOrderIdFromUrl('/orders/view'), null);

assert.strictEqual(a.registrationBody('123'), 'orderId=123');
assert.strictEqual(a.isGuest({ customerId: '426394', customer: 'Гость' }), true);
assert.strictEqual(a.isGuest({ customerId: '7', customer: 'Registered' }), false);
const body = a.billBody();
for (const x of ['billType=pdf', 'linkType=pdf', 'email=on', 'telegram=on', 'advanceLinkAmount=2000', 'sendType=advanceLink']) assert.ok(body.includes(x), x);
const htmlPending = '<table><tr><th>Заказ</th><th>Клиент</th><th>Действия</th></tr><tr><td><input id="inWorkSelectedOrders42"></td><td><a href="/clientinfo/7">Иван</a></td><td><a onclick="sendBill(42)"><img src="mail-closed-send.svg"></a></td></tr></table>';
const htmlSent = '<table><tr><th>Заказ</th><th>Клиент</th><th>Действия</th></tr><tr><td><input id="inWorkSelectedOrders43"></td><td>Иван</td><td><a onclick="sendBill(43)"><img src="mail-closed-send-disabled.svg"></a></td></tr></table>';
const htmlGuestWithUnrelatedClientLink = '<table><tr><th>Заказ</th><th>Клиент</th><th>Действия</th></tr><tr><td><input id="inWorkSelectedOrders44"></td><td>Гость, phone</td><td><a href="/clientinfo/999">unrelated</a><a onclick="sendBill(44)"><img src="mail-closed-send.svg"></a></td></tr></table>';
assert.strictEqual(a.paymentStateFromHtml(htmlPending, 42), 'pending');
assert.strictEqual(a.paymentStateFromHtml(htmlSent, 43), 'sent');
assert.strictEqual(a.customerStateFromHtml(htmlPending, 42), 'registered');
assert.strictEqual(a.customerStateFromHtml(htmlGuestWithUnrelatedClientLink, 44), 'guest');
assert.strictEqual(a.customerStateFromHtml('<table><tr><th>Заказ</th><th>Клиент</th></tr><tr><td><input id="inWorkSelectedOrders45"></td><td>Гость, phone</td></tr></table>', 45), 'guest');
assert.strictEqual(a.customerStateFromHtml('<table><tr><th>Заказ</th><th>Клиент</th></tr><tr><td><input id="inWorkSelectedOrders46"></td><td><a href="/clientinfo/7">Иван</a></td></tr></table>', 46), 'registered');
assert.strictEqual(a.emailSucceeded({ message: ['Письмо успешно отправлено'] }), true);
assert.strictEqual(a.telegramFailed({ errMessage: ['Не удалось отправить сообщение, попробуйте еще раз позже! (Telegram)'] }), true);
assert.strictEqual(a.emailSucceeded({ message: [], errMessage: [] }), false);
const p = a.plan({ number: '42', customerId: null });
assert.strictEqual(p.guest, true);
assert.ok(p.registration.path.includes('regGuestAsCustomer'));
assert.ok(p.bill.path.endsWith('/orders/42/sendBill/ajax'));
(async () => {
  const store = require('../lib/logistics/store');
  const customerApi = require('../lib/abcpCustomerApi');
  const originalState = store.autopilotState;
  const originalGetOrder = customerApi.getOrder;
  const originalGetHtml = browser.getOrdersHtml;
  const oldEnabled = process.env.ORDER_AUTOPILOT_ENABLED;
  const oldDryRun = process.env.ORDER_AUTOPILOT_DRY_RUN;
  process.env.ORDER_AUTOPILOT_ENABLED = '1';
  process.env.ORDER_AUTOPILOT_DRY_RUN = '0';
  store.autopilotState = async () => null;
  customerApi.getOrder = async () => ({ id: '290528868', posInfo: [{ status: 'new' }] });
  browser.getOrdersHtml = async () => '<table><tr><th>Заказ</th><th>Клиент</th><th>Действия</th></tr><tr><td><input id="inWorkSelectedOrders290528868"></td><td><a href="/clientinfo/159543324">Client</a></td><td><a onclick="sendBill(290528868)"><img src="mail-closed-send.svg"></a></td></tr></table>';
  try {
    const result = await a.process({ number: '290528868', customerId: '159543324', customer: 'Client' }, 'payment');
    assert.strictEqual(result.status, 'approval_required');
  } finally {
    store.autopilotState = originalState;
    customerApi.getOrder = originalGetOrder;
    browser.getOrdersHtml = originalGetHtml;
    if (oldEnabled === undefined) delete process.env.ORDER_AUTOPILOT_ENABLED; else process.env.ORDER_AUTOPILOT_ENABLED = oldEnabled;
    if (oldDryRun === undefined) delete process.env.ORDER_AUTOPILOT_DRY_RUN; else process.env.ORDER_AUTOPILOT_DRY_RUN = oldDryRun;
  }
  console.log('order autopilot tests passed');
})().catch(err => { console.error(err); process.exitCode = 1; });
