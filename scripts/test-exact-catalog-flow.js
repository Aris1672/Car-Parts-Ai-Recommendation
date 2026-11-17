/** Exact catalog evidence wins over knowledge/group guesses; no external calls. */
process.env.LLM_API_KEY = '';
const assert = require('assert');
const lx = require('../lib/laximo');
const kb = require('../lib/knowledge');
const prices = require('../lib/abcpPrices');
const n = require('../lib/narrowing');
const kw = 'крепление стойки амортизатора';
const schema = { catalog: 'BMW', vid: 'car', ssd: 's' };
const parts = [
  { oem: '41007933486', name: 'Крепление стойки амортизатора П Пд' },
  { oem: '41007933485', name: 'Крепление стойки амортизатора Л Пд' },
].map(p => ({ ...p, query: kw, exactName: true, schema }));
let currentParts = parts;
let unitCalls = [];
lx.findPartsByVin = async () => ({ vehicle: { brand: 'BMW', name: 'XM 50e', query: { c: 'BMW', vid: 'car', ssd: 's' } }, parts: currentParts });
kb.select = () => { throw new Error('Exact hits must not consult knowledge'); };
kb.extraGroups = () => { throw new Error('Exact hits must not add knowledge groups'); };
lx.partUnits = async (ref, oem) => {
  unitCalls.push(oem);
  return [{ group: '41', unitCode: '41_example', unitName: 'Колесная ниша/лонжерон', ref: 'body' }];
};
lx.mainGroupNames = async () => ({ '41': 'Кузов' });
lx.unitPage = async () => ({ image: 'https://example.invalid/body.png', rows: parts.map(p => ({ ...p, position: '01', box: { x: 1, y: 1 } })) });
prices.livePrices = async () => ({});
const chat = require('../api/chat');
const messages = [{ role: 'user', content: 'Крепление стойки амортизатора' }, { role: 'assistant', content: 'Пришлите VIN' }, { role: 'user', content: 'WBS11CS0609158489' }];
(async () => {
  const reply = await chat._narrow.narrowingStart({ vin: 'WBS11CS0609158489', partKeywords: [kw] }, messages, {});
  const buttons = JSON.parse(reply.match(/<<<BUTTONS>>>\s*([\s\S]*?)\s*<<<END_BUTTONS>>>/)[1]);
  assert.deepStrictEqual(buttons, parts.map(p => p.name));
  assert.deepStrictEqual(unitCalls, [], 'ask variants before choosing any unit');
  assert.ok(!reply.includes('31 Передний') && !reply.includes('33 Задний'));
  const unknown = await chat._narrow.narrowingFollowUp([...messages, { role: 'assistant', content: reply }, { role: 'user', content: 'не знаю' }]);
  assert.deepStrictEqual(n.stateOf([{ role: 'assistant', content: unknown }]).items[0].cands, n.stateOf([{ role: 'assistant', content: reply }]).items[0].cands, 'unknown reply preserves exact evidence without knowledge fallback');
  for (const part of parts) {
    unitCalls = [];
    const selected = await chat._narrow.narrowingFollowUp([...messages, { role: 'assistant', content: reply }, { role: 'user', content: part.name }]);
    assert.deepStrictEqual(unitCalls, [part.oem]);
    assert.ok(selected.includes('<<<UNIT_DIAGRAM>>>') && selected.includes('Колесная ниша/лонжерон'));
    const state = JSON.parse(selected.match(/<<<CONFIRM_STATE>>>([\s\S]*?)<<<END_CONFIRM_STATE>>>/)[1]);
    assert.strictEqual(state.oem, part.oem, 'selected side is marked, even when both share position 01');
    assert.strictEqual(state.positions.length, 2, 'full unit contents preserved');
    const confirmed = await chat._confirmFollowUp([{ role: 'assistant', content: selected }, { role: 'user', content: '1' }]);
    const cards = JSON.parse(confirmed.match(/<<<PRODUCTS>>>\s*([\s\S]*?)\s*<<<END_PRODUCTS>>>/)[1]);
    assert.deepStrictEqual(cards.map(c => c.article), [part.oem], 'position 1 must not re-add the opposite side');
  }
  // Exact rows bypass noun heuristics and retain list continuation after selection.
  const st = { v: 1, car: 'BMW', schema, cur: 0, items: [
    { kw, exactName: true, cands: parts.map(n.compact), asked: [] },
    { kw: 'другая деталь', cands: [{ oem: '123', name: 'Другая деталь' }], asked: [] },
  ] };
  const first = await chat._narrow.narrowContinue(st, '');
  const view = await chat._narrow.narrowingFollowUp([{ role: 'assistant', content: first }, { role: 'user', content: parts[0].name }]);
  assert.ok(view.includes('Готово, дальше'));
  console.log('test-exact-catalog-flow: exact variants, both sides, shared unit and list continuation ok');
})().catch(err => { console.error(err); process.exitCode = 1; });
