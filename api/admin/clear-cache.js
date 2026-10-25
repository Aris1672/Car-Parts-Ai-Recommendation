/**
 * api/admin/clear-cache.js
 *
 * Clears the in-memory compatibility/catalog caches inside chat.js's
 * handler module. Needed because those caches (seriesCache,
 * vendorCodeCompatCache, catalogIndexCache, catalogLookupCache) are module-level and
 * now persist for their full TTL (up to 6h) on this Coolify container,
 * unlike the old Vercel serverless setup where a cold start reset them
 * often. push-compatibility-to-supabase.js calls this endpoint right after
 * a successful push so new data is visible on the very next chat request
 * instead of waiting out the TTL.
 *
 * NOTE ON WIRING: this file assumes server.js mounts it the same way it
 * mounts every other api/*.js file (e.g. api/session/start.js,
 * api/dashboard/sessions.js) -- as the handler for
 * POST /api/admin/clear-cache. Add that route in server.js if it isn't
 * already wired up automatically from the api/ directory structure.
 *
 * Protected by a shared secret (CACHE_CLEAR_SECRET, set in Coolify's env
 * vars and in env.local) so it can't be triggered by anyone who just
 * guesses the URL.
 */

const { clearCaches } = require('../chat.js');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const providedSecret = req.headers['x-admin-secret'];
  const expectedSecret = process.env.CACHE_CLEAR_SECRET;

  if (!expectedSecret) {
    console.error('clear-cache: CACHE_CLEAR_SECRET is not set in this deployment\'s environment -- refusing to clear caches with no secret configured.');
    return res.status(500).json({ error: 'CACHE_CLEAR_SECRET not configured on server' });
  }

  if (!providedSecret || providedSecret !== expectedSecret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    clearCaches();
    return res.status(200).json({ cleared: true, at: new Date().toISOString() });
  } catch (err) {
    console.error('clear-cache: clearCaches() threw:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
