/**
 * api/session/manager.js — the customer's request to a manager.
 *
 * Personal data and the law (152-ФЗ): the customer's name, phone and email
 * must not reach a foreign LLM (DeepSeek), and are stored in Russia only
 * (self-hosted Supabase on assistant_vps_3). So the flow is split in two:
 *
 *   POST { action: 'summary', session_id, messages }
 *     The widget opens the request form and asks for the «Сообщение» text.
 *     The chat is MASKED first (lib/pii.js: phones/emails -> «[телефон скрыт]»),
 *     then the LLM writes 1-3 sentences: car, part, what the customer needs.
 *     -> { ok, message }   (message may be '' if the LLM failed; the customer
 *                           can always type it)
 *
 *   POST { action: 'submit', session_id, name, phone, email, message, consent }
 *     The customer pressed «Отправить» in the form. Nothing here goes to the
 *     LLM. Saved to manager_requests (lib/managerRequests.js), the session is
 *     marked manager_requested in chat_sessions, and every dashboard
 *     subscriber gets a push WITHOUT personal data in it (push services are
 *     Google/Apple/Mozilla servers abroad). The full request also goes to the
 *     managers' MAX chat (lib/maxNotify.js; Russian messenger, data in Russia)
 *     when MAX_BOT_TOKEN + MAX_CHAT_ID are set. The manager opens the
 *     dashboard, tab «Заявки».
 *     -> { ok, id } or { ok: false, error }
 *
 * A request without `action` (an old cached widget) is treated like
 * 'summary' + marking the session: no contacts are taken from it.
 *
 * Bitrix24 is gone: the client no longer uses it, and the old flow had the
 * LLM read the customer's phone/email out of the chat.
 */

const pii = require('../../lib/pii');
const managerRequests = require('../../lib/managerRequests');
const { sendPushToAll } = require('../_lib/push');
const maxNotify = require('../../lib/maxNotify');

const LLM_API_KEY  = process.env.LLM_API_KEY;
// Same provider settings as chat.js (DeepSeek V4 Pro, Anthropic-compatible API).
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.deepseek.com/anthropic';
const LLM_MODEL    = process.env.LLM_MODEL || 'deepseek-v4-pro';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const POLICY_URL = 'https://bmwclub77.ru/data_protection';

const SUMMARY_PROMPT = `Ниже диалог клиента с консультантом магазина автозапчастей. Напиши от лица клиента короткое сообщение менеджеру (1–3 предложения, не больше 400 символов): какой автомобиль (марка, модель, кузов, год, двигатель или VIN — что известно), какая деталь или вопрос, что нужно сделать (подобрать, проверить совместимость, уточнить цену/срок и т.п.).
Пиши просто и по делу, например: «BMW X5 E70 4.8i, 2008. Нужны передние тормозные колодки и датчик износа — подберите, пожалуйста, и сообщите цену и срок».
НЕ указывай имя, телефон, email, адрес и любые другие контакты клиента. Не упоминай «[телефон скрыт]» / «[email скрыт]». Без приветствий, без кавычек, без пояснений — только текст сообщения.

Диалог:
`;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const clip = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/** 1-3 sentences for the form's «Сообщение» field, from the MASKED chat. */
async function generateMessage(messages) {
  if (!LLM_API_KEY || !Array.isArray(messages) || !messages.length) return '';
  const transcript = pii.redactMessages(messages.slice(-20))
    .map(m => `${m.role === 'user' ? 'Клиент' : 'Консультант'}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
    .join('\n')
    // product/diagram blocks are long JSON the summary doesn't need
    .replace(/<<<([A-Z_]+)>>>[\s\S]*?<<<END_\1>>>/g, '[карточки]')
    .slice(-12000);
  try {
    const res = await fetch(`${LLM_BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': LLM_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: LLM_MODEL,
        max_tokens: 600,
        thinking: { type: 'disabled' },
        messages: [{ role: 'user', content: SUMMARY_PROMPT + transcript }],
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300);
      console.error(`[manager] summary failed (${LLM_MODEL}, HTTP ${res.status}): ${body}`);
      return '';
    }
    const data = await res.json();
    const text = ((data.content || []).find(b => b.type === 'text') || {}).text || '';
    // The LLM never saw contacts, but mask once more in case it invented one.
    return clip(pii.redactText(text).replace(/\[(телефон|email) скрыт\]/g, '').replace(/^["«]|["»]$/g, ''), 1000);
  } catch (err) {
    console.error('[manager] summary error:', err.message);
    return '';
  }
}

