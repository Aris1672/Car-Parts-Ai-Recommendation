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
{
  const k = chat.kitItemAsked;
  a.ok(k('Сколько свечи нужно заказать?').test('свеча зажигания BMW'));
  a.ok(!k('Сколько свечи нужно заказать?').test('Воздушный фильтр'));
  a.strictEqual(k('ТО для моей машины'), null);
  a.strictEqual(k('WBS11CS0609158489'), null);
  a.strictEqual(k('свечи и воздушный фильтр'), null, 'two positions -> whole kit');
  console.log('test-cards: kit follow-up ok');
}
{
  const t = chat.cleanCardsText('Принял, сейчас проверю по VIN.\n<<<PRODUCTS>>>\n[]\n<<<END_PRODUCTS>>>', 'Подобрал набор ТО для вашего BMW XM 50e — всё в карточках ниже.');
  a.ok(t.startsWith('Подобрал набор ТО') && !/сейчас проверю/.test(t), t);
  const u = chat.cleanCardsText('Для вашего XM 50e нужно 6 свечей.\n<<<PRODUCTS>>>\n[]\n<<<END_PRODUCTS>>>', 'X');
  a.ok(u.startsWith('Для вашего'), 'a real answer stays');
  console.log('test-cards: stall line ok');
}
{
  const L = require('../lib/laximo.js');
  const U = 'Масляный фильтр смаз.сист.,теплообменник';
  const rows = [{ oem: '11427800066', name: 'Масляный фильтр', unit: U }, { oem: '11427808443', name: 'К-т сменного элемента масляного фильтра', unit: U }, { oem: '11427826799', name: 'К-т сменного элемента масляного фильтра', unit: 'ТО по регл.Oelservice / Inspektion' }];
  a.ok(L.humanNameFor('корпус масляного фильтра'));
  a.ok(!L.humanNameFor('масляный фильтр'));
  const housing = L.applyHumanNames(rows, ['корпус масляного фильтра']);
  a.deepStrictEqual(housing.map(r => r.oem), ['11427800066']);
  a.ok(/Корпус масляного фильтра/.test(housing[0].name));
  a.deepStrictEqual(L.applyHumanNames(rows, ['масляный фильтр']).map(r => r.oem), ['11427808443', '11427826799']);
  const xm = [{ oem: '11429453682', name: 'Масляный фильтр', unit: 'ТО по регл.Oelservice / Inspektion' }];
  a.deepStrictEqual(L.applyHumanNames(xm, ['масляный фильтр']).map(r => r.oem), ['11429453682'], 'element named «Масляный фильтр» stays');
  console.log('test-cards: oil filter housing ok');
}
{
  const d = chat.dropManagerDetailsLine;
  const t = d('Вот корпус для X5 40i. Карточка ниже.\n\nМожно прислать VIN. Менеджер уточнит сроки поставки.\n<<<PRODUCTS>>>\n[]\n<<<END_PRODUCTS>>>');
  a.ok(!/Менеджер уточнит/.test(t) && /Можно прислать VIN/.test(t) && /<<<PRODUCTS>>>/.test(t), t);
  a.ok(/менеджер/.test(d('Если нужна установка, менеджер запишет вас в сервис.')), 'other manager lines stay');
  a.ok(!/уточнит/.test(d('Цену и наличие уточнит менеджер.')));
  console.log('test-cards: manager details line ok');
}
{
  const f = chat.articleInMessage;
  a.strictEqual(f('CS010502PN'), 'CS010502PN');
  a.strictEqual(f('CS-010502-PN'), 'CS010502PN');
  a.strictEqual(f('есть артикул CS010502PN?'), 'CS010502PN');
  a.strictEqual(f('WBS11CS0609158489', { vin: 'WBS11CS0609158489' }), null, 'VIN');
  a.strictEqual(f('WBS11CS0609158489'), null, 'VIN without extraction');
  a.strictEqual(f('11427826799'), null, 'BMW number keeps its path');
  a.strictEqual(f('288183838'), null, 'order number');
  a.strictEqual(f('X5 G05 40i'), null);
  a.strictEqual(f('Колодки BMW X5 G05 M50dX'), null, 'model codes are not articles');
  console.log('test-cards: article detection ok');
}
