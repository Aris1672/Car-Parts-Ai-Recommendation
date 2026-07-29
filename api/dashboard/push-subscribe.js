/**
 * api/dashboard/push-subscribe.js — Vercel Serverless Function
 * Stores/removes browser push subscriptions for the dashboard PWA.
 * Same password-based auth pattern as sessions.js/products.js/missing-articles.js.
 *
 * actions: 'subscribe' | 'unsubscribe'
 */

const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PASSWORD  = process.env.DASHBOARD_ADMIN_PASSWORD;
const CLIENT_PASSWORD = process.env.DASHBOARD_CLIENT_PASSWORD;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const { password, action, subscription } = req.body || {};

  let role = null;
  if (ADMIN_PASSWORD  && password === ADMIN_PASSWORD)  role = 'admin';
  if (CLIENT_PASSWORD && password === CLIENT_PASSWORD) role = 'client';
  if (!role) return res.status(401).json({ error: 'Invalid password' });

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'subscription with endpoint required' });
  }

  try {
    if (action === 'subscribe') {
      const res2 = await fetch(
        `${SUPABASE_URL}/rest/v1/push_subscriptions?on_conflict=endpoint`,
        {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'apikey':        SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Prefer':        'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify({
            endpoint:   subscription.endpoint,
            p256dh:     subscription.keys?.p256dh,
            auth:       subscription.keys?.auth,
            role,
            last_used_at: new Date().toISOString(),
          }),
        }
      );
      if (!res2.ok) {
        const err = await res2.text();
        return res.status(502).json({ error: 'db_error', detail: err });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'unsubscribe') {
      await fetch(
        `${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(subscription.endpoint)}`,
        {
          method: 'DELETE',
          headers: {
            'apikey':        SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
          },
        }
      );
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'action must be subscribe or unsubscribe' });

  } catch (err) {
    console.error('push-subscribe error:', err);
    return res.status(500).json({ error: err.message });
  }
};
