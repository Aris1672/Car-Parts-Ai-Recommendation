/**
 * lib/reviewsExport.js — «Передать Claude» in the admin «Диалоги» tab (04.11):
 * the reviewed conversations (✓ / ✗ with the owner's notes) are written as one
 * JSON file to the PRIVATE code repo, on a separate branch that holds only
 * these files (never merged into main, so customer chats stay out of the code
 * history and out of deploys):
 *   <GITHUB_REVIEWS_REPO>@<GITHUB_REVIEWS_BRANCH>:reviews/<YYYY-MM-DD_HHMM>.json
 * Claude reads them in a session (`git fetch origin bot-reviews`), fixes the
 * code and records what is fixed in reviews/STATUS.md on the same branch.
 *
 * Env (Coolify only):
 *   GITHUB_REVIEWS_TOKEN   fine-grained token, this repo only, Contents: read & write
 *   GITHUB_REVIEWS_REPO    default Aris1672/Car-Parts-Ai-Recommendation
 *   GITHUB_REVIEWS_BRANCH  default bot-reviews (created on first use, no history)
 */

const TOKEN = () => process.env.GITHUB_REVIEWS_TOKEN || '';
const REPO = () => process.env.GITHUB_REVIEWS_REPO || 'Aris1672/Car-Parts-Ai-Recommendation';
const BRANCH = () => process.env.GITHUB_REVIEWS_BRANCH || 'bot-reviews';

function configured() { return !!TOKEN(); }

async function gh(method, path, body) {
  const res = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${REPO()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'bmwclub77-dashboard',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 200) }; }
  if (!res.ok) {
    const e = new Error(`GitHub ${method} ${path}: HTTP ${res.status} ${(data && data.message) || ''}`.trim());
    e.status = res.status;
    throw e;
  }
  return data;
}

/** Creates the branch as an orphan (no code in it) with a README, if missing. */
async function ensureBranch() {
  try {
    await gh('GET', `/git/ref/heads/${encodeURIComponent(BRANCH())}`);
    return;
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  const readme = '# Bot reviews\n\nConversations reviewed in the dashboard «Диалоги» (✓ / ✗ with notes), pushed by «Передать Claude».\nOnly these files live on this branch; never merge it into main.\nreviews/STATUS.md — what Claude has fixed.\n';
  const blob = await gh('POST', '/git/blobs', { content: readme, encoding: 'utf-8' });
  const tree = await gh('POST', '/git/trees', { tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blob.sha }] });
  const commit = await gh('POST', '/git/commits', { message: 'bot-reviews: start', tree: tree.sha, parents: [] });
  await gh('POST', '/git/refs', { ref: `refs/heads/${BRANCH()}`, sha: commit.sha });
}

/** Writes one file (new path each time). Returns { path, url }. */
async function pushFile(path, content, message) {
  await ensureBranch();
  const r = await gh('PUT', `/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
    message, branch: BRANCH(), content: Buffer.from(content, 'utf8').toString('base64'),
  });
  return { path, url: r && r.content && r.content.html_url };
}

/** Compact export of conversations (only what a review needs). */
function exportPayload(conversations, meta = {}) {
  return {
    exported_at: new Date().toISOString(),
    ...meta,
    conversations: conversations.map(c => ({
      conv_id: c.conv_id,
      session_id: c.session_id || null,
      started: c.started,
      flags: c.flags,
      turns: c.turns.map(t => ({
        id: t.id,
        at: t.created_at,
        customer: t.user_text,
        understood: t.understood || null,
        reply: t.reply,
        buttons: t.buttons || null,
        cards: t.cards || null,
        review: t.review || null,
        note: t.review_note || null,
        status: t.status,
        ms: t.ms,
        trace: t.trace || [],
      })),
    })),
  };
}

module.exports = { configured, pushFile, exportPayload, repo: REPO, branch: BRANCH };
