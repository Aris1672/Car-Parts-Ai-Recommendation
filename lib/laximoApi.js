/**
 * lib/laximoApi.js -- the Laximo.CAT web service, called DIRECTLY with the
 * shop's own licence (instead of reading bmwclub77.ru/laximo pages, which
 * ABCP's browser check keeps blocking). Used by lib/laximo.js when
 * LAXIMO_SOURCE=api; every function there returns the same shapes as the
 * site path, so nothing above lib/laximo.js changes.
 *
 * Protocol: SOAP QueryDataLogin(request, login, hmac), request =
 * "Command:Key=Value|Key=Value", hmac = MD5(request + key) -- the key itself is
 * never sent. Command formats from Laximo's official PHP SDK (laximo/guayaquillib,
 * src/Oem.php); answer shapes from real dumps 04.11.2026
 * (`node scripts/check-laximo-api.js --dump <VIN>`, fixtures in scripts/fixtures/laximo-api/).
 *
 * ssd RULE (learned 04.11): every element of an answer (car, category, unit,
 * part) carries its own ssd, and a call about an element must get THAT ssd:
 *   car ssd       -> GetVehicleInfo, ListQuickGroup, ListQuickDetail, ListCategories,
 *                    SearchVehicleDetails, GetOEMPartApplicability
 *   category ssd  -> ListUnits
 *   unit ssd      -> GetUnitInfo, ListDetailByUnit, ListImageMapByUnit
 * Passing the car ssd to a unit call gives E_INVALIDPARAMETER:SSD.
 *
 * Billing: Laximo counts every NEW car looked up per billing month (licence
 * 1 000 OEM cars, shared with the site's own visitors). Over the limit Laximo
 * SWITCHES THE SERVICE OFF, site included. So the bot counts the distinct cars
 * it opened this billing month and stops at LAXIMO_MONTHLY_CAR_CAP.
 *
 * Env: LAXIMO_LOGIN, LAXIMO_KEY (Coolify only), LAXIMO_API_HOST,
 * LAXIMO_API_MIN_INTERVAL_MS (default 300), LAXIMO_API_TIMEOUT_MS (default 15000),
 * LAXIMO_MONTHLY_CAR_CAP (default 400), LAXIMO_BILLING_DAY (default 9).
 */
const crypto = require('crypto');
const cheerio = require('cheerio');
const { normalizeOem } = require('./normalize');

const HOST = () => (process.env.LAXIMO_API_HOST || 'https://ws.laximo.ru').replace(/\/+$/, '');
const SOAP_PATH = '/ec.Kito.WebCatalog/services/Catalog.CatalogHttpSoap11Endpoint/';
const MIN_INTERVAL_MS = () => Number(process.env.LAXIMO_API_MIN_INTERVAL_MS || 300);
const TIMEOUT_MS = () => Number(process.env.LAXIMO_API_TIMEOUT_MS || 15000);
const CAR_CAP = () => Number(process.env.LAXIMO_MONTHLY_CAR_CAP || 400);
const BILLING_DAY = () => Math.min(28, Math.max(1, Number(process.env.LAXIMO_BILLING_DAY || 9)));

const configured = () => !!(process.env.LAXIMO_LOGIN && process.env.LAXIMO_KEY);

/** Thrown for Laximo's own error answers (E_…); `code` is the E_ name. */
class LaximoApiError extends Error {
  constructor(message) {
    super(message);
    this.code = (String(message).match(/\bE_[A-Z_]+/) || [])[0] || null;
  }
}

// ─── TRANSPORT ──────────────────────────────────────────────────────────────
const xmlEscape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xmlUnescape = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** "Name:Key=Value|Key=Value" -- same as the PHP SDK (no escaping; values never contain | or newlines here). */
function command(name, params) {
  return `${name}:` + Object.entries(params).map(([k, v]) => `${k}=${String(v == null ? '' : v).replace(/[|\n\r]/g, ' ')}`).join('|');
}

let queue = Promise.resolve();
let lastAt = 0;

