/** Tests for lib/logistics/stages.js (logistics agent, phase 1). */
const assert = require('assert');
const s = require('../lib/logistics/stages');

let n = 0;
const t = (name, fn) => { fn(); n++; };

t('status names -> stages', () => {
  const m = {};
  assert.strictEqual(s.stageOfStatus('Новый', m), 'new');
  assert.strictEqual(s.stageOfStatus('Ожидает оплаты', m), 'payment');
  assert.strictEqual(s.stageOfStatus('Заказан у поставщика', m), 'supplier');
  assert.strictEqual(s.stageOfStatus('Отправлен поставщику', m), 'supplier');
  assert.strictEqual(s.stageOfStatus('В пути', m), 'transit');
  assert.strictEqual(s.stageOfStatus('Пришел на склад', m), 'stock');
  assert.strictEqual(s.stageOfStatus('Готов к выдаче', m), 'stock');
  assert.strictEqual(s.stageOfStatus('Отгружен клиенту', m), 'shipped');
  assert.strictEqual(s.stageOfStatus('Передан в СДЭК', m), 'shipped');
  assert.strictEqual(s.stageOfStatus('Выдан', m), 'done');
  assert.strictEqual(s.stageOfStatus('Отказ поставщика', m), 'cancelled');
  assert.strictEqual(s.stageOfStatus('Что-то своё', m), 'other');
  // BMW Club77 real statuses (log 07.11)
  assert.strictEqual(s.stageOfStatus('ВЫДАНО.', m), 'done');
  assert.strictEqual(s.stageOfStatus('Заказ принят', m), 'new');
  assert.strictEqual(s.stageOfStatus('Пришло в СЕРВИС Химки', m), 'stock');
  assert.strictEqual(s.stageOfStatus('Ждем предоплату', m), 'payment');
  assert.strictEqual(s.stageOfStatus('Нет на складе', m), 'problem');
  assert.strictEqual(s.stageOfStatus('Комплектуется на складе поставщика', m), 'supplier');
  assert.strictEqual(s.stageOfStatus('ЗАКАЗАНО СРОЧНЫМ', m), 'supplier');
  assert.strictEqual(s.stageOfStatus('Заказано из Германии', m), 'supplier');
  assert.strictEqual(s.stageOfStatus('В пути на склад', m), 'transit');
  assert.strictEqual(s.stageOfStatus('ОПЛАЧЕНО', m), 'stock'); // after «Пришло в СЕРВИС» (order 286732694)
  assert.strictEqual(s.stageOfStatus('Уточняем наличие в Польше', m), 'new');
  assert.strictEqual(s.stageOfStatus('Отказ клиента', m), 'cancelled');
  assert.strictEqual(s.stageOfStatus('СПАСИБО ЗА ЗАКАЗ!', m), 'other'); // waits for Михаил
  assert.strictEqual(s.stageOfStatus('Что-то своё', { 'Что-то своё': 'stock' }), 'stock');
});

t('order stage = slowest live position', () => {
  const m = {};
  assert.strictEqual(s.stageOfOrder([{ status: 'Выдан' }, { status: 'В пути' }], m), 'transit');
  assert.strictEqual(s.stageOfOrder([{ status: 'Отказ' }, { status: 'Пришел на склад' }], m), 'stock');
  assert.strictEqual(s.stageOfOrder([{ status: 'Отказ' }], m), 'cancelled');
  assert.strictEqual(s.stageOfOrder([], m), 'other');
});

t('carrier', () => {
  assert.strictEqual(s.carrierOf({ deliveryType: 'Доставка СДЭК до ПВЗ' }), 'cdek');
  assert.strictEqual(s.carrierOf({ deliveryType: 'Яндекс.Доставка' }), 'yandex');
  assert.strictEqual(s.carrierOf({ deliveryType: 'Самовывоз', deliveryOffice: 'Химки' }), 'pickup');
  assert.strictEqual(s.carrierOf({}), null);
});

t('Moscow date parsing', () => {
  assert.strictEqual(new Date(s.ts('2026-11-07 15:00:00')).toISOString(), '2026-11-07T12:00:00.000Z');
});

const now = Date.parse('2026-11-07T12:00:00Z'); // 15:00 MSK
const lim = { newHours: 4, lateGraceHours: 12, stockHours: 24, shippedDays: 7, silentDays: 3 };
const order = (positions, date = '2026-11-07 09:00:00') => s.normalizeOrder({ number: 123, date, positions });

t('not ordered after 4 h', () => {
  const o = order([{ id: 1, number: 'A1', status: 'Новый', statusChangeDate: '2026-11-07 09:00:00' }]);
  const a = s.alertsFor(o, now, lim, {});
  assert.deepStrictEqual(a.map(x => x.kind), ['not_ordered']);
  assert.deepStrictEqual(s.alertsFor(order(o.positions.map(p => ({ ...p, statusChangeDate: p.statusDate })), '2026-11-07 13:00:00'), now, lim, {}), []);
});

t('supplier late after deadlineMax + grace', () => {
  const p = { id: 1, number: 'A1', status: 'Заказан у поставщика', statusChangeDate: '2026-11-05 10:00:00', deadlineMax: 24 };
  assert.deepStrictEqual(s.alertsFor(order([p], '2026-11-05 09:00:00'), now, lim, {}).map(x => x.kind), ['supplier_late']);
  assert.deepStrictEqual(s.alertsFor(order([{ ...p, deadlineMax: 72 }], '2026-11-05 09:00:00'), now, lim, {}), []);
});

t('stock not shipped, long delivery, silent, unknown status', () => {
  const st = order([{ id: 1, number: 'A1', status: 'Пришел на склад', statusChangeDate: '2026-11-06 08:00:00' }]);
  assert.deepStrictEqual(s.alertsFor(st, now, lim, {}).map(x => x.kind), ['not_shipped']);
  const sh = order([{ id: 1, number: 'A1', status: 'Передан в СДЭК', statusChangeDate: '2026-10-29 10:00:00' }], '2026-10-28 10:00:00');
  assert.deepStrictEqual(s.alertsFor(sh, now, lim, {}).map(x => x.kind), ['delivery_long']);
  const si = order([{ id: 1, number: 'A1', status: 'В пути', statusChangeDate: '2026-11-02 10:00:00' }], '2026-11-02 09:00:00');
  assert.deepStrictEqual(s.alertsFor(si, now, lim, {}).map(x => x.kind), ['silent']);
  const un = order([{ id: 1, number: 'A1', status: 'Странный', statusChangeDate: '2026-11-07 10:00:00' }]);
  assert.deepStrictEqual(s.alertsFor(un, now, lim, {}).map(x => x.kind), ['unknown_status']);
});

