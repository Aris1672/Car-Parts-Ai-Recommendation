/**
 * api/dashboard/products.js — Vercel Serverless Function
 *
 * Manages the client-curated "manual_products" table (oils, brake fluid,
 * coolant, etc. -- categories that don't have vehicle-fitment data on
 * ABCP's platform, see README's "Compatibility matching architecture"
 * section). The client pastes a product URL from their own site; this
 * endpoint fetches that page and extracts name/image/specs automatically,
 * rather than anyone typing specs in by hand.
 *
 * Actions (all POST, same endpoint):
 *   { action: 'list' }                          -> returns all products
 *   { action: 'add', category, url }             -> crawls url, stores it
 *   { action: 'delete', id }                     -> removes a product
 *
 * Auth: same password pattern as sessions.js (DASHBOARD_ADMIN_PASSWORD /
 * DASHBOARD_CLIENT_PASSWORD). 'add' and 'delete' are admin-only -- the
 * client role can list/view but not modify, matching the spirit of the
 * client role being read-only in sessions.js (session_id stripped there).
 *
 * Extraction selectors (extractName, extractImage, extractPrice,
 * extractSpecs) were verified against real bmwclub77.ru product page HTML
 * (ABCP platform), not guessed from screenshots. If ABCP changes their
 * page template, these may need updating -- crawl_error on a product row
 * flags when specs come back empty so this is easy to spot.
 */

const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PASSWORD = process.env.DASHBOARD_ADMIN_PASSWORD;
const CLIENT_PASSWORD= process.env.DASHBOARD_CLIENT_PASSWORD;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function authenticate(password) {
  if (ADMIN_PASSWORD  && password === ADMIN_PASSWORD)  return 'admin';
  if (CLIENT_PASSWORD && password === CLIENT_PASSWORD) return 'client';
  return null;
}

