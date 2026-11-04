/**
 * Catalog coverage check (04.11): which typical customer requests find the
 * right parts in the original catalog, and which don't. Run in the app's
 * Terminal in Coolify (LAXIMO_SOURCE=api, Laximo env as for the bot):
 *
 *   node scripts/check-catalog-coverage.js --tree              # step 1: the whole «Поиск по группам» tree
 *   node scripts/check-catalog-coverage.js                     # step 2: ~80 requests -> table
 *   node scripts/check-catalog-coverage.js --only "рычаг,помпа"   # just these requests
 *   add --vin <VIN> for another car (a NEW VIN counts one car in the monthly
 *   Laximo quota; the default X5 E70 40dX X4XZW61140L560928 is already counted).
 *
 * Laximo bills per new car, not per call: all requests on one car cost one car.
 * Answers are cached in Postgres like the bot's, so a second run is fast.
 * Output on screen; full results also in /tmp/catalog-coverage/*.json|tsv.
 * Simplification: the AI steps (request reading, AI filter) are NOT run --
 * each request goes in as its own keyword, like a customer who typed only it.
 */
const fs = require('fs');
const path = require('path');
const laximo = require('../lib/laximo');

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const VIN = String(arg('--vin') || 'X4XZW61140L560928').toUpperCase();
const OUT = '/tmp/catalog-coverage';

const REQUESTS = [
  // brakes
  'тормозные колодки', 'тормозные диски', 'тормозной суппорт', 'датчик износа колодок', 'тормозной шланг', 'колодки стояночного тормоза', 'датчик ABS',
  // suspension / steering
  'амортизатор', 'опора амортизатора', 'пружина подвески', 'поперечный рычаг', 'продольный рычаг', 'сайлентблок', 'шаровая опора',
  'стойка стабилизатора', 'втулка стабилизатора', 'ступица', 'подшипник ступицы', 'рулевая тяга', 'рулевой наконечник', 'рулевая рейка', 'пыльник ШРУСа', 'приводной вал',
  // engine
  'масляный фильтр', 'воздушный фильтр', 'топливный фильтр', 'свечи зажигания', 'катушка зажигания', 'приводной ремень', 'натяжной ролик', 'помпа', 'термостат',
  'прокладка клапанной крышки', 'прокладка поддона', 'сальник коленвала', 'опора двигателя', 'цепь ГРМ', 'турбина', 'форсунка', 'датчик кислорода', 'клапан ВАНОС',
  'маслоохладитель', 'клапан вентиляции картера', 'дроссельная заслонка',
  // cooling / climate
  'радиатор охлаждения', 'расширительный бачок', 'патрубок радиатора', 'вентилятор радиатора', 'радиатор кондиционера', 'компрессор кондиционера', 'салонный фильтр', 'моторчик печки',
  // exhaust / transmission
  'глушитель', 'сажевый фильтр', 'катализатор', 'масло АКПП', 'фильтр АКПП', 'опора КПП', 'сцепление', 'кардан', 'раздаточная коробка', 'задний редуктор',
  // electrics / lights
  'аккумулятор', 'генератор', 'стартер', 'фара', 'задний фонарь', 'лампа фары', 'противотуманная фара', 'датчик парктроника', 'щётки стеклоочистителя', 'моторчик стеклоочистителя', 'стеклоподъёмник', 'замок двери', 'ключ',
  // body
  'передний бампер', 'решётка радиатора', 'зеркало', 'стекло зеркала', 'крыло', 'капот', 'молдинг', 'подкрылок', 'уплотнитель двери', 'лобовое стекло',
  // fluids
  'моторное масло', 'антифриз', 'тормозная жидкость', 'жидкость омывателя',
  // wheels
  'шины', 'колёсные диски', 'датчик давления в шинах', 'колёсный болт',
];

const side = name => { const n = ` ${String(name || '').toLowerCase()} `; return /[^а-я]лев[а-я]*[^а-я]|[\s.]л\s*$/.test(n) ? 'L' : /[^а-я]прав[а-я]*[^а-я]|[\s.]п\s*$/.test(n) ? 'R' : ''; };
const short = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

