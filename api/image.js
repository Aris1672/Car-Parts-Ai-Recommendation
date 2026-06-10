/**
 * api/image.js — Image proxy for pixmosaic.ru
 * Fetches images server-side to bypass hotlink protection.
 * Usage: /api/image?url=https://pixmosaic.ru/upload/...
 *
 * NOTE: pixmosaic.ru does not support https natively.
 * The browser always calls this proxy over https (secure).
 * This function internally fetches via http so the request succeeds.
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'url parameter required' });
  }

  // Security: only proxy pixmosaic.ru images
  if (!url.includes('pixmosaic.ru')) {
    return res.status(403).json({ error: 'Only pixmosaic.ru images allowed' });
  }

  // pixmosaic.ru does not support https — always fetch via http internally.
  // The browser talks to THIS proxy over https, so there is no mixed-content issue.
  const fetchUrl = url.replace('https://pixmosaic.ru', 'http://pixmosaic.ru');

  try {
    const imageRes = await fetch(fetchUrl, {
      headers: {
        'Referer':    'https://pixmosaic.ru/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':     'image/webp,image/apng,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!imageRes.ok) {
      console.error(`Image fetch failed: ${imageRes.status} for ${fetchUrl}`);
      return res.status(imageRes.status).json({ error: 'Image fetch failed' });
    }

    const contentType = imageRes.headers.get('content-type') || 'image/jpeg';
    const buffer = await imageRes.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // cache 24h
    return res.status(200).send(Buffer.from(buffer));

  } catch (err) {
    console.error('Image proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
};