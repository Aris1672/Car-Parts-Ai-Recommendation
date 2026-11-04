/**
 * Can the bot read ABCP's goods catalog «Шины» (the site's /tires_catalog)
 * through the admin API instead of the site page? READ-ONLY. Run once in the
 * app's Terminal in Coolify:
 *
 *   node scripts/check-abcp-catalog.js            # 195/60 R15 winter (as on the site 04.11)
 *   node scripts/check-abcp-catalog.js 225/45R18 summer
 *
 * The exact parameter names of cp/catalog/info and cp/catalog/search are not
 * confirmed yet, so the script tries the likely spellings one by one and
 * prints each answer shortened (full answers: /tmp/abcp-catalog/*.json).
 * Site filter names (getFilters, 04.11): goods_group=tires; property[season][]
 * = summer | winter | winter_studded | allseason; property[width|height|diameter][].
 * Needs the usual env: ABCP_API_HOST, ABCP_API_LOGIN, ABCP_API_PASSWORD_MD5.
 * No secrets are printed.
 */
const fs = require('fs');
const path = require('path');
const abcp = require('../lib/abcpOrders');

const OUT = '/tmp/abcp-catalog';
const sizeArg = process.argv[2] || '195/60R15';
const seasonArg = (process.argv[3] || 'winter').toLowerCase();
const m = sizeArg.match(/(\d{3})\D+(\d{2})\D*R?\s*(\d{2})/i);
if (!m) { console.error('size like 195/60R15'); process.exit(1); }
const [, width, height, diameter] = m;
const seasons = seasonArg === 'winter' ? ['winter', 'winter_studded'] : [seasonArg];

const short = (s, n = 700) => String(s).replace(/\s+/g, ' ').slice(0, n);
let n = 0;

async function tryCall(label, op, params) {
  n++;
  try {
    const data = await abcp.apiGet(op, params);
    const text = JSON.stringify(data, null, 2);
    fs.writeFileSync(path.join(OUT, `${String(n).padStart(2, '0')}-${label}.json`), text);
    const count = Array.isArray(data) ? data.length : (data && typeof data === 'object' ? Object.keys(data).length : 0);
    console.log(`\n✅ ${n}. ${label}: ${Array.isArray(data) ? 'array' : typeof data}, ${count} item(s)/key(s)`);
    console.log('   ' + short(text));
    return data;
  } catch (err) {
    console.log(`\n❌ ${n}. ${label}: ${short(err.message, 300)}`);
    return null;
  }
}

(async () => {
  if (!abcp.enabled()) { console.error('ABCP API env not set (ABCP_API_HOST / ABCP_API_LOGIN / ABCP_API_PASSWORD_MD5)'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`Tyres ${width}/${height} R${diameter}, season ${seasons.join(' + ')}`);

  // 1. catalog description / list of catalogs
  await tryCall('info-plain', 'cp/catalog/info', {});
  await tryCall('info-goodsGroup', 'cp/catalog/info', { goodsGroup: 'tires' });
  await tryCall('info-goods_group', 'cp/catalog/info', { goods_group: 'tires' });
  await tryCall('info-catalog', 'cp/catalog/info', { catalog: 'tires' });

  // 2. search with filters, likely spellings
  const props = { season: seasons, width: [width], height: [height], diameter: [diameter] };
  const variants = [
    ['search-goodsGroup-properties', { goodsGroup: 'tires', properties: props }],
    ['search-goods_group-property', { goods_group: 'tires', property: props }],
    ['search-goodsGroup-filters', { goodsGroup: 'tires', filters: props }],
    ['search-catalog-properties', { catalog: 'tires', properties: props }],
  ];
  for (const [label, params] of variants) {
    const data = await tryCall(label, 'cp/catalog/search', params);
    if (data && (Array.isArray(data) ? data.length : Object.keys(data).length)) break; // first one that returns something is enough
  }
  console.log(`\nDone. Full answers in ${OUT}/ — paste the screen output (or the files) into the chat.`);
})();
