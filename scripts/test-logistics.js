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
