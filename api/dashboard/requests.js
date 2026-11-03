/**
 * api/dashboard/requests.js — the dashboard's «Заявки» tab: requests the
 * customers sent from the widget's form (name, phone/email, message).
 * Source: manager_requests (lib/managerRequests.js), in our own database.
 *
 * POST { password, days }                      -> { success, requests, stats }
 * POST { password, action: 'status', id, status: 'new' | 'done' } -> { success }
 * Auth: the same passwords as the other dashboard endpoints.
 */

const { listRequests, setStatus } = require('../../lib/managerRequests');

const ADMIN_PASSWORD  = process.env.DASHBOARD_ADMIN_PASSWORD;
const CLIENT_PASSWORD = process.env.DASHBOARD_CLIENT_PASSWORD;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, days, action, id, status } = req.body || {};
  let role = null;
  if (ADMIN_PASSWORD  && password === ADMIN_PASSWORD)  role = 'admin';
  if (CLIENT_PASSWORD && password === CLIENT_PASSWORD) role = 'client';
  if (!role) return res.status(401).json({ error: 'Invalid password' });

  try {
    if (action === 'status') {
      const n = parseInt(id, 10);
      if (!n || !['new', 'done'].includes(status)) return res.status(400).json({ error: 'id and status required' });
      await setStatus(n, status);
      return res.status(200).json({ success: true });
    }

    const period = Math.min(365, Math.max(1, parseInt(days, 10) || 30));
    let requests = await listRequests(period);
    if (role === 'client') requests = requests.map(r => ({ ...r, session_id: undefined }));
    return res.status(200).json({
      success: true,
      role,
      days: period,
      stats: {
        total: requests.length,
        open: requests.filter(r => r.status !== 'done').length,
      },
      requests,
    });
  } catch (err) {
    console.error('Dashboard requests error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
