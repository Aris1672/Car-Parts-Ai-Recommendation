#!/usr/bin/env node
/**
 * Quick check that the LLM key, URL and model work, using the same env vars as the app.
 *
 *   node scripts/check-llm.js
 *
 * Sends one tiny request and prints OK or the exact error. Run it on the server
 * (Coolify terminal) after changing LLM_API_KEY, LLM_BASE_URL or LLM_MODEL.
 */
const BASE = process.env.LLM_BASE_URL || 'https://api.deepseek.com/anthropic';
const KEY = process.env.LLM_API_KEY;
const MODEL = process.env.LLM_MODEL || 'deepseek-v4-pro';

async function main() {
  if (!KEY) { console.error('LLM_API_KEY is not set'); process.exit(1); }
  console.log(`Base URL: ${BASE}\nModel:    ${MODEL}`);
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: 'user', content: 'Ответь одним словом: какой марки автомобиль BMW X5?' }] }),
      signal: AbortSignal.timeout(60000),
    });
    const body = await res.text();
    if (!res.ok) { console.log(`FAIL HTTP ${res.status} ${body.slice(0, 400)}`); process.exit(1); }
    const data = JSON.parse(body);
    const text = ((data.content || []).find(b => b.type === 'text') || {}).text || '';
    console.log(`OK in ${Date.now() - started} ms, served by "${data.model}": ${text.trim().slice(0, 60)}`);
  } catch (err) {
    console.log(`FAIL ${err.message}`);
    process.exit(1);
  }
}
main();
