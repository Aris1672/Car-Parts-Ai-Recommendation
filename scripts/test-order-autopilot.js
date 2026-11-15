const assert = require('assert');
const a = require('../lib/logistics/orderAutopilot');

assert.strictEqual(a.registrationBody('123'), 'orderId=123');
const body = a.billBody();
for (const x of ['billType=pdf', 'linkType=pdf', 'email=on', 'telegram=on', 'advanceLinkAmount=2000', 'sendType=advanceLink']) assert.ok(body.includes(x), x);
assert.strictEqual(a.emailSucceeded({ message: ['Письмо успешно отправлено'] }), true);
assert.strictEqual(a.telegramFailed({ errMessage: ['Не удалось отправить сообщение, попробуйте еще раз позже! (Telegram)'] }), true);
assert.strictEqual(a.emailSucceeded({ message: [], errMessage: [] }), false);
const p = a.plan({ number: '42', customerId: null });
assert.strictEqual(p.guest, true);
assert.ok(p.registration.path.includes('regGuestAsCustomer'));
assert.ok(p.bill.path.endsWith('/orders/42/sendBill/ajax'));
console.log('order autopilot tests passed');