t('payment: no «not ordered» alert; problem: no_stock at once', () => {
  assert.deepStrictEqual(s.alertsFor(order([{ id: 1, number: 'A1', status: 'Ждем предоплату', statusChangeDate: '2026-11-07 09:00:00' }]), now, lim, {}), []);
  assert.deepStrictEqual(s.alertsFor(order([{ id: 1, number: 'A1', status: 'Нет на складе', statusChangeDate: '2026-11-07 14:00:00' }]), now, lim, {}).map(x => x.kind), ['no_stock']);
});

t('unpaid new order: no «не заказан» (shop waits for payment), silent still applies', () => {
  const o = s.normalizeOrder({ number: 288003406, date: '2026-11-03 11:19:00', sum: 34900, debt: 34900, positions: [{ id: 1, number: '51319466313', status: 'Заказ принят', statusChangeDate: '2026-11-03 11:22:00' }] });
  assert.strictEqual(s.payStateOf(o), 'unpaid');
  assert.deepStrictEqual(s.alertsFor(o, now, lim, {}).map(x => x.kind), ['silent']);
  const paid = { ...o, debt: 0 };
  assert.strictEqual(s.payStateOf(paid), 'paid');
  assert.deepStrictEqual(s.alertsFor(paid, now, lim, {}).map(x => x.kind), ['not_ordered']);
  assert.strictEqual(s.payStateOf({ ...o, debt: 10000 }), 'partial');
});

t('forgotten position: siblings ordered, this one still «Заказ принят»', () => {
  const o = s.normalizeOrder({ number: 288119773, date: '2026-11-03 23:40:00', sum: 35200, debt: 33200, positions: [
    { id: 1, number: '34108870743', status: 'Комплектуется на складе поставщика', statusChangeDate: '2026-11-07 09:42:00', deadlineMax: 240 },
    { id: 2, number: '11617796622', status: 'Заказ принят', statusChangeDate: '2026-11-07 09:40:00' }] });
  const a = s.alertsFor(o, now, { ...lim, forgottenHours: 4 }, {});
  assert.deepStrictEqual(a.filter(x => x.position === '11617796622').map(x => x.kind), ['forgotten']);
  // sibling moved only 1 h ago -> not yet
  const fresh = { ...o, positions: o.positions.map(p => p.number === '34108870743' ? { ...p, statusDate: '2026-11-07 14:00:00' } : p) };
  assert.ok(!s.alertsFor(fresh, now, { ...lim, forgottenHours: 4 }, {}).some(x => x.kind === 'forgotten'));
});

t('unpaid «Заказ принят» -> «Ждём оплату»; no «поставщик опаздывает» before ordering', () => {
  const o = s.normalizeOrder({ number: 288590108, date: '2026-11-01 20:39:00', sum: 57600, debt: 57600,
    positions: [{ id: 1, number: '31316874373', status: 'Заказ принят', statusChangeDate: '2026-11-01 20:39:00', deadlineMax: 24 }] });
  const d = s.describe(o, now, lim, {});
  assert.strictEqual(d.stage, 'payment');
  assert.ok(!d.alerts.some(a => a.kind === 'supplier_late'));
  const paid = s.describe({ ...o, debt: 0 }, now, lim, {});
  assert.strictEqual(paid.stage, 'new');
  assert.deepStrictEqual(paid.alerts.map(a => a.kind), ['not_ordered']);
});

t('loss: purchase above the customer price (order 288586374)', () => {
  const o = s.normalizeOrder({ number: 288586374, date: '2026-11-06 19:36:00', sum: 38800, debt: 38800, positions: [
    { id: 1, number: '31108866771', status: 'ЗАКАЗАНО СРОЧНЫМ', statusChangeDate: '2026-11-07 10:00:00', price: 19400, priceIn: 20983.35, quantity: 1, deadlineMax: 240 },
    { id: 2, number: '31108866772', status: 'ЗАКАЗАНО СРОЧНЫМ', statusChangeDate: '2026-11-07 10:00:00', price: 19400, priceIn: 19000, quantity: 1, deadlineMax: 240 }] });
  const a = s.alertsFor(o, now, lim, {});
  // 20 983 vs 19 400 = +8.2 % -> below the 10 % threshold -> yellow «loss_small»
  assert.deepStrictEqual(a.filter(x => x.kind === 'loss_small').map(x => x.position), ['31108866771']);
  assert.ok(a.find(x => x.kind === 'loss_small').detail.includes('(+8.2%), минус 1583 ₽'));
  const big = s.normalizeOrder({ number: 1, date: '2026-11-06 19:36:00', sum: 1000, positions: [{ id: 9, number: 'X', status: 'Заказано', statusChangeDate: '2026-11-07 10:00:00', price: 1000, priceIn: 1150, quantity: 2, deadlineMax: 240 }] });
  const ab = s.alertsFor(big, now, lim, {});
  assert.deepStrictEqual(ab.filter(x => x.kind.startsWith('loss')).map(x => x.kind), ['loss']);
  assert.strictEqual(s.describe(big, now, lim, {}).health, 'late');
  const small = s.normalizeOrder({ number: 2, date: '2026-11-07 14:00:00', sum: 1000, positions: [{ id: 9, number: 'X', status: 'Заказано', statusChangeDate: '2026-11-07 14:00:00', price: 1000, priceIn: 1030, quantity: 1, deadlineMax: 240 }] });
  assert.strictEqual(s.describe(small, now, lim, {}).health, 'risk');
});

t('describe: health + finished orders have no alerts', () => {
  const late = s.describe(order([{ id: 1, number: 'A1', status: 'Новый' }]), now, lim, {});
  assert.strictEqual(late.health, 'late');
  const silent = s.describe(order([{ id: 1, number: 'A1', status: 'В пути', statusChangeDate: '2026-11-02 10:00:00' }], '2026-11-02 09:00:00'), now, lim, {});
  assert.strictEqual(silent.health, 'risk');
  const done = s.describe(order([{ id: 1, number: 'A1', status: 'Выдан' }], '2026-10-01 09:00:00'), now, lim, {});
  assert.strictEqual(done.stage, 'done');
  assert.deepStrictEqual(done.alerts, []);
});

t('MAX message groups alerts per order', () => {
  const { alertsMessage } = require('../lib/logistics/watch');
  const msg = alertsMessage([{ number: '1', text: 'Поставщик опаздывает' }, { number: '1', text: 'Поставщик опаздывает' }, { number: '2', text: 'Не заказан у поставщика' }]);
  assert.ok(msg.includes('Заказ 1: Поставщик опаздывает\n'));
  assert.ok(msg.includes('/logistics'));
});

console.log(`test-logistics: ${n} passed`);