/** One SOAP call -> the answer XML string ("<response>…</response>"). Serialized, MIN_INTERVAL_MS apart. */
function call(request) {
  const run = async () => {
    if (!configured()) throw new LaximoApiError('LAXIMO_LOGIN / LAXIMO_KEY not set');
    const wait = lastAt + MIN_INTERVAL_MS() - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastAt = Date.now();
    const login = process.env.LAXIMO_LOGIN, key = process.env.LAXIMO_KEY;
    const hmac = crypto.createHash('md5').update(request + key, 'utf8').digest('hex');
    const envelope = '<?xml version="1.0" encoding="UTF-8"?>' +
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="http://WebCatalog.Kito.ec">' +
      '<soapenv:Body><ns:QueryDataLogin>' +
      `<ns:request>${xmlEscape(request)}</ns:request><ns:login>${xmlEscape(login)}</ns:login><ns:hmac>${hmac}</ns:hmac>` +
      '</ns:QueryDataLogin></soapenv:Body></soapenv:Envelope>';
    const r = await fetch(HOST() + SOAP_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'urn:QueryDataLogin' },
      body: envelope,
      signal: AbortSignal.timeout(TIMEOUT_MS()),
    });
    const text = await r.text();
    const ret = text.match(/<(?:\w+:)?return[^>]*>([\s\S]*?)<\/(?:\w+:)?return>/);
    if (r.ok && ret) return xmlUnescape(ret[1]);
    const fault = text.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
    throw new LaximoApiError(`${fault ? xmlUnescape(fault[1]).trim() : `HTTP ${r.status}`}`.slice(0, 300));
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

// ─── PURE PARSERS (tested against the real dumps) ───────────────────────────
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const load = xml => cheerio.load(String(xml || ''), { xml: { xmlMode: true, decodeEntities: true } });
const imageUrl = u => (u ? String(u).replace('%size%', 'source') : null);

/** <attribute key name value/> children -> [{ key, name, value }] */
function attributesOf($, el) {
  return $(el).children('attribute').map((_, a) => ({ key: $(a).attr('key') || '', name: $(a).attr('name') || '', value: $(a).attr('value') || '' })).get();
}

/**
 * FindVehicleByVIN / GetVehicleInfo / FindVehicleByWizard2 rows -> the site's
 * vehicle shape: { brand, catalog, name, modelCode, options: {label: value}, vid, ssd }.
 * options use Laximo's Russian names (a second "Модель" -> "Модель (2)"), like the site.
 */
function parseVehicles(xml) {
  const $ = load(xml);
  return $('row[vehicleid]').map((_, row) => {
    const options = {};
    const attrs = attributesOf($, row);
    for (const a of attrs) {
      if (!a.value) continue;
      const label = a.name || a.key;
      options[options[label] !== undefined ? `${label} (2)` : label] = a.value;
    }
    const byKey = k => (attrs.find(a => a.key === k) || {}).value || '';
    // "X5 E70 LCI" -> "E70 LCI" (the chassis, like the site's model column)
    const series = byKey('series_description');
    const chassis = series.split(/\s+/).slice(1).join(' ') || byKey('series_code') || byKey('model');
    return {
      brand: $(row).attr('brand') || null,
      catalog: $(row).attr('catalog') || null,
      name: clean($(row).attr('name')),
      modelCode: chassis,
      model: byKey('model'),
      options,
      vid: $(row).attr('vehicleid'),
      ssd: $(row).attr('ssd') || '',
    };
  }).get();
}

/** ListCatalogs -> [{ name, catalog }] (the site's brand list shape). */
function parseCatalogs(xml) {
  const $ = load(xml);
  const seen = new Set();
  return $('row[code]').map((_, r) => ({ name: clean($(r).attr('brand') || $(r).attr('name')), catalog: $(r).attr('code') })).get()
    .filter(c => c.name && c.catalog && !seen.has(c.catalog) && seen.add(c.catalog));
}

/**
 * ListQuickGroup -> [{ gid, name, aliases, path }] for every node with link="true"
 * (same shape as the site's parseGroupTree). The single top node ("Легковые
 * автомобили (NEW)") is left out of the path.
 */
function parseQuickGroups(xml) {
  const $ = load(xml);
  const out = [];
  const walk = (nodes, path) => {
    nodes.each((_, n) => {
      const name = clean($(n).attr('name'));
      if ($(n).attr('link') === 'true' && $(n).attr('quickgroupid')) {
        out.push({
          gid: String($(n).attr('quickgroupid')),
          name,
          aliases: String($(n).attr('synonyms') || '').split(',').map(clean).filter(Boolean),
          path: path.join(' › '),
        });
      }
      walk($(n).children('row'), [...path, name]);
    });
  };
  const top = $('ListQuickGroups, ListQuickGroup').first().children('row');
  if (top.length === 1) walk(top.children('row'), []);
  else walk(top, []);
  return out;
}

