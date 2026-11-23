// Offline search-layer regression: VM replaces all I/O before any search runs.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../lib/laximo.js'), 'utf8');
const normalize = require('../lib/normalize');

function harness(responses = {}, groups = true) {
  const calls = [];
  const sandbox = {
    module: { exports: {} }, console: { log() {}, error() {} },
    process: { env: { LAXIMO_GROUPS: groups ? 'true' : 'false' } },
    URL, URLSearchParams, setTimeout, clearTimeout,
    require(id) {
      if (id === 'dns') return { setDefaultResultOrder() {} };
      if (id === 'cheerio') return { load() { throw new Error('Unexpected HTML parsing'); } };
      if (id === 'pg') return { Client: class { constructor() { throw new Error('Unexpected DB access'); } } };
      if (id === './progress') return { step() {}, quote: String };
      if (id === './normalize') return normalize;
      if (id === './laximoApi') return {};
      if (id === './xDifferential') return require('../lib/xDifferential');
      throw new Error('Unexpected dependency: ' + id);
    },
    async mockDetails(vehicle, query) {
      calls.push(query);
      const response = responses[query];
      if (response instanceof Error) throw response;
      return response || [];
    },
    async mockTree() { calls.push('<groups>'); return []; },
  };
  vm.runInNewContext(source + '\nsearchDetails = mockDetails; getGroupTree = mockTree; module.exports._blockGroups = () => { getGroupTree = async () => { throw new LaximoSkip("blocked fixture"); }; };', sandbox);
  return { L: sandbox.module.exports, calls };
}
const row = (oem, name) => ({ oem, name, position: '03', qty: '2', notes: { fit: 'original' },
  unit: 'Крепление стойки', schema: { number: oem, catalog: 'BMW', vid: 'car', ssd: 'token', unit: '41_1234' } });
const vehicle = { vin: 'TEST', query: { c: 'BMW', vid: 'car', ssd: 'token' } };
const list = value => Array.from(value);

