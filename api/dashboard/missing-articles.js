/**
 * api/dashboard/missing-articles.js — Vercel Serverless Function
 *
 * Surfaces parts that fit a real customer's vehicle (per the compatibility
 * data) but have no entry in the client's catalog feed -- almost always
 * because ABCP's export only includes items with a photo (see README's
 * "Compatibility matching architecture"), so the AI agent has nothing to
 * show and can't recommend it. chat.js logs these via the
 * bump_missing_article() Postgres function (see missing_articles_setup.sql)
 * every time it happens; this endpoint just reads/manages that log so the
 * client can see which specific parts are costing them sales and go add a
 * photo for them on ABCP's platform.
 *
 * Actions (all POST, same endpoint):
 *   { action: 'list' }                 -> all rows, unresolved first, sorted by request_count desc
 *   { action: 'resolve', vendor_code } -> mark as resolved (client's added a photo, no longer needs attention)
 *   { action: 'delete', vendor_code }  -> remove a row entirely (e.g. logged in error, or the part's discontinued)
 *   { action: 'abcp_check' }           -> start the background check against ABCP's catalog (lib/abcpCatalogCheck.js)
 *   { action: 'abcp_status' }          -> progress of that check
 * 'list' hides placeholder codes (00000000000, 01104444444...) and adds each
 * row's ABCP catalog result as `abcp` ({found, imagesCount, image, descr, checkedAt} or null = not checked).
 *
 * Auth: same password pattern as products.js / sessions.js
 * (DASHBOARD_ADMIN_PASSWORD / DASHBOARD_CLIENT_PASSWORD). Both roles can
 * view and resolve -- same reasoning as products.js: the client manages
 * their own catalog gaps directly, this isn't an admin-only concern.
 */

const { Client }     = require('pg');
const abcpCheck      = require('../../lib/abcpCatalogCheck');
const abcpOrders     = require('../../lib/abcpOrders');
const SUPABASE_URL   = process.env.SUPABASE_URL;
const DB_URL         = process.env.SUPABASE_DB_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PASSWORD = process.env.DASHBOARD_ADMIN_PASSWORD;
const CLIENT_PASSWORD= process.env.DASHBOARD_CLIENT_PASSWORD;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function authenticate(password) {
  if (ADMIN_PASSWORD  && password === ADMIN_PASSWORD)  return 'admin';
  if (CLIENT_PASSWORD && password === CLIENT_PASSWORD) return 'client';
  return null;
}

// ─── Car-model grouping for the filter ──────────────────────────────────────
// Stored model text varies ("X2 F39", "X2 F39 sDrive20i", "2 G42 220i",
// "A4 B8 2.0 TFSI"), so group by brand + model up to and including the first
// chassis/generation code (F39, G42, E70, W204, B8, 8K...). No code -> first
// word only. "X2 F39 sDrive20i" -> "BMW X2 F39".
const CHASSIS_RE = /^([a-z]\d{1,3}|\d[a-z]\d?|[a-z]{1,2}\d{2,3})$/i;
// One spelling per brand, so "Ауди"/"audi"/"Audi" land in one group.
const BRAND_CANON = {
  'bmw': 'BMW', 'бмв': 'BMW', 'audi': 'Audi', 'ауди': 'Audi',
  'mercedes': 'Mercedes-Benz', 'mercedes-benz': 'Mercedes-Benz', 'mercedes benz': 'Mercedes-Benz', 'мерседес': 'Mercedes-Benz', 'мерседес-бенц': 'Mercedes-Benz',
  'volkswagen': 'Volkswagen', 'vw': 'Volkswagen', 'фольксваген': 'Volkswagen',
  'land rover': 'Land Rover', 'range rover': 'Land Rover', 'ленд ровер': 'Land Rover', 'лэнд ровер': 'Land Rover',
  'porsche': 'Porsche', 'порше': 'Porsche', 'mini': 'MINI', 'мини': 'MINI',
};
function canonBrand(b) {
  const k = String(b || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!k) return '';
  return BRAND_CANON[k] || k.charAt(0).toUpperCase() + k.slice(1);
}
function vehicleLabel(v) {
  if (!v || typeof v !== 'object') return null;
  const brand = canonBrand(v.brand);
  const brandWords = new Set([...brand.toLowerCase().split(/[\s-]+/), String(v.brand || '').trim().toLowerCase()].filter(Boolean));
  const words = String(v.model || '').replace(/[()]/g, ' ').trim().split(/\s+/)
    .filter(Boolean)
    .filter(w => !brandWords.has(w.toLowerCase()))                 // "BMW X5 F15" -> "X5 F15"
    .map(w => (/\d/.test(w) ? w.toUpperCase() : w));               // "x5 e70" -> "X5 E70"
  if (!words.length) return brand || null;
  const i = words.findIndex((w, idx) => idx > 0 && CHASSIS_RE.test(w));
  const model = (i > 0 ? words.slice(0, i + 1) : words.slice(0, 1)).join(' ');
  return `${brand ? brand + ' ' : ''}${model}`.trim() || null;
}