async function tree(vehicle) {
  const t = await laximo.getGroupTree(vehicle.query);
  fs.writeFileSync(path.join(OUT, 'group-tree.json'), JSON.stringify(t, null, 1));
  const lines = t.map(n => `${n.gid}\t${n.path ? n.path + ' › ' : ''}${n.name}${n.aliases && n.aliases.length ? '\t[' + n.aliases.join(', ') + ']' : ''}`);
  fs.writeFileSync(path.join(OUT, 'group-tree.tsv'), lines.join('\n'));
  console.log(`\n${t.length} catalog groups (gid, path › name, [synonyms]):\n`);
  console.log(lines.join('\n'));
  console.log(`\nSaved: ${OUT}/group-tree.tsv -- copy everything above into the chat (or: cat ${OUT}/group-tree.tsv)`);
}

async function coverage(vehicle, list) {
  const rows = [];
  for (const req of list) {
    const t0 = Date.now();
    let r = { req };
    try {
      const parts = await laximo.searchPartsForVehicle(vehicle, [req], null, {}, { customerText: req });
      const ps = Array.isArray(parts) ? parts : [];
      const group = (parts.groupSearched || []).join(' + ');
      const front = ps.filter(p => p.axle === 'передняя ось').length, rear = ps.filter(p => p.axle === 'задняя ось').length;
      const L = ps.filter(p => side(p.name) === 'L').length, R = ps.filter(p => side(p.name) === 'R').length;
      r = {
        req,
        route: parts.searchFailed ? 'FAILED' : group ? `group: ${group}` : `words: ${(parts.searched || []).join(', ')}`,
        rows: ps.length,
        axle: front || rear ? `F${front}/R${rear}` : '',
        side: L || R ? `L${L}/R${R}` : '',
        equip: parts.equipmentQuestion ? parts.equipmentQuestion.label : '',
        dropped: parts.droppedByGroup ? Object.entries(parts.droppedByGroup).map(([g, n]) => `${g}×${n}`).join(' ') : '',
        names: [...new Set(ps.map(p => short(p.name, 40)))].slice(0, 4).join(' | '),
        ms: Date.now() - t0,
      };
    } catch (err) {
      r = { req, route: 'ERROR ' + short(err.message, 80), rows: 0, ms: Date.now() - t0 };
    }
    const flag = !r.rows ? '❌' : /^words/.test(r.route || '') ? '⚠️' : '✅';
    console.log(`${flag} ${short(req, 28).padEnd(28)} ${String(r.rows).padStart(3)}  ${short(r.route, 60)}${r.axle ? '  ' + r.axle : ''}${r.side ? '  ' + r.side : ''}${r.equip ? '  ? ' + short(r.equip, 40) : ''}${r.dropped ? '  dropped ' + r.dropped : ''}\n      ${r.names || ''}`);
    rows.push({ flag, ...r });
  }
  fs.writeFileSync(path.join(OUT, 'coverage.json'), JSON.stringify(rows, null, 1));
  const head = 'flag\trequest\trows\troute\taxle\tside\tequipment\tdropped\tnames';
  fs.writeFileSync(path.join(OUT, 'coverage.tsv'), [head, ...rows.map(r => [r.flag, r.req, r.rows, r.route, r.axle, r.side, r.equip, r.dropped, r.names].join('\t'))].join('\n'));
  const n = f => rows.filter(r => r.flag === f).length;
  console.log(`\n✅ ${n('✅')} by catalog group · ⚠️ ${n('⚠️')} by word search only · ❌ ${n('❌')} nothing found (of ${rows.length})`);
  console.log(`Saved: ${OUT}/coverage.tsv -- copy the whole output into the chat (or: cat ${OUT}/coverage.tsv)`);
}

(async () => {
  if (laximo.source() !== 'api') console.warn('Note: LAXIMO_SOURCE is not "api" -- this check uses the site pages (browser-check risk).');
  fs.mkdirSync(OUT, { recursive: true });
  const vehicle = await laximo.findVehicleByVin(VIN);
  if (!vehicle) { console.error(`VIN ${VIN} not found`); process.exit(1); }
  console.log(`Car: ${[vehicle.brand, vehicle.name, vehicle.modelCode].filter(Boolean).join(' ')} (${VIN})`);
  if (process.argv.includes('--tree')) await tree(vehicle);
  else {
    const only = arg('--only');
    await coverage(vehicle, only ? only.split(',').map(s => s.trim()).filter(Boolean) : REQUESTS);
  }
  setTimeout(() => process.exit(0), 200); // the Postgres pool keeps the process alive
})().catch(err => { console.error(err); process.exit(1); });
