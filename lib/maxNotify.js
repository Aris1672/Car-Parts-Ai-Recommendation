/**
 * lib/maxNotify.js — new manager requests to the MAX messenger.
 *
 * MAX (VK) is a Russian messenger with its data in Russia, so the full
 * request (name, phone, email, message) may go there (152-ФЗ). Telegram
 * is deliberately NOT used for this: its servers are abroad.
 *
 * A MAX bot posts each request into the managers' chat (or chats).
 *   MAX_BOT_TOKEN   bot token (MAX for partners -> the bot's settings)
 *   MAX_CHAT_ID     chat id(s) to post to, comma-separated; find them with
 *                   `node scripts/max-chat-id.js` after adding the bot to the chat
 *   MAX_API_URL     optional, default https://platform-api2.max.ru
 *                   (the address the official SDK @maxhub/max-bot-api uses)
 *   PUBLIC_BASE_URL optional, default https://bmwclub77.assistant24info.ru
 *                   (for the «Открыть в панели» link)
 *   STORE_NAME      optional, default «BMW Club77»: shown in every message,
 *                   so one bot can serve several stores (each store's app
 *                   has its own STORE_NAME and MAX_CHAT_ID, same MAX_BOT_TOKEN)
 *
 * API (from the official SDK): POST {MAX_API_URL}/messages?chat_id=<id>,
 * header «Authorization: <token>», JSON body { text, format: 'html' }.
 *
 * Best-effort: a MAX failure is logged and never fails the request itself
 * (it is already saved and the push has gone).
 *
 * If the server logs a TLS error («unable to get local issuer certificate»):
 * MAX's API may use the Russian Ministry of Digital Development root
 * certificate, which Node doesn't trust by default. Download «Russian Trusted
 * Root CA» from gosuslugi.ru/crt, put it into the image and set
 * NODE_EXTRA_CA_CERTS=/path/to/russian_trusted_root_ca.pem.
 */

const MAX_API_URL = (process.env.MAX_API_URL || 'https://platform-api2.max.ru').replace(/\/+$/, '');
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://bmwclub77.assistant24info.ru').replace(/\/+$/, '');

const storeName = () => (process.env.STORE_NAME || 'BMW Club77').trim();

const token = () => process.env.MAX_BOT_TOKEN || '';
const chatIds = () => String(process.env.MAX_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean);

function enabled() {
  return !!(token() && chatIds().length);
}

const escHtml = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function requestText(r) {
  const store = storeName();
  const lines = [`🚨 <b>Новая заявка №${escHtml(r.id)}${store ? ` — ${escHtml(store)}` : ''}</b>`, 'из ИИ-чата на сайте', ''];
  lines.push(`👤 ${escHtml(r.name)}`);
  if (r.phone) lines.push(`📞 ${escHtml(r.phone)}`);
  if (r.email) lines.push(`✉️ ${escHtml(r.email)}`);
  if (r.message) lines.push('', `💬 ${escHtml(r.message)}`);
  lines.push('', `<a href="${PUBLIC_BASE_URL}/dashboard#requests">Открыть в панели</a>`);
  return lines.join('\n');
}

/** POST /messages to one chat. Returns { ok, status, error }. */
async function sendText(chatId, text) {
  const url = `${MAX_API_URL}/messages?chat_id=${encodeURIComponent(chatId)}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token() },
      body: JSON.stringify({ text, format: 'html' }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return { ok: true, status: res.status };
    const body = (await res.text().catch(() => '')).slice(0, 300);
    return { ok: false, status: res.status, error: body };
  } catch (err) {
    const cause = err.cause && (err.cause.code || err.cause.message);
    return { ok: false, status: 0, error: `${err.message}${cause ? ` (${cause})` : ''}` };
  }
}

/** The request to every configured MAX chat. Never throws. */
async function notifyRequest(r) {
  if (!enabled()) return { sent: 0, skipped: true };
  const text = requestText(r);
  const results = await Promise.all(chatIds().map(id => sendText(id, text)));
  results.forEach((res, i) => {
    if (!res.ok) {
      const hint = res.status === 401 ? ' -- check MAX_BOT_TOKEN'
        : res.status === 403 || res.status === 404 ? ' -- is the bot still in this chat? check MAX_CHAT_ID'
        : /certificate|CERT|issuer/i.test(res.error || '') ? ' -- TLS: set NODE_EXTRA_CA_CERTS to the Russian Trusted Root CA (see lib/maxNotify.js)'
        : '';
      console.error(`[max] request #${r.id} to chat ${chatIds()[i]} failed (HTTP ${res.status}): ${res.error}${hint}`);
    }
  });
  const sent = results.filter(x => x.ok).length;
  if (sent) console.log(`[max] request #${r.id} sent to ${sent} chat(s)`);
  return { sent };
}

module.exports = { enabled, notifyRequest, sendText, requestText, MAX_API_URL };