async function supabaseFetch(path, options = {}) {
  const url = `${SUPABASE_URL.replace(/\/?$/, '/')}rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      ...(options.headers || {}),
    },
  });
  return res;
}

// ── Page fetch ────────────────────────────────────────────────────────────
async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      // Identify as a normal browser -- same-origin scrape of the client's
      // own site, but some server configs still block empty/unusual UAs.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  return res.text();
}

// ── Extraction ────────────────────────────────────────────────────────────
// Selectors below are verified against real bmwclub77.ru (ABCP platform)
// product page markup -- not a guess. Applicability ("Применимость") data
// is NOT included here on purpose: for oils/fluids it's simply absent
// ("Нет информации о применимости"), and for parts pages in general it's
// loaded via a separate AJAX chain after interactive brand/model selection
// (article/getBrandsApplicability -> getModelsApplicability ->
// getModificationsApplicability), not present in the initial page HTML --
// which is exactly why the vehicle-fitment crawler uses the reverse
// (car -> parts, getAdaptability) direction instead. Not needed here since
// this manual-products flow doesn't attempt vehicle matching at all.

function extractName(html) {
  const brandMatch  = html.match(/<span class="article-brand[^"]*">([\s\S]*?)<\/span>/);
  const numberMatch = html.match(/<span class="article-number">([\s\S]*?)<\/span>/);
  const descrMatch  = html.match(/<div class="goodsInfoDescr">([\s\S]*?)<a[^>]*class="goodsInfoEditIcon"|<div class="goodsInfoDescr">([\s\S]*?)<\/div>/);

  const brand  = brandMatch  ? stripTags(brandMatch[1]).trim()  : '';
  const number = numberMatch ? stripTags(numberMatch[1]).trim() : '';
  const descr  = descrMatch  ? stripTags(descrMatch[1] || descrMatch[2]).trim() : '';

  if (descr) return `${brand} ${number} — ${descr}`.trim();
  if (brand || number) return `${brand} ${number}`.trim();

  // Fallback: <title> tag, if the structure above ever changes
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch ? stripTags(titleMatch[1]).trim() : null;
}

function extractImage(html, pageUrl) {
  // First image inside the articleImages/article-image block -- the <a>'s
  // href points to the full-size image (same file the <img> src also
  // points to on this platform), which is what we want to store.
  const linkMatch = html.match(/class="article-image">\s*<a[^>]+href="([^"]+)"/);
  if (linkMatch) return absolutize(linkMatch[1], pageUrl);

  const imgMatch = html.match(/class="articleImages">[\s\S]{0,300}?<img[^>]+src="([^"]+)"/);
  if (imgMatch) return absolutize(imgMatch[1], pageUrl);

  return null;
}

function extractPrice(html) {
  // "Цена" label followed by the amount + ₽, inside distrInfoPrice block.
  // Note: price is often absent from the raw page for logged-out/no-profile
  // requests (ABCP shows "Посмотреть другие предложения" instead) -- null
  // is an expected, normal outcome here, not a parsing failure.
  const match = html.match(/Цена<\/div>\s*([\d\s\u00A0]+)\s*₽/);
  if (!match) return null;
  return match[1].replace(/[\s\u00A0]+/g, ' ').trim() + ' ₽';
}

function extractSpecs(html) {
  const specs = {};
  const rowMatches = [...html.matchAll(
    /<div class="characteristicsListRow">\s*<span class="property">([^<]+?):?\s*<\/span>\s*<span>([\s\S]*?)<\/span>\s*<\/div>/g
  )];
  for (const m of rowMatches) {
    const key = stripTags(m[1]).trim();
    const val = stripTags(m[2]).trim();
    if (key && val) specs[key] = val;
  }
  return specs;
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function absolutize(src, pageUrl) {
  try {
    return new URL(src, pageUrl).toString();
  } catch {
    return src;
  }
}

// ── Handler ───────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, action } = req.body || {};
  const role = authenticate(password);
  if (!role) return res.status(401).json({ error: 'Invalid password' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    if (action === 'list') {
      const sbRes = await supabaseFetch('manual_products?select=*&order=created_at.desc');
      if (!sbRes.ok) return res.status(502).json({ error: 'DB error', detail: await sbRes.text() });
      const products = await sbRes.json();
      return res.status(200).json({ success: true, products });
    }

    if (action === 'add') {
      if (role !== 'admin') return res.status(403).json({ error: 'Admin only' });

      const { category, url } = req.body || {};
      if (!category || !url) {
        return res.status(400).json({ error: 'category and url are required' });
      }

      let name = null, image = null, price = null, specs = {}, crawlError = null;
      try {
        const html = await fetchHtml(url);

        // TEMPORARY DIAGNOSTIC LOGGING -- the same extraction logic tests
        // correctly against real page HTML (verified manually), but came
        // back empty when actually crawled live. This logs exactly what
        // the server-side fetch received (length + a snippet + whether key
        // markers are present at all) so we can tell apart: a genuinely
        // different page (bot-block/challenge page), a truncated response,
        // or something else -- rather than guessing further. Check Vercel
        // logs after a crawl attempt.
        console.log(JSON.stringify({
          diag: 'crawl-fetch-check',
          url,
          htmlLength: html.length,
          htmlSnippetStart: html.slice(0, 300),
          hasCharacteristicsListRow: html.includes('characteristicsListRow'),
          hasArticleBrand: html.includes('article-brand'),
          hasGoodsInfoDescr: html.includes('goodsInfoDescr'),
        }));

        name  = extractName(html);
        image = extractImage(html, url);
        price = extractPrice(html);
        specs = extractSpecs(html);
        if (Object.keys(specs).length === 0) {
          crawlError = 'Специфи­кации не найдены — возможно, потребуется уточнить структуру страницы';
        }
      } catch (err) {
        // "fetch failed" alone is a generic wrapper -- Node's fetch (undici)
        // usually attaches a more specific `cause` (DNS failure, connection
        // refused, TLS error, timeout, etc.) that doesn't show up unless
        // explicitly logged. This was previously silent on failure (no log
        // at all), which is why Vercel's logs were empty despite the crawl
        // actually failing.
        const causeInfo = err.cause ? `${err.cause.code || ''} ${err.cause.message || err.cause}`.trim() : null;
        console.log(JSON.stringify({
          diag: 'crawl-fetch-error',
          url,
          errorMessage: err.message,
          errorCause: causeInfo,
          errorName: err.name,
        }));
        crawlError = `Не удалось загрузить страницу: ${err.message}${causeInfo ? ` (${causeInfo})` : ''}`;
      }

      const sbRes = await supabaseFetch('manual_products?on_conflict=url', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          category, url, name, image, price, specs,
          crawl_error: crawlError,
          updated_at: new Date().toISOString(),
        }),
      });

      if (!sbRes.ok) {
        return res.status(502).json({ error: 'DB error', detail: await sbRes.text() });
      }
      const [product] = await sbRes.json();
      return res.status(200).json({ success: true, product });
    }

    if (action === 'delete') {
      if (role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required' });

      const sbRes = await supabaseFetch(`manual_products?id=eq.${id}`, { method: 'DELETE' });
      if (!sbRes.ok) return res.status(502).json({ error: 'DB error', detail: await sbRes.text() });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Dashboard products error:', err);
    return res.status(500).json({ error: err.message });
  }
};