(async () => {
  const kw = 'крепление амортизатора';
  const mounts = [row('41000000001', 'Крепление амортизатора Л'), row('41000000002', 'Крепление амортизатора П')];
  let h = harness({ [kw]: [...mounts, row('31000000001', 'Крепление амортизатора дополнительное')] });
  let found = await h.L.searchPartsForVehicle(vehicle, [kw], { [kw]: ['амортизатор', 'стойка'] }, { [kw]: ['31', '33'] }, { narrow: true });
  assert.deepStrictEqual(list(found.map(r => r.oem)), mounts.map(r => r.oem));
  assert.deepStrictEqual(h.calls, [kw], 'exact body-group 41 mounts never trigger groups/damper synonyms');
  for (let i = 0; i < found.length; i++) {
    assert.strictEqual(found[i].exactName, true);
    assert.strictEqual(found[i].query, kw);
    for (const key of Object.keys(mounts[i])) assert.strictEqual(found[i][key], mounts[i][key], key + ' preserved');
  }
  assert.deepStrictEqual(list(found.searched), [kw]);
  console.log('PASS exact body-41 mounts survive suspension filters; metadata preserved; no broad search');

  // Full names, case, ё and whitespace normalize; suffixes are whole approved tokens only.
  const match = h.L.exactCatalogName;
  for (const name of ['Крепление амортизатора', 'КРЕПЛЕНИЕ  амортизатора Пд Л', 'Крепление амортизатора Зд П', 'Крепление амортизатора Вх', 'Крепление амортизатора Нж']) assert.ok(match(kw, name), name);
  assert.ok(match('  Колёсный   кожух ', 'КОЛЕСНЫЙ\tКОЖУХ Л'));
  for (const name of ['Крепление амортизатора капота', 'Крепление амортизатора багажника', 'Крепление амортизатора дополнительное', 'Крепление амортизатора Пд дополнительное', 'Крепление амортизатора ЛевыйXYZ', 'Крепление амортизатора Л/что-то', 'Крепление амортизатораЛ', 'Болт крепление амортизатора', 'Крепление амортизатора, капота']) assert.ok(!match(kw, name), name);
  assert.ok(!match('', 'Л'));
  console.log('PASS strict normalization and false substring/component matches');

  h = harness({ 'амортизатор': [row('31000000010', 'Амортизатор Л')] });
  found = await h.L.searchPartsForVehicle(vehicle, ['амортизатор'], { 'амортизатор': ['стойка'] }, { 'амортизатор': ['31', '33'] });
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].exactName, true);
  assert.deepStrictEqual(h.calls, ['амортизатор']);
  console.log('PASS normal damper exact name suppresses family expansion');

  h = harness({ 'амортизаторы': [], 'амортизатор': [row('31000000010', 'Амортизатор Л')], 'стойка': [row('31000000011', 'Амортизаторная стойка')] }, false);
  found = await h.L.searchPartsForVehicle(vehicle, ['амортизаторы'], { 'амортизаторы': ['амортизатор'] }, null);
  assert.strictEqual(h.calls[0], 'амортизаторы');
  assert.ok(found.some(r => r.oem === '31000000010'));
  assert.ok(found.every(r => !r.exactName));
  assert.ok(h.calls.length > 2, 'ordinary suspension damper family still searched after exact miss');
  console.log('PASS ordinary damper fallback/family remains active after exact miss');

  h = harness({ 'воздушный фильтр': [], 'элемент фильтра': [row('13710000001', 'Сменный элемент фильтра')] });
  found = await h.L.searchPartsForVehicle(vehicle, ['воздушный фильтр'], { 'воздушный фильтр': ['элемент фильтра'] }, null);
  assert.strictEqual(h.calls[0], 'воздушный фильтр');
  assert.ok(h.calls.includes('элемент фильтра'));
  assert.strictEqual(found.length, 1);
  assert.ok(!found[0].exactName);
  console.log('PASS proven empty exact probe retains fallback search');

  h = harness({ [kw]: mounts, 'воздушный фильтр': [], 'элемент фильтра': [row('13710000001', 'Сменный элемент фильтра')] });
  found = await h.L.searchPartsForVehicle(vehicle, [kw, 'воздушный фильтр'], { [kw]: ['амортизатор'], 'воздушный фильтр': ['элемент фильтра'] }, {}, { narrow: true });
  assert.deepStrictEqual(h.calls.slice(0, 2), [kw, 'воздушный фильтр']);
  assert.ok(h.calls.includes('<groups>') && h.calls.includes('элемент фильтра'));
  assert.ok(!h.calls.includes('амортизатор'), 'resolved keyword excluded from broad plans');
  assert.strictEqual(found.filter(r => r.exactName).length, 2);
  assert.ok(found.some(r => r.oem === '13710000001'));
  console.log('PASS partial multi-keyword exact results preserve remaining group/name fallback');
  h = harness({ [kw]: mounts });
  h.L._blockGroups();
  found = await h.L.searchPartsForVehicle(vehicle, [kw, 'воздушный фильтр'], {}, {}, { narrow: true });
  assert.strictEqual(found.length, 2);
  assert.ok(found.every(r => r.exactName));
  assert.strictEqual(found.searchFailed, true);
  console.log('PASS unrelated fallback interruption preserves successful exact evidence');

  for (const error of [new Error('catalog unavailable'), Object.assign(new Error('timeout'), { name: 'AbortError' })]) {
    h = harness({ [kw]: error });
    await assert.rejects(h.L.searchPartsForVehicle(vehicle, [kw], { [kw]: ['амортизатор'] }, {}), e => e === error);
    assert.deepStrictEqual(h.calls, [kw]);
  }
  console.log('PASS exceptions/timeouts propagate without fallback');
  console.log('test-exact-catalog-search: all offline regressions passed');
})().catch(err => { console.error(err); process.exitCode = 1; });
