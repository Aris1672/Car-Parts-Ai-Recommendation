/**
 * Laximo web service (LAXIMO_SOURCE=api): parsers against real answers
 * (scripts/fixtures/laximo-api/, dumps of 04.11.2026, X5 40dX E70 LCI) and
 * the whole VIN -> group -> diagram -> ТО chain against a local fake Laximo
 * that serves those answers. No network, no database. Run: node scripts/test-laximo-api.js
 */
const a = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const FIX = path.join(__dirname, 'fixtures', 'laximo-api');
const fx = name => fs.readFileSync(path.join(FIX, `${name}.xml`), 'utf8');
const A = require('../lib/laximoApi');
const L = require('../lib/laximo');
const noteLabel = L.noteLabel;

// ─── parsers ────────────────────────────────────────────────────────────────
const [car] = A.parseVehicles(fx('FindVehicleByVIN'));
a.strictEqual(car.brand, 'BMW');
a.strictEqual(car.catalog, 'BMW202601');
a.strictEqual(car.vid, '2050271679');
a.strictEqual(car.name, 'X5 40dX');
a.strictEqual(car.modelCode, 'E70 LCI');
a.ok(car.ssd.startsWith('$*Kw'));
a.strictEqual(car.options['Дата выпуска'], '29.09.2010');       // used by versionCheck in chat.js
a.strictEqual(car.options['Код модели'], 'E70N');               // chassis regex in chat.js: ^[A-Z]\d{2,3}
a.strictEqual(car.options['Двигатель'], 'N57S (3000CC / 225kW)');
a.strictEqual(car.options['Регион'], 'ЕЭК');                    // European car -> export variants dropped
a.strictEqual(car.options['Модель'], 'ZW61');
a.strictEqual(car.options['Модель (2)'], 'X5 E70 LCI');

const tree = A.parseQuickGroups(fx('ListQuickGroup'));
const pads = tree.find(n => n.gid === '545');
a.deepStrictEqual(pads, { gid: '545', name: 'Колодки тормозные дисковые', aliases: [], path: 'Тормозная система' });
a.deepStrictEqual(tree.find(n => n.gid === '13').aliases, ['Водяной насос', 'Помпа']);
a.strictEqual(tree.find(n => n.gid === '611').path, 'Ходовая часть › Колеса, шины');
a.ok(!tree.some(n => n.gid === '0' || n.gid === '1'), 'link="false" nodes are not groups');
a.ok(tree.some(n => n.gid === '178') && tree.some(n => n.gid === '179'), 'a group inside a group');
a.strictEqual(L.findGroupFor('тормозные колодки', tree).gid, '545');   // the site's own group rules work on the API tree
a.strictEqual(L.findGroupFor('помпа', tree).gid, '13');

const blocks = A.parseUnitBlocks(fx('ListQuickDetail'), noteLabel);
a.strictEqual(blocks.length, 3);
a.deepStrictEqual(blocks[0].category, { id: '340072', name: 'Сервисное обслуживание тормозов', ssd: '$*KwGiloe89P$' });
a.strictEqual(blocks[0].unit.uid, '1171722170');
a.strictEqual(blocks[0].unit.ssd, '$*KwH6zt_krK$');
a.strictEqual(blocks[0].unit.image, 'https://img.laximo.ru/BMW202601/source/483884_z.gif?s=937811639&k=88961d4fef444bdf3237bbbdca9b51a5');
const disc = blocks[0].rows[0];
a.strictEqual(disc.oem, '34116868938');
a.strictEqual(disc.position, '01');
a.strictEqual(disc.qty, '2 шт.');
a.strictEqual(disc.notes['Примечание'], 'min.th. = 28,4 mm; 348X30');
a.ok(Object.values(disc.notes).some(v => /Для автомобилей с Исполнение для Китая \(L8AAA\) = нет/.test(v)), 'comment1 kept next to note');
a.strictEqual(blocks[0].rows.filter(r => r.match).map(r => r.oem).join(), '34116852253');

const appl = A.parseUnitBlocks(fx('GetOEMPartApplicability'), noteLabel);
a.strictEqual(A.applicabilityOf(fx('GetOEMPartApplicability')), 'PARTIAL');
a.strictEqual(appl.length, 2);
a.strictEqual(L.pickSchemaBlock(appl).unit.name, 'Диск тормозного механизма перед.колеса', 'own ETK unit, not the 02xx service section');

