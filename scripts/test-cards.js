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
{
  // Several parts in one message (Диалоги ✗ 06.11 #175): every found part gets a card
  const ens = chat.ensureCardPerKeyword;
  const feed = new Map([['11618637800', { article: '11618637800', name: 'Уплотнение', price: 900 }], ['11428575211', { article: '11428575211', name: 'Фильтр', price: 2100 }]]);
  const parts = [
    { oem: '11618637800', name: 'Уплотнение системы впуска', unit: 'Система охлаждения наддувочного воздуха', query: 'прокладка впускного коллектора' },
    { oem: '11428575211', name: 'К-т сменного элемента масляного фильтра', query: 'масляный фильтр' },
  ];
  const ai = 'Нашлись позиции.\nПо **прокладке впускного коллектора** и **поддону АКПП с фильтром** — в каталоге с фото этих позиций сейчас нет. Подойдут по VIN.\n<<<PRODUCTS>>>\n[{"article":"11428575211","name":"Фильтр"}]\n<<<END_PRODUCTS>>>';
  const out = ens(ai, { keywords: ['прокладка впускного коллектора', 'масляный фильтр', 'поддон АКПП с фильтром'], parts, feedByOem: feed, carLabel: 'BMW 230i (F22)' });
  const cards = JSON.parse(out.match(/<<<PRODUCTS>>>([\s\S]*?)<<<END_PRODUCTS>>>/)[1]);
  a.deepStrictEqual(cards.map(c => c.article), ['11428575211', '11618637800']);
  a.ok(/Уплотнение системы впуска/.test(cards[1].best_for), cards[1].best_for);
  a.ok(!/с фото этих позиций/.test(out), out);
  a.ok(/Подойдут по VIN/.test(out), 'other sentences stay');
  a.ok(/«поддон АКПП с фильтром» в оригинальном каталоге/.test(out), 'not-found part gets one line');
  a.strictEqual(ens(ai, { keywords: ['масляный фильтр'], parts, feedByOem: feed }), ai, 'one part -> untouched');
  const t = chat.cleanCardsText('**Фланец** — арт. 11118511205.\n**Свечи** — арт. 12120040551, нужно 4 шт.\n<<<PRODUCTS>>>\n[]\n<<<END_PRODUCTS>>>', 'X');
  a.ok(!/арт/.test(t) && /нужно 4 шт/.test(t), t);
  console.log('test-cards: one card per asked part ok');
}
{
  // «Прокладка впускного коллектора» = catalog «Уплотнение впускного коллектора» (owner 06.11)
  const L = require('../lib/laximo.js');
  const kw = 'прокладка впускного коллектора';
  const h = L.humanNameFor(kw);
  a.ok(h && h.label === 'seal' && h.alsoWords);
  a.strictEqual(h.searchNames(kw)[0], 'уплотнение впускного коллектора');
  a.strictEqual(L.humanNameFor('прокладка выпускного коллектора').searchNames('прокладка выпускного коллектора')[0], 'уплотнение выпускного коллектора');
  const rows = [
    { oem: '11618637800', name: 'Уплотнение системы впуска', query: kw },
    { oem: '13548632344', name: 'уплотнительная прокладка', query: kw },
    { oem: '11617619286', name: 'Уплотнение впускного коллектора', query: kw },
    { oem: '11428575211', name: 'К-т сменного элемента масляного фильтра', query: 'масляный фильтр' },
  ];
  a.deepStrictEqual(L.applyHumanNames(rows, [kw, 'масляный фильтр']).map(r => r.oem), ['11617619286', '11428575211']);
  // owner 06.11 (230i B48): «коллектора» is the key -- «Уплотнение выпускного коллектора» stays, «Уплотнение системы впуска» goes
  const live = [{ oem: '11618637800', name: 'Уплотнение системы впуска', query: kw }, { oem: '11627617523', name: 'Уплотнение выпускного коллектора', query: kw }];
  a.deepStrictEqual(L.applyHumanNames(live, [kw]).map(r => r.oem), ['11627617523']);
  a.ok(L.humanNameFor(kw).searchNames(kw).includes('уплотнение коллектора'));
  a.deepStrictEqual(L.applyHumanNames(live, ['прокладка выпускного коллектора'].concat([])).length, 2, 'rows tagged with another keyword untouched');
  a.deepStrictEqual(L.applyHumanNames(live.map(r => ({ ...r, query: 'прокладка выпускного коллектора' })), ['прокладка выпускного коллектора']).map(r => r.oem), ['11627617523']);
  a.strictEqual(L.applyHumanNames([{ oem: '1', name: 'Корпус дроссельной заслонки', query: kw }], [kw]).length, 1, 'no seal row -> rows stay');
  const lt = chat.cleanCardsText('Подходят две позиции:\n**1. Уплотнение системы впуска BMW арт. 11618637800** — 4 шт.\n<<<PRODUCTS>>>\n[]\n<<<END_PRODUCTS>>>', 'X');
  a.ok(/1\. Уплотнение системы впуска/.test(lt), lt);
  a.strictEqual(L.humanNameFor('масляный фильтр'), null);
  console.log('test-cards: прокладка = уплотнение ok');
}
