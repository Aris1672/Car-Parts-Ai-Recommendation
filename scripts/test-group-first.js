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
  a.ok(/Какой узел показать/.test(r) && /"Воздуховоды"/.test(r) && /"Облицовка днища кузова"/.test(r) && !/51_8782/.test(r.split('<<<NARROW_STATE>>>')[0]), r.slice(0, 400));
  msgs.push({ role: 'assistant', content: r }, { role: 'user', content: 'Воздуховоды' });
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

  // A list (owner 10.11: the new logic everywhere): pads (one part) + воздуховод (groups).
  const pads = [{ oem: '34216888825', name: 'Рем.к-т торм.накладок', axle: 'задняя ось' }];
  st = st0([{ kw: 'задние тормозные колодки', cands: pads, asked: [], text: 'x' }, { kw: 'воздуховод', cands: xm, asked: [], text: 'Задние колодки и воздуховод' }]);
  r = await chat._narrow.narrowContinue(st, '');
  a.ok(/34216888825/.test(r) && /деталь 2 из 2/.test(r) && /64 Отопление/.test(r), 'pads card first, then the group question for item 2: ' + r.slice(0, 300));
  // воздуховод first, pads second: the unit view carries the rest of the list
  st = st0([{ kw: 'воздуховод', cands: xm, asked: [], text: 'Воздуховод и задние колодки' }, { kw: 'задние тормозные колодки', cands: pads, asked: [], text: 'x' }]);
  r = await chat._narrow.narrowContinue(st, '');
  msgs = [{ role: 'user', content: 'Воздуховод и задние колодки' }, { role: 'assistant', content: r }, { role: 'user', content: '64 Отопление и кондиционирование' }];
  r = await chat._narrow.narrowingFollowUp(msgs);
  a.ok(/<<<UNIT_DIAGRAM>>>/.test(r) && /Готово, дальше/.test(r), r.slice(0, 300));
  msgs.push({ role: 'assistant', content: r }, { role: 'user', content: 'Готово, дальше' });
  const next = await (async () => { const h = require('../api/chat'); return h._confirmFollowUp ? h._confirmFollowUp(msgs) : null; })();
  if (next !== null) a.ok(/34216888825/.test(next), 'next part = the pads card: ' + String(next).slice(0, 300));
  console.log('test-group-first: list of parts ok');

  // Pads in two units that differ only by axle (owner 10.11): «Передние / Задние тормозные колодки / Обе оси».
  UNITS['34108842390'] = [{ group: '34', unitCode: '34_3255', unitName: 'Датчик износа торм.накладки пер.колеса', ref: 'api:C:1:u34f:s' }];
  UNITS['34208842966'] = [{ group: '34', unitCode: '34_3256', unitName: 'Датчик износа торм.накладки колеса Зд', ref: 'api:C:1:u34r:s' }];
  const padsBoth = [{ oem: '34108842390', name: 'Ремкомплект тормозных колодок', axle: 'передняя ось' }, { oem: '34208842966', name: 'Ремкомплект тормозных колодок безасбест.', axle: 'задняя ось' }];
  st = st0([{ kw: 'тормозные колодки', cands: padsBoth, asked: [], text: 'и тормозные колодки' }]);
  r = await chat._narrow.narrowContinue(st, '');
  a.ok(/Передние тормозные колодки/.test(r) && /Задние тормозные колодки/.test(r) && /Обе оси/.test(r) && !/Датчик износа/.test(r.split('<<<NARROW_STATE>>>')[0]), r.slice(0, 400));
  msgs = [{ role: 'user', content: 'и тормозные колодки' }, { role: 'assistant', content: r }, { role: 'user', content: 'Обе оси (передние и задние)' }];
  r = await chat._narrow.narrowingFollowUp(msgs);
  a.ok(/34108842390/.test(r) && /34208842966/.test(r) && !/<<<NARROW_STATE>>>/.test(r), 'both axles -> both cards: ' + r.slice(0, 300));
  console.log('test-group-first: pads front / rear / both ok');

  // Group 02 is dropped when the part has its own group (owner 10.11 #599).
  UNITS['P1'] = [{ group: '02', unitCode: '02_0084', unitName: 'ТО по регл.Oelservice / Inspektion', ref: 'r1' }, { group: '34', unitCode: '34_3133', unitName: 'Сервисный к-т торм.колодки', ref: 'r2' }];
  UNITS['P2'] = [{ group: '34', unitCode: '34_3133', unitName: 'Сервисный к-т торм.колодки', ref: 'r2' }];
  st = st0([{ kw: 'тормозные колодки', cands: [{ oem: 'P1', name: 'К-т' }, { oem: 'P2', name: 'К-т' }], asked: [], text: 'и тормозные колодки' }]);
  r = await chat._narrow.narrowContinue(st, '');
  a.ok(!/02 Объем/.test(r) && !/Где находится/.test(r), 'only group 34 -> no group question: ' + r.slice(0, 300));
  console.log('test-group-first: group 02 dropped ok');
})().catch(e => { console.error(e); process.exit(1); });
{
  // Foreign catalog names are detected (translated by the AI live; offline: nothing changes).
  const chat = require('../api/chat');
  if (chat._isForeignName) {
    a.ok(chat._isForeignName('Seitenscheibendefrostkanal') && chat._isForeignName('Luftkanal B-Säule') && !chat._isForeignName('Воздуховод задней части салона') && !chat._isForeignName('Болт M6'));
    console.log('test-group-first: foreign names ok');
  }
}
{
  // Group 88 «Детали и пакеты: ремонт и обслуживание» is never a group (owner 10.11 #590).
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'laximo.js'), 'utf8');
  a.ok(/NOT_A_PLACE_GROUP_RE = \/\^88\//.test(src) && /NOT_A_PLACE_UNITS = new Set\(\['02_0006'\]\)/.test(src), 'group 88 and unit 02_0006 out, 02_0084 stays');
  console.log('test-group-first: group 88 excluded ok');
}
{
  // After the picked positions' cards: only the positions not picked yet (owner 10.11).
  const chat = require('../api/chat');
  (async () => {
    const cst = { oem: '1', name: 'x', unit: 'U', schema: { catalog: 'C', vid: '1', ssd: 's', number: '1' }, car: 'BMW', noMarker: true, allPositions: true,
      positions: [1, 2, 3, 4, 5].map(i => ({ position: String(i), oem: `3411211206${i}`, name: `Деталь ${i}` })) };
    const msgs = [{ role: 'assistant', content: 'схема\n<<<CONFIRM_STATE>>>\n' + JSON.stringify(cst) + '\n<<<END_CONFIRM_STATE>>>' }, { role: 'user', content: '1, 2, 3' }];
    let r = await chat._confirmFollowUp(msgs);
    const b = JSON.parse(r.match(/<<<BUTTONS>>>([\s\S]*?)<<<END_BUTTONS>>>/)[1]);
    a.deepStrictEqual(b.items, ['4 — Деталь 4', '5 — Деталь 5'], JSON.stringify(b));
    msgs.push({ role: 'assistant', content: r }, { role: 'user', content: '4, 5' });
    r = await chat._confirmFollowUp(msgs);
    a.ok(!/<<<BUTTONS>>>/.test(r), 'all picked -> no chips: ' + r.slice(-300));
    console.log('test-group-first: only not-picked positions ok');
  })().catch(e => { console.error(e); process.exit(1); });
}
