/**
 * lib/msk.js — Moscow time for the dashboard.
 *
 * chat_sessions stores `date` / `time` in UTC (api/session/start.js); the
 * shop works in Moscow time (UTC+3 all year, no daylight saving since 2014),
 * so the dashboard shows and filters everything in Moscow time.
 */

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** UTC instant -> { date: 'YYYY-MM-DD', time: 'HH:MM:SS' } in Moscow time. */
function toMsk(instant) {
  const ms = instant instanceof Date ? instant.getTime() : Date.parse(instant);
  if (!Number.isFinite(ms)) return null;
  const iso = new Date(ms + MSK_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
}

/** A chat_sessions row's UTC date + time (or created_at) -> Moscow { date, time }. */
function sessionMsk(date, time, createdAt) {
  const d = date instanceof Date ? date.toISOString().slice(0, 10) : (date ? String(date).slice(0, 10) : null);
  if (d && time) {
    const m = toMsk(`${d}T${String(time).slice(0, 8)}Z`);
    if (m) return m;
  }
  if (createdAt) {
    const m = toMsk(createdAt);
    if (m) return m;
  }
  return { date: d, time: time ? String(time) : null };
}

/** Moscow day 'YYYY-MM-DD' -> its UTC start / end as ISO strings (for a date filter). */
function mskDayStartUtc(day) { return new Date(Date.parse(`${day}T00:00:00Z`) - MSK_OFFSET_MS).toISOString(); }
function mskDayEndUtc(day)   { return new Date(Date.parse(`${day}T00:00:00Z`) - MSK_OFFSET_MS + 24 * 60 * 60 * 1000).toISOString(); }

module.exports = { toMsk, sessionMsk, mskDayStartUtc, mskDayEndUtc };