// ─── suppliers (phase 2 preview) ───
const sup = require('../lib/logistics/suppliers');
t('history facts: ordered, arrived, refusals', () => {
  const f = sup.historyFacts([
    { status: 'Заказ принят', at: '2026-10-26 05:49:14' }, { status: 'ЗАКАЗАНО СРОЧНЫМ', at: '2026-10-26 20:26:02' },
    { status: 'Пришло в СЕРВИС Химки', at: '2026-10-27 16:59:52' }, { status: 'ОПЛАЧЕНО', at: '2026-10-28 05:47:53' }], {});
  assert.strictEqual(new Date(f.orderedAt).toISOString(), '2026-10-26T17:26:02.000Z');
  assert.strictEqual(new Date(f.arrivedAt).toISOString(), '2026-10-27T13:59:52.000Z');
  assert.strictEqual(f.refused, false);
  assert.strictEqual(sup.historyFacts([{ status: 'Нет на складе', at: '2026-10-26 05:49:14' }], {}).refused, true);
  assert.strictEqual(sup.historyFacts([{ status: 'Отказ клиента', at: '2026-10-26 05:49:14' }], {}).refused, false);
});

t('ABCP history dates «DD.MM.YYYY HH:MM:SS», unsorted input', () => {
  assert.strictEqual(new Date(s.ts('26.10.2026 05:49:14')).toISOString(), '2026-10-26T02:49:14.000Z');
  const f = sup.historyFacts([
    { status: 'Пришло в СЕРВИС Химки', at: '27.10.2026 16:59:52' }, { status: 'Заказ принят', at: '26.10.2026 05:49:14' },
    { status: 'ЗАКАЗАНО СРОЧНЫМ', at: '26.10.2026 20:26:02' }], {});
  assert.ok(f.arrivedAt > f.orderedAt);
  assert.strictEqual(Math.round((f.arrivedAt - f.orderedAt) / 3600000), 21);
});

