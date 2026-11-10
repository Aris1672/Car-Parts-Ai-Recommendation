/**
 * Replay reviewed dialogs through the narrowing dialog (owner 10.11, «narrowing-dialog-plan»).
 * Needs the live services (Laximo, DeepSeek, ABCP) -> run in the Coolify terminal:
 *
 *   git fetch origin bot-reviews && git show origin/bot-reviews:reviews/2026-11-10_1229.json > /tmp/r.json
 *   NARROWING=1 node scripts/replay-narrowing.js /tmp/r.json [--all] [--limit 20]
 *
 * For every reviewed conversation: its FIRST part request with a VIN or a model (or, with
 * --all, every customer message on its own) goes through the full chat handler with
 * NARROWING=1; prints the owner's ✓/✗ + note, the old reply and the new one (question +
 * buttons, or the cards). Nothing is recorded in the dashboard (body.replay).
 */
process.env.NARROWING = '1';
const fs = require('fs');
const handler = require('../api/chat');

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/replay-narrowing.js <reviews.json> [--all] [--limit N]'); process.exit(1); }
const all = process.argv.includes('--all');
const li = process.argv.indexOf('--limit');
const limit = li > 0 ? Number(process.argv[li + 1]) || 20 : 20;
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const CAR_RE = /[A-HJ-NPR-Z0-9]{17}|\b[EFGU]\d{2}\b|\bX[1-7]\b|\b[1-8]\d{2}[id]\b/i;

function call(messages) {
  return new Promise(resolve => {
    const res = { headers: {}, statusCode: 200, setHeader() {}, end() { resolve({}); },
      status(c) { this.statusCode = c; return this; }, json(b) { resolve(b || {}); return this; } };
    handler({ method: 'POST', headers: {}, socket: {}, body: { messages, replay: true } }, res);
  });
}
const short = r => {
  const t = String(r || '');
  const buttons = (t.match(/<<<BUTTONS>>>([\s\S]*?)<<<END_BUTTONS>>>/) || [])[1];
  const cards = (t.match(/<<<PRODUCTS>>>([\s\S]*?)<<<END_PRODUCTS>>>/) || [])[1];
  let out = t.replace(/<<<[A-Z_]+>>>[\s\S]*?<<<END_[A-Z_]+>>>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
  try { if (buttons) out += `\n      buttons: ${JSON.parse(buttons).join(' | ')}`; } catch {}
  try { if (cards) out += `\n      cards: ${JSON.parse(cards).map(c => `${c.article} ${c.name}`).join(' | ')}`; } catch {}
  return out;
};

(async () => {
  let n = 0;
  for (const conv of data.conversations || []) {
    const turns = conv.turns || [];
    const picks = all ? turns : turns.filter(t => CAR_RE.test(t.customer || '') && (t.understood && t.understood.parts)).slice(0, 1);
    for (const t of picks) {
      if (n++ >= limit) return;
      const r = await call([{ role: 'user', content: t.customer }]);
      console.log(`\n#${t.id} ${t.review === 'bad' ? '✗' : t.review === 'ok' ? '✓' : '·'} «${String(t.customer).replace(/\s+/g, ' ').slice(0, 90)}»${t.note ? `\n   note: ${t.note}` : ''}`);
      console.log(`   OLD: ${short(t.reply)}`);
      console.log(`   NEW: ${short(r.reply || r.error)}`);
    }
  }
})().then(() => process.exit(0));
