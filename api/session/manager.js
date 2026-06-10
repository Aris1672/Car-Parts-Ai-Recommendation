/**
 * api/session/manager.js — Vercel Serverless Function
 * Triggered when user presses "Connect with manager" button.
 *
 * 1. Asks Claude to produce a concise lead summary from the conversation
 * 2. Saves summary + manager_requested=true to Supabase
 * 3. POSTs the summary to Bitrix24 webhook
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_KEY;
const BITRIX_WEBHOOK    = process.env.BITRIX24_WEBHOOK_URL; // e.g. https://yourcompany.bitrix24.ru/rest/1/xxxxx/

const SUMMARY_PROMPT = `You are a concise sales assistant. Based on the conversation below, write a SHORT lead summary in Russian for the sales manager.

Format:
🧩 Интерес: [what mosaic type/material the client is looking for]
📐 Площадь: [area/quantity if mentioned, otherwise "не указана"]
💰 Бюджет: [if mentioned, otherwise "не указан"]
❓ Вопросы: [key open questions or concerns the client raised]
📝 Заметки: [anything else relevant — location, timeline, special requirements]

Be brief. Max 5 lines total. No extra commentary.

Conversation:
`;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function generateSummary(messages) {
  if (!ANTHROPIC_API_KEY) return 'API key not configured — summary unavailable.';

  // Build a readable transcript
  const transcript = messages
    .map(m => `${m.role === 'user' ? 'Клиент' : 'ИИ'}: ${m.content}`)
    .join('\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [
        { role: 'user', content: SUMMARY_PROMPT + transcript }
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) return 'Summary generation failed.';
  const data = await response.json();
  return data.content?.[0]?.text?.trim() ?? 'No summary.';
}

async function saveToSupabase(sessionId, summary) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  await fetch(
    `${SUPABASE_URL}/rest/v1/chat_sessions?session_id=eq.${encodeURIComponent(sessionId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({
        manager_requested: true,
        summary:           summary,
      }),
    }
  ).catch(e => console.error('Supabase manager update error:', e));
}

async function sendToBitrix(summary, sessionId) {
  // Uses im.notify.system.add — same method as your Voiceflow integration
  // Webhook base URL from env var; falls back to your known URL
  const webhookBase = BITRIX_WEBHOOK
    ? BITRIX_WEBHOOK.replace(/\/?$/, '/')
    : 'https://b24-q8506c.bitrix24.ru/rest/1/jahblh75ol4bqll1/';

  const message = `📬 Новый запрос на связь с менеджером\n\nСессия: ${sessionId}\n\n${summary}`;

  const url = `${webhookBase}im.notify.system.add?USER_ID=1&MESSAGE=${encodeURIComponent(message)}`;

  await fetch(url, { signal: AbortSignal.timeout(10000) })
    .catch(e => console.error('Bitrix24 webhook error:', e));
}

module.exports = async function handler(req, res) {
  const headers = corsHeaders();
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { session_id, messages } = req.body || {};

    if (!session_id || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'session_id and messages required' });
    }

    // Run all three tasks in parallel for speed
    const summary = await generateSummary(messages);

    await Promise.allSettled([
      saveToSupabase(session_id, summary),
      sendToBitrix(summary, session_id),
    ]);

    return res.status(200).json({ ok: true, summary });

  } catch (err) {
    console.error('session/manager error:', err);
    return res.status(500).json({ error: err.message });
  }
};
