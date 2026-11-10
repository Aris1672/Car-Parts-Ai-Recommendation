/** Narrowing dialog (owner 10.11, project doc «narrowing-dialog-plan»): pure engine + chat glue. */
process.env.NARROWING = '1';
const a = require('assert');
const n = require('../lib/narrowing');

// XM 50e (WBS11CS0609158489): the site's name search «Воздуховод», 20 rows (owner's screenshot 10.11).
const XM = [['13715A1F9C2','Воздуховод'],['51749451352','Воздуховод сверху'],['13719455373','Воздуховод наддувочного воздуха'],['51749451683','Воздуховод радиатора сверху'],['51749451684','Воздуховод радиатора снизу'],['51169399772','Воздуховод задней части салона'],['51169399774','Воздуховод задней части салона'],['51759451727','Воздуховод заднего глушителя слева'],['51759451728','Воздуховод заднего глушителя справа'],['51166833469','Воздуховод задней части салона Л'],['51166833470','Воздуховод задней части салона П'],['51479399775','Воздуховод задней части салона Л'],['51479399776','Воздуховод задней части салона П'],['51477434329','Воздуховод в задн.части салона Л Пд'],['51477434330','Воздуховод в задн.части салона П Пд'],['64227431847','Воздуховод в задн.части салона Л Зд'],['64227431848','Воздуховод в задн.части салона П Зд'],['51169399910','Переходная пластина воздуховода'],['517451A0BE1','Рама воздуховода снизу'],['64116825817','Штуцер воздуховода, Л Зд часть салона']].map(([oem, name]) => ({ oem, name }));

