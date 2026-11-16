// Dialog #1021: selecting the oil cooler must never reuse coolant candidates.
const assert = require('assert');
const laximo = require('../lib/laximo');
const chat = require('../api/chat');
const coolant = { group: '17', unitCode: '17_coolant', unitName: 'Крепеж радиатора охлаждающей жидкости', ref: 'coolant' };
const oil = { group: '17', unitCode: '17_oil', unitName: 'Радиатор охл.масла КПП/трубопр.масл.рад.', ref: 'oil' };
let units = [coolant, oil];
let failPage = false;
const calls = [];
laximo.groupUnitsNamed = async (schema, group, stem) => {
  assert.strictEqual(schema.vid, 'vehicle');
  assert.strictEqual(group, '17');
  assert.strictEqual(stem, 'радиатор');
  return units;
};
laximo.mainGroupNames = async () => ({ '17': 'Система охлаждения' });
laximo.unitPage = async ref => {
  calls.push(ref);
  if (failPage) throw new Error('simulated page error');
  return { image: 'https://img/' + ref + '.png', rows: [
    { position: '01', oem: ref === 'oil' ? '17218843278' : '17118697883', name: ref === 'oil' ? 'Масляный радиатор коробки передач' : 'Радиатор охлаждающей жидкости' },
    { position: '02', oem: '07119900001', name: 'Болт' }
  ] };
};
(async () => {
  const initial = { v: 1, car: 'BMW X6 M50iX (G06)', schema: { catalog: 'BMW', vid: 'vehicle', ssd: 'token' }, cur: 0, items: [
    { kw: 'радиатор охлаждения', cands: [{ oem: '17118697883', name: 'Радиатор охлаждающей жидкости' }, { oem: '17115A3F238', name: 'Радиатор' }], asked: [] },
    { kw: 'воздушный фильтр', cands: [{ oem: '13710000001', name: 'Воздушный фильтр' }], asked: [] }
  ] };
  const question = await chat._narrow.narrowContinue(initial, '');
  assert.ok(!question.includes('<<<UNIT_DIAGRAM>>>'));
  const choose = selection => chat._narrow.narrowingFollowUp([
    { role: 'user', content: 'Радиатор охлаждения' },
    { role: 'assistant', content: question },
    { role: 'user', content: selection }
  ]);
  for (const [selection, ref, title] of [
    ['Масляный радиатор коробки передач', 'oil', oil.unitName],
    ['Радиатор охлаждающей жидкости', 'coolant', coolant.unitName]
  ]) {
    const reply = await choose(selection);
    assert.ok(reply.includes(title), reply);
    const diagram = JSON.parse(reply.match(/<<<UNIT_DIAGRAM>>>([\s\S]*?)<<<END_UNIT_DIAGRAM>>>/)[1]);
    assert.strictEqual(diagram.image, 'https://img/' + ref + '.png');
    const state = JSON.parse(reply.match(/<<<CONFIRM_STATE>>>([\s\S]*?)<<<END_CONFIRM_STATE>>>/)[1]);
    assert.strictEqual(state.ask, selection);
    assert.strictEqual(state.positions.length, 2, 'whole schema includes fasteners');
    assert.strictEqual(state.narrowRest.cur, 1, 'preserve next requested item');
    assert.ok(reply.includes('Готово, дальше'));
    assert.strictEqual(calls.at(-1), ref);
  }
  // Plain «Радиатор» uses unit-choice buttons: simplify only the coolant label.
  const group = { code: '17', name: 'Система охлаждения', units: [oil, coolant].map(u => ({ code: u.unitCode, name: u.unitName, ref: u.ref, oems: [] })) };
  const plain = { ...initial, items: [{ kw: 'радиатор', cands: initial.items[0].cands, asked: [], groups: [group] }] };
  const unitQuestion = await chat._narrow.narrowContinue(plain, '');
  const buttons = JSON.parse(unitQuestion.match(/<<<BUTTONS>>>([\s\S]*?)<<<END_BUTTONS>>>/)[1]);
  assert.deepStrictEqual(buttons, [oil.unitName, 'Радиатор охлаждающей жидкости', 'Не знаю — покажите схемы']);
  const coolantReply = await chat._narrow.narrowingFollowUp([{ role: 'assistant', content: unitQuestion }, { role: 'user', content: 'Радиатор охлаждающей жидкости' }]);
  assert.ok(coolantReply.includes(coolant.unitName), 'original schema title preserved');
  assert.strictEqual(calls.at(-1), 'coolant', 'friendly label routes to coolant schema');
  units = [coolant];
  const count = calls.length;
  const missing = await choose('Масляный радиатор коробки передач');
  assert.strictEqual(calls.length, count, 'no fallback to coolant');
  assert.ok(!missing.includes('<<<UNIT_DIAGRAM>>>'));
  assert.ok(missing.includes('<<<NARROW_STATE>>>'), 'selection can be retried');
  units = [coolant, oil]; failPage = true;
  const failed = await choose('Масляный радиатор коробки передач');
  assert.ok(!failed.includes('<<<UNIT_DIAGRAM>>>'));
  assert.ok(failed.includes('<<<NARROW_STATE>>>'));
  console.log('test-radiator-routing: both schemas, list context, missing unit and page failure ok');
})().catch(err => { console.error(err); process.exitCode = 1; });