const cats = A.parseCategories(fx('ListCategories'));
a.deepStrictEqual(cats[1], { cid: '340071', name: 'ТО по регл.Oelservice / Inspektion', code: '0205', parent: '340070', leaf: true, ssd: '$*KwFCdmdcFB$' });
a.strictEqual(cats[0].leaf, false);

const units = A.parseUnits(fx('ListUnits'));
a.strictEqual(units[0].uid, '1171722170');
a.strictEqual(units[0].name, 'Сервисное обслуживание тормозов');

const parts = A.parseUnitParts(fx('ListDetailByUnit'), noteLabel, { name: 'X' });
a.strictEqual(parts.length, 4);
a.strictEqual(parts[2].oem, '34116852253');
a.strictEqual(parts[2].code, '03');
a.strictEqual(parts[2].unit, 'X');

const boxes = A.parseImageMap(fx('ListImageMapByUnit'));
a.deepStrictEqual(boxes['01'], { x: 42, y: 238, w: 12, h: 20 });
a.deepStrictEqual(boxes['02'], { x: 143, y: 58, w: 14, h: 20 }, 'first box per code');
a.strictEqual(Object.keys(boxes).length, 21);

const search = A.parseNameSearch(fx('SearchVehicleDetails'));
a.strictEqual(search.length, 9);
a.deepStrictEqual(search[4], { oem: '34216776937', name: 'Колодки тормозные' });

const wiz = A.parseWizard(fx('GetWizard2'));
a.strictEqual(wiz.wizardSteps[0].name, 'Серия');
a.strictEqual(wiz.wizardSteps[0].determined, false);
a.deepStrictEqual(wiz.wizardSteps[0].options[0], { key: '$*KwGTyrbclQAAAABUj74E$', value: "1' E81" });
a.deepStrictEqual(L.pickWizardOption(wiz.wizardSteps[0], L.norm('BMW X5 E70 колодки')), { ask: ['X5 E70', 'X5 E70 LCI'] });

// command line: like the PHP SDK, no separators leak from values
a.strictEqual(A.command('FindVehicleByVIN', { Locale: 'ru_RU', VIN: 'X4X|Z\nW' }), 'FindVehicleByVIN:Locale=ru_RU|VIN=X4X Z W');

// billing period (Moscow date, billing day 9)
a.strictEqual(A.billingPeriod(new Date('2026-11-04T10:00:00Z'), 9), '2026-10-09');
a.strictEqual(A.billingPeriod(new Date('2026-11-08T20:59:00Z'), 9), '2026-10-09');
a.strictEqual(A.billingPeriod(new Date('2026-11-08T21:00:00Z'), 9), '2026-11-09'); // 00:00 MSK on the 9th
a.strictEqual(A.billingPeriod(new Date('2026-01-03T10:00:00Z'), 9), '2025-12-09');

