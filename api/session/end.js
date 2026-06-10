/**
 * api/session/end.js — Vercel Serverless Function
 * Called by the widget via sendBeacon when the panel closes or page unloads.
 * Updates duration_seconds and message_count in Supabase.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

module.exports = async function handler(req, res) {
  const headers = corsHeaders();
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    const { session_id, duration_seconds, message_count } = req.body || {};

    if (!session_id) {
      return res.status(400).json({ error: 'session_id required' });
    }

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_sessions?session_id=eq.${encodeURIComponent(session_id)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify({
          duration_seconds: duration_seconds ?? null,
          message_count:    message_count    ?? 0,
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error('Supabase patch error:', err);
      return res.status(502).json({ error: 'db_error' });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('session/end error:', err);
    return res.status(500).json({ error: err.message });
  }
};