t('reliability per supplier', () => {
  const row = (supplier, ordered, arrived, promised, refused = false) => ({ supplier, order_date: ordered, ordered_at: ordered, arrived_at: arrived, promised_hours: promised, refused });
  const r = sup.reliability([
    row('A', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z', 48), row('A', '2026-10-01T00:00:00Z', '2026-10-06T00:00:00Z', 48),
    row('B', '2026-10-01T00:00:00Z', null, 48, true)]);
  const a = r.find(x => x.supplier === 'A'), b = r.find(x => x.supplier === 'B');
  assert.strictEqual(a.onTimeShare, 0.5); assert.strictEqual(a.judged, 2); assert.strictEqual(a.medianDays, 5);
  assert.strictEqual(b.refusedShare, 1); assert.strictEqual(b.onTimeShare, null);
});

t('offers: own number only, scored by price, days, reliability', () => {
  const raw = [
    { number: '51319466313', price: 30000, deliveryPeriod: 72, deliveryPeriodMax: 120, distributorId: 1, availability: 2 },
    { number: '51319466313', price: 31000, deliveryPeriod: 0, distributorId: 2, availability: 1 },
    { number: '51319466313', price: 29000, deliveryPeriod: 24, distributorId: 3, availability: 1 },
    { number: '51319466399', price: 100, deliveryPeriod: 0, distributorId: 4 },  // analog: dropped
    { number: '51319466313', price: 1000, deliveryPeriod: 0, distributorId: 5, isUsed: 1 }, // used: dropped
  ];
  const offers = sup.normalizeOffers('51 31 9 466 313', raw, new Map([['1', 'Slow'], ['2', 'Stock'], ['3', 'Flaky']]));
  assert.strictEqual(offers.length, 3);
  const stats = [
    { supplier: 'Flaky', supplierId: '3', judged: 20, onTimeShare: 0.4, positions: 20, refusedShare: 0.3 },
    { supplier: 'Stock', supplierId: '2', judged: 20, onTimeShare: 0.95, positions: 20, refusedShare: 0 },
  ];
  const s = sup.scoreOffers(offers, stats, 1);
  assert.strictEqual(s[0].supplier, 'Stock');                 // a bit dearer, in stock and reliable beats the cheapest flaky one
  assert.ok(s[0].reasons.includes('в наличии'));
  assert.ok(s.find(o => o.supplier === 'Flaky').reasons[0].startsWith('дешевле выбора агента на'), s.find(o => o.supplier === 'Flaky').reasons[0]);
  assert.ok(s.find(o => o.supplier === 'Flaky').reasons.some(r => r.startsWith('отказы')));
  assert.ok(s.find(o => o.supplier === 'Slow').reasons.includes('мало истории по поставщику'));
});
t('unreliable cheapest loses; one offer per supplier; names match across [online]', () => {
  const offers = sup.normalizeOffers('22118835574', [
    { number: '22118835574', price: 11700, deliveryPeriod: 72, distributorId: 7 },
    { number: '22118835574', price: 14000, deliveryPeriod: 96, distributorId: 7 },
    { number: '22118835574', price: 12300, deliveryPeriod: 24, distributorId: 8 },
  ], new Map([['7', 'trinity-parts.ru [online]'], ['8', 'ЦС Автодом Сток']]));
  const s2 = sup.scoreOffers(offers, [
    { supplier: 'trinity-parts.ru [online]', judged: 5, onTimeShare: 0.2, positions: 5, refusedShare: 0 },
    { supplier: 'ЦС Автодом Сток', judged: 781, onTimeShare: 0.72, positions: 800, refusedShare: 0.01 },
  ], 1);
  assert.strictEqual(s2[0].supplier, 'ЦС Автодом Сток');
  assert.strictEqual(s2.filter(o => o.supplier.startsWith('trinity')).length, 1);
  assert.strictEqual(sup.nameKey('germsp.ru [online]'), sup.nameKey('GermSP.ru'));
});
t('offers compared by purchase price (priceIn), not the profile selling price', () => {
  // order 288688455, 07.11: froza 38 400 sale / 41 735 purchase; Мезенцев 49 500 / 43 000
  const o = sup.normalizeOffers('11128571308', [
    { number: '11128571308', price: 38400, priceIn: 41735, deliveryPeriod: 96, distributorId: 1 },
    { number: '11128571308', price: 49500, priceIn: 43000, deliveryPeriod: 24, distributorId: 2 }], new Map([['1', 'froza'], ['2', 'Мезенцев']]));
  assert.strictEqual(o[0].price, 41735); assert.strictEqual(o[0].sale, 38400);
  const sc = sup.scoreOffers(o, [], 1);
  // no history: 1 day for 1 265 ₽ more beats 4 days
  assert.strictEqual(sc[0].supplier, 'Мезенцев');
  assert.strictEqual(sc[0].reasons[0], 'выбор агента');
  assert.ok(sc[1].reasons[0].startsWith('дешевле выбора агента на 1\u00a0265 ₽, но срок до 4 дн.'), sc[1].reasons[0]);
});
t('pick explains itself (order 288688455)', () => {
  const o = sup.normalizeOffers('11128571308', [
    { number: '11128571308', price: 31100, priceIn: 33785, deliveryPeriod: 48, distributorId: 1 },
    { number: '11128571308', price: 38400, priceIn: 41735, deliveryPeriod: 96, distributorId: 2 },
    { number: '11128571308', price: 51900, priceIn: 43250, deliveryPeriod: 48, distributorId: 3 }],
    new Map([['1', 'trinity-parts.ru [online]'], ['2', 'froza.ru [online]'], ['3', 'autoeuro.ru [online]']]));
  const sc = sup.scoreOffers(o, [
    { supplier: 'trinity-parts.ru [online]', judged: 5, onTimeShare: 0.2, positions: 5, refusedShare: 0 },
    { supplier: 'autoeuro.ru [online]', judged: 80, onTimeShare: 0.78, positions: 90, refusedShare: 0.12 }], 1);
  assert.strictEqual(sc[0].supplier, 'froza.ru [online]');
  const why = sup.explainPick(sc, { supplier: 'autoeuro.ru [online]', priceIn: 43250 });
  assert.strictEqual(why[0], 'дешевле текущего предложения autoeuro.ru [online] (43\u00a0250 ₽) на 1\u00a0515 ₽');
  assert.ok(why[1].startsWith('самый дешёвый вариант (trinity-parts.ru [online], 33\u00a0785 ₽) отброшен — опаздывает в 80% случаев'), why[1]);
  assert.ok(why.includes('новый поставщик — истории доставок ещё нет'));
  const tr = sc.find(x => x.supplier.startsWith('trinity'));
  assert.ok(tr.reasons[0].startsWith('дешевле выбора агента на 7\u00a0950 ₽, но опаздывает в 80% случаев'), tr.reasons[0]);
  assert.ok(sc.find(x => x.supplier.startsWith('autoeuro')).reasons[0].startsWith('дороже выбора агента на 1\u00a0515 ₽ (4%)'));
});
t('suspiciously cheap / other brand offers lose and are flagged', () => {
  const o = sup.normalizeOffers('31108866771', [
    { number: '31108866771', brand: 'BMW', price: 10300, priceIn: 11047, deliveryPeriod: 48, distributorId: 1 },
    { number: '31108866771', brand: 'BMW', price: 19400, priceIn: 20983, deliveryPeriod: 24, distributorId: 2 },
    { number: '31108866771', brand: 'BMW', price: 22200, priceIn: 19300, deliveryPeriod: 24, distributorId: 3 },
    { number: '31108866771', brand: 'FEBI', price: 9000, priceIn: 15000, deliveryPeriod: 24, distributorId: 4 }],
    new Map([['1', 'adeo.pro [online]'], ['2', 'ЦС Автодом Сток'], ['3', 'Наличие БорисХофы'], ['4', 'X']]));
  const sc = sup.scoreOffers(o, [], 1, 'BMW');
  const adeo = sc.find(x => x.supplier.startsWith('adeo'));
  assert.ok(adeo.suspicious);
  assert.ok(adeo.reasons.some(r => r.startsWith('⚠ подозрительно дёшево')));
  assert.ok(sc.find(x => x.supplier === 'X').otherBrand);
  assert.strictEqual(sc[0].supplier, 'Наличие БорисХофы');
});
t('lever 772: a suspicious offer is never picked while a normal one exists; «no history» named as the reason', () => {
  const o = sup.normalizeOffers('31108866772', [
    { number: '31108866772', brand: 'BMW', price: 8600, priceIn: 9182, deliveryPeriod: 48, distributorId: 1 },
    { number: '31108866772', brand: 'BMW', price: 19400, priceIn: 20983, deliveryPeriod: 24, distributorId: 2 },
    { number: '31108866772', brand: 'BMW', price: 22200, priceIn: 19300, deliveryPeriod: 24, distributorId: 3 },
    { number: '31108866772', brand: 'BMW', price: 22000, priceIn: 22000, deliveryPeriod: 0, distributorId: 4 }],
    new Map([['1', 'adeo.pro [online]'], ['2', 'ЦС Автодом Сток'], ['3', 'Наличие БорисХофы'], ['4', 'Наше наличие']]));
  const stats = [{ supplier: 'ЦС Автодом Сток', judged: 909, onTimeShare: 0.70, positions: 950, refusedShare: 0.01 }];
  const sc = sup.scoreOffers(o, stats, 1, 'BMW');
  assert.ok(!sc[0].suspicious, sc[0].supplier);
  const why = sup.explainPick(sc, { supplier: 'ЦС Автодом Сток', priceIn: 20983 });
  if (sc[0].supplier === 'ЦС Автодом Сток') assert.ok(why.some(w => w.includes('нет истории доставок') || w.includes('подозрительно')), why.join(' | '));
});
t('trusted supplier (БорисХофы, every branch) wins lever 771 without own history', () => {
  assert.ok(sup.isTrusted('Наличие БорисХофы') && sup.isTrusted('БорисХоф МКАД29') && sup.isTrusted('БорисХоф Балашиха'));
  assert.ok(!sup.isTrusted('adeo.pro [online]'));
  assert.ok(sup.isTrusted('Мерседес Каширка Рольф') && sup.isTrusted('Рольф Ясенево нал') && sup.isTrusted('Рольф Химки нал'));
  const o = sup.normalizeOffers('31108866771', [
    { number: '31108866771', brand: 'BMW', price: 10300, priceIn: 11047, deliveryPeriod: 48, distributorId: 1 },
    { number: '31108866771', brand: 'BMW', price: 19400, priceIn: 20983, deliveryPeriod: 24, distributorId: 2 },
    { number: '31108866771', brand: 'BMW', price: 22200, priceIn: 19300, deliveryPeriod: 24, distributorId: 3 }],
    new Map([['1', 'adeo.pro [online]'], ['2', 'ЦС Автодом Сток'], ['3', 'Наличие БорисХофы']]));
  const sc = sup.scoreOffers(o, [{ supplier: 'ЦС Автодом Сток', judged: 909, onTimeShare: 0.70, positions: 950, refusedShare: 0.01 }], 1, 'BMW');
  assert.strictEqual(sc[0].supplier, 'Наличие БорисХофы');
  const why = sup.explainPick(sc, { supplier: 'ЦС Автодом Сток', priceIn: 20983 });
  assert.ok(why.includes('доверенный поставщик') && why[0].startsWith('дешевле текущего предложения ЦС Автодом Сток (20\u00a0983 ₽) на 1'), why.join(' | '));
});
console.log(`test-logistics (suppliers): ok`);

// ─── «Нужно ваше решение» (phase 2) ───
const dec = require('../lib/logistics/decisions');
const write = require('../lib/abcpWrite');
const row = (number, positions, extra = {}) => ({ number, finished_at: null, alerts: extra.alerts || [], summary: { number, date: '2026-11-07 10:00:00', customer: 'Клиент', sum: 1000, debt: extra.debt ?? 0, payState: extra.payState, positions } });
const P = (id, status, supplierId, extra = {}) => ({ id, number: 'A' + id, brand: 'BMW', status, supplier: 'S' + supplierId, supplierId: String(supplierId), price: 1000, priceIn: 800, quantity: 1, dsRouteId: '77', ...extra });

t('queue: paid «new» positions grouped per order + supplier; unpaid, ordered and handled ones out', () => {
  const rows = [
    row('1', [P('11', 'Заказ принят', 5), P('12', 'Заказ принят', 5), P('13', 'Заказ принят', 6), P('14', 'Заказано', 5)]),
    row('2', [P('21', 'Заказ принят', 5)], { payState: 'unpaid', debt: 1000 }),
    row('3', [P('31', 'Заказ принят', 5), P('32', 'Заказано', 5)], { payState: 'unpaid', debt: 1000, alerts: [{ kind: 'forgotten' }] }),
    row('4', [P('41', 'Заказ принят', 5, { dsRouteId: null })]),
  ];
  const q = dec.buildQueue(rows, new Map([['12', 'sent']]), Date.parse('2026-11-07T12:00:00Z'));
  const keys = q.map(i => i.key).sort();
  assert.deepStrictEqual(keys, ['1|5', '1|6', '3|5', '4|5']);
  assert.deepStrictEqual(q.find(i => i.key === '1|5').positions.map(p => p.id), ['11']); // 12 handled, 14 already ordered
  // newest first (all four have the same date here -> stable order, just check the field exists)
  assert.ok(q.every(i => i.ageHours != null));
  assert.strictEqual(q.find(i => i.key === '4|5').sendable, false);
});

t('re-check before sending stops on any change', () => {
  const item = dec.buildQueue([row('1', [P('11', 'Заказ принят', 5)])])[0];
  const fresh = st => ({ positions: [{ id: 11, status: st, distributorId: 5, priceIn: 800, dsRouteId: 77 }] });
  assert.strictEqual(dec.recheck(item, fresh('Заказ принят')), null);
  assert.ok(dec.recheck(item, fresh('Заказано')).includes('уже не новая'));
  assert.ok(dec.recheck(item, { positions: [{ id: 11, status: 'Заказ принят', distributorId: 9, priceIn: 800, dsRouteId: 77 }] }).includes('сменился поставщик'));
  assert.ok(dec.recheck(item, { positions: [{ id: 11, status: 'Заказ принят', distributorId: 5, priceIn: 950, dsRouteId: 77 }] }).includes('изменилась закупочная цена'));
  assert.ok(dec.recheck(item, { positions: [] }).includes('удалена'));
  assert.ok(dec.recheck(item, null).includes('не найден'));
});

t('send answer: confirmSend true = sent, anything else = unclear (never retried)', () => {
  const r = dec.parseSendAnswer([{ number: 'S-1', status: 'ok', positions: [{ reference: '11', confirmSend: true }, { reference: '12', confirmSend: false, status: ['Нет в наличии'] }] }], ['11', '12', '13']);
  assert.strictEqual(r.get('11').status, 'sent'); assert.strictEqual(r.get('11').supplierOrder, 'S-1');
  assert.strictEqual(r.get('12').status, 'unclear'); assert.ok(r.get('12').message.includes('Нет в наличии'));
  assert.strictEqual(r.get('13').status, 'unclear');
});

t('write client refuses while sending is switched off', async () => {
  delete process.env.LOGISTICS_SEND_ENABLED;
  assert.strictEqual(write.sendEnabled(), false);
  await assert.rejects(write.sendOnline([{ id: 1 }]), /switched off/);
});
t('switch supplier: edit request changes only route / itemKey / purchase / deadline, never the customer price', () => {
  const offers = sup.normalizeOffers('31108866771', [{ number: '31108866771', brand: 'BMW', price: 22200, priceIn: 19300, deliveryPeriod: 24, deliveryPeriodMax: 48, distributorId: 3, supplierCode: '8812', itemKey: 'abc==' }], new Map([['3', 'Наличие БорисХофы']]));
  assert.strictEqual(offers[0].routeId, '8812'); assert.strictEqual(offers[0].itemKey, 'abc==');
  const o = write.buildSwitchOrder(288586374, 601, offers[0]);
  assert.deepStrictEqual(o, { number: '288586374', positions: [{ id: '601', routeId: '8812', itemKey: 'abc==', priceIn: 19300, deadline: 24, deadlineMax: 48 }] });
  assert.ok(!('priceOut' in o.positions[0]) && !('quantity' in o.positions[0]) && !('statusCode' in o.positions[0]));
  assert.throws(() => write.buildSwitchOrder(1, 2, { ...offers[0], itemKey: null }), /itemKey/);
});

t('switch supplier: verified only if ABCP shows the new supplier and the same customer price', () => {
  const offer = { supplier: 'Наличие БорисХофы', supplierId: '3' };
  const fresh = (dist, out) => ({ positions: [{ id: 601, distributorId: dist, distributorName: dist === 3 ? 'Наличие БорисХофы' : 'ЦС Автодом Сток', priceOut: out }] });
  assert.strictEqual(dec.verifySwitch(fresh(3, 19400), '601', offer, 19400), null);
  assert.ok(dec.verifySwitch(fresh(5, 19400), '601', offer, 19400).includes('не сменился'));
  assert.ok(dec.verifySwitch(fresh(3, 22200), '601', offer, 19400).includes('цена клиента'));
  assert.ok(dec.verifySwitch({ positions: [] }, '601', offer, 19400).includes('не найдена'));
});

t('write client: switching refuses while writing is switched off', async () => {
  delete process.env.LOGISTICS_SEND_ENABLED;
  await assert.rejects(write.switchPositionSupplier(1, 2, { routeId: '1', itemKey: 'k', priceIn: 10 }), /switched off/);
});
t('never switch to an offer slower than the delivery the customer chose', () => {
  const pos = { deadlineMaxHours: 24 };
  assert.strictEqual(dec.slowerThanPromised(pos, { supplier: 'A', hoursMax: 24 }), null);
  assert.strictEqual(dec.slowerThanPromised(pos, { supplier: 'A', hoursMax: 0 }), null);
  assert.ok(dec.slowerThanPromised(pos, { supplier: 'froza', hoursMax: 96 }).includes('клиент выбрал срок до 1 дн.'));
  assert.strictEqual(dec.slowerThanPromised({}, { supplier: 'A', hoursMax: 96 }), null);
  // whole days, as shown: 24 h is not slower than a 20 h promise (both «1 дн.»)
  assert.strictEqual(dec.slowerThanPromised({ deadlineMaxHours: 20 }, { supplier: 'АвтоЕвро', hoursMax: 24 }), null);
  assert.ok(dec.slowerThanPromised({ deadlineMaxHours: 20 }, { supplier: 'X', hoursMax: 30 }));
  // promise already broken (1-day promise, order 4 days old): slower offers allowed
  const t0 = Date.parse('2026-11-08T00:00:00Z');
  assert.strictEqual(dec.slowerThanPromised({ deadlineMaxHours: 24 }, { supplier: 'froza', hoursMax: 96 }, t0 - 4 * 86400000, t0), null);
  assert.ok(dec.slowerThanPromised({ deadlineMaxHours: 24 }, { supplier: 'froza', hoursMax: 96 }, t0 - 3600000, t0));
  assert.ok(dec.promiseExpired({ deadlineMaxHours: 24 }, t0 - 4 * 86400000, t0));
});
t('order 288688455: 250 ₽ cheaper but 50 % of 8 vs 78 % of 80 -> keep the current supplier', () => {
  const o = sup.normalizeOffers('11128571308', [
    { number: '11128571308', brand: 'BMW', price: 49500, priceIn: 43000, deliveryPeriod: 24, distributorId: 1 },
    { number: '11128571308', brand: 'BMW', price: 51900, priceIn: 43250, deliveryPeriod: 48, distributorId: 2 },
    { number: '11128571308', brand: 'BMW', price: 63000, priceIn: 62994, deliveryPeriod: 24, distributorId: 3 }],
    new Map([['1', 'Иван Мезенцев'], ['2', 'zlataauto.ru [online]'], ['3', 'АвтоСкай']]));
  const stats = [
    { supplier: 'Иван Мезенцев', judged: 8, onTimeShare: 0.5, positions: 8, refusedShare: 0 },
    { supplier: 'zlataauto.ru [online]', judged: 80, onTimeShare: 0.78, positions: 90, refusedShare: 0.12 }];
  const sc = sup.scoreOffers(o, stats, 1, 'BMW');
  const kept = sup.preferCurrent(sc, { supplier: 'zlataauto.ru [online]' });
  assert.strictEqual(kept[0].supplier, 'zlataauto.ru [online]');
  assert.ok(kept[0].keptCurrent);
  const why = sup.explainPick(kept, { supplier: 'zlataauto.ru [online]', priceIn: 43250 });
  assert.ok(why[0].startsWith('оставить поставщика из заказа'), why[0]);
  // the trade-off is said out loud when a less reliable supplier IS recommended
  const why2 = sup.explainPick(sc, { supplier: 'zlataauto.ru [online]', priceIn: 43250 });
  if (sc[0].supplier === 'Иван Мезенцев') assert.ok(why2.some(w => w.startsWith('но вовремя 50% (из 8) против 78% (из 80)')), why2.join(' | '));
});
console.log('test-logistics (decisions): ok');

// ─── shadow mode (agent vs manager) ───
const shadow = require('../lib/logistics/shadow');
t('shadow: picks for paid new positions only, once; manager decision when the position moves on', () => {
  const d = (number, positions, extra = {}) => ({ number, stage: extra.stage || 'new', payState: extra.payState || 'paid', alerts: extra.alerts || [], positions });
  const described = [
    d('1', [{ id: 'a', status: 'Заказ принят' }, { id: 'b', status: 'Заказано' }]),
    d('2', [{ id: 'c', status: 'Заказ принят' }], { payState: 'unpaid' }),
    d('3', [{ id: 'e', status: 'Заказ принят' }], { payState: 'unpaid', alerts: [{ kind: 'forgotten' }] }),
    d('4', [{ id: 'f', status: 'Выдан' }], { stage: 'done' }),
  ];
  // all four orders are dated 1970 here -> unpaid «c» is old -> skipped; forgotten «e» kept
  assert.deepStrictEqual(shadow.toPick(described, new Set()).map(x => x.p.id).sort(), ['a', 'e']);
  assert.deepStrictEqual(shadow.toPick(described, new Set(['a'])).map(x => x.p.id), ['e']);
  // a FRESH unpaid order (today) is recorded too, newest first
  const today = { ...described[1], date: new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 19).replace('T', ' ') };
  assert.deepStrictEqual(shadow.toPick([described[0], today], new Set()).map(x => x.p.id), ['c', 'a']);
  const moved = [d('1', [{ id: 'a', status: 'ЗАКАЗАНО СРОЧНЫМ' }, { id: 'x', status: 'Отказ клиента' }, { id: 'y', status: 'Заказ принят' }])];
  assert.deepStrictEqual(shadow.toResolve(moved, new Set(['a', 'x', 'y'])).map(x => `${x.p.id}:${x.outcome}`), ['a:ordered', 'x:cancelled']);
  assert.ok(shadow.sameSupplier('zlataauto.ru [online]', null, 'Zlataauto.ru', null));
  // 10.11: names decide; a shared id never makes two differently named suppliers «the same»
  assert.ok(shadow.sameSupplier('A', '1', 'A', '2'));
  assert.ok(!shadow.sameSupplier('Алексей Химки', '77', 'autoskyimport.ru [online]', '77'));
  assert.ok(shadow.sameSupplier(null, '77', 'autoskyimport.ru [online]', '77'));
});
t('VAG 1T0075111: the manager\'s cheap supplier is not «suspicious»; never recommend 90 % dearer', () => {
  const raw = [
    { number: '1T0075111', brand: 'VAG', price: 6000, priceIn: 5866, deliveryPeriod: 72, distributorId: 1 },
    { number: '1T0075111', brand: 'VAG', price: 10400, priceIn: 11144, deliveryPeriod: 96, distributorId: 2 },
    { number: '1T0075111', brand: 'VAG', price: 10500, priceIn: 11261, deliveryPeriod: 72, distributorId: 3 },
    { number: '1T0075111', brand: 'VAG', price: 11000, priceIn: 11775, deliveryPeriod: 48, distributorId: 4 }];
  const names = new Map([['1', 'VAG Brest 26.11.2025'], ['2', 'froza.ru [online]'], ['3', 'adeo.pro [online]'], ['4', 'autoskyimport.ru [online]']]);
  const cur = { supplier: 'VAG Brest 26.11.2025', supplierId: '1' };
  const sc = sup.scoreOffers(sup.normalizeOffers('1T0075111', raw, names), [], 1, 'VAG', cur);
  assert.ok(!sc.find(o => o.supplier.startsWith('VAG Brest')).suspicious);
  const kept = sup.preferCurrent(sc, cur);
  assert.strictEqual(kept[0].supplier, 'VAG Brest 26.11.2025');
  // without the «current» hint (old behaviour) it would be flagged — and even then preferCurrent never jumps to +90 %
  const sc2 = sup.scoreOffers(sup.normalizeOffers('1T0075111', raw, names), [], 1, 'VAG');
  assert.ok(sc2.find(o => o.supplier.startsWith('VAG Brest')).suspicious);
});
t('order 280523680: customer pays 5 900 ₽ -> never pick an 11 144 ₽ offer, even if the current supplier is late', () => {
  const raw = [
    { number: '1T0075111', brand: 'VAG', price: 6800, priceIn: 5866, deliveryPeriod: 360, distributorId: 1 },
    { number: '1T0075111', brand: 'VAG', price: 10400, priceIn: 11144, deliveryPeriod: 96, distributorId: 2 },
    { number: '1T0075111', brand: 'VAG', price: 10500, priceIn: 11261, deliveryPeriod: 72, distributorId: 3 }];
  const names = new Map([['1', 'VAG Brest 26.11.2025'], ['2', 'froza.ru [online]'], ['3', 'adeo.pro [online]']]);
  const cur = { supplier: 'VAG Brest 26.11.2025', supplierId: '1', priceOut: 5900 };
  const stats = [{ supplier: 'VAG Brest 26.11.2025', judged: 8, onTimeShare: 0.25, positions: 8, refusedShare: 0 }];
  const sc = sup.scoreOffers(sup.normalizeOffers('1T0075111', raw, names), stats, 1, 'VAG', cur);
  const kept = sup.preferCurrent(sc, cur);
  assert.strictEqual(kept[0].supplier, 'VAG Brest 26.11.2025');
  assert.ok(kept[0].keptForMargin);
  const why = sup.explainPick(kept, cur);
  assert.ok(why[0].includes('дороже цены клиента (5\u00a0900 ₽)'), why[0]);
  assert.ok(why.some(w => w.includes('часто опаздывает')));
  // customer price covers the dearer offers: a late current supplier is NOT replaced by an unknown, dearer one (10.11) …
  const kept2 = sup.preferCurrent(sc, { ...cur, priceOut: 15000 });
  assert.strictEqual(kept2[0].supplier, 'VAG Brest 26.11.2025');
  // … but it may be replaced by a PROVEN one
  const stats3 = [...stats, { supplier: 'adeo.pro [online]', judged: 30, onTimeShare: 0.95, positions: 30, refusedShare: 0 }];
  const sc3 = sup.scoreOffers(sup.normalizeOffers('1T0075111', raw, names), stats3, 1, 'VAG', cur);
  assert.strictEqual(sup.preferCurrent(sc3, { ...cur, priceOut: 15000 })[0].supplier, 'adeo.pro [online]');
});
console.log('test-logistics (shadow): ok');

