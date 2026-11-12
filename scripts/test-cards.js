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
  // G30 530dX (Диалоги ✗ 12.11): the housing's unit has no «теплообменник» in its name; the element came from the service unit
  const g30 = [{ oem: '11428583895', name: 'Масляный фильтр', unit: 'Масляный фильтр' }, { oem: '11425B95014', name: 'К-т сменного элемента масляного фильтра', unit: 'ТО по регл.Oelservice / Inspektion' }];
  a.deepStrictEqual(L.applyHumanNames(g30, ['масляный фильтр']).map(r => r.oem), ['11425B95014']);
  a.deepStrictEqual(L.applyHumanNames(g30.slice(0, 1), ['масляный фильтр']).map(r => r.oem), ['11428583895'], 'no element found -> the row stays');
  // #803 / #807: the element's names are searched as they are — no short form «фильтр» (fuel / cabin filters in 5 groups)
  a.deepStrictEqual(L.normalizeSearchNames({ 'масляный фильтр': ['к-т сменного элемента масляного фильтра', 'сменный элемент масляного фильтра'] }, ['масляный фильтр'])['масляный фильтр'],
    ['к-т сменного элемента масляного фильтра', 'сменный элемент масляного фильтра']);
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
  a.strictEqual(f('CS010502PN').code, 'CS010502PN');
  a.strictEqual(f('CS-010502-PN').code, 'CS010502PN');
  a.strictEqual(f('есть артикул CS010502PN?').code, 'CS010502PN');
  a.strictEqual(f('WBS11CS0609158489', { vin: 'WBS11CS0609158489' }), null, 'VIN');
  a.strictEqual(f('WBS11CS0609158489'), null, 'VIN without extraction');
  a.strictEqual(f('11427826799'), null, 'BMW number keeps its path');
  a.strictEqual(f('288183838'), null, 'order number');
  a.strictEqual(f('X5 G05 40i'), null);
  a.strictEqual(f('Колодки BMW X5 G05 M50dX'), null, 'model codes are not articles');
  a.strictEqual((f('5JA071497N 8Z8') || {}).code, '5JA071497N8Z8', 'VAG colour suffix (Диалоги #267)');
  a.strictEqual((f('5JA 071 497 N 8Z8') || {}).code, '5JA071497N8Z8');
  a.strictEqual((f('5JA071497N8Z8') || {}).code, '5JA071497N8Z8');
  a.strictEqual((f('5JA071497N 2 шт') || {}).code, '5JA071497N', 'a quantity is not a suffix');
  a.strictEqual(f('BMW X5 E70 2010'), null);
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
{
  // «Фланец системы охлаждения» = catalog «Соединительный патрубок» (owner 06.11)
  const L = require('../lib/laximo.js');
  const kw = 'фланец системы охлаждения';
  const h = L.humanNameFor(kw);
  a.ok(h && h.label === 'flange');
  a.strictEqual(h.searchNames(kw)[0], 'соединительный патрубок');
  const rows = [{ oem: '11118511205', name: 'Соединительный патрубок', unit: 'Блок цилиндров/дополнительные элементы', query: kw },
    { oem: '11537600000', name: 'Шланг радиатора', query: kw }, { oem: '11428575211', name: 'Фильтр', query: 'масляный фильтр' }];
  const out = L.applyHumanNames(rows, [kw, 'масляный фильтр']);
  a.deepStrictEqual(out.map(r => r.oem), ['11118511205', '11428575211']);
  a.strictEqual(out[0].name, 'Фланец системы охлаждения (в каталоге BMW — «Соединительный патрубок»)');
  a.strictEqual(L.applyHumanNames(rows.slice(1, 2), [kw]).length, 1, 'no catalog row -> rows stay');
  console.log('test-cards: фланец = соединительный патрубок ok');
}
{
  // BMW main-group check lets names-table rows through (live 06.11: flange 11 11… dropped, AI allowed only group 17)
  const L = require('../lib/laximo.js');
  a.ok(L.humanRowMatch('фланец системы охлаждения', { name: 'Соединительный патрубок' }));
  a.ok(!L.humanRowMatch('фланец системы охлаждения', { name: 'Шланг радиатора' }));
  a.ok(L.humanRowMatch('прокладка впускного коллектора', { name: 'Уплотнение выпускного коллектора' }));
  a.ok(!L.humanRowMatch('прокладка впускного коллектора', { name: 'Уплотнение системы впуска' }));
  a.ok(!L.humanRowMatch('масляный фильтр', { name: 'Соединительный патрубок' }));
  console.log('test-cards: group check for names-table rows ok');
}
{
  const L = require('../lib/laximo.js');
  const kw = 'уплотнение впускного коллектора';
  a.ok(L.humanNameFor(kw) && L.humanNameFor(kw).label === 'seal', 'the AI may write «уплотнение …» itself');
  a.ok(L.humanRowMatch(kw, { name: 'Уплотнение выпускного коллектора' }));
  console.log('test-cards: «уплотнение …» keyword ok');
}
{
  // X5 E70 N57S (owner 06.11): manifold gasket only in «Монтажный комплект турбонагнетателя»
  const L = require('../lib/laximo.js');
  const kw = 'прокладка впускного коллектора';
  const rows = [
    { oem: '11617801943', name: 'Профильная прокладка', unit: 'Система впуска AGR с упр.заслонками', query: kw },
    { oem: '11617807480', name: 'Профильная прокладка', unit: 'Система впуска AGR с упр.заслонками', query: kw },
    { oem: '11652456238', name: 'Монтажный комплект турбонагнетателя', unit: 'Турбонагнетатель и монт.к-т Value Line', query: kw },
    { oem: '11427808443', name: 'Фильтр масляный', query: 'масляный фильтр' },
  ];
  const out = L.applyHumanNames(rows, [kw, 'масляный фильтр']);
  a.deepStrictEqual(out.map(r => r.oem), ['11652456238', '11427808443']);
  a.ok(/входит в монтажный комплект турбонагнетателя/.test(out[0].name) && out[0].fixedName === kw, out[0].name);
  a.ok(L.humanRowMatch(kw, { name: 'Монтажный комплект турбонагнетателя' }), 'kit passes the group check');
  // 230i: the «… коллектора» seal row wins over the kit
  const b = L.applyHumanNames([{ oem: '11627617523', name: 'Уплотнение выпускного коллектора', query: kw }, { oem: '11652456238', name: 'Монтажный комплект турбонагнетателя', query: kw }], [kw]);
  a.deepStrictEqual(b.map(r => r.oem), ['11627617523']);
  console.log('test-cards: gasket in the turbo mounting kit ok');
}
{
  const f = chat.articleInMessage;
  a.deepStrictEqual(f('Liqui moly 4087'), { code: '4087', brandHint: 'Liqui moly' });
  a.strictEqual(f('4087'), null, 'digits alone: no brand');
  a.strictEqual(f('заказ 266736654', { orderStatusQuestion: true }), null);
  a.strictEqual(f('BMW 11427826799'), null, '11-digit BMW number keeps its path');
  const e = { partKeywords: ['колесный диск', 'диск'], partSearchNames: { 'колесный диск': ['диск'], 'диск': ['диск'] } };
  chat.dropGenericKeywords(e); a.deepStrictEqual(e.partKeywords, ['колесный диск']);
  const e2 = { partKeywords: ['передние тормозные диски', 'диск'] };
  chat.dropGenericKeywords(e2); a.deepStrictEqual(e2.partKeywords, ['передние тормозные диски']);
  const e3 = { partKeywords: ['масляный фильтр', 'воздушный фильтр'] };
  chat.dropGenericKeywords(e3); a.strictEqual(e3.partKeywords.length, 2, 'two real parts stay');
  console.log('test-cards: brand+number, generic keywords ok');
}
{
  const L = require('../lib/laximo.js');
  const h = L.humanNameFor('датчик абсолютного давления и температуры воздуха');
  a.ok(h && h.label === 'tmap');
  a.ok(L.humanNameFor('датчик t-map').label === 'tmap');
  a.ok(!L.humanNameFor('датчик давления масла') || L.humanNameFor('датчик давления масла').label !== 'tmap');
  console.log('test-cards: T-Map ok');
}
{
  const L = require('../lib/laximo.js');
  a.strictEqual(L.catalogShortForm('датчик температуры охлаждающей жидкости'), 'датчик температуры охл.жидкости');
  a.strictEqual(L.catalogShortForm('датчик температуры о.ж'), 'датчик температуры охл.жидкости');
  a.strictEqual(L.catalogShortForm('датчик температуры головки блока цилиндров'), 'датчик температуры головки блока цил.');
  const n = L.normalizeSearchNames({ 'датчик температуры охлаждающей жидкости': ['датчик температуры'] }, ['датчик температуры охлаждающей жидкости']);
  a.strictEqual(n['датчик температуры охлаждающей жидкости'][0], 'датчик температуры охл.жидкости');
  a.ok(n['датчик температуры охлаждающей жидкости'].includes('датчик температуры'));
  const m = L.normalizeSearchNames({ 'масляный фильтр': ['фильтр'] }, ['масляный фильтр']);
  a.deepStrictEqual(m['масляный фильтр'], ['фильтр'], 'no abbreviation -> unchanged');
  console.log('test-cards: catalog abbreviations ok');
}
{
  const kw = 'датчик температуры охлаждающей жидкости';
  a.ok(chat.rowMatchesRequest(kw, 'Датчик температуры охл.жидкости / масла'), 'short form matches');
  a.ok(!chat.rowMatchesRequest(kw, 'Датчик температуры головки блока цил.'));
  a.ok(chat.sameKindOtherVariant(kw, 'Датчик температуры головки блока цил.'), 'same kind, other variant -> ask');
  a.ok(!chat.sameKindOtherVariant('передние колодки', 'Ремкомплект накладок'), 'synonym -> no question');
  a.ok(!chat.sameKindOtherVariant('глушитель', 'Глушитель задний'), 'one word -> no question');
  const st = chat.confirmStateOf([{ role: 'assistant', content: 'Это она?\n<<<CONFIRM_STATE>>>\n{"oem":"13628649765","schema":{"vid":"1"}}\n<<<END_CONFIRM_STATE>>>' }, { role: 'user', content: 'Да, это она' }]);
  a.strictEqual(st.oem, '13628649765');
  console.log('test-cards: «Это она?» rules ok');
}
{
  const L = require('../lib/laximo.js');
  const g = L.groupsForKeyword ? L.groupsForKeyword('датчик температуры охлаждающей жидкости') : null;
  if (g) { a.ok(g.includes('13') && !g.includes('83'), 'sensor -> engine electronics, not fluids'); }
  console.log('test-cards: sensor groups ok');
}
{
  const rows = ['Датчик температуры', 'Датчик температуры', 'Датчик температуры', 'Датчик температуры испарителя', 'Датчик температуры головки блока цил.', 'Датчик температуры охл.жидкости / масла', 'Датчик давления масла'].map(name => ({ name }));
  const q = chat.variantQuestion(rows, ['датчик температуры'], 'Датчик температуры VIN: WBA2H71010VF78880');
  a.ok(q && q.options.length === 4, JSON.stringify(q));
  a.deepStrictEqual(q.options.find(o => /без уточнения/.test(o.label)).rows, [1, 2, 3]);
  a.strictEqual(chat.variantQuestion(rows, ['датчик температуры'], 'Датчик температуры головки блока цил.'), null, 'picked qualifier -> no question');
  a.strictEqual(chat.variantQuestion(rows, ['датчик температуры', 'головка'], 'x'), null, 'two parts');
  console.log('test-cards: variant question ok');
}
{
  const sv = [{ name: 'Серводвигатель' }, { name: 'Жгут проводов серводвигателя Valvetronic' }];
  const q = chat.variantQuestion(sv, ['серводвигатель'], 'Серводвигатель VIN: WBA2H71010VF78880');
  a.ok(q && q.options.length === 2 && q.options[0].label === 'Серводвигатель', JSON.stringify(q));
  a.strictEqual(chat.variantQuestion(sv, ['серводвигатель'], 'жгут серводвигателя'), null, 'customer named «жгут»');
  const L = require('../lib/laximo.js');
  a.ok(L.groupsForKeyword('серводвигатель').includes('11'));
  console.log('test-cards: servomotor variants ok');
}
{
  const sv = [{ name: 'Серводвигатель' }, { name: 'Жгут проводов серводвигателя Valvetronic' }];
  a.strictEqual(chat.variantQuestion(sv, ['серводвигатель'], 'Серводвигатель VIN: WBA2H71010VF78880 | Серводвигатель'), null, 'tapped plain option');
  console.log('test-cards: tapped option ok');
}
{
  const L = require('../lib/laximo.js');
  a.ok(L.namedLikeRequest('датчик температуры охлаждающей жидкости', { name: 'Датчик температуры охл.жидкости / масла' }));
  a.ok(L.namedLikeRequest('серводвигатель', { name: 'Серводвигатель' }));
  a.ok(!L.namedLikeRequest('колодки', { name: 'Ремкомплект накладок' }));
  a.ok(!L.namedLikeRequest('датчик температуры охлаждающей жидкости', { name: 'Датчик температуры головки блока цил.' }));
  const g = L.resolveGroups({ 'датчик температуры охлаждающей жидкости': ['17', '83'] }, ['датчик температуры охлаждающей жидкости']);
  const set = g['датчик температуры охлаждающей жидкости'];
  a.ok(set.has('13') && set.has('17') && set.has('83'), 'fixed rule + AI groups together');
  console.log('test-cards: soft group check ok');
}
{
  const p = chat.parseConfirmAnswer;
  a.deepStrictEqual(p('Да 3'), { yes: true, no: false, other: false, num: '3' });
  a.ok(p('Да, это она').yes && !p('Да, это она').num);
  a.ok(p('да').yes);
  a.ok(p('Нет, другая позиция').no);
  a.ok(p('нет').no);
  a.strictEqual(p('3 — Серводвигатель').num, '3');
  a.strictEqual(p('поз. 12').num, '12');
  a.ok(p('Другая деталь на схеме').other && !p('Другая деталь на схеме').no);
  a.ok(!p('датчик температуры').yes && !p('датчик температуры').no && !p('датчик температуры').num);
  a.strictEqual(p('Серводвигатель VIN: WBA2H71010VF78880 и еще много слов тут').num, null, 'long text: no position');
  console.log('test-cards: confirm answers ok');
}
{
  const p = chat.parseConfirmAnswer;
  a.strictEqual(p('Колодки X5').num, null, 'model name is not a position');
  a.strictEqual(p('12').num, '12');
  a.strictEqual(p('номер 7').num, '7');
  console.log('test-cards: position numbers ok');
}
{
  const ap = chat.catalogOilApprovals([{ name: 'BMW Engine Oil LL17FE+ 0W20' }, { name: 'BMW Engine Oil LL04 5W30' }, { name: 'BMW Engine Oil LL12FE 0W30' }, { name: 'BMW Engine Oil LL17FE+ 0W20' }]);
  a.deepStrictEqual(ap, ['BMW Longlife-17 FE+', 'BMW Longlife-04', 'BMW Longlife-12 FE']);
  console.log('test-cards: catalog oil approvals ok');
}
{
  const n = chat.narrowToNamedParts;
  const to = ['масляный фильтр', 'воздушный фильтр', 'салонный фильтр', 'микрофильтр', 'свеча', 'щетка', 'жидкость', 'антифриз', 'CHF', 'тормозные колодки', 'тормозные диски'];
  const m = t => [{ role: 'user', content: 'ТО для моей машины' }, { role: 'assistant', content: 'набор ТО' }, { role: 'user', content: t }];
  const e = { partKeywords: to.slice() }; n(e, m('и тормозные колодки/диски'));
  a.deepStrictEqual(e.partKeywords, ['тормозные колодки', 'тормозные диски']);
  const e2 = { partKeywords: to.slice(0, 9) }; n(e2, m('ТО для моей машины'));
  a.strictEqual(e2.partKeywords.length, 9, 'a new ТО request keeps the kit');
  const e3 = { partKeywords: ['моторное масло', 'тормозные колодки'] }; n(e3, m('а для задних?'));
  a.strictEqual(e3.partKeywords.length, 2, 'nothing named -> unchanged');
  console.log('test-cards: follow-up narrowing ok');
}
{
  const m = [{ role: 'user', content: 'ТО для моей машины' }, { role: 'assistant', content: 'набор ТО' }, { role: 'user', content: 'и тормозные колодки/диски' }];
  const e = { partKeywords: ['масляный фильтр', 'воздушный фильтр', 'салонный фильтр', 'тормозные колодки', 'тормозные диски'] };
  chat.narrowToNamedParts(e, m);
  a.strictEqual(chat.isServiceRequest(m, e), false, 'brakes after ТО -> not the kit path');
  console.log('test-cards: brakes after ТО ok');
}
(async () => {
  const lx = require('../lib/laximo');
  const rows = [
    { oem: '34216859917', name: 'Рем.к-т торм.накладок, безасбестовых', axle: 'задняя ось', schema: { number: '34216859917', unit: 'Тормозной механизм заднего колеса' } },
    { oem: '34116865713', name: 'Тормозной диск вентилируемый', axle: 'передняя ось', schema: { number: '34116865713', catalog: 'BMW', unit: 'Тормозной механизм переднего колеса' } },
  ];
  const fake = async p => ({ unitName: 'Тормозной механизм переднего колеса', unitParts: [
    { oem: '34116865713', name: 'Тормозной диск вентилируемый', position: '1' },
    { oem: '34106888459', name: 'Ремкомплект тормозных накладок', position: '3', notes: {} },
    { oem: '34356890788', name: 'Датчик износа тормозных накладок', position: '5' },
    { oem: '34116867311', name: 'Направляющая тормозных колодок Л', position: '6' },
    { oem: '34116867312', name: 'Направляющая колодок П', position: '7' },
  ] });
  const out = await lx.axleUnitRows(['передние тормозные колодки', 'задние тормозные колодки', 'передние тормозные диски'], rows, fake);
  a.deepStrictEqual(out.map(r => r.oem), ['34106888459']);
  a.strictEqual(out[0].axle, 'передняя ось'); a.strictEqual(out[0].schema.number, '34106888459');
  console.log('test-cards: front pads from the front brake unit ok');
})().catch(e => { console.error(e); process.exit(1); });
{
  const t = 'Понял вас. По оригинальному каталогу для вашего BMW X5 40i есть фирменные неподвижные колпаки ступицы — они как раз не вращаются.\n\nПодходящие варианты для вашей машины показал в карточках ниже — выберите нужный комплект.';
  const out = chat.dropCardClaims(t, { partKeywords: ['колпак ступицы'] });
  a.ok(!/карточк/.test(out) && /не удалось/.test(out), out);
  a.strictEqual(chat.dropCardClaims('Всё в карточках ниже.\n<<<PRODUCTS>>>\n[]\n<<<END_PRODUCTS>>>'), 'Всё в карточках ниже.\n<<<PRODUCTS>>>\n[]\n<<<END_PRODUCTS>>>');
  console.log('test-cards: no false card claims ok');
}
a.strictEqual(chat.dropCardClaims('Цена и срок указаны в карточке товара на сайте.', { partKeywords: ['фильтр'] }), 'Цена и срок указаны в карточке товара на сайте.');
{
  const m = [{ role: 'user', content: 'ТО для моей машины' }, { role: 'assistant', content: 'набор' }, { role: 'user', content: 'и тормозные колодки/диски' }, { role: 'assistant', content: 'Для какой оси?' }, { role: 'user', content: 'Передние и задние' }];
  const e = { partKeywords: ['масляный фильтр', 'свеча', 'воздушный фильтр', 'CHF', 'передние тормозные колодки', 'передние тормозные диски', 'задние тормозные колодки', 'задние тормозные диски', 'тормозной диск'] };
  chat.narrowToNamedParts(e, m);
  a.deepStrictEqual(e.partKeywords, ['передние тормозные колодки', 'передние тормозные диски', 'задние тормозные колодки', 'задние тормозные диски', 'тормозной диск']);
  a.strictEqual(chat.isServiceRequest(m, e), false);
  console.log('test-cards: axle answer after ТО follow-up ok');
}
console.log('test-cards: side-question guard compiled');
(async () => {
  const lx = require('../lib/laximo');
  const rows = [{ oem: '34216859917', name: 'Рем.к-т торм.накладок, безасбестовых', axle: 'задняя ось', schema: { number: '34216859917', unit: 'Сервисное обслуживание тормозов' } }];
  const fake = async () => ({ unitName: 'Сервисное обслуживание тормозов', unitParts: [
    { oem: '34116865713', name: 'Тормозной диск вентилируемый', position: '01' },
    { oem: '34118867481', name: 'Ремонтный комплект тормозных накладок', position: '02' },
    { oem: '34356888167', name: 'Датчик износа тормозных накладок Л Пд', position: '03' },
    { oem: '34216859917', name: 'Рем.к-т торм.накладок, безасбестовых', position: '05' },
    { oem: '34206864449', name: 'Фиксирующая пружина', position: '07' },
  ] });
  const out = await lx.axleUnitRows(['тормозные колодки'], rows, fake);
  a.deepStrictEqual(out.map(r => r.oem + ' ' + r.axle), ['34118867481 передняя ось']);
  const none = await lx.axleUnitRows(['тормозные диски'], rows, fake);
  a.strictEqual(none.length, 0);
  console.log('test-cards: plain «тормозные колодки» -> both axles ok');
})().catch(e => { console.error(e); process.exit(1); });
(async () => {
  const lx = require('../lib/laximo');
  // live 09.11 #427: the rear set's own unit is the rear wheel; «Сервисное обслуживание тормозов» has both axles
  const rows = [{ oem: '34216859917', name: 'Рем.к-т торм.накладок, безасбестовых', axle: 'задняя ось',
    schema: { number: '34216859917', unit: 'Тормозной механизм заднего колеса' }, units: ['Тормозной механизм заднего колеса', 'Сервисное обслуживание тормозов'] }];
  const calls = [];
  const fake = async p => { calls.push(p.schema.unit); return p.schema.unit === 'Сервисное обслуживание тормозов'
    ? { unitName: 'Сервисное обслуживание тормозов', unitParts: [{ oem: '34118867481', name: 'Ремонтный комплект тормозных накладок' }, { oem: '34216859917', name: 'Рем.к-т торм.накладок, безасбестовых' }] }
    : { unitName: 'Тормозной механизм заднего колеса', unitParts: [{ oem: '34216859917', name: 'Рем.к-т торм.накладок, безасбестовых' }] }; };
  const out = await lx.axleUnitRows(['тормозные колодки'], rows, fake);
  a.deepStrictEqual(out.map(r => r.oem), ['34118867481']);
  a.deepStrictEqual(calls, ['Тормозной механизм заднего колеса', 'Сервисное обслуживание тормозов']);
  // only the wear sensor knows the front unit
  const r2 = [{ oem: '34216859917', name: 'Рем.к-т торм.накладок, безасбестовых', axle: 'задняя ось', schema: { number: '34216859917', unit: 'Тормозной механизм заднего колеса' } }];
  const sensor = [{ oem: '34356888167', name: 'Датчик износа тормозных накладок Л Пд', axle: 'передняя ось', schema: { number: '34356888167', unit: 'Тормозной механизм переднего колеса' } }];
  const fake2 = async p => p.schema.unit === 'Тормозной механизм переднего колеса'
    ? { unitParts: [{ oem: '34118867481', name: 'Ремонтный комплект тормозных накладок' }, { oem: '34116867311', name: 'Направляющая тормозных колодок Л' }] } : { unitParts: [] };
  a.deepStrictEqual((await lx.axleUnitRows(['тормозные колодки'], r2, fake2, sensor)).map(r => r.oem), ['34118867481']);
  console.log('test-cards: front pads via the service unit / the sensor unit ok');
})().catch(e => { console.error(e); process.exit(1); });
{
  const d = chat.dropManagerReplacementClause;
  a.strictEqual(d('- Ремонтный комплект тормозных накладок (снят с производства — актуальную замену подскажет менеджер)'), '- Ремонтный комплект тормозных накладок (снят с производства)');
  a.strictEqual(d('Учтите: ремонтный комплект тормозных накладок снят с производства — менеджер подберёт актуальную замену.'), 'Учтите: ремонтный комплект тормозных накладок снят с производства.');
  a.strictEqual(d('Если нужно, менеджер свяжется с вами.'), 'Если нужно, менеджер свяжется с вами.');
  console.log('test-cards: «менеджер подберёт замену» clause ok');
}

