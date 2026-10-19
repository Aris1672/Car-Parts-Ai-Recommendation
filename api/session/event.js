/**
 * api/session/event.js — records what happened in a chat for the dashboard's
 * "Подбор" tab (see lib/chatEvents.js): the customer's first message, the
 * product cards shown, and cards opened. Called by the widget, also via
 * navigator.sendBeacon when a card's "Подробнее →" link is clicked.
 *
 * Public endpoint (the widget runs on the client's site), so input is
 * validated strictly and rate-limited per IP. Never fails the widget:
 * logging problems return 200/204 with nothing to retry.
 */

const { validateEvent, insertEvent } = require('../../lib/chatEvents');

// Simple in-memory limiter: a real chat produces a handful of events.
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 60;
const hits = new Map(); // ip -> [timestamps]

function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear(); // keep memory bounded
  return list.length > MAX_PER_WINDOW;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  if (limited(ip)) return res.status(429).json({ error: 'too many events' });

  const ev = validateEvent(req.body);
  if (!ev) return res.status(400).json({ error: 'invalid event' });

  try {
    await insertEvent(ev);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('session/event insert error:', err.message);
    return res.status(200).json({ ok: false }); // never break the chat over analytics
  }
};
