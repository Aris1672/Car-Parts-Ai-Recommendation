/**
 * Can this server use the Laximo web service DIRECTLY (not the bmwclub77.ru
 * /laximo pages that ABCP's browser check keeps blocking)? Run once in the
 * app's Terminal in Coolify:
 *
 *   node scripts/check-laximo-api.js                 # catalog list only (no car lookups)
 *   node scripts/check-laximo-api.js --vin <VIN>     # + ONE VIN lookup (counts as one car in the quota)
 *   node scripts/check-laximo-api.js --dump <VIN>    # raw answers of every method the bot will use, for
 *                                                    # writing the parsers (one car; use an already counted VIN,
 *                                                    # e.g. X4XZW61140L560928). Short version on screen, full
 *                                                    # answers in /tmp/laximo-dump/*.xml. No secrets printed.
 *   node scripts/check-laximo-api.js --dump <VIN> --units   # only VIN + pads group + categories + unit calls
 *
 * Needs Coolify env vars (never in the repo or a chat):
 *   LAXIMO_LOGIN   the service login from the Laximo cabinet («Логин»)
 *   LAXIMO_KEY     the access code from the cabinet («Код доступа»)
 *
 * Protocols (doc.laximo.ru, read 03.11.2026):
 *  - REST: POST https://ws.laximo.ru/restApi/v1/<method>, HTTP Basic auth, JSON.
 *  - SOAP: QueryDataLogin(request, login, hmac) on
 *    https://ws.laximo.ru/ec.Kito.WebCatalog/services/Catalog.CatalogHttpSoap11Endpoint/
 *    request = "Command:Param=Value|Param=Value", hmac = MD5(request + key);
 *    the key itself is never sent. FindVehicleByVIN exists only in SOAP.
 * Laximo bills per NEW car looked up (error E_ACCESSLIMITREACHED), not per call;
 * the catalog list is not a car lookup.
 */
const crypto = require('crypto');

const LOGIN = process.env.LAXIMO_LOGIN || '';
const KEY = process.env.LAXIMO_KEY || '';
const HOST = (process.env.LAXIMO_API_HOST || 'https://ws.laximo.ru').replace(/\/+$/, '');
const SOAP_URL = `${HOST}/ec.Kito.WebCatalog/services/Catalog.CatalogHttpSoap11Endpoint/`;
const TIMEOUT = 20000;

const vinArg = (() => { const i = process.argv.indexOf('--vin'); return i > 0 ? String(process.argv[i + 1] || '').toUpperCase() : null; })();

const xmlEscape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xmlUnescape = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const short = (s, n = 300) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

async function outgoingIp() {
  try {
    const r = await fetch('https://ifconfig.me/ip', { signal: AbortSignal.timeout(8000) });
    return (await r.text()).trim();
  } catch (err) {
    return `unknown (${err.message})`;
  }
}

/** REST call -> { ok, status, data | error } */
async function rest(method, params = {}) {
  const url = `${HOST}/restApi/v1/${method}${Object.keys(params).length ? '?' + new URLSearchParams(params) : ''}`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${LOGIN}:${KEY}`).toString('base64'),
        'accept-language': 'ru_RU',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return r.ok ? { ok: true, status: r.status, data } : { ok: false, status: r.status, error: short(text) };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

/** SOAP QueryDataLogin -> { ok, status, xml | error } */
async function soap(request) {
  const hmac = crypto.createHash('md5').update(request + KEY, 'utf8').digest('hex');
  const envelope = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="http://WebCatalog.Kito.ec">' +
    '<soapenv:Body><ns:QueryDataLogin>' +
    `<ns:request>${xmlEscape(request)}</ns:request><ns:login>${xmlEscape(LOGIN)}</ns:login><ns:hmac>${hmac}</ns:hmac>` +
    '</ns:QueryDataLogin></soapenv:Body></soapenv:Envelope>';
  try {
    const r = await fetch(SOAP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'urn:QueryDataLogin' },
      body: envelope,
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const text = await r.text();
    const ret = text.match(/<(?:\w+:)?return[^>]*>([\s\S]*?)<\/(?:\w+:)?return>/);
    if (r.ok && ret) return { ok: true, status: r.status, xml: xmlUnescape(ret[1]) };
    const fault = text.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
    return { ok: false, status: r.status, error: short(fault ? xmlUnescape(fault[1]) : text) };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

/** What a Laximo error means, in plain words. */
function explain(error) {
  const e = String(error || '');
  if (/E_ACCESSDENIED/.test(e) && /MAC check failed/i.test(e)) return 'the access code (LAXIMO_KEY) is wrong';
  if (/E_ACCESSDENIED/.test(e) && /subscription/i.test(e)) return 'no active subscription for this login';
  if (/E_ACCESSDENIED/.test(e) && /Cannot find active/i.test(e)) return 'this login does not exist or is disabled (check LAXIMO_LOGIN)';
  if (/E_ACCESSDENIED/.test(e)) return 'access denied: wrong login/code, or this function / IP is not allowed for the licence -- ask Laximo';
  if (/E_ACCESSLIMITREACHED/.test(e)) return 'the monthly limit of cars is used up';
  if (/E_TOO_MANY_REQUESTS/.test(e)) return 'too many requests per minute';
  if (/^401$|Unauthorized/i.test(e)) return 'login/code not accepted (HTTP 401)';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|timeout|abort/i.test(e)) return 'the server cannot reach ws.laximo.ru (network / firewall)';
  return '';
}

/** Laximo SOAP command line: "Name:Key=Value|Key=Value" (same as Laximo's PHP SDK, no escaping). */
const cmd = (name, params) => `${name}:` + Object.entries(params).map(([k, v]) => `${k}=${v}`).join('|');
const attr = (tag, k) => (String(tag).match(new RegExp(`\\b${k}="([^"]*)"`, 'i')) || [])[1] || '';
const rowsOf = xml => [...String(xml).matchAll(/<row\b[^>]*>/g)].map(m => m[0]);