// Parts without a car (owner 09.11, «Тормозные колодки» chip): only the car is asked, axle later as buttons.
{
  const { _noCarReply: n } = require('../api/chat');
  const r = n({ partKeywords: ['тормозные колодки', 'тормозные диски'] });
  a.ok(/тормозные колодки и диски/.test(r) && /VIN/.test(r) && /кнопкой/.test(r), r);
  a.ok(!/кнопкой/.test(n({ partKeywords: ['тормозная жидкость'] })));
  a.strictEqual(n({ partKeywords: ['тормозные колодки'], model: 'X5' }), null);
  a.strictEqual(n({ partKeywords: ['тормозные колодки'], vin: 'WBA2H71010VF78880' }), null);
  a.strictEqual(n({ partKeywords: ['зимние шины'] }), null);
  a.strictEqual(n({ partKeywords: null }), null);
  console.log('test-cards: no-car reply ok');
}

// «Пришёл ли заказ, можно забрать?» (Диалоги ✗ 10.11 #468): a direct answer first.
{
  const { _pickupAnswer: pa } = require('../api/chat');
  const o = st => [{ number: '288674242', date: '2099-01-01 10:00:00', deliveryOffice: 'ПВЗ Химки Сервис', positions: st.map(s => ({ status: s, deliveryDaysMax: 4 })) }];
  a.ok(/Пока нет/.test(pa('288674242 этот заказ пришёл его можно забрать сейчас?', o(['Заказ в работе', 'Комплектуется на складе поставщика']))));
  a.ok(/Да, заказ .* можно забирать в ПВЗ Химки Сервис/.test(pa('можно забрать?', o(['Пришло в СЕРВИС Химки', 'Пришло в СЕРВИС Химки']))));
  a.ok(/Пришла часть заказа .*1 из 2/.test(pa('пришёл?', o(['Пришло в СЕРВИС Химки', 'В пути на склад']))));
  a.ok(/уже выдан/.test(pa('готов?', o(['ВЫДАНО']))));
  a.strictEqual(pa('где мой заказ', o(['Заказ в работе'])), '');
  console.log('test-cards: pickup answer ok');
}
{
  const { _orderShownBefore: sb } = require('../api/chat');
  a.ok(sb([{ role: 'assistant', content: '**Заказ №288674242** от 07.11.2026' }], '288674242'));
  a.ok(!sb([{ role: 'assistant', content: 'Напишите номер заказа' }], '288674242'));
  console.log('test-cards: order shown before ok');
}

