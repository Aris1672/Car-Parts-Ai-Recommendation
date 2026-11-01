/**
 * lib/progress.js — live "what the agent is doing" lines for the chat widget.
 *
 * While /api/chat works on a message (reading it, finding the car in the
 * original catalog, opening catalog groups, checking prices, writing the
 * answer), each real step calls `progress.step('…')`. The widget shows these
 * lines in the typing bubble instead of timed placeholder text.
 *
 * The emitter is carried by AsyncLocalStorage, so deep code (lib/laximo.js)
 * can report a step without passing a callback through every function. With
 * no listener (old widget, scripts, tests) `step()` does nothing.
 *
 * Transport (api/chat.js, `startStream`): when the widget sends
 * `stream: true`, the response is NDJSON — one JSON object per line:
 *   {"step":"Ищу автомобиль по VIN в оригинальном каталоге…"}
 *   …
 *   {"done":true,"status":200,"body":{ …the usual reply JSON… }}
 */

const { AsyncLocalStorage } = require('async_hooks');

const store = new AsyncLocalStorage();

/** Run fn with `emit(text)` as the step listener for everything it awaits. */
function run(emit, fn) {
  return store.run({ emit, last: null }, fn);
}

/** Report a step the customer can see. Repeats of the same text are skipped. */
function step(text) {
  const ctx = store.getStore();
  if (!ctx || !text) return;
  const t = String(text).replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!t || t === ctx.last) return;
  ctx.last = t;
  try { ctx.emit(t); } catch (_) { /* a closed connection must never break the work */ }
}

/** «…» around a catalog name, shortened for the bubble. */
function quote(s, max = 60) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return `«${t.length > max ? t.slice(0, max - 1) + '…' : t}»`;
}

module.exports = { run, step, quote };
