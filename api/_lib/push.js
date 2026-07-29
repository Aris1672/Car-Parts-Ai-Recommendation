/**
 * api/_lib/push.js — shared helper, NOT itself a Vercel route (lives outside
 * api/dashboard and api/session so it isn't auto-deployed as an endpoint).
 *
 * Sends a Web Push notification to every stored subscription. Used by
 * api/session/manager.js right after a lead is created, so the client
 * gets an instant alert on their phone/desktop even with the dashboard
 * closed.
 *
 * Fire-and-forget by design at the call site: a push failure must never
 * block or fail the actual lead-creation flow (same "best-effort, never
 * blocks core flow" pattern as logMissingArticles() and saveToSupabase()
 * elsewhere in this repo).
 */

const webpush = require('web-push');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const VAPID_PUBLIC_KEY  = process.env.WEBPUSH_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.WEBPUSH_VAPID_PRIVATE_KEY;
const VAPID_SUBJECT     = process.env.WEBPUSH_VAPID_SUBJECT || 'mailto:admin@example.com';

let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return true;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  vapidConfigured = true;
  return true;
}

async function getSubscriptions() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=*`, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) return [];
  return res.json();
}

async function deleteSubscription(endpoint) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
    method: 'DELETE',
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  }).catch(() => {});
}

/**
 * Sends { title, body, url, tag } to every stored subscription.
 * Best-effort: logs and continues on individual failures, and prunes
 * subscriptions the push service reports as gone (404/410 — the browser
 * revoked or expired them).
 */
async function sendPushToAll(payload) {
  if (!ensureVapid()) {
    console.error('Web push not configured (missing VAPID env vars) — skipping.');
    return;
  }

  const subs = await getSubscriptions();
  if (subs.length === 0) return;

  const body = JSON.stringify(payload);

  await Promise.allSettled(subs.map(async (sub) => {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };
    try {
      await webpush.sendNotification(pushSubscription, body);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        // Subscription no longer valid on the push service's end — remove it
        // so future sends don't keep failing against a dead endpoint.
        await deleteSubscription(sub.endpoint);
      } else {
        console.error('Push send error for', sub.endpoint, err.statusCode, err.body);
      }
    }
  }));
}

module.exports = { sendPushToAll };
