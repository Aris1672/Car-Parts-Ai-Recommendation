/**
 * Can this server use the Laximo web service DIRECTLY (not the bmwclub77.ru
 * /laximo pages that ABCP's browser check keeps blocking)? Run once in the
 * app's Terminal in Coolify:
 *
 *   node scripts/check-laximo-api.js                 # catalog list only (no car lookups)
 *   node scripts/check-laximo-api.js --vin <VIN>     # + ONE VIN lookup (counts as one car in the quota)
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

(async () => {
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
