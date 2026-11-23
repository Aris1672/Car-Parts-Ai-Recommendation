process.env.LLM_API_KEY = '';
const assert = require('assert');
const lx = require('../lib/laximo');
const prices = require('../lib/abcpPrices');
const parts = [
  { oem: '31108866771', name: 'Поперечный рычаг с резинов.подшипником Л', query: 'поперечный рычаг', schema: { catalog: 'BMW', vid: 'car', ssd: 's' } },
  { oem: '31108866772', name: 'Поперечный рычаг с резинов.подшипником П', query: 'поперечный рычаг', schema: { catalog: 'BMW', vid: 'car', ssd: 's' } },
];
let searches=[]; let pages=0;
lx.searchByCatalogNames = async (_schema, names) => { searches.push(names[0]); return names[0].endsWith('передний') ? [] : [...parts, { oem: '31106884584', name: 'Демпфер поперечный рычаг подвески' }]; };
lx.partUnits = async () => [{ group:'31', unitCode:'31_test', unitName:'Балка пер.моста, попер.рычаг подв./тяга', ref:'unit' }];
lx.unitPage = async () => { pages++; return { image:'img', unitName:'Балка пер.моста, попер.рычаг подв./тяга', rows: parts.map((p,i)=>({...p,position:'04',box:{x:i+1,y:1}})) }; };
prices.livePrices = async () => ({});
const chat=require('../api/chat');
const st={v:1,cur:0,car:'BMW X5 25dX',schema:{catalog:'BMW',vid:'car',ssd:'s'},items:[{kw:'продольный нижний рычаг передний',frontLowerArm:true,cands:[],asked:[]}]};
(async () => {
  for (const [model, kw] of [['25dX', 'продольный нижний рычаг передний'], ['40dX', 'передний нижний продольный рычаг']]) {
    searches = []; pages = 0;
    lx.findPartsByModel = async () => ({ vehicle: { brand: 'BMW', name: 'X5 ' + model }, vehicleQuery: { c: 'BMW', vid: model, ssd: 's' }, parts: [] });
    const reply = await chat._narrow.narrowingStart({ brand: 'BMW', model: 'X5 G05 ' + model, partKeywords: [kw] }, [{ role: 'user', content: 'БМВ X5 G05 ' + kw }, { role: 'user', content: 'X5 ' + model }], {});
    assert.ok(reply.includes('<<<UNIT_DIAGRAM>>>') && !reply.includes('Где находится нужный?'));
    assert.deepStrictEqual(searches, ['поперечный рычаг передний', 'поперечный рычаг']);
    assert.strictEqual(pages, 1);
    const state = JSON.parse(reply.match(/<<<CONFIRM_STATE>>>([\s\S]*?)<<<END_CONFIRM_STATE>>>/)[1]);
    assert.strictEqual(state.position, '4');
    assert.deepStrictEqual(state.armChoices, { Левый: '31108866771', Правый: '31108866772' });
    const follow = content => chat._confirmFollowUp([{ role: 'assistant', content: reply }, { role: 'user', content }]);
    for (const [side, oem] of Object.entries(state.armChoices)) {
      const chosen = await follow(side);
      assert.deepStrictEqual(JSON.parse(chosen.match(/<<<PRODUCTS>>>([\s\S]*?)<<<END_PRODUCTS>>>/)[1]).map(c => c.article), [oem]);
    }
    for (const text of ['4', '4, 5', 'да']) assert.ok(!(await follow(text)).includes('<<<PRODUCTS>>>'));
  }
  assert.ok(!lx.isFrontLowerArmAlias('продольный нижний рычаг задний'));
  assert.ok(!lx.isFrontLowerArmAlias('сайлентблок переднего нижнего продольного рычага'));
  // Synthetic 40dX/40iX response shapes: different references can point to the
  // same verified catalog unit, and broad results can include other positions.
  const extra = { oem: '31100000003', name: 'Поп.рычаг с рез.подшипником Л' };
  for (const [model, position] of [['40dX', '06'], ['40iX', '09']]) {
    searches = [];
    lx.searchByCatalogNames = async (_, [query], accept) => {
      searches.push(query);
      const rows = query.endsWith('передний') ? [parts[0]] : [...parts, extra, { oem: '31100000004', name: 'Поп.рычаг подв. Вх' }];
      return rows.filter(accept);
    };
    lx.partUnits = async (_, oem) => [{ group: '31', unitCode: '31_test', ref: oem }];
    lx.unitPage = async () => ({ image: 'img', unitName: 'Передняя подвеска', rows: [
      ...parts.map(p => ({ ...p, position })), { ...extra, position: '08' },
    ] });
    const reply = await chat._narrow.narrowContinue({ ...st, car: 'BMW X5 ' + model }, '');
    const state = JSON.parse(reply.split('<<<CONFIRM_STATE>>>')[1].split('<<<END_CONFIRM_STATE>>>')[0]);
    assert.strictEqual(state.position, String(Number(position)));
    assert.deepStrictEqual(state.armChoices, { Левый: parts[0].oem, Правый: parts[1].oem });
    assert.deepStrictEqual(searches, ['поперечный рычаг передний', 'поперечный рычаг']);
  }
  lx.partUnits = async () => [{ group: '33', ref: 'wrong' }];
  assert.ok((await chat._narrow.narrowContinue(st, '')).includes('<<<MANAGER_BUTTON>>>'));
  console.log('test-front-lower-arm: both X5 cases, ordered fallback, shared diagram, side and safe miss ok');
})().catch(err => { console.error(err); process.exitCode = 1; });
