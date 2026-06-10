/**
 * api/dashboard/sessions.js — Vercel Serverless Function
 * Protected endpoint that returns session data for the dashboard.
 * Passwords: DASHBOARD_ADMIN_PASSWORD, DASHBOARD_CLIENT_PASSWORD (Vercel env vars)
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

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, date_from, date_to } = req.body || {};

  // ── Auth ──────────────────────────────────────────────────
  let role = null;
  if (ADMIN_PASSWORD  && password === ADMIN_PASSWORD)  role = 'admin';
  if (CLIENT_PASSWORD && password === CLIENT_PASSWORD) role = 'client';
  if (!role) return res.status(401).json({ error: 'Invalid password' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    // ── Build query ───────────────────────────────────────────
    let query = `${SUPABASE_URL}/rest/v1/chat_sessions?select=*&order=created_at.desc&limit=1000`;
    if (date_from) query += `&date=gte.${date_from}`;
    if (date_to)   query += `&date=lte.${date_to}`;

    const response = await fetch(query, {
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: 'DB error', detail: err });
    }

    let sessions = await response.json();

    // ── Strip session_id for client role ─────────────────────
    if (role === 'client') {
      sessions = sessions.map(s => ({ ...s, session_id: undefined, id: undefined }));
    }

    // ── Compute stats ─────────────────────────────────────────
    const total          = sessions.length;
    const managerCount   = sessions.filter(s => s.manager_requested).length;
    const conversionPct  = total ? Math.round((managerCount / total) * 100) : 0;
    // Last activity — most recent created_at across all sessions (not filtered by date)
    const lastSession    = sessions[0]; // already ordered by created_at desc
    const lastActivity   = lastSession ? (lastSession.created_at || null) : null;
    const sessionsWithSummary = sessions.filter(s => s.summary).length;

    // Sessions per day for chart
    const byDay = {};
    sessions.forEach(s => {
      const d = s.date || s.created_at?.split('T')[0];
      if (d) byDay[d] = (byDay[d] || 0) + 1;
    });
    const chartData = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    return res.status(200).json({
      role,
      stats: { total, managerCount, conversionPct, lastActivity, sessionsWithSummary },
      chartData,
      sessions,
    });

  } catch (err) {
    console.error('Dashboard sessions error:', err);
    return res.status(500).json({ error: err.message });
  }
};
