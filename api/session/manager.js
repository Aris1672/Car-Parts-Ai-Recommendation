/**
 * api/session/manager.js — Vercel Serverless Function
 * Triggered when: (1) the user explicitly asks for a manager/human,
 * (2) the agent has no compatibility/fitment data for a requested part,
 * or (3) the agent can't find any matching product at all. Also triggered
 * by the widget's "Connect with manager" button.
 *
 * 1. Asks Claude to produce a structured lead summary (contact info +
 *    context) from the conversation
 * 2. Creates a real CRM Lead in Bitrix24 (crm.lead.add) — not just a chat
 *    notification — so it's trackable/assignable to a specialist
 * 3. Optionally logs to Supabase if configured (best-effort, non-blocking —
 *    same pattern as start.js/end.js; the escalation still works fully
 *    even if Supabase isn't set up)
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_KEY;

// REQUIRED — no hardcoded fallback. The previous version of this file had a
// real, working webhook URL hardcoded as a "fallback" (leftover from a
// different client's Bitrix24 account, copied over from the mosaic-tile
// project this repo was templated from). That's dangerous: if this env var
// were ever unset, leads would silently go to the WRONG COMPANY's Bitrix24
// instead of failing loudly. Removed entirely — this must be set in
// Vercel's environment variables once the client provides their own
// Bitrix24 webhook (incoming webhook from Настройки → Разработчикам →
// Другое → Входящий вебхук, with crm scope enabled).
const BITRIX_WEBHOOK = process.env.BITRIX24_WEBHOOK_URL;

const { sendPushToAll } = require('../_lib/push');

// Ask Claude for a machine-parseable header (PHONE/EMAIL/REASON) followed
// by a short freeform summary, so we can reliably split contact info out
// for the CRM lead's structured fields rather than regex-guessing it out
// of freeform Russian text.
const SUMMARY_PROMPT = `Ты — ассистент отдела продаж. На основе диалога ниже составь структурированную сводку для менеджера по продаже автозапчастей.

ФОРМАТ ОТВЕТА (строго придерживайся, каждое поле на новой строке):
PHONE: [телефон клиента, если указан в диалоге, иначе "не указан"]
EMAIL: [email клиента, если указан в диалоге, иначе "не указан"]
NAME: [имя клиента, если указано, иначе "не указано"]
REASON: [одно из: "запрос менеджера" / "нет данных о совместимости" / "товар не найден" / "другое"]
CAR: [марка, модель, год, если упоминались, иначе "не указано"]
PART: [какая запчасть/артикул интересует клиента, если упоминалось, иначе "не указано"]
SUMMARY: [краткое описание ситуации и что нужно клиенту, макс. 3 предложения]

Диалог:
`;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function generateSummary(messages) {
  if (!ANTHROPIC_API_KEY) {
    return { raw: 'API key not configured — summary unavailable.', fields: {} };
  }

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
      max_tokens: 400,
      messages: [
        { role: 'user', content: SUMMARY_PROMPT + transcript }
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    return { raw: 'Summary generation failed.', fields: {} };
  }

  const data = await response.json();
  // Find by TYPE, not array position -- same latent bug as chat.js: a
  // thinking block (if this model ever gets adaptive thinking enabled)
  // would occupy position 0 and silently break this with an empty summary.
  const textBlock = (data.content || []).find(block => block.type === 'text');
  const raw = textBlock?.text?.trim() ?? 'No summary.';

  // Parse the structured header fields out of Claude's response. Falls
  // back gracefully to empty values if the format drifts slightly — this
  // is best-effort extraction, not something that should ever throw.
  const fields = {};
  for (const line of raw.split('\n')) {
    const match = line.match(/^(PHONE|EMAIL|NAME|REASON|CAR|PART|SUMMARY):\s*(.*)$/);
    if (match) fields[match[1].toLowerCase()] = match[2].trim();
  }

  return { raw, fields };
}

async function saveToSupabase(sessionId, raw) {
  // Best-effort only. If Supabase isn't configured for this project, this
  // silently does nothing — the escalation/lead-creation flow below does
  // NOT depend on this succeeding.
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
        summary:           raw,
      }),
    }
  ).catch(e => console.error('Supabase manager update error:', e));
}

const REASON_LABELS = {
  'запрос менеджера':              'Запрос на связь с менеджером',
  'нет данных о совместимости':    'Нет данных о совместимости детали',
  'товар не найден':               'Товар не найден в каталоге',
  'другое':                        'Обращение из ИИ-чата',
};

async function createBitrixLead(sessionId, fields, raw) {
  if (!BITRIX_WEBHOOK) {
    console.error('BITRIX24_WEBHOOK_URL not configured — cannot create lead.');
    return { ok: false, error: 'bitrix_not_configured' };
  }

  const webhookBase = BITRIX_WEBHOOK.replace(/\/?$/, '/');
  const reasonLabel = REASON_LABELS[fields.reason] || 'Обращение из ИИ-чата';

  const title = `${reasonLabel}${fields.car && fields.car !== 'не указано' ? ' — ' + fields.car : ''}`;

  const comments = [
    fields.part && fields.part !== 'не указано' ? `Запчасть: ${fields.part}` : null,
    fields.car && fields.car !== 'не указано' ? `Автомобиль: ${fields.car}` : null,
    fields.summary ? `Сводка: ${fields.summary}` : null,
    `Сессия чата: ${sessionId}`,
  ].filter(Boolean).join('\n');

  const leadFields = {
    TITLE: title,
    NAME: fields.name && fields.name !== 'не указано' ? fields.name : 'Клиент из чата',
    COMMENTS: comments,
    SOURCE_ID: 'WEBFORM', // "CRM form" — closest built-in source for a chat-widget lead
    ...(fields.phone && fields.phone !== 'не указан'
      ? { PHONE: [{ VALUE: fields.phone, VALUE_TYPE: 'WORK' }] }
      : {}),
    ...(fields.email && fields.email !== 'не указан'
      ? { EMAIL: [{ VALUE: fields.email, VALUE_TYPE: 'WORK' }] }
      : {}),
  };

  const url = `${webhookBase}crm.lead.add.json`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: leadFields }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (data.error) {
      console.error('Bitrix24 lead creation error:', data.error_description || data.error);
      return { ok: false, error: data.error_description || data.error };
    }
    return { ok: true, leadId: data.result };
  } catch (err) {
    console.error('Bitrix24 webhook request failed:', err);
    return { ok: false, error: err.message };
  }
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

    const { raw, fields } = await generateSummary(messages);

    const [leadResult] = await Promise.allSettled([
      createBitrixLead(session_id, fields, raw),
      saveToSupabase(session_id, raw),
    ]);

    const bitrixOutcome = leadResult.status === 'fulfilled' ? leadResult.value : { ok: false, error: 'unexpected_failure' };

    // Awaited deliberately -- on Vercel serverless (unlike a long-running
    // Node process), the execution environment can be frozen/terminated
    // the instant res.json() is sent. A genuine "fire and forget" call
    // here would silently never complete on some fraction of invocations,
    // with no error ever logged (the process is killed mid-flight, not
    // failing). Wrapped in try/catch so a push failure still can't fail
    // the escalation response itself -- same intent as before, just made
    // to actually run to completion first.
    const reasonLabel = REASON_LABELS[fields.reason] || 'Обращение из ИИ-чата';
    try {
      await sendPushToAll({
        title: '🚨 Новый лид',
        body:  `${reasonLabel}${fields.car && fields.car !== 'не указано' ? ' — ' + fields.car : ''}`,
        url:   '/dashboard',
        tag:   'lead-alert',
      });
    } catch (e) {
      console.error('sendPushToAll error:', e);
    }

    return res.status(200).json({
      ok: bitrixOutcome.ok,
      leadId: bitrixOutcome.leadId ?? null,
      error: bitrixOutcome.error ?? null,
      summary: raw,
    });

  } catch (err) {
    console.error('session/manager error:', err);
    return res.status(500).json({ error: err.message });
  }
};
