const assert = require('assert');
const lx = require('../lib/laximo');
const knowledge = require('../lib/knowledge');
const title = 'Балка пер.моста, попер.рычаг подв./тяга';
const schema = { catalog: 'BMW', vid: 'car', ssd: 'token' };
let available = true;
lx.findPartsByVin = async () => ({ vehicle: { brand: 'BMW', name: 'X6 M50iX', query: { c: 'BMW', vid: 'car', ssd: 'token' } }, parts: [] });
lx.groupUnitsNamed = async (ref, group, stem) => {
  assert.deepStrictEqual(ref, schema);
  assert.strictEqual(group, '31');
  assert.strictEqual(stem, title.toLowerCase());
  return available ? [{ unitCode: '31_example', unitName: title, ref: 'front-axle' }] : [];
};
lx.unitPage = async ref => {
  assert.strictEqual(ref, 'front-axle');
  return { image: 'https://img/front.png', rows: [{ position: '10', oem: '31110000001', name: 'Поперечный рычаг' }, { position: '09', oem: '07110000001', name: 'Гайка' }] };
};
const chat = require('../api/chat');
(async () => {
  for (const phrase of ['Шаровые опоры', 'Шаровая опора', 'Шарикова упора', 'Шариковая опора']) {
    assert.ok(knowledge.select(phrase).some(e => e.schemaOnly && e.unit === title));
    const reply = await chat._narrow.narrowingStart({ vin: 'WBACY810709B19176', partKeywords: [phrase] }, [{ role: 'user', content: phrase }], {});
    assert.ok(reply.includes('<<<UNIT_DIAGRAM>>>') && reply.includes(title), reply);
    assert.ok(reply.includes('10 — Поперечный рычаг') && reply.includes('9 — Гайка'));
    assert.ok(!reply.includes('Где находится'), 'no unrelated catalog groups');
  }
  available = false;
  const missing = await chat._narrow.narrowingStart({ vin: 'WBACY810709B19176', partKeywords: ['шаровые опоры'] }, [], {});
  assert.ok(missing.includes('Не удалось найти схему') && !missing.includes('<<<UNIT_DIAGRAM>>>'));
  console.log('test-ball-joint-schema: approved phrases, empty word search, full schema and missing unit ok');
})().catch(err => { console.error(err); process.exitCode = 1; });