{
  const c = n.headFilter(XM, n.stemsFor('воздуховод', []));
  a.strictEqual(c.length, 17, 'neighbours («Штуцер / Рама / Переходная пластина воздуховода») out');
  let item = { kw: 'воздуховод', cands: c, asked: [] };
  let s = n.nextStep(item);
  a.strictEqual(s.attr, 'kind');
  a.ok(s.options.includes('Воздуховод радиатора') && s.options.includes('Воздуховод задней части салона') && s.options.includes(n.DONT_KNOW), s.options.join(' | '));
  a.ok(!s.options.some(o => /в задн\.части/.test(o)), 'one kind for «задней части» / «в задн.части»');
  item = n.applyAnswer(item, 'kind', 'Воздуховод радиатора');
  s = n.nextStep(item);
  a.strictEqual(s.attr, 'topBottom');
  item = n.applyAnswer(item, 'topBottom', 'Нижний');
  s = n.nextStep(item);
  a.ok(s.done && s.pick.length === 1 && s.pick[0].oem === '51749451684');
  // precise request: the customer's own words answer the questions -> 0 questions
  const p = n.applyRequestWords(c, 'Воздуховод радиатора снизу VIN: WBS11CS0609158489', 'воздуховод');
  a.deepStrictEqual(p.map(x => x.oem), ['51749451684']);
  // «Не знаю» -> show what is left
  const g = n.applyAnswer({ kw: 'воздуховод', cands: c, asked: [] }, 'kind', n.DONT_KNOW);
  a.ok(g.gaveUp && g.cands.length === 17);
  console.log('test-narrowing: XM воздуховод ok');
}
{
  // Brake pads: catalog «Рем.к-т торм.накладок», axle from the number (34 1x front, 34 2x rear).
  const pads = [
    { oem: '34106888459', name: 'Рем.к-т торм.накладок, безасбестовых', axle: 'передняя ось' },
    { oem: '34216888825', name: 'Рем.к-т торм.накладок, безасбестовых', axle: 'задняя ось' },
    { oem: '34356890789', name: 'Датчик износа тормозных накладок' },
  ];
  const c = n.headFilter(pads, n.stemsFor('тормозные колодки', ['накладка', 'колодка']));
  a.strictEqual(c.length, 2, 'wear sensor is a neighbour');
  a.deepStrictEqual(n.applyRequestWords(c, 'Задние тормозные колодки VIN WBS11CS0609158489', 'задние тормозные колодки').map(x => x.oem), ['34216888825'], 'precise -> no question');
  const s = n.nextStep({ kw: 'тормозные колодки', cands: c, asked: [] });
  a.strictEqual(s.attr, 'frontRear', 'no axle said -> asked');
  a.ok(s.options.includes('Оба (передний и задний)'));
  console.log('test-narrowing: brake pads ok');
}
{
  // State round trip + exact button match.
  const st = { v: 1, items: [], attr: 'side', options: ['Левый', 'Правый'] };
  const msgs = [{ role: 'assistant', content: 'Левый или правый?' + n.stateBlock(st) }];
  a.deepStrictEqual(n.stateOf(msgs).options, ['Левый', 'Правый']);
  a.strictEqual(n.matchOption(' левый ', st.options), 'Левый');
  console.log('test-narrowing: state ok');
}
{
  // Chat glue: question -> answers -> card (no live prices offline).
  const chat = require('../api/chat');
  (async () => {
    const cands = n.headFilter(XM, n.stemsFor('воздуховод', [])).map(n.compact);
    const st = { v: 1, car: 'BMW XM 50e (G09)', schema: { catalog: 'C', vid: '1', ssd: 'x' }, items: [{ kw: 'воздуховод', cands, asked: [] }], cur: 0 };
    let reply = await chat._narrow.narrowContinue(st, '');
    a.ok(/17 вариантов/.test(reply) && /<<<NARROW_STATE>>>/.test(reply), reply.slice(0, 200));
    const msgs = [{ role: 'user', content: 'Воздуховод' }, { role: 'assistant', content: reply }, { role: 'user', content: 'Воздуховод радиатора' }];
    reply = await chat._narrow.narrowingFollowUp(msgs);
    msgs.push({ role: 'assistant', content: reply }, { role: 'user', content: 'Нижний' });
    reply = await chat._narrow.narrowingFollowUp(msgs);
    a.ok(/51749451684/.test(reply) && !/<<<NARROW_STATE>>>/.test(reply), reply.slice(0, 300));
    console.log('test-narrowing: chat glue ok');
  })().catch(e => { console.error(e); process.exit(1); });
}
{
  // No row IS the asked part -> nothing (10.11 #531-535: a trim kit came through as pads).
  const trim = [{ oem: '51137480123', name: 'Ремкомплект для черной дизайн. накладки' }];
  a.strictEqual(n.headFilter(trim, n.stemsFor('тормозные колодки', ['колодка'])).length, 0);
  console.log('test-narrowing: no false part ok');
}
{
  // XM front pads «Ремкомплект тормозных колодок» (34 10 8 842 390, owner's screenshot 10.11).
  const rows = [{ oem: '34108842390', name: 'Ремкомплект тормозных колодок', axle: 'передняя ось' }, { oem: '34216888825', name: 'Рем.к-т торм.накладок, безасбестовых', axle: 'задняя ось' }];
  a.strictEqual(n.headFilter(rows, n.stemsFor('тормозные колодки', ['накладка', 'колодка'])).length, 2);
  console.log('test-narrowing: XM front pads name ok');
}
{
  // XM rear pads «Ремкомплект тормозных колодок безасбест.» 34 20 8 842 966 (owner's screenshot 10.11).
  const rows = [{ oem: '34108842390', name: 'Ремкомплект тормозных колодок', axle: 'передняя ось' }, { oem: '34208842966', name: 'Ремкомплект тормозных колодок безасбест.', axle: 'задняя ось' }];
  const c = n.headFilter(rows, n.stemsFor('задние тормозные колодки', ['накладка', 'колодка']));
  a.deepStrictEqual(n.applyRequestWords(c, 'Задние тормозные колодки, VIN: WBS11CS0609158489', 'задние тормозные колодки').map(x => x.oem), ['34208842966']);
  const s = n.nextStep({ kw: 'тормозные колодки', cands: c, asked: [] });
  a.strictEqual(s.attr, 'frontRear', 'front «колодок» vs rear «колодок безасбест.» = one kind, the axle is asked');
  console.log('test-narrowing: XM rear pads name ok');
}
{
  // «Задние тормозные колодки», then only the VIN (10.11 #552): the keyword keeps «задние».
  const rows = [{ oem: '34108842390', name: 'Ремкомплект тормозных колодок', axle: 'передняя ось' }, { oem: '34208842966', name: 'Ремкомплект тормозных колодок безасбест.', axle: 'задняя ось' }];
  const kw = 'задние тормозные колодки';
  a.deepStrictEqual(n.applyRequestWords(rows, `${kw} VIN: WBS11CS0609158489`, kw).map(x => x.oem), ['34208842966']);
  console.log('test-narrowing: words from the earlier message ok');
}
{
  // «Тормозные диски»: «Диск датчика» skipped -> straight to the axle (owner 10.11).
  const rows = [{ oem: '34116889456', name: 'Тормозной диск Л', axle: 'передняя ось' }, { oem: '34116889457', name: 'Тормозной диск П', axle: 'передняя ось' }, { oem: '34216889467', name: 'Тормозной диск', axle: 'задняя ось' }, { oem: '34526884421', name: 'Диск датчика' }];
  const c = n.applyRequestWords(n.headFilter(rows, n.stemsFor('тормозные диски', ['диск'])), 'тормозные диски VIN: WBS11CS0609158489', 'тормозные диски');
  a.strictEqual(c.length, 3);
  a.strictEqual(n.nextStep({ kw: 'тормозные диски', cands: c, asked: [] }).attr, 'frontRear');
  console.log('test-narrowing: brake discs ok');
}
{
  // X5 E70 «Воздуховод» (owner's site search 10.11): kinds first, «Дополнительный воздуховод» in,
  // «левой / правой центральной стойки» = one kind + the side question; «Патрубок …» out.
  const rows = [['51647222952','Воздуховод радиатора'],['64316945579','Воздуховод LHD'],['51748048025','Дополнительный воздуховод Л'],['51747222877','Воздуховод тормозов Л Пд'],['51747222878','Воздуховод тормозов П Пд'],['64226803173','Воздуховод задней части салона'],['64226963457','Воздуховод левой центральной стойки'],['64226963458','Воздуховод правой центральной стойки'],['64229112783','Воздуховод задней части салона'],['64229279302','Воздуховод обдува лобового стекла'],['64229390523','Воздуховод задней части салона'],['51459129316','Воздуховод, простр.для ног водителя LHD'],['51748048023','Воздуховод доп.радиатора Л M-PAKET'],['64119129300','Воздуховод, простр.для ног пасс. LHD'],['51717169417','Крышка воздуховода Л Пд'],['11537800000','Патрубок соединительный']].map(([oem, name]) => ({ oem, name }));
  const c = n.headFilter(rows, n.stemsFor('воздуховод', []));
  a.ok(c.some(x => x.oem === '51748048025') && !c.some(x => /Крышка|Патрубок/.test(x.name)), c.map(x => x.name).join(' | '));
  const s = n.nextStep({ kw: 'воздуховод', cands: c, asked: [] });
  a.strictEqual(s.attr, 'kind', s.question);
  a.ok(s.options.includes('Воздуховод центральной стойки') && s.options.includes('Воздуховод тормозов'), s.options.join(' | '));
  console.log('test-narrowing: X5 E70 воздуховод ok');
}
