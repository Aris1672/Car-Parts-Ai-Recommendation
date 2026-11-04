/**
 * Can the bot read ABCP's goods catalog «Шины» (the site's /tires_catalog)
 * through the admin API instead of the site page? READ-ONLY. Run once in the
 * app's Terminal in Coolify:
 *
 *   node scripts/check-abcp-catalog.js            # 195/60 R15 winter (as on the site 04.11)
 *   node scripts/check-abcp-catalog.js 225/45R18 summer
 *   node scripts/check-abcp-catalog.js --probe    # which operation names exist at all (cp/catalog/* gave «Unknown operation» 04.11)
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
const PROBE = process.argv.includes('--probe');
const args = process.argv.slice(2).filter(a => a !== '--probe');
const sizeArg = args[0] || '195/60R15';
const seasonArg = (args[1] || 'winter').toLowerCase();
const m = sizeArg.match(/(\d{3})\D+(\d{2})\D*R?\s*(\d{2})/i);
if (!m) { console.error('size like 195/60R15'); process.exit(1); }
const [, width, height, diameter] = m;
const seasons = seasonArg === 'winter' ? ['winter', 'winter_studded'] : [seasonArg];

const short = (s, n = 700) => String(s).replace(/\s+/g, ' ').slice(0, n);
let n = 0;

async function tryCall(label, op, params, post = false) {
  n++;
  try {
    const data = post ? await abcp.apiPost(op, params) : await abcp.apiGet(op, params);
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

  if (PROBE) {
    // «Unknown operation» = no such name; any other error (missing parameter…) = the name exists.
    const names = ['catalog/info', 'catalog/search', 'cp/catalogs', 'catalogs', 'cp/goodsCatalog', 'goodsCatalog/search',
      'cp/goods_catalog', 'goods_catalog/search', 'catalog/tires', 'cp/catalog/tires', 'tires/search', 'cp/tires'];
    for (const op of names) await tryCall('probe-' + op.replace(/\//g, '_'), op, { goodsGroup: 'tires' });
    console.log(`\nDone. Lines without «unknown operation» are the interesting ones.`);
    return;
  }
  // ABCP docs (admin API, «Каталоги в товарных группах», read 04.11): a SEPARATE PAID SERVICE.
  // GET /cp/catalog/info?goods_group=tires -> filters; POST /cp/catalog/search
  // goods_group=tires&properties[width][0]=195... -> { articles:[{brand,number,…}], count }.
  // «Unknown operation» here = the service is not connected for the shop.
  await tryCall('info', 'cp/catalog/info', { goods_group: 'tires' });
  await tryCall('search', 'cp/catalog/search', { goods_group: 'tires', properties: { season: seasons, width: [width], height: [height], diameter: [diameter] }, limit: 20 }, true);
  console.log(`\nDone. Full answers in ${OUT}/ — paste the screen output (or the files) into the chat.`);
})();
