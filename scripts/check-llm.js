#!/usr/bin/env node
/**
 * Quick check that the LLM key, URL and models work, using the same env vars as the app.
 *
 *   node scripts/check-llm.js
 *
 * Sends one tiny request per configured model and prints OK / the exact error.
 * Run it on the server (Coolify terminal) after changing ANTHROPIC_BASE_URL,
 * ANTHROPIC_API_KEY or any *_MODEL variable.
 */
const BASE = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
const KEY = process.env.ANTHROPIC_API_KEY;

const models = {
  ANSWER_MODEL:      process.env.ANSWER_MODEL      || 'claude-sonnet-5',
  CLARIFY_MODEL:     process.env.CLARIFY_MODEL     || 'claude-sonnet-5',
  TRANSLATE_MODEL:   process.env.TRANSLATE_MODEL   || 'claude-sonnet-5',
  EXTRACT_MODEL:     process.env.EXTRACT_MODEL     || 'claude-sonnet-5',
  PART_FILTER_MODEL: process.env.PART_FILTER_MODEL || 'claude-sonnet-5',
  FALLBACK_MODEL:    process.env.FALLBACK_MODEL    || 'claude-haiku-4-5-20251001',
  MANAGER_MODEL:     process.env.MANAGER_MODEL     || 'claude-sonnet-5',
};

async function main() {
  if (!KEY) { console.error('ANTHROPIC_API_KEY is not set'); process.exit(1); }
  console.log(`Base URL: ${BASE}`);
  let failed = 0;
  for (const model of [...new Set(Object.values(models))]) {
    const vars = Object.entries(models).filter(([, m]) => m === model).map(([v]) => v).join(', ');
    const started = Date.now();
    try {
      const res = await fetch(`${BASE}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'user', content: 'Ответь одним словом: какой марки автомобиль BMW X5?' }] }),
        signal: AbortSignal.timeout(60000),
      });
      const body = await res.text();
      if (!res.ok) { failed++; console.log(`FAIL ${model} (${vars}): HTTP ${res.status} ${body.slice(0, 400)}`); continue; }
      const data = JSON.parse(body);
      const text = ((data.content || []).find(b => b.type === 'text') || {}).text || '';
      console.log(`OK   ${model} (${vars}) in ${Date.now() - started} ms, served by "${data.model}": ${text.trim().slice(0, 60)}`);
    } catch (err) {
      failed++;
      console.log(`FAIL ${model} (${vars}): ${err.message}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
main();
