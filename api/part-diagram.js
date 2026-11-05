/**
 * api/part-diagram.js -- the marked diagram for one diagram card (30.10).
 *
 *   GET /api/part-diagram?t=<signed token from lib/diagramToken.js>
 *   -> { image, box, position, unitName } | { error }
 *
 * The chat replies at once; each card without a product photo then asks here
 * for its diagram with the part's position (box) so the widget can zoom in and
 * mark it. Uses lib/laximo.js getPartDiagram(): the same single request queue
 * (3 s apart), the same caches (7 days) and the same pause on the site's
 * browser check -- nothing here can raise the request rate. `image` is the
 * img.laximo.ru URL; the widget loads it through /api/laximo-image.
 */
const laximo = require('../lib/laximo');
const token = require('../lib/diagramToken');

const TIMEOUT_MS = 60000;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ref = token.verify(req.query.t);
  if (!ref) return res.status(400).json({ error: 'bad token' });

  try {
    const why = await laximo.unavailableReason();
    if (why) return res.status(503).json({ error: 'catalog unavailable' });
    let t;
    const d = await Promise.race([
      laximo.getPartDiagram({ oem: laximo.normalizeOem(ref.oem), schema: { number: ref.oem, catalog: ref.catalog, vid: ref.vid, ssd: ref.ssd, ...(ref.unit ? { unit: ref.unit } : {}) } }),
      new Promise(r => { t = setTimeout(() => r('timeout'), TIMEOUT_MS); }),
    ]).finally(() => clearTimeout(t));
    if (d === 'timeout') return res.status(504).json({ error: 'timeout' });
    if (!d || !d.image) return res.status(404).json({ error: 'no diagram' });
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).json({ image: d.image, box: d.box || null, position: d.position || null, unitName: d.unitName || null });
  } catch (err) {
    console.error('[part-diagram] failed:', ref.oem, err.message);
    return res.status(502).json({ error: 'failed' });
  }
};