t('no exact offers -> replacements / analogs listed (requested brand first), never the exact number', async () => {
  const abcpMod = require('../lib/abcpOrders');
  const orig = abcpMod.apiGet;
  abcpMod.apiGet = async (op, params) => {
    if (op === 'cp/distributors') return [{ id: 1, name: 'ЦС Автодом Сток' }, { id: 2, name: 'autoeuro.ru [online]' }];
    assert.strictEqual(params.withOutAnalogs, 0);
    return [
      { number: '11247516808', brand: 'BMW', price: 0, distributorId: 1 },                                   // exact, no price -> skipped
      { number: '11 24 7 852 405', numberFix: '11247852405', brand: 'BMW', description: 'Болт', price: 400, priceIn: 330, deliveryPeriod: 24, distributorId: 1 },
      { number: '11247852405', brand: 'BMW', price: 420, priceIn: 350, deliveryPeriod: 48, distributorId: 2 },
      { number: '009110', brand: 'FEBI', price: 200, priceIn: 150, deliveryPeriod: 72, distributorId: 2 }];
  };
  try {
    const r = await sup.replacementsFor('11247516808', 'BMW');
    assert.strictEqual(r[0].brand, 'BMW'); assert.strictEqual(r[0].offers, 2);
    assert.deepStrictEqual(r[0].cheapest, { supplier: 'ЦС Автодом Сток', priceIn: 330, days: 1 });
    assert.strictEqual(r[1].brand, 'FEBI');
    assert.ok(!r.some(x => x.number === '11247516808'));
  } finally { abcpMod.apiGet = orig; }
});
t('Gates T36296: compared with the live price of the order\'s supplier; 7 % cheaper is not «suspicious»', () => {
  const o = sup.normalizeOffers('T36296', [
    { number: 'T36296', brand: 'Gates', price: 1100, priceIn: 1143, deliveryPeriod: 72, distributorId: 1 },
    { number: 'T36296', brand: 'Gates', price: 1200, priceIn: 1223, deliveryPeriod: 48, distributorId: 2 },
    { number: 'T36296', brand: 'Gates', price: 1500, priceIn: 1469, deliveryPeriod: 24, distributorId: 3 },
    { number: 'T36296', brand: 'Gates', price: 2100, priceIn: 2050, deliveryPeriod: 24, distributorId: 4 },
    { number: 'T36296', brand: 'Gates', price: 2200, priceIn: 2150, deliveryPeriod: 24, distributorId: 5 }],
    new Map([['1', 'АктивГрупп Вероника'], ['2', 'froza.ru [online]'], ['3', 'Рольф Химки нал'], ['4', 'Дилер 1'], ['5', 'Дилер 2']]));
  const cur = { supplier: 'Рольф Химки нал', supplierId: '3', priceIn: 1189 };
  const sc = sup.scoreOffers(o, [], 1, 'Gates', cur);
  assert.ok(!sc.find(x => x.supplier === 'АктивГрупп Вероника').suspicious);
  const best = sc[0];
  const why = sup.explainPick(sc, cur);
  if (best.supplier !== 'Рольф Химки нал') {
    assert.ok(why[0].startsWith('дешевле текущего предложения Рольф Химки нал (1\u00a0469 ₽) на'), why[0]);
    assert.ok(why.includes('в заказе записана закупка 1\u00a0189 ₽'), why.join(' | '));
  }
});
t('own stock «Наше наличие» is never replaced; current supplier matched by name, not a shared id', () => {
  const raw = [
    { number: '34116889585', brand: 'BMW', price: 7000, priceIn: 6895, deliveryPeriod: 72, distributorId: 9 },
    { number: '34116889585', brand: 'BMW', price: 9000, priceIn: 8800, deliveryPeriod: 24, distributorId: 8 }];
  const offers = sup.scoreOffers(sup.normalizeOffers('34116889585', raw, new Map([['9', 'motexc.ru [online]'], ['8', 'autoeuro.ru [online]']])), [], 1, 'BMW');
  // «Наше наличие» is not even in the search results -> still kept
  const kept = sup.preferCurrent(offers, { supplier: 'Наше наличие', supplierId: '1', priceIn: 23000, priceOut: 30000 });
  assert.strictEqual(kept[0].supplier, 'Наше наличие'); assert.ok(kept[0].ownStock);
  assert.deepStrictEqual(sup.explainPick(kept, { supplier: 'Наше наличие', supplierId: '1', priceIn: 23000 }), ['деталь есть на своём складе — заказывать у других поставщиков не нужно']);
  // «Алексей Химки» shares a distributor id with autoskyimport -> NOT treated as the same supplier
  const raw2 = [
    { number: '61217604808', brand: 'BMW', price: 38000, priceIn: 37883, deliveryPeriod: 24, distributorId: 77 },
    { number: '61217604808', brand: 'BMW', price: 31000, priceIn: 30000, deliveryPeriod: 24, distributorId: 78 }];
  const o2 = sup.scoreOffers(sup.normalizeOffers('61217604808', raw2, new Map([['77', 'autoskyimport.ru [online]'], ['78', 'Алексей Химки']])), [], 1, 'BMW', { supplier: 'Алексей Химки', supplierId: '77' });
  const k2 = sup.preferCurrent(o2, { supplier: 'Алексей Химки', supplierId: '77', priceOut: 40000 });
  assert.strictEqual(k2[0].supplier, 'Алексей Химки');
});
t('Bosch 0 445 110 435: a supplier the shop has ever ordered from is never «suspicious» (no 2× dearer pick)', () => {
  const raw = [
    { number: '0445110435', brand: 'Bosch', price: 13000, priceIn: 12918, deliveryPeriod: 24, distributorId: 1 },
    { number: '0445110435', brand: 'Bosch', price: 25000, priceIn: 24269, deliveryPeriod: 24, distributorId: 2 },
    { number: '0445110435', brand: 'Bosch', price: 26000, priceIn: 25500, deliveryPeriod: 24, distributorId: 3 },
    { number: '0445110435', brand: 'Bosch', price: 27000, priceIn: 26100, deliveryPeriod: 24, distributorId: 4 }];
  const names = new Map([['1', 'autoeuro.ru [online]'], ['2', 'Фаворит СЕО'], ['3', 'X'], ['4', 'Y']]);
  // the order's supplier at pick time was something else; autoeuro has only 1 position of history -> still a real source
  const sc = sup.scoreOffers(sup.normalizeOffers('0445110435', raw, names), [{ supplier: 'autoeuro.ru [online]', judged: 0, onTimeShare: null, positions: 1, refusedShare: 0 }], 4, 'Bosch', { supplier: 'Другой' });
  assert.ok(!sc.find(o => o.supplier.startsWith('autoeuro')).suspicious);
  assert.strictEqual(sc[0].supplier, 'autoeuro.ru [online]');
});
console.log('test-logistics (replacements): ok');