/** Laximo part attributes -> { qty, notes: {label: value} } with the site's labels (noteLabel from lib/laximo.js). */
function detailNotes(attrs, noteLabel) {
  const notes = {};
  let qty = null;
  for (const a of attrs) {
    if (!a.value) continue;
    if (a.key === 'amount') { qty = a.value; continue; }
    const n = noteLabel(a);
    // note + comment1 + comment2 all read "Примечание" -- keep every one
    const label = notes[n.label] === undefined ? n.label : (notes[a.key] === undefined ? a.key : `${n.label} (${a.key})`);
    notes[label] = n.value;
  }
  return { qty, notes };
}

/** One <Detail>/<row> part element -> the site's part row shape. */
function partRow($, el, noteLabel, unit) {
  const { qty, notes } = detailNotes(attributesOf($, el), noteLabel);
  const code = $(el).attr('codeonimage') || null;
  return {
    position: code,
    oem: normalizeOem($(el).attr('oem') || ''),
    name: clean($(el).attr('name')) || null,
    qty,
    notes,
    unit: unit ? unit.name : null,
    ...(code ? { code } : {}),
    ...($(el).attr('match') === 't' ? { match: true } : {}),
  };
}

/**
 * ListQuickDetail / GetOEMPartApplicability -> [{ category: {id, name, ssd},
 *   unit: {uid, name, code, image, ssd}, rows: [part rows] }] -- one entry per unit.
 */
function parseUnitBlocks(xml, noteLabel) {
  const $ = load(xml);
  const out = [];
  $('Category').each((_, c) => {
    const category = { id: $(c).attr('categoryid'), name: clean($(c).attr('name')), ssd: $(c).attr('ssd') || '' };
    $(c).children('Unit').each((__, u) => {
      const unit = { uid: $(u).attr('unitid'), name: clean($(u).attr('name')), code: $(u).attr('code') || null,
        image: imageUrl($(u).attr('largeimageurl') || $(u).attr('imageurl')), ssd: $(u).attr('ssd') || '',
        // equipment-dependent unit (model path): the filter string for GetFilterByUnit
        filter: $(u).attr('filter') || $(u).children('Detail[filter]').first().attr('filter') || null };
      const rows = $(u).children('Detail').map((___, d) => partRow($, d, noteLabel, unit)).get().filter(r => /^[A-Z0-9]{5,}$/.test(r.oem));
      out.push({ category, unit, rows });
    });
  });
  return out;
}

/**
 * GetFilterByUnit -> the site's equipment selector shape:
 * [{ label: "Спортивные тормоза M (S2NHA)", options: [{ text: "да", value: <ssdmodification> }] }].
 * Shape from Laximo's PHP SDK (FilterObject: row[name,type] > values > row[name,note,ssdmodification]). Pure.
 */
function parseFilter(xml) {
  const $ = load(xml);
  const root = $('GetFilterByUnit, GetFilterByDetail').first();
  return root.children('row').map((_, f) => ({
    label: clean($(f).attr('name')),
    options: $(f).children('values').children('row').map((__, v) => ({ text: clean($(v).attr('name')), value: $(v).attr('ssdmodification') || '' })).get()
      .filter(o => o.text && o.value),
  })).get().filter(f => f.label && f.options.length);
}

/** GetOEMPartApplicability -> "FULL" | "PARTIAL" | … (attribute on the answer element). */
function applicabilityOf(xml) {
  return (String(xml).match(/<GetOEMPartApplicability\b[^>]*\bapplicability="([^"]*)"/) || [])[1] || null;
}

/** ListCategories -> [{ cid, name, code, parent, leaf, ssd }] */
function parseCategories(xml) {
  const $ = load(xml);
  return $('row[categoryid]').map((_, r) => ({
    cid: $(r).attr('categoryid'), name: clean($(r).attr('name')), code: $(r).attr('code') || null,
    parent: $(r).attr('parentcategoryid') || null, leaf: $(r).attr('childrens') !== 'true', ssd: $(r).attr('ssd') || '',
  })).get();
}

/** ListUnits / GetUnitInfo -> [{ uid, name, code, image, ssd }] */
function parseUnits(xml) {
  const $ = load(xml);
  return $('row[unitid]').map((_, r) => ({
    uid: $(r).attr('unitid'), name: clean($(r).attr('name')), code: $(r).attr('code') || null,
    image: imageUrl($(r).attr('largeimageurl') || $(r).attr('imageurl')), ssd: $(r).attr('ssd') || '',
  })).get();
}