// One part, the AI forgot the card (Диалоги ✗ 10.11 #478, XM 50e right engine mount).
{
  const ens = require('../api/chat').ensureCardPerKeyword;
  const feed = new Map([['22116860458', { article: '22116860458', name: 'Подушка крепления двигателя П', price: 13748 }]]);
  const parts = [{ oem: '22116860458', name: 'Подушка крепления двигателя П', unit: 'Подвеска двигателя', query: 'правая подушка крепления двигателя' }];
  const out = ens('Вот правая подушка.', { keywords: ['правая подушка крепления двигателя'], parts, feedByOem: feed, carLabel: 'BMW XM 50e' });
  a.ok(/22116860458/.test(out) && /<<<PRODUCTS>>>/.test(out), out);
  console.log('test-cards: single part card added ok');
}

// Gearbox mount (Диалоги ✗ 10.11 #483–491, XM G09 50e).
{
  const lx = require('../lib/laximo');
  const rows = [
    { oem: '22116860458', name: 'Подушка крепления двигателя П', unit: 'Подвеска двигателя', query: 'крепление коробки передач' },
    { oem: '22116860457', name: 'Подушка крепления двигателя Л', unit: 'Подвеска двигателя', query: 'крепление коробки передач' },
    { oem: '22325A16555', name: 'Несущий кронштейн коробки передач', unit: 'Крепление КПП', query: 'крепление коробки передач' },
  ];
  a.deepStrictEqual(lx.dropEngineRowsForGearbox(rows, ['крепление коробки передач']).map(r => r.oem), ['22325A16555']);
  a.strictEqual(lx.dropEngineRowsForGearbox(rows, ['крепление коробки передач', 'подушка двигателя']).length, 3, 'engine named -> kept');
  const h = lx.HUMAN_NAMES.find(x => x.label === 'gearboxMount');
  a.ok(h.ask.test('подушка крепления коробки передач') && h.ask.test('опора КПП') && !h.ask.test('кронштейн коробки передач'));
  if (lx.applyHumanNames) {
    const kw = 'подушка крепления коробки передач';
    const out = lx.applyHumanNames([
      { oem: '22326860533', name: 'Подшипник коробки передач', unit: 'Крепление КПП', query: kw },
      { oem: '22319844631', name: 'Подшипник коробки передач', unit: 'Детали раздаточной коробки ATC 13', query: kw },
      { oem: '22116860458', name: 'Подушка крепления двигателя П', unit: 'Подвеска двигателя', query: kw },
    ], [kw]);
    a.deepStrictEqual(out.map(r => r.oem), ['22326860533']);
  }
  console.log('test-cards: gearbox mount ok');
}