/** Screen version of an answer: ssd shortened, at most `max` characters. */
function compact(xml, max = 2500) {
  const s = String(xml).replace(/\s+/g, ' ').replace(/\bssd="([^"]{12})[^"]*"/g, 'ssd="$1…"');
  return s.length > max ? s.slice(0, max) + ` … [${s.length - max} more characters in the file]` : s;
}

async function dump(vin) {
  const fs = require('fs');
  const dir = '/tmp/laximo-dump';
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  const run = async (label, request, done) => {
    n++;
    const name = request.split(':')[0];
    const r = done || await soap(request);
    const file = `${dir}/${String(n).padStart(2, '0')}-${name}.xml`;
    fs.writeFileSync(file, r.ok ? r.xml : `ERROR ${r.status}: ${r.error}`);
    console.log(`\n===== [${n}] ${label} -- ${name} ${r.ok ? `OK, ${r.xml.length} chars, ${rowsOf(r.xml).length} rows` : 'FAILED'} (${file})`);
    console.log(r.ok ? compact(r.xml) : `${r.error}${explain(r.error) ? ' -> ' + explain(r.error) : ''}`);
    return r.ok ? r.xml : null;
  };
  const L = { Locale: 'ru_RU' };

  const vXml = await run('car by VIN', cmd('FindVehicleByVIN', { ...L, VIN: vin, Localized: 'true' }));
  const car = vXml && rowsOf(vXml).find(t => attr(t, 'vehicleid'));
  if (!car) { console.log('\nNo car for this VIN -- the dump stops here.'); return; }
  const C = attr(car, 'catalog'), V = attr(car, 'vehicleid'), ssd = attr(car, 'ssd');
  console.log(`\n-> car: ${attr(car, 'brand')} ${attr(car, 'name')}, catalog ${C}, vehicleid ${V}, ssd ${ssd.length} chars`);

  const vi = await run('car details', cmd('GetVehicleInfo', { ...L, Catalog: C, VehicleId: V, ssd, Localized: 'true' }));
  const viSsd = vi ? attr(rowsOf(vi)[0] || '', 'ssd') : '';
  const onlyUnits = process.argv.includes('--units');
  let unitSsd = '', catSsd = '', catId = '';
  /** Tries each candidate ssd until Laximo stops answering E_INVALIDPARAMETER:SSD; prints which one worked. */
  const tryRun = async (label, build, cands) => {
    for (const [name, value] of cands) {
      if (!value) continue;
      const r = await soap(build(value));
      if (!r.ok && /E_INVALIDPARAMETER:SSD/.test(r.error)) { console.log(`   (${label}: ssd of ${name} rejected)`); continue; }
      return run(`${label} [ssd of ${name}]`, build(value), r);
    }
    console.log(`\n===== ${label}: every ssd rejected`);
    return null;
  };

  // Quick groups ("Поиск по группам"): find the brake pads group.
  const qg = onlyUnits ? null : await run('group tree', cmd('ListQuickGroup', { ...L, Catalog: C, VehicleId: V, ssd }));
  const groups = qg ? rowsOf(qg) : [];
  let pads = groups.find(t => /колодки тормозные дисковые/i.test(attr(t, 'name')) && attr(t, 'link') === 'true')
    || groups.find(t => /колодк/i.test(attr(t, 'name')) && attr(t, 'link') === 'true');
  let unitId = '', oem = '';
  if (onlyUnits) pads = '<row quickgroupid="545" name="Колодки тормозные дисковые" link="true">';
  if (pads) {
    const gid = attr(pads, 'quickgroupid');
    console.log(`\n-> pads group: "${attr(pads, 'name')}" (quickgroupid ${gid})`);
    const qd = await run('parts of the pads group', cmd('ListQuickDetail', { ...L, Catalog: C, VehicleId: V, QuickGroupId: gid, ssd, Localized: 'true', All: '1' }));
    const unit = qd && (qd.match(/<Unit\b[^>]*>/i) || [])[0];
    if (unit) { unitId = attr(unit, 'unitid'); unitSsd = attr(unit, 'ssd'); }
    const cat = qd && (qd.match(/<Category\b[^>]*>/i) || [])[0];
    if (cat) { catSsd = attr(cat, 'ssd'); catId = attr(cat, 'categoryid'); }
    const det = qd && (qd.match(/<Detail\b[^>]*>/i) || [])[0];
    if (det) oem = attr(det, 'oem');
  } else {
    console.log('\n-> no brake pads group in the tree (names above)');
  }

  // Car page categories and units.
  const cats = await run('categories', cmd('ListCategories', { ...L, Catalog: C, VehicleId: V, CategoryId: '-1', ssd }));
  const catRow = cats && (rowsOf(cats).find(t => attr(t, 'categoryid') === catId) || rowsOf(cats).find(t => attr(t, 'childrens') === 'false'));
  const listCatSsd = catRow ? attr(catRow, 'ssd') : '';
  const useCat = catId || (catRow ? attr(catRow, 'categoryid') : '-1');
  const vehCands = [['FindVehicleByVIN', ssd], ['GetVehicleInfo', viSsd]];
  const units = await tryRun(`units of category ${useCat}`, v => cmd('ListUnits', { ...L, Catalog: C, VehicleId: V, CategoryId: useCat, ssd: v, Localized: 'true' }),
    [['the category (ListCategories)', listCatSsd], ['the category (ListQuickDetail)', catSsd], ...vehCands]);
  if (units) { const u = rowsOf(units).find(t => attr(t, 'unitid') === unitId) || rowsOf(units).find(t => attr(t, 'unitid')); if (u && !unitId) { unitId = attr(u, 'unitid'); } if (u && attr(u, 'unitid') === unitId) unitSsd = unitSsd || attr(u, 'ssd'); }

  // One unit: parts, diagram map, info.
  if (unitId) {
    console.log(`\n-> unit ${unitId}`);
    const uc = [['the unit (ListQuickDetail)', unitSsd], ['the category', listCatSsd || catSsd], ...vehCands];
    await tryRun('unit info', v => cmd('GetUnitInfo', { ...L, Catalog: C, UnitId: unitId, ssd: v, Localized: 'true' }), uc);
    const parts = await tryRun('unit parts', v => cmd('ListDetailByUnit', { ...L, Catalog: C, UnitId: unitId, ssd: v, Localized: 'true', WithLinks: 'true' }), uc);
    await tryRun('unit diagram map', v => cmd('ListImageMapByUnit', { Catalog: C, UnitId: unitId, ssd: v, WithLinks: 'true' }), uc);
    if (!oem && parts) { const d = rowsOf(parts).find(t => attr(t, 'oem')); if (d) oem = attr(d, 'oem'); }
  }
  if (onlyUnits) { console.log(`\nDump (units) finished: ${n} answers. Copy everything above and send it to the developer.`); return; }

  await run('search by name "колодки"', cmd('SearchVehicleDetails', { Catalog: C, VehicleId: V, ssd, Query: 'колодки', Locale: 'ru_RU' }));
  if (oem) await run(`part ${oem} in this car`, cmd('GetOEMPartApplicability', { Catalog: C, OEM: oem, ssd, Locale: 'ru_RU' }));

  // Model wizard: first two steps (no car is looked up, so no quota).
  const w1 = await run('wizard, first step', cmd('GetWizard2', { ...L, Catalog: C, ssd: '' }));
  const opt = w1 && (w1.match(/<row\b[^>]*\bkey="[^"]+"[^>]*>/) || [])[0];
  if (opt) await run(`wizard, after "${attr(opt, 'value')}"`, cmd('GetWizardNextStep2', { ...L, Catalog: C, ssd: attr(opt, 'key') }));

  console.log(`\nDump finished: ${n} answers. Copy everything above from "===== [1]" and send it to the developer.`);
  console.log(`If asked for a full answer: cat ${dir}/<file>.xml`);
}

(async () => {
  const dumpVin = (() => { const i = process.argv.indexOf('--dump'); return i > 0 ? String(process.argv[i + 1] || '').toUpperCase() : null; })();
  if (dumpVin) {
    if (!LOGIN || !KEY) { console.log('Set LAXIMO_LOGIN and LAXIMO_KEY first.'); process.exit(1); }
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(dumpVin)) { console.log(`--dump "${dumpVin}" is not a 17-character VIN`); process.exit(1); }
    await dump(dumpVin);
    process.exit(0);
  }
  console.log('Laximo direct API check');
  console.log(`  service:     ${HOST}`);
  console.log(`  login:       ${LOGIN || '(LAXIMO_LOGIN not set)'}`);
  console.log(`  access code: ${KEY ? `set (${KEY.length} characters)` : '(LAXIMO_KEY not set)'}`);
  console.log(`  this server's outgoing IP: ${await outgoingIp()}`);
  if (!LOGIN || !KEY) {
    console.log('\nSet LAXIMO_LOGIN and LAXIMO_KEY in Coolify (Environment Variables), redeploy, run again.');
    process.exit(1);
  }
  let failed = 0;

  // 1. REST catalog list (no car lookup).
  const r1 = await rest('listCatalogs');
  if (r1.ok && Array.isArray(r1.data)) {
    const bmw = r1.data.filter(c => /^(BMW|MINI)$/i.test(c.brand || ''));
    console.log(`\n[1] REST listCatalogs: OK -- ${r1.data.length} catalogs available to this licence`);
    for (const c of bmw) console.log(`      ${c.brand} ${c.code}: ${(c.features || []).map(f => f.name).join(', ') || 'no features listed'}`);
    if (!bmw.length) console.log('      (no BMW / MINI catalog in the list)');
  } else {
    failed++;
    const why = explain(r1.error) || explain(String(r1.status));
    console.log(`\n[1] REST listCatalogs: FAILED (HTTP ${r1.status}) ${r1.error}${why ? `\n      -> ${why}` : ''}`);
  }

  // 2. SOAP catalog list (the protocol VIN search needs).
  const r2 = await soap('ListCatalogs:Locale=ru_RU');
  if (r2.ok) {
    const n = (r2.xml.match(/<row\b/g) || []).length;
    console.log(`\n[2] SOAP ListCatalogs: OK -- ${n} catalogs`);
  } else {
    failed++;
    const why = explain(r2.error);
    console.log(`\n[2] SOAP ListCatalogs: FAILED (HTTP ${r2.status}) ${r2.error}${why ? `\n      -> ${why}` : ''}`);
  }

  // 3. Optional: one VIN (one car from the monthly quota).
  if (vinArg) {
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vinArg)) {
      console.log(`\n[3] --vin "${vinArg}" is not a 17-character VIN -- skipped`);
    } else {
      const r3 = await soap(`FindVehicleByVIN:Locale=ru_RU|VIN=${vinArg}|Localized=true`);
      if (r3.ok) {
        const rows = [...r3.xml.matchAll(/<row\b([^>]*)>/g)].map(m => {
          const a = k => (m[1].match(new RegExp(`${k}="([^"]*)"`, 'i')) || [])[1] || '';
          return `${a('brand')} ${a('name')} (catalog ${a('catalog')}, vehicleid ${a('vehicleid')})`;
        });
        console.log(`\n[3] SOAP FindVehicleByVIN ${vinArg}: OK -- ${rows.length ? rows.join('; ') : 'no car found for this VIN'}`);
      } else {
        failed++;
        const why = explain(r3.error);
        console.log(`\n[3] SOAP FindVehicleByVIN: FAILED (HTTP ${r3.status}) ${r3.error}${why ? `\n      -> ${why}` : ''}`);
      }
    }
  }

  console.log(failed
    ? '\nResult: direct access does NOT work yet -- send the lines above (they contain no secret) to the developer / Laximo support.'
    : '\nResult: direct access WORKS from this server.');
  process.exit(failed ? 1 : 0);
})();
