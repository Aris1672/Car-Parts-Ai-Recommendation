/** Dialogs #1315, #1377 and #1378: advance from front pads to the engine oil filter. */
process.env.LLM_API_KEY = '';
process.env.LAXIMO_ENABLED = 'true';
const assert = require('node:assert/strict');
const laximo = require('../lib/laximo');
const prices = require('../lib/abcpPrices');
const chat = require('../api/chat');

const pads = 'передние тормозные колодки';
const filter = 'масляный фильтр';
const unit = 'Тормозной механизм переднего колеса';
const schema = { catalog: 'BMW202601', vid: 'fixture', ssd: 'vehicle-ssd' };
const padRows = [
  { oem: '34111111111', name: 'Рем.к-т торм.накладок, безасбестовых', axle: 'передняя ось' },
  { oem: '34111111112', name: 'Рем.к-т торм.накладок переднего колеса', axle: 'передняя ось' },
];
const element = { oem: '11421111111', name: 'К-т сменного элемента масляного фильтра', query: filter, schema, viaGroup: true };
const unrelatedRows = [
  { oem: '64111111111', name: 'Сменный элемент масляного фильтра', query: filter },
  { oem: '11421111112', name: 'Крышка сменного элемента масляного фильтра', query: filter },
  { oem: '11421111113', name: 'Масляный фильтр', unit: 'Масляный фильтр и теплообменник', query: filter },
];
const rowList = [...padRows.map(row => ({ ...row, query: pads, schema })), element];
const priceLookups = [];
prices.livePrices = async numbers => { priceLookups.push(numbers); return {}; };
laximo.partUnits = async (_schema, oem) => [{
  group: '34', unitCode: oem, ref: oem, unitName: oem === padRows[0].oem ? unit : 'Передний тормоз M Performance',
}];
laximo.mainGroupNames = async () => ({ 34: 'Тормозные механизмы' });
laximo.unitPage = async () => ({
  image: 'https://example.invalid/brakes.png',
  rows: [{ ...padRows[0], position: '1' }],
});

const assistant = content => ({ role: 'assistant', content });
const user = content => ({ role: 'user', content });
const cardsOf = reply => JSON.parse(reply.match(/<<<PRODUCTS>>>([\s\S]*?)<<<END_PRODUCTS>>>/)[1]);
const confirmationOf = reply => JSON.parse(reply.match(/<<<CONFIRM_STATE>>>([\s\S]*?)<<<END_CONFIRM_STATE>>>/)[1]);
const advance = reply => chat._confirmFollowUp([assistant(reply), user('Готово, дальше')]);
const savedState = state => '<<<CONFIRM_STATE>>>' + JSON.stringify(state) + '<<<END_CONFIRM_STATE>>>';

async function replay(extracted, messages) {
  const requested = { ...extracted, brand: 'BMW', partKeywords: [pads, 'накладки', filter],
    partSearchNames: { [pads]: ['накладка'], [filter]: ['фильтр', 'элемент фильтра'] } };
  const question = await chat._narrow.narrowingStart(requested, messages, {});
  const diagram = await chat._narrow.narrowingFollowUp([assistant(question), user(unit)]);
  assert.match(diagram, /<<<UNIT_DIAGRAM>>>/);
  const selected = await chat._confirmFollowUp([assistant(diagram), user('1')]);
  assert.deepEqual(cardsOf(selected).map(card => card.article), [padRows[0].oem]);
  assert.match(selected, /Готово, дальше/);
  const continued = await advance(selected);
  assert.deepEqual(cardsOf(continued).map(card => card.article), [element.oem]);
  assert.match(continued, /масляный фильтр/);
  return confirmationOf(selected);
}

(async () => {
  const vin = 'WBA00000000000001';
  const selectedVehicle = (name, rows) => ({
    vehicle: { brand: 'BMW', name, query: { c: schema.catalog, vid: schema.vid, ssd: schema.ssd } },
    parts: rows,
  });
  laximo.findPartsByVin = async requestedVin => {
    assert.equal(requestedVin, vin);
    return selectedVehicle('X6 M50iX', rowList);
  };
  laximo.findPartsByModel = async text => {
    assert.match(text, /X5 40iX/);
    return selectedVehicle('X5 40iX', [...rowList, ...unrelatedRows]);
  };
  const fromVin = await replay({ vin }, [user(`VIN: ${vin}\nНужно тормозные колодки передние и масляный фильтр`)]);
  await replay({ model: 'X5 G05 40iX' }, [
    user('Хочу тормозные колодки, передние и масляный фильтр.'), user('X5 G05 LCI'), user('X5 40iX'),
  ]);

  // An already-open chat may still hold the empty list from before the fix.
  fromVin.narrowRest.items[1].cands = [];
  laximo.searchByCatalogNames = async (ref, names, matchesRow) => {
    assert.deepEqual(ref, schema);
    assert.ok(names.includes('к-т сменного элемента масляного фильтра'));
    return [...unrelatedRows, element].filter(matchesRow);
  };
  assert.deepEqual(cardsOf(await advance(savedState(fromVin))).map(card => card.article), [element.oem]);

  laximo.searchByCatalogNames = async () => { throw new Error('fixture catalog timeout'); };
  const missing = await advance(savedState(fromVin));
  assert.match(missing, /масляный фильтр.*<<<MANAGER_BUTTON>>>/s);
  assert.doesNotMatch(missing, /<<<PRODUCTS>>>|откройте карточку/i);

  fromVin.narrowRest.items[1].kw = 'другая деталь';
  fromVin.narrowRest.items.push({ kw: 'свеча', cands: [{ oem: '12121111111', name: 'Свеча зажигания' }], asked: [] });
  const third = await advance(savedState(fromVin));
  assert.match(third, /другая деталь.*<<<MANAGER_BUTTON>>>/s);
  assert.deepEqual(cardsOf(third).map(card => card.article), ['12121111111']);
  assert.ok(priceLookups.every(numbers => numbers.length), 'never request prices for an empty list');
  console.log('test-oil-filter-continuation: VIN and model replay, existing chat recovery and missing results ok');
})().catch(err => { console.error(err); process.exitCode = 1; });