/** ListDetailByUnit -> part rows */
function parseUnitParts(xml, noteLabel, unit) {
  const $ = load(xml);
  return $('row[oem]').map((_, r) => partRow($, r, noteLabel, unit)).get().filter(r => /^[A-Z0-9]{5,}$/.test(r.oem));
}

/** ListImageMapByUnit -> { code: {x, y, w, h} } (first box per code, like the site). */
function parseImageMap(xml) {
  const $ = load(xml);
  const boxes = {};
  $('row[code]').each((_, r) => {
    const n = k => Number($(r).attr(k));
    const code = $(r).attr('code');
    const [x1, x2, y1, y2] = ['x1', 'x2', 'y1', 'y2'].map(n);
    if (!code || boxes[code] || ![x1, x2, y1, y2].every(Number.isFinite)) return;
    boxes[code] = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  });
  return boxes;
}

/** SearchVehicleDetails -> [{ oem, name }] */
function parseNameSearch(xml) {
  const $ = load(xml);
  return $('row[oem]').map((_, r) => ({ oem: normalizeOem($(r).attr('oem')), name: clean($(r).text()) || null })).get()
    .filter(r => /^[A-Z0-9]{5,}$/.test(r.oem));
}

/**
 * GetWizard2 -> the site's wizard JSON shape:
 * { wizardSteps: [{ conditionId, name, determined, value, automatic, options: [{key, value}] }], ssd }
 * A determined step has its chosen value and no options.
 */
function parseWizard(xml) {
  const $ = load(xml);
  const wizardSteps = $('GetWizard2').first().children('row').map((_, r) => ({
    conditionId: $(r).attr('conditionid') || null,
    name: clean($(r).attr('name')),
    determined: $(r).attr('determined') === 'true',
    automatic: $(r).attr('automatic') === 'true',
    value: $(r).attr('value') || null,
    ssd: $(r).attr('ssd') || '',
    allowListVehicles: $(r).attr('allowlistvehicles') === 'true',
    options: $(r).children('options').children('row').map((__, o) => ({ key: $(o).attr('key'), value: clean($(o).attr('value')) })).get()
      .filter(o => o.key && o.value),
  })).get();
  return { wizardSteps };
}

// ─── MONTHLY CAR COUNTER ────────────────────────────────────────────────────
/** Billing period key for a date: "2026-10-09" for 09.10–08.11 when the billing day is 9. Pure. */
function billingPeriod(now = new Date(), day = BILLING_DAY()) {
  const msk = new Date(now.getTime() + 3 * 3600 * 1000); // Moscow date
  let y = msk.getUTCFullYear(), m = msk.getUTCMonth();
  if (msk.getUTCDate() < day) { m -= 1; if (m < 0) { m = 11; y -= 1; } }
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The counter lives in laximo_cache (key axcars:<period>) via the get/set the
 * caller passes in, so lib/laximo.js keeps one cache. `id` = catalog:vehicleid.
 *   check(store)       -> null | reason string (cap reached)
 *   add(store, id)     -> counts a car once per period
 */
const carCounter = {
  key: () => `axcars:${billingPeriod()}`,
  async list(store) { const v = await store.get(carCounter.key()); return Array.isArray(v && v.cars) ? v.cars : []; },
  async check(store, id) {
    const cars = await carCounter.list(store);
    if (id && cars.includes(id)) return null;
    return cars.length >= CAR_CAP() ? `monthly bot cap of ${CAR_CAP()} cars reached (${cars.length} this billing month since ${billingPeriod()})` : null;
  },
  async add(store, id) {
    if (!id) return;
    const cars = await carCounter.list(store);
    if (cars.includes(id)) return;
    cars.push(id);
    await store.set(carCounter.key(), { cars });
    console.log(`[laximo-api] new car this billing month: ${id} (${cars.length}/${CAR_CAP()})`);
  },
};

module.exports = {
  configured, call, command, LaximoApiError,
  parseVehicles, parseCatalogs, parseQuickGroups, parseUnitBlocks, applicabilityOf, parseCategories, parseUnits,
  parseUnitParts, parseImageMap, parseFilter, parseNameSearch, parseWizard, detailNotes, billingPeriod, carCounter,
};
