/**
 * api/dashboard/product-views.js — data for the dashboard's "Подбор" tab:
 * per chat session, the customer's first message, the product cards the
 * agent showed, and which cards the customer opened. Source: chat_events
 * (lib/chatEvents.js), filled by the widget via api/session/event.js.
 *
 * POST { password, days }  (days: 1..365, default 30)
 * Auth: same passwords as the other dashboard endpoints. The client role
 * gets the same data without session IDs (same as sessions.js).
 */

const { listSessions } = require('../../lib/chatEvents');

const ADMIN_PASSWORD  = process.env.DASHBOARD_ADMIN_PASSWORD;
const CLIENT_PASSWORD = process.env.DASHBOARD_CLIENT_PASSWORD;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, days } = req.body || {};
  let role = null;
  if (ADMIN_PASSWORD  && password === ADMIN_PASSWORD)  role = 'admin';
  if (CLIENT_PASSWORD && password === CLIENT_PASSWORD) role = 'client';
  if (!role) return res.status(401).json({ error: 'Invalid password' });

  const period = Math.min(365, Math.max(1, parseInt(days, 10) || 30));

  try {
    let sessions = await listSessions(period);

    // Totals for the KPI cards
    const withCards   = sessions.filter(s => s.shown.length > 0);
    const cardsShown  = sessions.reduce((n, s) => n + s.shown.filter(p => p.times > 0).length, 0);
    const cardsOpened = sessions.reduce((n, s) => n + s.opened.length, 0);
    // Rate: of the cards actually logged as shown, how many were opened.
    // (Opens without a logged "shown" -- e.g. an older cached widget -- still
    // count in cardsOpened, but not in the rate.)
    const shownAndOpened = sessions.reduce((n, s) => n + s.shown.filter(p => p.times > 0 && p.opened).length, 0);
    const sessionsOpened = sessions.filter(s => s.opened.length > 0).length;

    // Most opened products across all sessions
    const top = new Map();
    for (const s of sessions) for (const o of s.opened) {
      const t = top.get(o.article) || { article: o.article, name: o.name, opens: 0 };
      t.opens += o.times;
      top.set(o.article, t);
    }
    const topOpened = [...top.values()].sort((a, b) => b.opens - a.opens).slice(0, 10);

    if (role === 'client') sessions = sessions.map(s => ({ ...s, session_id: undefined }));

    return res.status(200).json({
      success: true,
      role,
      days: period,
      stats: {
        sessions: sessions.length,
        sessionsWithCards: withCards.length,
        cardsShown,
        cardsOpened,
        sessionsOpened,
        openRatePct: cardsShown ? Math.round((shownAndOpened / cardsShown) * 100) : 0,
      },
      topOpened,
      sessions,
    });
  } catch (err) {
    console.error('Dashboard product-views error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
