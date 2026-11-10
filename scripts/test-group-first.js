/** Group-first narrowing (owner 10.11): search rows -> catalog groups -> group question -> unit -> unit diagram. */
process.env.NARROWING = '1';
const a = require('assert');
const laximo = require('../lib/laximo');
const n = require('../lib/narrowing');

const UNITS = {
  '13715A1F9C2': [{ group: '13', unitCode: '13_2622', unitName: 'Воздуховод', ref: 'api:C:1:u13:s' }],
  '51749451684': [{ group: '51', unitCode: '51_8782', unitName: 'Воздуховоды', ref: 'api:C:1:u51:s' }],
  '51759451727': [{ group: '51', unitCode: '51_8868', unitName: 'Облицовка днища кузова', ref: 'api:C:1:u518:s' }],
  '51169399772': [{ group: '64', unitCode: '64_2903', unitName: 'Воздуховод', ref: 'api:C:1:u64:s' }], // 51… number, unit in 64
  '51747290605': [{ group: '51', unitCode: '51_8574', unitName: 'Воздуховоды', ref: 'api:C:1:u5174:s' }],
  '51748058911': [{ group: '51', unitCode: '51_8574', unitName: 'Воздуховоды', ref: 'api:C:1:u5174:s' }],
};
laximo.partUnits = async (schema, oem) => UNITS[oem] || [];
laximo.mainGroupNames = async () => ({ 13: 'Подготовка и регулир. рабочей смеси', 51: 'Оснащение кузова', 64: 'Отопление и кондиционирование' });
laximo.groupUnitsNamed = async (schema, code) => (code === '13' ? [{ group: '13', unitCode: '13_2655', unitName: 'Воздуховод', ref: 'api:C:1:u13b:s' }]
  : code === '64' ? [{ group: '64', unitCode: '64_1876', unitName: 'Воздуховод', ref: 'api:C:1:u64b:s' }] : []);
laximo.unitPage = async ref => ({ image: 'https://img/x.png', unitName: 'Воздуховод', rows: [{ position: '01', oem: '64119999001', name: 'Воздуховод Пд' }, { position: '02', oem: '51169399772', name: 'Воздуховод задней части салона' }] });
const chat = require('../api/chat');
const st0 = items => ({ v: 1, car: 'BMW', schema: { catalog: 'C', vid: '1', ssd: 's' }, items, cur: 0 });

(async () => {
  // XM: rows in 13, 51 (two units), 64 -> group question with the catalog's group names.
  const xm = [['13715A1F9C2', 'Воздуховод'], ['51749451684', 'Воздуховод радиатора снизу'], ['51759451727', 'Воздуховод заднего глушителя слева'], ['51169399772', 'Воздуховод задней части салона']].map(([oem, name]) => ({ oem, name }));
  let st = st0([{ kw: 'воздуховод', cands: xm, asked: [], text: 'Воздуховод, VIN: WBS11CS0609158489' }]);
  let r = await chat._narrow.narrowContinue(st, '');
  a.ok(/13 Подготовка и регулир\. рабочей смеси/.test(r) && /51 Оснащение кузова/.test(r) && /64 Отопление и кондиционирование/.test(r), r.slice(0, 500));
  // «64» -> one unit -> its diagram (the 51… number counts as 64 by its unit)
  let msgs = [{ role: 'user', content: 'Воздуховод' }, { role: 'assistant', content: r }, { role: 'user', content: '64 Отопление и кондиционирование' }];
  r = await chat._narrow.narrowingFollowUp(msgs);
  a.ok(/<<<UNIT_DIAGRAM>>>/.test(r) && /группа 64/.test(r) && /Отмечена деталь/.test(r), r.slice(0, 400));
  // «51» -> two units -> unit question -> diagram
  st = st0([{ kw: 'воздуховод', cands: xm, asked: [], text: 'Воздуховод' }]);
  r = await chat._narrow.narrowContinue(st, '');
  msgs = [{ role: 'user', content: 'Воздуховод' }, { role: 'assistant', content: r }, { role: 'user', content: '51 Оснащение кузова' }];
  r = await chat._narrow.narrowingFollowUp(msgs);
  a.ok(/Какой узел показать/.test(r) && /Воздуховоды \(51_8782\)/.test(r) && /Облицовка днища кузова \(51_8868\)/.test(r), r.slice(0, 400));
  msgs.push({ role: 'assistant', content: r }, { role: 'user', content: 'Воздуховоды (51_8782)' });
  r = await chat._narrow.narrowingFollowUp(msgs);
  a.ok(/<<<UNIT_DIAGRAM>>>/.test(r), r.slice(0, 300));
  console.log('test-group-first: XM воздуховод ok');

  // 230i: the search finds only 51 -> the knowledge exception adds 13 and 64.
  const f22 = [['51747290605', 'Воздуховод радиатора сист.охлажд.двиг.'], ['51748058911', 'Воздуховод Нж М']].map(([oem, name]) => ({ oem, name }));
  st = st0([{ kw: 'воздуховод', cands: f22, asked: [], text: 'Воздуховод, VIN: WBA2H71010VF78880' }]);
  r = await chat._narrow.narrowContinue(st, '');
  a.ok(/13 Подготовка/.test(r) && /51 Оснащение кузова/.test(r) && /64 Отопление/.test(r), r.slice(0, 500));
  msgs = [{ role: 'user', content: 'Воздуховод' }, { role: 'assistant', content: r }, { role: 'user', content: '13 Подготовка и регулир. рабочей смеси' }];
  r = await chat._narrow.narrowingFollowUp(msgs);
  a.ok(/<<<UNIT_DIAGRAM>>>/.test(r) && /группа 13/.test(r) && !/Отмечена/.test(r), r.slice(0, 300));
  console.log('test-group-first: 230i воздуховод (knowledge groups 13, 64) ok');

  // Positions picked from the group-first diagram -> cards (the confirm flow).
  const cst = (r.match(/<<<CONFIRM_STATE>>>([\s\S]*?)<<<END_CONFIRM_STATE>>>/) || [])[1];
  a.ok(cst && JSON.parse(cst).noMarker && JSON.parse(cst).positions.length === 2);
  console.log('test-group-first: unit state for the position chips ok');
})().catch(e => { console.error(e); process.exit(1); });
