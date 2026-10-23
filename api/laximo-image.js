/**
 * api/laximo-image.js -- serves Laximo unit diagrams to the chat widget.
 *
 *   GET /api/laximo-image?u=<encoded https://img.laximo.ru/... URL>
 *
 * The diagram links on the site are signed (?s=…&k=…) and may expire, and
 * img.laximo.ru may check the referrer -- so the widget never links them
 * directly. Only img.laximo.ru is allowed (no open proxy). Images are kept in
 * memory (max 150, 7 days), so an old chat keeps its diagram after the link
 * expires, as long as the server hasn't restarted.
 */

const ALLOWED_HOST = 'img.laximo.ru';
const MAX_ITEMS = 150;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 3 * 1024 * 1024;
const cache = new Map(); // url -> { at, type, buf }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let url;
  try { url = new URL(String(req.query.u || '')); } catch { return res.status(400).json({ error: 'bad url' }); }
  if (url.protocol !== 'https:' || url.hostname !== ALLOWED_HOST) return res.status(400).json({ error: 'host not allowed' });

  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return send(res, hit);

  try {
    const r = await fetch(key, {
      headers: { 'Referer': 'https://bmwclub77.ru/', 'User-Agent': 'Mozilla/5.0 (compatible; BMWClub77-assistant)' },
      signal: AbortSignal.timeout(10000),
    });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !/^image\//.test(type)) return res.status(502).json({ error: `upstream ${r.status}` });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) return res.status(502).json({ error: 'too large' });
    const item = { at: Date.now(), type, buf };
    cache.set(key, item);
    if (cache.size > MAX_ITEMS) cache.delete(cache.keys().next().value);
    return send(res, item);
  } catch (err) {
    console.error('[laximo-image] fetch failed:', err.message);
    return res.status(502).json({ error: 'fetch failed' });
  }
};

function send(res, item) {
  res.setHeader('Content-Type', item.type);
  res.setHeader('Cache-Control', 'public, max-age=604800');
  return res.status(200).end(item.buf);
}
