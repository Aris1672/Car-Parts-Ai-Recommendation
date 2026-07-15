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
 *   { action: 'set_fitment', id, fitment }       -> replaces a product's vehicle-fitment list
 *
 * Vehicle fitment: most manual_products (oils, fluids) are matched purely
 * by manufacturer approval code (see chat.js matchOilByApproval) --
 * brand/model-agnostic, which is correct for how oil compatibility
 * actually works. But some manual_products are physical parts (e.g. a
 * shock absorber) that only fit specific car models -- for those, the
 * dashboard lets the client attach one or more fitment entries (brand,
 * series/chassis, modification, year range, region, steering side, body
 * type). A product with a non-empty `fitment` array is ONLY recommended
 * when the customer's vehicle matches one of those entries (see chat.js
 * matchManualProductsByVehicle) -- a product with an empty/absent
 * `fitment` array keeps today's behavior (approval-code-only, or fully
 * unrestricted if it has neither).
 *
 * Auth: same password pattern as sessions.js (DASHBOARD_ADMIN_PASSWORD /
 * DASHBOARD_CLIENT_PASSWORD). Both 'add' and 'delete' are available to
 * admin and client roles -- the client fully manages their own product
 * catalog.
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
  // More robust than a strict inline regex: some categories (e.g. batteries)
  // apparently wrap the number in extra tags (a <span>, etc.) between the
  // "Цена" label and the "₽" sign, which broke the original strict
  // digits-and-spaces-only pattern. This instead locates the "Цена" label,
  // takes a text window after it, strips any tags within that window, and
  // then pulls the number out of the resulting plain text -- tolerant of
  // markup differences between product categories.
  const idx = html.indexOf('>Цена<');
  if (idx === -1) return null;

  const window = html.slice(idx, idx + 300);
  const plain  = stripTags(window); // tags removed, whitespace collapsed

  // Number can include regular spaces, non-breaking spaces, or narrow
  // no-break spaces as thousands separators (all normalized by stripTags's
  // \s+ collapse already, but kept tolerant here just in case).
  const match = plain.match(/Цена\s*([\d\s.,]+)\s*₽/);
  if (!match) return null;
  return match[1].replace(/\s+/g, ' ').trim() + ' ₽';
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

function extractDescription(html) {
  // The free-text technical/marketing description block -- distinct from
  // the structured "Характеристики" spec table. Often explains use-case
  // details the spec table doesn't (engine generation compatibility, DPF
  // suitability, technology notes) -- useful extra context for the agent
  // beyond the raw viscosity/ACEA/approval fields.
  const match = html.match(/<div class="goodsInfoModelDescr">([\s\S]*?)<\/div>/);
  return match ? stripTags(match[1]).trim() : null;
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
      // Both admin and client roles can add products.

      const { category, url, html: pastedHtml, manualPrice, fitment } = req.body || {};
      if (!category || !url) {
        return res.status(400).json({ error: 'category and url are required' });
      }

      let name = null, image = null, price = null, description = null, specs = {}, crawlError = null;

      if (pastedHtml && pastedHtml.trim().length > 0) {
        // Primary path: admin pasted the page's HTML directly (View Source
        // on the actual product page). This exists because Vercel's
        // outbound connections to bmwclub77.ru time out at the TCP level
        // (UND_ERR_CONNECT_TIMEOUT) -- confirmed via diagnostic logging,
        // consistent with many RU-hosted sites filtering foreign
        // datacenter IP ranges regardless of request headers. A real
        // browser (which is what generates this pasted HTML) doesn't hit
        // that wall, so this sidesteps the problem entirely rather than
        // trying to work around network-level filtering.
        try {
          name  = extractName(pastedHtml);
          image = extractImage(pastedHtml, url);
          price = extractPrice(pastedHtml);
          specs = extractSpecs(pastedHtml);
          description = extractDescription(pastedHtml);
          if (Object.keys(specs).length === 0) {
            crawlError = 'Специфи­кации не найдены в предоставленном HTML — проверьте, что скопирована вся страница (Ctrl+A после Ctrl+U)';
          }
        } catch (err) {
          crawlError = `Ошибка обработки HTML: ${err.message}`;
        }
      } else {
        // Fallback: attempt a live server-side fetch. Expected to fail in
        // the current network setup (see above) -- kept in case this
        // changes later (e.g. after moving to a custom domain / different
        // hosting setup), so the feature degrades to "paste HTML" rather
        // than being removed outright.
        try {
          const fetchedHtml = await fetchHtml(url);
          console.log(JSON.stringify({
            diag: 'crawl-fetch-check',
            url,
            htmlLength: fetchedHtml.length,
            htmlSnippetStart: fetchedHtml.slice(0, 300),
            hasCharacteristicsListRow: fetchedHtml.includes('characteristicsListRow'),
          }));
          name  = extractName(fetchedHtml);
          image = extractImage(fetchedHtml, url);
          price = extractPrice(fetchedHtml);
          specs = extractSpecs(fetchedHtml);
          description = extractDescription(fetchedHtml);
          if (Object.keys(specs).length === 0) {
            crawlError = 'Специфи­кации не найдены — возможно, потребуется вставить HTML страницы вручную';
          }
        } catch (err) {
          const causeInfo = err.cause ? `${err.cause.code || ''} ${err.cause.message || err.cause}`.trim() : null;
          console.log(JSON.stringify({
            diag: 'crawl-fetch-error',
            url,
            errorMessage: err.message,
            errorCause: causeInfo,
          }));
          crawlError = `Не удалось загрузить страницу автоматически (${err.message}${causeInfo ? `, ${causeInfo}` : ''}) — вставьте HTML страницы вручную`;
        }
      }

      // Manual price always wins over extraction, if provided. Price is
      // loaded via a separate AJAX call on the live site (after the page
      // has already rendered), so it's genuinely absent from a plain
      // "View Source" (Ctrl+U) copy -- rather than requiring the client to
      // use DevTools' Elements panel (Copy outerHTML) to capture the
      // post-AJAX DOM, it's simpler and more reliable for them to just
      // type the price in directly from what they see on the page.
      if (manualPrice && manualPrice.trim().length > 0) {
        const trimmed = manualPrice.trim();
        price = trimmed.includes('₽') ? trimmed : `${trimmed} ₽`;
        // A manually-supplied price means this product is usable even if
        // the pasted HTML had no specs -- don't let an unrelated crawl
        // warning obscure that price is fine.
      }

      const sbRes = await supabaseFetch('manual_products?on_conflict=url', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          category, url, name, image, price, description, specs,
          crawl_error: crawlError,
          fitment: Array.isArray(fitment) ? fitment : [],
          updated_at: new Date().toISOString(),
        }),
      });

      if (!sbRes.ok) {
        return res.status(502).json({ error: 'DB error', detail: await sbRes.text() });
      }
      const [product] = await sbRes.json();
      return res.status(200).json({ success: true, product });
    }

    if (action === 'set_fitment') {
      // Both admin and client roles can manage fitment, same as add/delete.
      const { id, fitment } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required' });
      if (!Array.isArray(fitment)) {
        return res.status(400).json({ error: 'fitment must be an array' });
      }

      const sbRes = await supabaseFetch(`manual_products?id=eq.${id}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({ fitment, updated_at: new Date().toISOString() }),
      });
      if (!sbRes.ok) return res.status(502).json({ error: 'DB error', detail: await sbRes.text() });
      const [product] = await sbRes.json();
      return res.status(200).json({ success: true, product });
    }

    if (action === 'delete') {
      // Both admin and client roles can delete products.
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
