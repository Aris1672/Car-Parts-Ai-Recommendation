/** lib/normalize.js -- the one normaliser contract. Run: npm test */
const a = require('assert');
const N = require('../lib/normalize');
const L = require('../lib/laximo');

// latinizeCodes: code tokens only
a.strictEqual(N.latinizeCodes('Х5 Е70'), 'X5 E70');
a.strictEqual(N.latinizeCodes('х5 е70 40д'), 'x5 e70 40д'); // «40д»: д is no look-alike -> token untouched
a.strictEqual(N.latinizeCodes('М3 Купе'), 'M3 Купе');
a.strictEqual(N.latinizeCodes('ТО для моей машины'), 'ТО для моей машины'); // plain Russian words stay
a.strictEqual(N.latinizeCodes('5-серия'), '5-серия');
a.strictEqual(N.latinizeCodes(null), '');

// part numbers / VIN
a.strictEqual(N.normalizeOem('11 42 8 507 683'), '11428507683');
a.strictEqual(N.normalizeOem('61615А3F9D8'), '61615A3F9D8'); // Cyrillic А
a.strictEqual(N.normalizeOem('34.11-6864906'), '34116864906');
a.strictEqual(N.normalizeVin('wbs11cs0609158489'), 'WBS11CS0609158489');
a.strictEqual(N.normalizeVin('WBА11CS06091584В9'), 'WBA11CS06091584B9'); // Cyrillic А, В
a.strictEqual(N.normalizeVin('WBS11CS060915848'), null); // 16 chars
a.strictEqual(N.normalizeVin('WBS11CS06O9158489'), null); // O is not allowed in a VIN
a.strictEqual(L.normalizeOem, N.normalizeOem); // laximo re-exports the same function
a.strictEqual(L.normalizeVin, N.normalizeVin);

// series (review R2: "x5" / "Х5" found nothing in the compatibility table)
for (const [m, s] of [['X5 E70', 'X5'], ['x5 e70', 'X5'], ['Х5 E70', 'X5'], ['х5', 'X5'], ['X5 Touring (E70)', 'X5'],
  ['3 (E46)', '3'], ['i3 I01', 'I3'], ['  X1  F48 xDrive20i', 'X1'], [null, 'unknown'], ['', 'unknown']]) {
  a.strictEqual(N.extractSeries(m), s, `extractSeries(${JSON.stringify(m)})`);
}
a.deepStrictEqual(N.seriesVariants('X5'), ['X5', 'x5']);
a.deepStrictEqual(N.seriesVariants('I3'), ['I3', 'i3']);
a.deepStrictEqual(N.seriesVariants('IX'), ['IX', 'iX', 'ix']);
a.deepStrictEqual(N.seriesVariants('3'), ['3']);
a.deepStrictEqual(N.seriesVariants('unknown'), []);

// normalizeModel: the same form for the customer's words and the table's records
const eq = (x, y) => a.strictEqual(N.normalizeModel(x), N.normalizeModel(y), `${x} ~ ${y}`);
eq('Х5 Е70', 'X5 E70');
eq('х5 е70', 'X5 (E70)');
eq('М5 F90', 'M5 F90');
a.strictEqual(N.normalizeModel('BMW 320 i (E46) Купе'), N.normalizeModel('BMW 320i E46'));
a.strictEqual(N.normalizeModel(''), '');

// wizard matching (lib/laximo.js norm): Cyrillic look-alikes match the Latin option
a.strictEqual(L.norm('Х5 40д'), L.norm('x5 40д'));
a.strictEqual(L.norm('Ёлка'), ' елка ');

console.log('test-normalize: all ok');
