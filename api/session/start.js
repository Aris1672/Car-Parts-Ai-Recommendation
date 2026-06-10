/**
 * api/session/start.js — Vercel Serverless Function
 * Called by the widget after the AI sends its first reply.
 * A billable interaction = at least 1 AI response received.
 * Creates a new row in Supabase chat_sessions and returns the session_id.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY; // service role key — never expose to client

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
    // Generate a unique session ID (timestamp + random suffix)
    const sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const now = new Date();
    const date = now.toISOString().split('T')[0];           // YYYY-MM-DD
    const time = now.toISOString().split('T')[1].split('.')[0]; // HH:MM:SS (UTC)

    const response = await fetch(`${SUPABASE_URL}/rest/v1/chat_sessions`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer':        'return=representation',
      },
      body: JSON.stringify({
        session_id:    sessionId,
        date:          date,
        time:          time,
        message_count: 0,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Supabase insert error:', err);
      // Still return a session_id so the widget keeps working even if DB fails
      return res.status(200).json({ session_id: sessionId, warning: 'db_error' });
    }

    return res.status(200).json({ session_id: sessionId });

  } catch (err) {
    console.error('session/start error:', err);
    // Fail silently to the widget — chat must not break if logging fails
    const fallbackId = `s_${Date.now()}_fallback`;
    return res.status(200).json({ session_id: fallbackId, warning: 'exception' });
  }
};
