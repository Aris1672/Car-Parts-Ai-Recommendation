/**
 * lib/diagramToken.js -- signed references for diagram cards (30.10).
 *
 * A diagram card in the chat loads its marked diagram later, from
 * /api/part-diagram?t=<token>. The token names exactly one part of one car
 * (OEM + Laximo catalog, vid, ssd) and is signed, so the endpoint never makes
 * Laximo requests for parts the chat didn't offer (the site's anti-bot check
 * must not be provoked from outside).
 *
 * Secret: DIAGRAM_TOKEN_SECRET, else CACHE_CLEAR_SECRET, else random per
 * process (then tokens of older chats stop working after a restart -- the card
 * keeps its unmarked diagram).
 */
const crypto = require('crypto');

const SECRET = process.env.DIAGRAM_TOKEN_SECRET || process.env.CACHE_CLEAR_SECRET || crypto.randomBytes(32).toString('hex');

const b64 = buf => Buffer.from(buf).toString('base64url');
const mac = data => crypto.createHmac('sha256', SECRET).update(data).digest('base64url').slice(0, 32);

/** { oem, catalog, vid, ssd } -> token string */
function sign(ref) {
  const data = b64(JSON.stringify({ o: ref.oem, c: ref.catalog || '', v: ref.vid || '', s: ref.ssd || '', ...(ref.unit ? { u: String(ref.unit) } : {}) }));
  return `${data}.${mac(data)}`;
}

/** token -> { oem, catalog, vid, ssd } | null */
function verify(token) {
  const [data, sig] = String(token || '').split('.');
  if (!data || !sig || sig.length !== 32) return null;
  const want = mac(data);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const j = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    return j && j.o ? { oem: String(j.o), catalog: j.c, vid: j.v, ssd: j.s, ...(j.u ? { unit: j.u } : {}) } : null;
  } catch { return null; }
}

module.exports = { sign, verify };
