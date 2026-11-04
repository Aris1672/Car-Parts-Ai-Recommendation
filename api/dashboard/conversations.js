/**
 * api/dashboard/conversations.js — ADMIN ONLY «Диалоги» tab: every chat message,
 * the bot's reply and what the code did (lib/chatTurns.js). The client password
 * gets 403: this tab is for the owner's quality review, not for the shop.
 *
 * POST { password, days, filter }                       -> { success, conversations }
 *      filter: all | problems | unreviewed | bad | good
 * POST { password, action: 'review', id, review: 'ok'|'bad'|null, note } -> { success }
 */

const turns = require('../../lib/chatTurns');

const ADMIN_PASSWORD = process.env.DASHBOARD_ADMIN_PASSWORD;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, days, filter, action, id, review, note } = req.body || {};
  if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Admin only' });
  if (!turns.enabled()) return res.status(200).json({ success: true, conversations: [], disabled: true });

  try {
    if (action === 'review') {
      const n = parseInt(id, 10);
      if (!n) return res.status(400).json({ error: 'id required' });
      await turns.setReview(n, review, note);
      return res.status(200).json({ success: true });
    }
    const period = Math.min(90, Math.max(1, parseInt(days, 10) || 7));
    const f = ['all', 'problems', 'unreviewed', 'bad', 'good'].includes(filter) ? filter : 'all';
    const conversations = await turns.listConversations({ days: period, filter: f });
    return res.status(200).json({ success: true, days: period, conversations });
  } catch (err) {
    console.error('Dashboard conversations error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