/** chat_sessions: manager flag + the (contact-free) message for the Аналитика tab. */
async function markSession(sessionId, summary) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !sessionId) return;
  await fetch(`${SUPABASE_URL}/rest/v1/chat_sessions?session_id=eq.${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ manager_requested: true, ...(summary ? { summary } : {}) }),
  }).catch(e => console.error('[manager] chat_sessions update error:', e.message));
}

// ─── Validation ─────────────────────────────────────────────────────────────
const EMAIL_OK = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (/^[78]\d{10}$/.test(d)) return `+7${d.slice(1)}`;
  if (/^9\d{9}$/.test(d)) return `+7${d}`;
  if (d.length >= 10 && d.length <= 15 && /^\s*\+/.test(String(raw))) return `+${d}`;
  return null;
}

// A public endpoint: a few requests per IP per 10 minutes is plenty.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < RATE_WINDOW_MS)) hits.delete(k);
  return list.length > RATE_MAX;
}

async function submit(req, res, body) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const name = clip(body.name, 80);
  const phoneRaw = clip(body.phone, 40);
  const email = clip(body.email, 254).toLowerCase();
  const message = clip(body.message, 2000);
  const sessionId = clip(body.session_id, 64) || null;

  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (!name) return res.status(400).json({ ok: false, error: 'name_required' });
  if (phoneRaw && !phone) return res.status(400).json({ ok: false, error: 'phone_invalid' });
  if (email && !EMAIL_OK.test(email)) return res.status(400).json({ ok: false, error: 'email_invalid' });
  if (!phone && !email) return res.status(400).json({ ok: false, error: 'contact_required' });
  if (body.consent !== true) return res.status(400).json({ ok: false, error: 'consent_required' });
  if (rateLimited(ip)) return res.status(429).json({ ok: false, error: 'too_many_requests' });

  let id;
  try {
    id = await managerRequests.addRequest({
      session_id: sessionId, name, phone, email: email || null, message: message || null,
      consent_policy_url: POLICY_URL, ip, user_agent: clip(req.headers['user-agent'], 300),
    });
  } catch (err) {
    console.error('[manager] request save failed:', err.message);
    return res.status(500).json({ ok: false, error: 'save_failed' });
  }
  console.log(`[manager] request #${id} saved (session ${sessionId || '-'}, by ${phone ? 'phone' : ''}${phone && email ? '+' : ''}${email ? 'email' : ''})`);

  // The Аналитика tab keeps its manager flag and summary (no contacts in it).
  await markSession(sessionId, message ? `Заявка №${id}: ${message}` : `Заявка №${id}`);

  // Push: no personal data in it (it travels through foreign push services).
  // MAX: the full request -- a Russian messenger, data stays in Russia.
  // Both best-effort and in parallel; the request is already saved.
  await Promise.allSettled([
    sendPushToAll({
      title: '🚨 Новая заявка',
      body: `Заявка №${id} из ИИ-чата — откройте вкладку «Заявки»`,
      url: '/dashboard#requests',
      tag: 'lead-alert',
    }).catch(e => console.error('[manager] push error:', e.message)),
    maxNotify.notifyRequest({ id, name, phone, email: email || null, message: message || null }),
  ]);

  return res.status(200).json({ ok: true, id });
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    if (body.action === 'submit') return await submit(req, res, body);

    const message = await generateMessage(body.messages);
    if (body.action === 'summary') return res.status(200).json({ ok: true, message });

    // Old cached widget: no form, no contacts -- flag the session for the dashboard.
    await markSession(clip(body.session_id, 64), message);
    return res.status(200).json({ ok: false, error: 'form_required', message });
  } catch (err) {
    console.error('session/manager error:', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
};