// ─── whole chain against a fake Laximo ─────────────────────────────────────
const calls = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    const request = ((body.match(/<ns:request>([\s\S]*?)<\/ns:request>/) || [])[1] || '').replace(/&amp;/g, '&');
    const name = request.split(':')[0];
    const params = Object.fromEntries(request.slice(name.length + 1).split('|').map(kv => [kv.split('=')[0], kv.slice(kv.indexOf('=') + 1)]));
    calls.push({ name, params });
    // The ssd rule: unit calls need the UNIT ssd, ListUnits the category ssd.
    const unitCall = ['GetUnitInfo', 'ListDetailByUnit', 'ListImageMapByUnit'].includes(name);
    const bad = (unitCall && !/UNIT|KwH6zt|KwEXIzIjd2|KwGVobCLw8/.test(params.ssd)) || (name === 'ListUnits' && params.ssd !== '$*KwFCdmdcFB$');
    const map = { ListUnits: 'ListUnits' };
    let xml;
    if (bad) xml = null;
    else if (name === 'ListCatalogs') xml = '<response><ListCatalogs><row brand="BMW" code="BMW202601" name="BMW"/><row brand="MINI" code="MINI202601" name="MINI"/></ListCatalogs></response>'; // shape assumed (REST listCatalogs has brand + code)
    else if (name === 'GetWizard2' && params.ssd) xml = '<response><GetWizard2><row automatic="false" conditionid="2" determined="true" name="Серия" value="X5 E70 LCI" ssd="' + params.ssd + '"/></GetWizard2></response>';
    else if (name === 'ListQuickDetail' && params.QuickGroupId === '544') xml = params.ssd === car.ssd + '$*MOD_YES$'
      ? '<response><ListQuickDetail><Category categoryid="1" code="3410" name="Диск" ssd="c"><Unit code="34_1" name="Тормоз M" ssd="$*UNITM$" unitid="9"><Detail codeonimage="01" match="t" name="Тормозной диск" oem="34116875283"/></Unit></Category></ListQuickDetail></response>'
      : '<response><ListQuickDetail><Category categoryid="1" code="3410" name="Диск" ssd="c"><Unit code="34_1" filter="S2NHA" name="Тормоз" ssd="$*UNITF$" unitid="8"><Detail codeonimage="01" match="t" name="Тормозной диск" oem="34116875283"/><Detail codeonimage="01" match="t" name="Тормозной диск" oem="34108858705"/></Unit></Category></ListQuickDetail></response>';
    else if (name === 'GetFilterByUnit') xml = '<response><GetFilterByUnit><row name="Спортивные тормоза M (S2NHA)" type="list"><values><row name="да" note="" ssdmodification="$*MOD_YES$"/><row name="нет" note="" ssdmodification="$*MOD_NO$"/></values></row></GetFilterByUnit></response>';
    else if (name === 'FindVehicleByWizard2') xml = fx('FindVehicleByVIN').replace(/FindVehicleByVIN/g, 'FindVehicleByWizard2');
    else if (name === 'ListUnits') xml = fx('ListUnits').replace('Сервисное обслуживание тормозов', 'ТО по регл.Oelservice / Inspektion');
    else if (fs.existsSync(path.join(FIX, `${map[name] || name}.xml`))) xml = fx(map[name] || name);
    if (!xml) {
      res.writeHead(500, { 'Content-Type': 'text/xml' });
      return res.end(`<e><faultstring>${bad ? 'E_INVALIDPARAMETER:SSD' : 'E_UNKNOWN_COMMAND:' + name}</faultstring></e>`);
    }
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(`<soap><ns:return>${esc(xml)}</ns:return></soap>`);
  });
});