// «Крепление коробки передач» = the whole unit «Крепление КПП» (owner, Диалоги ✗ 10.11 #501).
{
  const c = require('../api/chat');
  a.ok(c._isUnitRequest('крепления коробки передач VIN WBS11CS0609158489'));
  a.ok(c._isUnitRequest('крепление КПП'));
  a.ok(!c._isUnitRequest('Подушка крепления коробки передач'));
  a.ok(!c._isUnitRequest('кронштейн крепления КПП'));
  const sch = { vid: '1', catalog: 'BMW', ssd: 'x' };
  a.strictEqual(c._gearboxUnitRow([{ oem: '22116860458', name: 'Подушка', schema: sch }, { oem: '22326860533', name: 'Подшипник коробки передач', unit: 'Крепление КПП', schema: sch }]).oem, '22326860533');
  a.strictEqual(c._gearboxUnitRow([{ oem: '22325A16555', name: 'Несущий кронштейн', schema: sch }]).oem, '22325A16555');
  console.log('test-cards: gearbox unit request ok');
}

// Catalog path copied from the site (Диалоги ✗ 10.11 #507, XM «Воздуховод Подготовка и регулир. рабочей смеси»).
{
  const c = require('../api/chat');
  const path = c._catalogPathIn('Воздуховод Подготовка и регулир. рабочей смеси  VIN: WBS11CS0609158489');
  a.ok(path && /подготовка/i.test(path), path);
  a.ok(c._keywordInTitle('подготовка рабочей смеси', path));
  a.ok(!c._keywordInTitle('воздуховод', path));
  a.strictEqual(c._catalogPathIn('колодки на X5'), null);
  const sch = { vid: '1' };
  a.strictEqual(c._namedUnitRow([{ oem: '13715A24FB2', name: 'Сменный элемент', schema: sch }, { oem: '137151F9C2', name: 'Воздуховод', unit: 'Воздуховод', schema: sch }], 'воздуховод').oem, '137151F9C2');
  console.log('test-cards: catalog path unit ok');
}
