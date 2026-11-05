// Card labels and order-status wording (Диалоги ✗ 05.11). Run: npm test
const a = require('assert');
const chat = require('../api/chat.js');
const parts = [{ notes: { 'Примечание': 'Для цилиндров 1–4' } }, { notes: { 'Примечание': 'Для цилиндров 5–8' } }];
const cards = chat.labelSameNameCards(parts, [{ name: 'Сменный элемент фильтра', best_for: '' }, { name: 'Сменный элемент фильтра', best_for: '' }]);
a.deepStrictEqual(cards.map(c => c.best_for), ['Для цилиндров 1–4', 'Для цилиндров 5–8']);
const one = chat.labelSameNameCards([parts[0]], [{ name: 'Фильтр', best_for: '' }]);
a.strictEqual(one[0].best_for, '', 'a single card keeps its line empty');
for (const t of ['Писал в телеграм - нет ответа', 'никто не отвечает', 'не перезвонили', 'жду без ответа']) a.ok(chat.NO_ANSWER_RE.test(t), t);
for (const t of ['где мой заказ 288183838', 'ответьте по заказу']) a.ok(!chat.NO_ANSWER_RE.test(t), t);
console.log('test-cards: all ok');
