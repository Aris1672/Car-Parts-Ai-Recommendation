/** Tyre route helpers (lib/laximo.js). Unit names from the X5 G05 «36. Колеса с шинами» page (03.11). Run: node scripts/test-tires.js */
const L = require('../lib/laximo');
const a = require('assert');
a.deepStrictEqual(L.tireRequest('шина'), { kind: 'tire', season: null });
a.deepStrictEqual(L.tireRequest('зимние шины'), { kind: 'tire', season: 'winter' });
a.deepStrictEqual(L.tireRequest('летняя резина'), { kind: 'tire', season: 'summer' });
a.deepStrictEqual(L.tireRequest('колесные диски'), { kind: 'rim', season: null });
a.deepStrictEqual(L.tireRequest('колеса в сборе'), { kind: 'wheel', season: null });
for (const k of ['тормозные диски', 'диски', 'подшипник колеса', 'колесный болт', 'датчик давления в шинах', 'ступица колеса', 'колпачки', 'аварийное колесо'])
  a.strictEqual(L.tireRequest(k), null, k);
a.deepStrictEqual(L.tireSizes('Шина 235/55 R18'), ['235/55 R18']);
a.deepStrictEqual(L.tireSizes('235/55R18 и 275/40 ZR21, 255 50 19'), ['235/55 R18', '275/40 R21', '255/50 R19']);
a.deepStrictEqual(L.tireSizes('11 42 8 507 683 и 34116864906 VIN WBA12345678901234'), []);
a.deepStrictEqual(L.rimDiameters('BMW л/с диск звездообр.спицы 740M - 20"'), [20]);
a.deepStrictEqual(L.rimDiameters('диски R19'), [19]);
a.deepStrictEqual(L.rimDiameters('Шина 235/55 R18'), [18]);
a.deepStrictEqual(L.rimDiameters('Диск литой 9Jx21 ET:35'), [21]);
a.deepStrictEqual(L.rimDiameters('11 42 8 507 683'), []);

const names = ['Аварийное колесо легкосплавное', 'BMW л/с диск с V-образн.сп.746I - 22"', 'BMW л/с диск звездообр.спицы 740M - 20"',
  'BMW кол.с л/с диск.V-обр.спицы 738 - 20"', 'BMW кол.с л/с диск.V-обр.спицы 735 - 19"', 'BMW кол.с л/с д.турбин.стиль 689 - 18"',
  'BMW LM Rad V-Speiche 618 - 18"', 'Балансировочный грузик', 'Комплект фиксаторов колесного болта', 'Зимние шины', 'Летние шины',
  'Комплект Аварийное колесо с шиной', 'Колпачки клапанов'];
const units = names.map((name, i) => ({ name, href: `u${i}` }));
const pick = (req, d) => L.pickTireUnits(units, req, d).map(u => u.name);
a.deepStrictEqual(pick({ kind: 'tire', season: null }), ['Зимние шины', 'Летние шины']);
a.deepStrictEqual(pick({ kind: 'tire', season: 'summer' }), ['Летние шины']);
a.deepStrictEqual(pick({ kind: 'rim', season: null }, [20]), ['BMW л/с диск звездообр.спицы 740M - 20"']);
a.deepStrictEqual(pick({ kind: 'wheel', season: null }, [18]), ['BMW кол.с л/с д.турбин.стиль 689 - 18"', 'BMW LM Rad V-Speiche 618 - 18"']);
a.ok(pick({ kind: 'rim', season: null }).length <= 4);

const rows = [{ oem: '1', name: 'Шина летняя 275/40 R21' }, { oem: '2', name: 'Шина 235/55R18 100V' }];
a.deepStrictEqual(L.filterTireRows(rows, ['235/55 R18']).rows.map(r => r.oem), ['2']);
a.strictEqual(L.filterTireRows(rows, ['245/45 R19']).sizeMissing, '245/45 R19');
const rims = [{ oem: '3', name: 'Диск литой 9Jx20 ET:35', unit: 'x' }, { oem: '4', name: 'Диск литой', unit: 'BMW л/с диск 746I - 22"' }];
a.deepStrictEqual(L.filterTireRows(rims, [], { kind: 'rim' }, [22]).rows.map(r => r.oem), ['4']);
console.log('all ok');
