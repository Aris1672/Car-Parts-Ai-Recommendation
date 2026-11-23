/** BMW X differential assembly routing: model lookup through button follow-up, offline. */
process.env.LLM_API_KEY = '';
const assert = require('node:assert/strict');
const lx = require('../lib/laximo');
const schema = { catalog: 'BMW', vid: 'fixture-car', ssd: 'fixture-ssd' };
const axles = [
  { button: 'Редуктор переднего моста', name: 'Привод переднего моста', oem: '31500000001', group: '31', position: '03' },
  { button: 'Редуктор заднего моста', name: 'Редуктор главной передачи', oem: '33100000001', group: '33', position: '07' },
];
const components = [
  { oem: '31500000002', name: 'Сальник привода переднего моста', position: '02' },
  { oem: '33100000002', name: 'Крышка редуктора главной передачи', position: '02' },
];
let mode = 'hit', model = 'X5 40dX';
const calls = { searches: [], units: [], pages: [] };
function reset() { for (const list of Object.values(calls)) list.length = 0; }
lx.findPartsByModel = async () => ({ vehicle: { brand: 'BMW', name: model }, parts: [],
  vehicleQuery: { c: schema.catalog, vid: schema.vid, ssd: schema.ssd } });
lx.searchByCatalogNames = async (ref, names, accept) => {
  assert.equal(ref.vid, schema.vid);
  calls.searches.push(...names.map(n => n.toLowerCase()));
  const rows = [...components, ...axles.filter(a => mode !== 'no-hit' || !names.some(n => n.toLowerCase() === a.name.toLowerCase()))];
  return rows.filter(accept || (r => names.some(n => r.name.toLowerCase().startsWith(n.toLowerCase()))));
};
lx.partUnits = async (_, oem) => {
  calls.units.push(oem);
  const axle = axles.find(a => a.oem === oem);
  if (!axle) return [];
  const opposite = axles.find(a => a !== axle);
  return (mode === 'wrong-group' ? [opposite] : [opposite, axle]).map(a => ({
    group: a.group, unitCode: a.group + '_test', unitName: a.name, ref: 'unit-' + a.group,
  }));
};
lx.unitPage = async ref => {
  calls.pages.push(ref);
  const i = axles.findIndex(a => ref === 'unit-' + a.group);
  assert.notEqual(i, -1);
  const rows = [components[i]];
  if (mode !== 'missing-position') rows.push(axles[i]);
  return { image: 'https://example.invalid/' + ref + '.png', unitName: axles[i].name,
    rows: rows.map(({ name, oem, position }) => ({ name, oem, position, box: { x: 5, y: 8 } })) };
};
const { narrowingStart, narrowingFollowUp } = require('../api/chat')._narrow;
const user = content => ({ role: 'user', content });
const history = kw => [user('BMW ' + model + ', ' + kw)];
const start = kw => narrowingStart({ brand: 'BMW', model, partKeywords: [kw] }, history(kw), {});
const follow = (question, answer) => narrowingFollowUp([...history('редуктор'), { role: 'assistant', content: question }, user(answer)]);
function block(reply, tag) {
  const body = String(reply).split('<<<' + tag + '>>>')[1];
  assert.ok(body, 'expected ' + tag + ' in ' + reply);
  return JSON.parse(body.split('<<<END_' + tag + '>>>')[0]);
}
function diagram(reply, axle) {
  assert.ok(reply && reply.includes('<<<UNIT_DIAGRAM>>>'), 'expected diagram: ' + reply);
  const state = block(reply, 'CONFIRM_STATE');
  assert.equal(state.oem, axle.oem);
  assert.equal(Number(state.position), Number(axle.position));
  assert.deepEqual(calls.searches, [axle.name.toLowerCase()]);
  assert.deepEqual(calls.units, [axle.oem]);
  assert.deepEqual(calls.pages, ['unit-' + axle.group]);
}
(async () => {
  const question = await start('редуктор');
  assert.deepEqual(block(question, 'BUTTONS').sort(), axles.map(a => a.button).sort());
  assert.deepEqual(calls, { searches: [], units: [], pages: [] }, 'ask before resolving an axle');
  for (const axle of axles) {
    reset(); diagram(await follow(question, axle.button), axle);
    reset(); diagram(await start(axle.button.toLowerCase()), axle);
    reset(); diagram(await start(axle.name.toLowerCase()), axle);
    reset(); diagram(await follow(question, axle.group === '31' ? 'передний' : 'задний'), axle);
    for (mode of ['no-hit', 'wrong-group', 'missing-position']) {
      reset();
      const miss = await follow(question, axle.button);
      assert.ok(miss && miss.includes('<<<MANAGER_BUTTON>>>'), mode + ': expected handoff');
      assert.doesNotMatch(miss, /<<<(?:UNIT_DIAGRAM|CONFIRM_STATE|PRODUCTS)>>>/);
      assert.deepEqual(calls.searches, [axle.name.toLowerCase()], 'never retry on the other axle');
    }
    mode = 'hit';
  }
  for (const [car, kw] of [['320d', 'редуктор'], ['X5 40dX', 'крышка редуктора'], ['X5 40dX', 'сальник переднего редуктора']]) {
    model = car; reset();
    const reply = await start(kw);
    assert.ok(!axles.some(a => String(reply).includes(a.button)), 'unexpected axle choice for ' + car + ' ' + kw);
    assert.deepEqual(calls.searches, [], 'not an X-series assembly request');
  }
  console.log('test-x-differential: both axle choices, explicit requests, catalog misses and scope guards ok');
})().catch(err => { console.error(err); process.exitCode = 1; });
