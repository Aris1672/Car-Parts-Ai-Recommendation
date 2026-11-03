#!/usr/bin/env node
/**
 * scripts/max-chat-id.js — setting up the MAX bot (lib/maxNotify.js).
 *
 * Run on the server (Coolify -> the app -> Terminal), with MAX_BOT_TOKEN set:
 *
 *   node scripts/max-chat-id.js          checks the token, lists the chats the
 *                                        bot has seen recently -> MAX_CHAT_ID
 *   node scripts/max-chat-id.js --test   sends a test request to MAX_CHAT_ID
 *
 * To make a chat show up: add the bot to the managers' group (or open a
 * private chat with it), then write any message there, then run the script
 * within a few hours.
 */

const { MAX_API_URL, sendText, requestText } = require('../lib/maxNotify');

const TOKEN = process.env.MAX_BOT_TOKEN;

async function get(path) {
  const res = await fetch(`${MAX_API_URL}${path}`, {
    headers: { Authorization: TOKEN },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return data;
}

(async () => {
  if (!TOKEN) { console.error('MAX_BOT_TOKEN is not set'); process.exit(1); }

  if (process.argv.includes('--test')) {
    const ids = String(process.env.MAX_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) { console.error('MAX_CHAT_ID is not set'); process.exit(1); }
    const text = requestText({ id: 'ТЕСТ', name: 'Тестовая заявка', phone: '+70000000000', message: 'Проверка связи: если вы видите это сообщение, заявки будут приходить сюда.' });
    for (const id of ids) {
      const r = await sendText(id, text);
      console.log(r.ok ? `OK: test message sent to chat ${id}` : `FAILED for chat ${id}: HTTP ${r.status} ${r.error}`);
    }
    return;
  }

  const me = await get('/me');
  console.log(`Bot: ${me.name || me.first_name || ''} (@${me.username || '?'}), user_id ${me.user_id}`);

  const { updates = [] } = await get('/updates?timeout=0&limit=100') || {};
  const chats = new Map();
  for (const u of updates) {
    const m = u.message || {};
    const id = u.chat_id ?? m.recipient?.chat_id;
    if (id == null) continue;
    const title = u.chat?.title || m.recipient?.chat_type || u.update_type;
    const from = m.sender ? (m.sender.name || [m.sender.first_name, m.sender.last_name].filter(Boolean).join(' ')) : (u.user?.name || '');
    chats.set(String(id), `${title}${from ? ` -- last from ${from}` : ''}`);
  }
  if (!chats.size) {
    console.log('No chats seen yet. Add the bot to the managers\' chat, write any message there, then run this again.');
    return;
  }
  console.log('Chats the bot has seen (use the number as MAX_CHAT_ID):');
  for (const [id, label] of chats) console.log(`  ${id}   ${label}`);
})().catch(err => {
  const cause = err.cause && (err.cause.code || err.cause.message);
  console.error(`Error: ${err.message}${cause ? ` (${cause})` : ''}`);
  if (/certificate|CERT|issuer/i.test(`${err.message} ${cause}`)) {
    console.error('TLS problem: set NODE_EXTRA_CA_CERTS to the Russian Trusted Root CA (see lib/maxNotify.js).');
  }
  process.exit(1);
});
