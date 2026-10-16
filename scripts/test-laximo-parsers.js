/**
 * Checks lib/laximo.js's parsers against saved /laximo page sources, so a
 * change in the site's markup can be caught without touching the live site.
 *
 * Save pages from Chrome via Ctrl+U (view source) -> Ctrl+S into one folder,
 * named: vin.html, vehicle.html, unit.html (optionally details.html).
 * Files saved from a view-source tab are unwrapped automatically.
 *
 *   node scripts/test-laximo-parsers.js path/to/folder
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const L = require('../lib/laximo');

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/test-laximo-parsers.js <folder with saved pages>');
  process.exit(1);
}

// Chrome's "save view-source tab" wraps each source line in <td class="line-content">.
function load(name) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.includes('class="line-content"')) return raw;
  const $ = cheerio.load(raw);
  return $('td.line-content').map((_, td) => $(td).text()).get().join('\n');
}

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failed++;
};

const vin = load('vin.html');
if (vin) {
  const v = L.parseVinResults(vin);
  check('VIN page: one vehicle with a vehicle link', v.length >= 1 && /lp=vehicle/.test(v[0].href), v[0] && `${v[0].name} / ${v[0].modelCode}`);
  check('VIN page: options parsed', v[0] && Object.keys(v[0].options).length > 3, v[0] && Object.keys(v[0].options).join(', '));
}

const vehicle = load('vehicle.html');
if (vehicle) {
  const p = L.parseVehiclePage(vehicle);
  check('vehicle page: search data object has vid + ssd', !!(p.query && p.query.vid && p.query.ssd));
  check('vehicle page: units found', p.units.length > 0, `${p.units.length} units`);
  check('vehicle page: categories found', p.categories.length > 0, `${p.categories.length} categories`);
}

for (const name of ['unit.html', 'details.html']) {
  const html = load(name);
  if (!html) continue;
  const parts = L.parsePartRows(html);
  check(`${name}: OEM rows found`, parts.length > 0, `${parts.length} rows`);
  check(`${name}: rows have OEM + name`, parts.every(r => r.oem && r.name));
  parts.slice(0, 3).forEach(r => console.log('      ', r.position, r.oem, r.name, r.qty, r.unit || ''));
}

process.exit(failed ? 1 : 0);
