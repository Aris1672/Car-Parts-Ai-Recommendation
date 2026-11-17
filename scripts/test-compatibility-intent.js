// Reviews #1056 and #1049: explicit compatibility != order status or manager handoff.
const assert = require('assert');
const ask = require('../api/chat')._compatibilityRequest;
const user = content => ({ role: 'user', content });
for (const text of ['Подойдёт ли номер?', 'Подойдет ли номер?', 'Подойдёт ли деталь?', '🚗 Проверить совместимость', 'Проверка совместимости']) {
  const extracted = { orderStatusQuestion: true };
  const reply = ask(extracted, [user(text)]);
  assert.strictEqual(extracted.orderStatusQuestion, false);
  assert.ok(reply.includes('артикул') && reply.includes('VIN'), reply);
  assert.ok(!reply.includes('номер заказа') && !reply.includes('телефон'));
}
const e = { vendorCode: '34112359855', orderStatusQuestion: 'true' };
const r = ask(e, [user('34112359855'), { role: 'assistant', content: 'предложения' }, user('🚗 Проверить совместимость')]);
assert.ok(r.includes('34112359855') && r.includes('VIN'));
assert.ok(!r.includes('менеджер'));
const recovered = {};
ask(recovered, [user('34112359855'), user('Проверка совместимости')]);
assert.strictEqual(recovered.vendorCode, '34112359855');
const ready = { vendorCode: '13538631820', vin: 'WBS11CS0609158489', orderStatusQuestion: true };
assert.strictEqual(ask(ready, [user('Проверить совместимость')]), null, 'full data continues to existing catalog check');
assert.strictEqual(ready.orderStatusQuestion, false);
assert.ok(ask({ vin: 'WBS11CS0609158489' }, [user('Проверить совместимость')]).includes('артикул'));
for (const text of ['Где мой заказ?', 'Проверка заказа', 'Когда придёт заказ?', '289561682']) {
  const order = { orderStatusQuestion: true };
  assert.strictEqual(ask(order, [user(text)]), null);
  assert.strictEqual(order.orderStatusQuestion, true, 'order requests unaffected');
}
const widget = require('fs').readFileSync(require('path').join(__dirname, '../widget/chat-widget.js'), 'utf8');
assert.ok(!widget.includes("'Подойдёт ли номер?'"));
console.log('test-compatibility-intent: explicit actions, missing data, article memory and order isolation ok');