t('retro check: only positions the manager already ordered, from the last N days, no own stock, not recorded yet', () => {
  const now = Date.parse('2026-11-10T18:00:00Z');
  const row = (date, positions) => ({ summary: { number: 'N', date, positions } });
  const rows = [
    row('2026-11-09 12:00:00', [
      { id: '1', supplier: 'ЦС Автодом Сток', status: 'Заказано' },
      { id: '2', supplier: 'ЦС Автодом Сток', status: 'Заказ принят' },          // not decided yet
      { id: '3', supplier: 'Наше наличие', status: 'Заказано' },                  // own stock
      { id: '4', supplier: 'autoeuro.ru [online]', status: 'ВЫДАНО.' }]),
    row('2026-11-01 12:00:00', [{ id: '5', supplier: 'X', status: 'Заказано' }]), // too old
  ];
  assert.deepStrictEqual(shadow.retroCandidates(rows, new Set(['4']), 3, now).map(x => x.p.id), ['1']);
});
t('10.11: Рольф cheaper -> Рольф; manager\'s supplier missing now -> not replaced by a much dearer / unknown one', () => {
  // MANN C26042: Рольф Ясенево нал 1 101 ₽ (11 % refusals in history) vs autoeuro.ru 1 158 ₽ (86 % of 118)
  const o = sup.normalizeOffers('C26042', [
    { number: 'C26042', brand: 'MANN-FILTER', price: 1200, priceIn: 1101, deliveryPeriod: 24, distributorId: 1 },
    { number: 'C26042', brand: 'MANN-FILTER', price: 1250, priceIn: 1158, deliveryPeriod: 24, distributorId: 2 }],
    new Map([['1', 'Рольф Ясенево нал'], ['2', 'autoeuro.ru [online]']]));
  const stats = [{ supplier: 'Рольф Ясенево нал', judged: 50, onTimeShare: 0.6, positions: 55, refusedShare: 0.11 },
                 { supplier: 'autoeuro.ru [online]', judged: 118, onTimeShare: 0.86, positions: 120, refusedShare: 0.02 }];
  const sc = sup.scoreOffers(o, stats, 1, 'MANN-FILTER', { supplier: 'Рольф Ясенево нал' });
  assert.strictEqual(sup.preferCurrent(sc, { supplier: 'Рольф Ясенево нал', priceIn: 1101 })[0].supplier, 'Рольф Ясенево нал');
  // Toyota 5310178210: Рольф (62 833 ₽ in the order) has no offer now; froza 78 413 ₽ -> keep Рольф
  const o2 = sup.scoreOffers(sup.normalizeOffers('5310178210', [
    { number: '5310178210', brand: 'TOYOTA', price: 80000, priceIn: 78413, deliveryPeriod: 96, distributorId: 7 }], new Map([['7', 'froza.ru [online]']])), [], 1, 'TOYOTA');
  const k2 = sup.preferCurrent(o2, { supplier: 'Рольф Ясенево нал', priceIn: 62833 });
  assert.strictEqual(k2[0].supplier, 'Рольф Ясенево нал'); assert.ok(k2[0].missingNow);
  assert.ok(sup.explainPick(k2, { supplier: 'Рольф Ясенево нал', priceIn: 62833 })[0].startsWith('у поставщика из заказа сейчас нет предложения'));
});
t('11.11: an unproven supplier is never paid more than the cheapest proven one — with or without a manager', () => {
  // Masuma case: adeo.pro (no history) in stock but 100 ₽ dearer than a slow supplier with 40 deliveries, 60 % on time
  const o = sup.normalizeOffers('MS1234', [
    { number: 'MS1234', price: 2000, priceIn: 2000, deliveryPeriod: 240, distributorId: 1 },
    { number: 'MS1234', price: 2100, priceIn: 2100, deliveryPeriod: 0, distributorId: 2 }], new Map([['1', 'autoeuro.ru [online]'], ['2', 'adeo.pro [online]']]));
  const sc = sup.scoreOffers(o, [{ supplier: 'autoeuro.ru [online]', judged: 40, onTimeShare: 0.6, positions: 40, refusedShare: 0 }], 1);
  assert.strictEqual(sc[0].supplier, 'autoeuro.ru [online]');   // no «current» passed at all = autopilot
  assert.ok(sc[0].riskGated && sc[0].riskGated.supplier === 'adeo.pro [online]');
  assert.ok(sup.explainPick(sc, {}).some(x => x.includes('непроверенное обещание')));
  // the proven one is late most of the time -> no reference, the faster new one may win
  const sc2 = sup.scoreOffers(o, [{ supplier: 'autoeuro.ru [online]', judged: 40, onTimeShare: 0.3, positions: 40, refusedShare: 0 }], 1);
  assert.ok(!sc2[0].riskGated);
});
t('11.11: Михаил\'s trusted list', () => {
  for (const n of ['Рольф Ясенево нал', 'ЦС Автодом Сток', 'zlataauto.ru [online]', 'Мезенцев', 'ОригаТо', 'germsp.ru [online]', 'Марат', 'БорисХоф Север'])
    assert.ok(sup.isTrusted(n), n);
  assert.ok(!sup.isTrusted('adeo.pro [online]'));
});
console.log('test-logistics (retro): ok');
