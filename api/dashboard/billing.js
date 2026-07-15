/**
 * api/dashboard/billing.js — Vercel Serverless Function
 *
 * Manages the client's billing plan and reports usage against it.
 * 'get' (plan + usage, read-only) is available to both admin and client
 * roles -- the client dashboard's "Тариф" tab shows this read-only, with
 * no edit controls. 'set' (changing the plan) is admin-only.
 *
 * Actions (all POST, same endpoint):
 *   { action: 'get' }                          -> current plan + usage this cycle (admin + client)
 *   { action: 'set', ...plan fields }           -> update the plan (admin only)
 *
 * Auth: same password pattern as sessions.js / products.js
 * (DASHBOARD_ADMIN_PASSWORD / DASHBOARD_CLIENT_PASSWORD) -- but unlike
 * those, EVERY action here requires the admin role. There is currently no
 * client-facing billing view at all; the "Тариф" dashboard tab must be
 * hidden entirely for the client role (enforced client-side in
 * dashboard/index.html AND here server-side, belt-and-suspenders).
 *
 * Billing model: rolling 30-day cycles anchored to `cycle_start` (set to
 * the signup date, or reset whenever the admin explicitly resets it) --
 * non-overlapping cycles, not a continuously-sliding trailing window.
 */

const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PASSWORD = process.env.DASHBOARD_ADMIN_PASSWORD;
const CLIENT_PASSWORD= process.env.DASHBOARD_CLIENT_PASSWORD;

const DAY_MS   = 24 * 60 * 60 * 1000;
const CYCLE_MS = 30 * DAY_MS;

// Preset plans matching the public pricing page (assistant24.tech/recom.html).
// 'custom' isn't a preset -- it's what the plan becomes once an admin edits
// any field manually rather than picking a preset.
const PRESETS = {
  start:      { plan_name: 'Старт',      monthly_price: 21000, included_sessions: 250,  overage_price_per_session: 95 },
  pro:        { plan_name: 'Профи',      monthly_price: 42000, included_sessions: 500,  overage_price_per_session: 90 },
  enterprise: { plan_name: 'Энтерпрайз', monthly_price: 80000, included_sessions: 1000, overage_price_per_session: 84 },
};

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

// Computes the current 30-day cycle's [start, end) boundaries given the
// plan's anchor date. Non-overlapping cycles counted forward from
// cycle_start, e.g. cycle_start=Jan 1 -> cycles are [Jan1,Jan31), [Jan31,Mar2), ...
function currentCycleBounds(cycleStartIso) {
  const cycleStart = new Date(cycleStartIso).getTime();
  const now = Date.now();
  const elapsed = now - cycleStart;
  const cyclesElapsed = Math.floor(elapsed / CYCLE_MS);
  const periodStart = new Date(cycleStart + cyclesElapsed * CYCLE_MS);
  const periodEnd   = new Date(cycleStart + (cyclesElapsed + 1) * CYCLE_MS);
  return { periodStart, periodEnd };
}

async function getUsageCount(periodStart, periodEnd) {
  const url = `chat_sessions?select=id&created_at=gte.${periodStart.toISOString()}&created_at=lt.${periodEnd.toISOString()}`;
  const res = await supabaseFetch(url, { headers: { 'Prefer': 'count=exact' } });
  if (!res.ok) return 0;
  const countHeader = res.headers.get('content-range'); // e.g. "0-24/25"
  if (countHeader) {
    const match = countHeader.match(/\/(\d+)$/);
    if (match) return parseInt(match[1], 10);
  }
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows.length : 0;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, action } = req.body || {};
  const role = authenticate(password);
  if (!role) return res.status(401).json({ error: 'Invalid password' });

  // 'get' is read-only and is now deliberately available to both roles --
  // the client dashboard's "Тариф" tab shows plan + usage read-only,
  // with no way to change the plan. 'set' (changing the plan) stays
  // admin-only, enforced below.
  if (action === 'set' && role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    if (action === 'get') {
      const planRes = await supabaseFetch('billing_plan?id=eq.1&select=*');
      if (!planRes.ok) return res.status(502).json({ error: 'DB error', detail: await planRes.text() });
      const [plan] = await planRes.json();
      if (!plan) return res.status(404).json({ error: 'No billing plan configured -- run the setup SQL first' });

      const { periodStart, periodEnd } = currentCycleBounds(plan.cycle_start);
      const usedSessions = await getUsageCount(periodStart, periodEnd);
      const overageSessions = Math.max(0, usedSessions - plan.included_sessions);
      const overageCost = overageSessions * plan.overage_price_per_session;

      return res.status(200).json({
        success: true,
        plan,
        usage: {
          periodStart: periodStart.toISOString(),
          periodEnd:   periodEnd.toISOString(),
          usedSessions,
          includedSessions: plan.included_sessions,
          overageSessions,
          overageCost,
          estimatedTotal: Number(plan.monthly_price) + overageCost,
        },
        presets: PRESETS,
      });
    }

    if (action === 'set') {
      const { plan_key, plan_name, monthly_price, included_sessions, overage_price_per_session, reset_cycle } = req.body || {};

      let fields;
      if (plan_key && PRESETS[plan_key]) {
        fields = { plan_key, ...PRESETS[plan_key] };
      } else {
        // Custom plan -- all fields required since there's no preset to fall back on
        if (!plan_name || monthly_price == null || included_sessions == null || overage_price_per_session == null) {
          return res.status(400).json({ error: 'Custom plan requires plan_name, monthly_price, included_sessions, overage_price_per_session' });
        }
        fields = { plan_key: 'custom', plan_name, monthly_price, included_sessions, overage_price_per_session };
      }

      if (reset_cycle) {
        fields.cycle_start = new Date().toISOString();
      }
      fields.updated_at = new Date().toISOString();

      const updateRes = await supabaseFetch('billing_plan?id=eq.1', {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(fields),
      });
      if (!updateRes.ok) return res.status(502).json({ error: 'DB error', detail: await updateRes.text() });
      const [plan] = await updateRes.json();

      return res.status(200).json({ success: true, plan });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Dashboard billing error:', err);
    return res.status(500).json({ error: err.message });
  }
};
