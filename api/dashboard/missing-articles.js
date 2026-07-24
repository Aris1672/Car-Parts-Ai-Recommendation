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
 *
 * Auth: same password pattern as products.js / sessions.js
 * (DASHBOARD_ADMIN_PASSWORD / DASHBOARD_CLIENT_PASSWORD). Both roles can
 * view and resolve -- same reasoning as products.js: the client manages
 * their own catalog gaps directly, this isn't an admin-only concern.
 */

const SUPABASE_URL   = process.env.SUPABASE_URL;
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
      const sbRes = await supabaseFetch(
        'missing_articles?select=*&order=resolved.asc,request_count.desc'
      );
      if (!sbRes.ok) return res.status(502).json({ error: 'DB error', detail: await sbRes.text() });
      const articles = await sbRes.json();
      return res.status(200).json({ success: true, articles });
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