(async () => {
  await new Promise(r => server.listen(0, r));
  Object.assign(process.env, {
    LAXIMO_SOURCE: 'api', LAXIMO_LOGIN: 'test', LAXIMO_KEY: 'test', LAXIMO_API_MIN_INTERVAL_MS: '0',
    LAXIMO_API_HOST: `http://127.0.0.1:${server.address().port}`, LAXIMO_MONTHLY_CAR_CAP: '1',
  });
  delete process.env.SUPABASE_DB_URL;
  try {
    a.strictEqual(L.source(), 'api');
    a.strictEqual(await L.unavailableReason(), null);

    // VIN + pads: group 545 -> the parts marked match="t"; 02xx service unit last
    const r = await L.findPartsByVin('X4XZW61140L560928', ['тормозные колодки'], ['колодки'], ['34']);
    a.ok(r && r.vehicle, 'car found');
    a.strictEqual(r.vehicle.name, 'X5 40dX');
    a.strictEqual(r.vehicle.options['Дата выпуска'], '29.09.2010');
    a.deepStrictEqual(r.vehicleQuery, { c: 'BMW202601', vid: '2050271679', ssd: car.ssd, vin: 'X4XZW61140L560928' });
    const oems = r.parts.map(p => p.oem);
    a.ok(oems.includes('34116852253') && oems.includes('34216776937'), `pads found: ${oems.join(', ')}`);
    a.ok(!oems.includes('34116868938'), 'the disc (not marked for this group) is not offered for pads');
    a.ok(calls.some(c => c.name === 'ListQuickDetail' && c.params.QuickGroupId === '545'), 'opened group 545');
    a.ok(!calls.some(c => c.name === 'SearchVehicleDetails'), 'group found -> no word search');
    const pad = r.parts.find(p => p.oem === '34116852253');
    a.deepStrictEqual(pad.schema, { number: '34116852253', catalog: 'BMW202601', vid: '2050271679', ssd: car.ssd });
    a.ok(/^https:\/\/img\.laximo\.ru\//.test(pad.unitImage), 'diagram picture without an extra request');
    a.deepStrictEqual(await L.apiCarsThisMonth(), ['BMW202601:2050271679']);

    // Same VIN again: from the cache, no new Laximo call, no new car
    const before = calls.length;
    const r2 = await L.findPartsByVin('X4XZW61140L560928', ['тормозные колодки'], ['колодки'], ['34']);
    a.strictEqual(r2.vehicle.name, 'X5 40dX');
    a.strictEqual(calls.filter(c => c.name === 'FindVehicleByVIN').length, 1);
    a.ok(calls.length === before, 'everything cached');

    // Cap = 1 car: a NEW VIN is refused, as "unavailable" (not "VIN not found")
    const r3 = await L.findPartsByVin('WBA11111111111111', ['колодки'], [], ['34']);
    a.ok(r3 && r3.unavailable && /monthly bot cap of 1/.test(r3.unavailable), JSON.stringify(r3));

    // Diagram for a part: GetOEMPartApplicability -> own unit -> unit calls with the UNIT ssd
    const dgm = await L.getPartDiagram({ oem: '34116868938', schema: { number: '34116868938', catalog: 'BMW202601', vid: '2050271679', ssd: car.ssd } });
    a.ok(dgm, 'diagram');
    a.strictEqual(dgm.unitName, 'Диск тормозного механизма перед.колеса'); // the part's own ETK unit
    a.strictEqual(dgm.position, '01');
    a.deepStrictEqual(dgm.box, { x: 42, y: 238, w: 12, h: 20 });
    a.ok(dgm.unitParts.length >= 4 && dgm.unitParts.some(p => p.box), 'every position with its box');
    const unitCall = calls.find(c => c.name === 'ListDetailByUnit');
    a.strictEqual(unitCall.params.ssd, '$*KwEXIzIjd2…', 'unit ssd from the applicability answer');

    // ТО: service category -> ListUnits with the CATEGORY ssd -> the unit
    const svc = await L.getServiceUnit(r.vehicleQuery);
    a.ok(svc, 'service unit');
    a.strictEqual(svc.unitName, 'ТО по регл.Oelservice / Inspektion');
    a.ok(svc.unitParts.length >= 4);
    a.strictEqual(calls.find(c => c.name === 'ListUnits').params.CategoryId, '340071');

    // Word search: name search rows carry the schema
    const ws = await L.searchPartsForVehicle({ query: r.vehicleQuery, vin: 'X4XZW61140L560928' }, ['кожух рулевой колонки'], ['кожух'], null);
    a.ok(Array.isArray(ws));
    // Model path (no VIN): ListCatalogs -> GetWizard2 -> FindVehicleByWizard2; the car is already counted (same vehicleid), so the cap lets it through
    const m = await L.findPartsByModel('BMW X5 E70 LCI 40dX тормозные колодки', ['тормозные колодки'], 'BMW', ['колодки'], ['34']);
    a.ok(m && m.vehicle, `model path: ${JSON.stringify(m && m.needsChoice)}`);
    a.strictEqual(m.vehicle.name, 'X5 40dX');
    a.deepStrictEqual(m.vehicle.path, ['X5 E70 LCI']);
    a.strictEqual(m.vehicleQuery.vid, '2050271679');
    a.ok(calls.some(c => c.name === 'GetWizard2' && c.params.ssd === '$*KwX5E70LCI$'), 'wizard step with the option key as ssd');
    a.deepStrictEqual(await L.apiCarsThisMonth(), ['BMW202601:2050271679']);
    const m2 = await L.findPartsByModel('BMW X5 E70 колодки', ['колодки'], 'BMW', [], ['34']);
    a.deepStrictEqual(m2.needsChoice, { step: 'Серия', options: ['X5 E70', 'X5 E70 LCI'] });

    // Equipment selector on the model path: unit with filter -> GetFilterByUnit -> the site's question; the answer opens the group with ssdmodification
    a.deepStrictEqual(A.parseFilter('<response><GetFilterByUnit><row name="X (S1)"><values><row name="да" ssdmodification="$a$"/><row name="нет" ssdmodification="$b$"/></values></row></GetFilterByUnit></response>'),
      [{ label: 'X (S1)', options: [{ text: 'да', value: '$a$' }, { text: 'нет', value: '$b$' }] }]);
    // Auto answers (live 04.11): China / CKD Thailand never asked, their «нет» appended; S2NHA «нет» also carries red-M «нет»
    const auto = L.withAutoAnswers([
      { label: 'Спортивные тормоза M (S2NHA)', options: [{ text: 'да', value: '~A1' }, { text: 'нет', value: '~A0' }] },
      { label: 'Спортивный тормоз M, красный глянцевый (S3M2A)', options: [{ text: 'да', value: '~R1' }, { text: 'нет', value: '~R0' }] },
      { label: 'Монтаж CKD Таиланд (S9C6A)', options: [{ text: 'да', value: '~T1' }, { text: 'нет', value: '~T0' }] },
      { label: 'Исполнение для Китая (L8AAA)', options: [{ text: 'да', value: '~C1' }, { text: 'нет', value: '~C0' }] },
    ]);
    a.deepStrictEqual(auto.map(f => f.label), ['Спортивные тормоза M (S2NHA)', 'Спортивный тормоз M, красный глянцевый (S3M2A)']);
    a.deepStrictEqual(auto[0].options.map(o => o.value), ['~A1~T0~C0', '~A0~T0~C0~R0']);
    a.deepStrictEqual(auto[1].options.map(o => o.value), ['~R1~T0~C0', '~R0~T0~C0']);
    // group-wide: a unit WITHOUT the CKD filter still carries the CKD «нет» found in another unit
    const g = L.withAutoAnswers([{ label: 'Спортивные тормоза M (S2NHA)', options: [{ text: 'да', value: '~A1' }, { text: 'нет', value: '~A0' }] }],
      [{ label: 'Монтаж CKD Таиланд (S9C6A)', options: [{ text: 'да', value: '~T1' }, { text: 'нет', value: '~T0' }] }, { label: 'Монтаж CKD Таиланд (S9C6A)', options: [{ text: 'нет', value: '~T9' }] }]);
    a.deepStrictEqual(g[0].options.map(o => o.value), ['~A1~T0', '~A0~T0']);
    const mq = { query: m.vehicleQuery, cacheId: 'model:test' };
    const d1 = await L.searchPartsForVehicle(mq, ['тормозные диски'], ['диск'], ['34']);
    a.deepStrictEqual(d1.equipmentQuestion && d1.equipmentQuestion.label, 'Спортивные тормоза M (S2NHA)', JSON.stringify(d1.equipmentQuestion));
    const d2 = await L.searchPartsForVehicle(mq, ['тормозные диски'], ['диск'], ['34'], { equipment: { label: 'Спортивные тормоза M (S2NHA)', answer: 'да' } });
    a.deepStrictEqual(d2.map(p => p.oem), ['34116875283'], 'answer "да" -> only the M brake disc');
    a.ok(calls.some(c => c.name === 'ListQuickDetail' && c.params.ssd === car.ssd + '$*MOD_YES$'), 'group reopened with car ssd + ssdmodification');

    // Battery (live 04.11): a plain «АКБ» keeps the main 12 V units, drops the 48 V / auxiliary lithium ones (and their S2VWA selector)
    const bp = { units: [
      { name: 'Оригинальная АКБ BMW', filters: [], rows: [{ oem: '61216806755', name: 'Оригинальная акк.батарея BMW AGM' }] },
      { name: 'Дополнительная литий-ионная АКБ 12 В', filters: [], rows: [{ oem: '61215B3F328', name: 'Дополнительная литий-ионная АКБ 12 В' }] },
      { name: 'Сдвоенная литиевая АКБ 12 В', filters: [], rows: [{ oem: '61215A4AF23', name: 'Сдвоенная литиевая АКБ 12 В' }] },
      { name: 'Аккумуляторная батарея 48 В', filters: [{ label: 'Спортивная ходовая часть M Professional (S2VWA)', options: [] }], rows: [{ oem: '61215A6EC78', name: 'Аккумуляторная батарея 48 В' }] },
    ] };
    a.deepStrictEqual(L.narrowUnits(bp, ['АКБ'], 'АКБ BMW X5 G05').units.map(u => u.name), ['Оригинальная АКБ BMW']);
    a.strictEqual(L.narrowUnits(bp, ['АКБ'], 'АКБ 48 В на X5').units.length, 4, 'asked for 48 V -> all kept');
    a.strictEqual(L.narrowUnits(bp, ['тормозные колодки'], '').units.length, 4, 'other parts untouched');
    // Generic group match on the real X5 E70 group tree (coverage run 04.11)
    const gt = require('./fixtures/laximo-api/group-tree-bmw-x5-e70.json');
    const gm = kw => { const n = L.findGroupFor(kw, gt); return n ? n.gid : null; };
    for (const [kw, gid] of [['рулевой наконечник', '522'], ['рулевая тяга', '520'], ['прокладка поддона', '27'], ['цепь ГРМ', '79'], ['пыльник ШРУСа', '447'],
      ['маслоохладитель', '128'], ['задний редуктор', '456'], ['подкрылок', '820'], ['лампа фары', '626'], ['фара', '623'], ['крыло', '935'], ['колёсный болт', '515'],
      ['натяжной ролик', '195'], ['тормозной шланг', '564'], ['масло АКПП', '437'], ['стекло зеркала', '13485'], ['свечи зажигания', null], ['тормозные колодки', '545'], ['клапан вентиляции картера', '99'], ['опора КПП', '152'], ['зеркало', '869'], ['генератор', '617']]) {
      a.strictEqual(gm(kw), gid, `group for «${kw}»`);
    }
    // XM G09 tree has no «Колодки стояночного тормоза» / «Генератор» / body «Зеркала» under these names
    const xm = gt.filter(n => !['13390', '617', '869', '968', '13484'].includes(n.gid)).concat([{ gid: '751', name: 'Зеркало', path: 'Электрооборудование › Дополнительные удобства', aliases: [] }]);
    const gx = kw => { const n = L.findGroupFor(kw, xm); return n ? n.gid : null; };
    a.notStrictEqual(gx('колодки стояночного тормоза'), '545', 'handbrake shoes must not open the disc pads');
    a.notStrictEqual(gx('генератор'), '251', 'alternator must not open the pulse generator (sensors)');
    // «530xi» = 530iX (live 04.11: ALPINA buttons were offered)
    a.strictEqual(L.norm('BMW 530xi').trim(), 'bmw 530ix');
    a.strictEqual(L.norm('530i xDrive').trim(), '530ix');
    const w = L.pickWizardOption({ options: [{ key: '1', value: 'BMW ALPINA B5' }, { key: '2', value: 'BMW ALPINA D5s B57R' }, { key: '3', value: '530iX' }, { key: '4', value: '530iX B46D' }, { key: '5', value: '530i' }] }, L.norm('свеча BMW 530xi'));
    a.ok(!JSON.stringify(w).includes('ALPINA'), JSON.stringify(w));
    // «BMW 530» on the G30 LCI «Модель» step: the word «BMW» must not pick the ALPINA options (Диалоги ✗ 04.11)
    const g30 = { name: 'Модель', options: ['BMW ALPINA B5', 'BMW ALPINA D5s B57R', 'BMW ALPINA D5s B57S', '520d', '520dX', '520i', '530d', '530dX', '530e', '530eX', '530i', '530iX', '530iX B46D', '540i', '540iX', 'M550i'].map((v, i) => ({ key: String(i), value: v })) };
    for (const txt of ['модель: 5 G30 \n Свеча зажигания BMW 530 \n 5\' G30 LCI', 'Свеча зажигания BMW 530xi \n 5\' G30 LCI']) {
      const r = L.pickWizardOption(g30, L.norm(txt)) || L.partialWizardPick(g30, L.norm(txt));
      a.ok(r && !JSON.stringify(r).includes('ALPINA'), `${txt}: ${JSON.stringify(r)}`);
    }
    console.log('test-laximo-api: all ok');
  } finally {
    server.close();
  }
  process.exit(0);
})().catch(err => { console.error(err); server.close(); process.exit(1); });