// All rows (no 1000-row API cap): read the table directly when possible.
async function listAll() {
  if (DB_URL) {
    const client = new Client({ connectionString: DB_URL, ssl: false });
    try {
      await client.connect();
      const r = await client.query('select * from missing_articles order by resolved asc, request_count desc');
      return r.rows;
    } finally {
      await client.end().catch(() => {});
    }
  }
  // Fallback: REST, paged past the default 1000-row limit.
  const rows = [];
  for (let from = 0; from < 50000; from += 1000) {
    const res = await supabaseFetch('missing_articles?select=*&order=resolved.asc,request_count.desc', {
      headers: { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' },
    });
    if (!res.ok) throw new Error(`DB error: ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function supabaseFetch(path, options = {}) {
  const url = `${SUPABASE_URL.replace(/\/?$/, '/')}rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      ...(options.headers || {}),
    },
  });
  return res;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, action } = req.body || {};
  const role = authenticate(password);
  if (!role) return res.status(401).json({ error: 'Invalid password' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    if (action === 'list') {
      const allRows = await listAll();
      const rows = allRows.filter(a => !abcpCheck.isJunkCode(a.vendor_code));
      let info = new Map();
      try { info = await abcpCheck.getInfoMap(); } catch (err) { console.error('abcp info unavailable:', err.message); }
      // Per row: the model groups it was requested for (any of its stored
      // examples), plus a facet list with article counts for the dropdown.
      const facet = new Map();
      const articles = rows.map(a => {
        const ex = Array.isArray(a.vehicle_examples) ? a.vehicle_examples : [];
        const exampleLabels = ex.map(vehicleLabel); // aligned with vehicle_examples
        const models = [...new Set(exampleLabels.filter(Boolean))];
        for (const m of models) facet.set(m, (facet.get(m) || 0) + 1);
        return { ...a, models, exampleLabels, abcp: info.get(a.vendor_code) || null };
      });
      const models = [...facet.entries()].map(([label, count]) => ({ label, count }))
        .sort((x, y) => y.count - x.count || x.label.localeCompare(y.label));
      return res.status(200).json({
        success: true, total: articles.length, articles, models,
        hiddenJunk: allRows.length - rows.length,
        abcpEnabled: abcpOrders.enabled(),
        abcpCheck: abcpCheck.status(),
      });
    }

    if (action === 'abcp_check') {
      try { return res.status(200).json({ success: true, abcpCheck: await abcpCheck.start() }); }
      catch (err) { return res.status(400).json({ error: err.message }); }
    }

    if (action === 'abcp_status') {
      return res.status(200).json({ success: true, abcpCheck: abcpCheck.status() });
    }

    if (action === 'resolve') {
      const { vendor_code } = req.body || {};
      if (!vendor_code) return res.status(400).json({ error: 'vendor_code is required' });

      const sbRes = await supabaseFetch(`missing_articles?vendor_code=eq.${encodeURIComponent(vendor_code)}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({ resolved: true, resolved_at: new Date().toISOString() }),
      });
      if (!sbRes.ok) return res.status(502).json({ error: 'DB error', detail: await sbRes.text() });
      const [article] = await sbRes.json();
      return res.status(200).json({ success: true, article });
    }

    if (action === 'delete') {
      const { vendor_code } = req.body || {};
      if (!vendor_code) return res.status(400).json({ error: 'vendor_code is required' });

      const sbRes = await supabaseFetch(`missing_articles?vendor_code=eq.${encodeURIComponent(vendor_code)}`, {
        method: 'DELETE',
      });
      if (!sbRes.ok) return res.status(502).json({ error: 'DB error', detail: await sbRes.text() });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Dashboard missing-articles error:', err);
    return res.status(500).json({ error: err.message });
  }
};

module.exports.vehicleLabel = vehicleLabel; // exposed for tests
