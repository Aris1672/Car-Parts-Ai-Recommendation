/**
 * lib/logistics/suppliers.js — logistics agent, phase 2 preview (READ-ONLY):
 *   1. Supplier reliability from real order history: for every order position
 *      the watcher loads its ABCP status history once (and again only when the
 *      status changed) and stores when it was ordered, when it arrived, whether
 *      it was refused (table logistics_pos_history). Per supplier: positions,
 *      on-time share (arrived within the promised max days + 1 day), average
 *      real days, refusal share.
 *   2. Offers for one part (search/articles, all suppliers the profile sees,
 *      own number only) scored by price, delivery days and the supplier's
 *      reliability -> the offer the agent WOULD pick, with the reasons.
 * Nothing is ordered: phase 2 adds the «Подтвердить» button.
 */

const abcp = require('../abcpOrders');
const stages = require('./stages');
const { withDb, ensureTables } = require('./store');

const nameKey = s => String(s || '').toLowerCase().replace(/\[online\]/g, '').replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '');
// Trusted suppliers (owner 07.11: «БорисХофы — крупнейший дилер BMW в России»): counted as reliable
// even without the shop's own delivery history. Substring match, every branch included.
// LOGISTICS_TRUSTED_SUPPLIERS = comma list, replaces the default.
const trustedList = () => String(process.env.LOGISTICS_TRUSTED_SUPPLIERS || 'борисхоф').split(',').map(x => nameKey(x)).filter(Boolean);
const isTrusted = name => { const k = nameKey(name); return !!k && trustedList().some(t => k.includes(t)); };
const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const H = 3600 * 1000;

// ─── table ──────────────────────────────────────────────────────────────────
let ready = null;
function ensureHistoryTable() {
  if (!ready) {
    ready = ensureTables().then(() => withDb(c => c.query(`
      create table if not exists logistics_pos_history (
        position_id    text primary key,
        number         text not null,
        article        text,
        brand          text,
        supplier       text,
        supplier_id    text,
        order_date     timestamptz,
        promised_hours int,
        ordered_at     timestamptz,
        arrived_at     timestamptz,
        refused        boolean not null default false,
        status         text,
        status_date    text,
        history        jsonb,
        fetched_at     timestamptz not null default now()
      );
      create index if not exists idx_lph_supplier on logistics_pos_history (supplier);
    `))).catch(err => { ready = null; throw err; });
  }
  return ready;
}

// ─── pure: one position's history -> facts ─────────────────────────────────
/** history [{status, at}] (oldest first) -> { orderedAt, arrivedAt, refused } (ms). Exported for tests. */
function historyFacts(history, map) {
  let orderedAt = null, arrivedAt = null, refused = false;
  const sorted = [...(history || [])].sort((a, b) => (stages.ts(a.at) || 0) - (stages.ts(b.at) || 0));
  for (const e of sorted) {
    const st = stages.stageOfStatus(e.status, map);
    const t = stages.ts(e.at);
    if (!orderedAt && ['supplier', 'transit'].includes(st)) orderedAt = t;
    if (!arrivedAt && ['stock', 'shipped', 'done'].includes(st)) arrivedAt = t;
    if (st === 'problem' || (st === 'cancelled' && !/клиент/i.test(e.status))) refused = true; // «Отказ клиента» is not the supplier's fault
  }
  return { orderedAt, arrivedAt, refused };
}

/** Rows of logistics_pos_history -> per-supplier stats. Exported for tests. */
function reliability(rows, graceHours = 24) {
  const by = new Map();
  for (const r of rows) {
    const name = r.supplier || 'не указан';
    if (!by.has(name)) by.set(name, { supplier: name, supplierId: r.supplier_id || null, positions: 0, arrived: 0, onTime: 0, late: 0, refused: 0, days: [] });
    const s = by.get(name);
    s.positions++;
    if (r.refused) s.refused++;
    const start = r.ordered_at ? Date.parse(r.ordered_at) : r.order_date ? Date.parse(r.order_date) : null;
    const base = r.order_date ? Date.parse(r.order_date) : start;
    if (r.arrived_at && start && Date.parse(r.arrived_at) >= start - H) {
      s.arrived++;
      const arr = Date.parse(r.arrived_at);
      s.days.push((arr - start) / (24 * H));
      if (r.promised_hours && base) (arr <= base + (r.promised_hours + graceHours) * H ? s.onTime++ : s.late++);
    }
  }
  return [...by.values()].map(s => {
    const judged = s.onTime + s.late;
    const sorted = [...s.days].sort((a, b) => a - b);
    return {
      supplier: s.supplier, supplierId: s.supplierId, positions: s.positions, arrived: s.arrived,
      onTimeShare: judged ? s.onTime / judged : null, judged,
      refusedShare: s.positions ? s.refused / s.positions : 0,
      medianDays: sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10 : null,
    };
  }).sort((a, b) => b.positions - a.positions);
}

// ─── backfill from the watcher ─────────────────────────────────────────────
const PER_PASS = Number(process.env.LOGISTICS_HISTORY_PER_PASS) || 300; // 3 statusHistory calls

/** Called by the watcher after each pass: load history for new / changed positions. */
async function refreshHistory(described) {
  await ensureHistoryTable();
  const known = await withDb(async c => new Map((await c.query('select position_id, status_date from logistics_pos_history')).rows.map(r => [r.position_id, r.status_date])));
  const todo = [];
  for (const o of described) for (const p of o.positions) {
    if (!p.id) continue;
    const sd = String(p.statusDate || p.status || '');
    if (known.get(p.id) !== sd) todo.push({ o, p, sd });
  }
  const batch = todo.slice(0, PER_PASS);
  let saved = 0;
  for (let i = 0; i < batch.length; i += 100) {
    const part = batch.slice(i, i + 100);
    let map;
    try { map = abcp.parseHistory(await abcp.apiGet('cp/orders/statusHistory', { positionsId: part.map(x => x.p.id) })); }
    catch (err) { console.error('[logistics] history batch failed:', err.message); break; }
    await withDb(async c => {
      for (const { o, p, sd } of part) {
        const hist = map.get(p.id) || [];
        const f = historyFacts(hist);
        const iso = ms => (ms ? new Date(ms).toISOString() : null);
        await c.query(
          `insert into logistics_pos_history (position_id, number, article, brand, supplier, supplier_id, order_date, promised_hours, ordered_at, arrived_at, refused, status, status_date, history, fetched_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
           on conflict (position_id) do update set supplier = excluded.supplier, supplier_id = excluded.supplier_id, promised_hours = excluded.promised_hours,
             ordered_at = excluded.ordered_at, arrived_at = excluded.arrived_at, refused = excluded.refused, status = excluded.status,
             status_date = excluded.status_date, history = excluded.history, fetched_at = now()`,
          [p.id, o.number, p.number, p.brand, p.supplier, p.supplierId, iso(stages.ts(o.date)), p.deadlineMaxHours || p.deadlineHours || null,
           iso(f.orderedAt), iso(f.arrivedAt), f.refused, p.status, sd, JSON.stringify(hist)]);
        saved++;
      }
    });
  }
  return { saved, pending: todo.length - batch.length };
}

let relCache = null, relAt = 0;
async function supplierStats(days = 120) {
  if (relCache && Date.now() - relAt < 5 * 60 * 1000 && relCache.days === days) return relCache.list;
  await ensureHistoryTable();
  const rows = await withDb(async c => (await c.query(
    `select supplier, supplier_id, order_date, promised_hours, history
       from logistics_pos_history where order_date > now() - ($1::int * interval '1 day')`, [days])).rows);
  // Facts recomputed from the stored history every time (07.11: dates «26.10.2026 05:49:14» were misread before).
  const iso = ms => (ms ? new Date(ms).toISOString() : null);
  const list = reliability(rows.map(r => { const f = historyFacts(r.history || []); return { ...r, ordered_at: iso(f.orderedAt), arrived_at: iso(f.arrivedAt), refused: f.refused }; }));
  relCache = { days, list }; relAt = Date.now();
  return list;
}

// ─── supplier names (cp/distributors, read-only, 6 h) ─────────────────────
let distCache = null, distAt = 0;
async function distributorNames() {
  if (distCache && Date.now() - distAt < 6 * H) return distCache;
  try {
    const list = await abcp.apiGet('cp/distributors');
    const arr = Array.isArray(list) ? list : Object.values(list || {});
    distCache = new Map(arr.filter(Boolean).map(d => [String(d.id), d.name || d.title || String(d.id)]));
  } catch (err) {
    console.error('[logistics] cp/distributors failed:', err.message);
    distCache = distCache || new Map();
  }
  distAt = Date.now();
  return distCache;
}

// ─── offers + scoring ───────────────────────────────────────────────────────
const offerCache = new Map();

/** Pure: raw search/articles answer -> normalized new offers of this number. Exported for tests. */
function normalizeOffers(number, raw, names = new Map()) {
  const want = norm(number);
  return (Array.isArray(raw) ? raw : Object.values(raw || {})).filter(o => o && norm(o.numberFix || o.number) === want && Number(o.price) > 0 && !Number(o.isUsed))
    .map(o => {
      const h = Number(o.deliveryPeriod) || 0, hMax = Number(o.deliveryPeriodMax) || 0;
      const id = o.distributorId != null ? String(o.distributorId) : null;
      return {
        supplierId: id,
        supplier: (id && names.get(id)) || o.distributorName || o.supplierName || (o.supplierCode ? `код ${o.supplierCode}` : 'поставщик ?'),
        brand: o.brand || null,
        sale: Math.round(Number(o.price)),                                   // profile («Опт») selling price
        priceIn: Number(o.priceIn) > 0 ? Math.round(Number(o.priceIn)) : null, // purchase price (07.11: matches «Цена поставщика» in ABCP)
        price: Number(o.priceIn) > 0 ? Math.round(Number(o.priceIn)) : Math.round(Number(o.price)), // what we compare: the cost
        days: Math.ceil(h / 24),
        daysMax: Math.ceil(Math.max(h, hMax) / 24),
        qty: Number(o.availability) > 0 ? Number(o.availability) : null,
        noReturn: !!Number(o.noReturn),
        // needed to switch an order position to this offer (cp/order POST): routeId = search «supplierCode», itemKey, hours
        routeId: o.supplierCode != null ? String(o.supplierCode) : null,
        itemKey: o.itemKey || null,
        hours: h, hoursMax: Math.max(h, hMax),
      };
    });
}

const rubT = n => `${Math.round(n).toLocaleString('ru-RU')} ₽`;

/** Why a cheaper offer lost to the agent's pick. */
function rejectWhy(c, best) {
  const st = c.stats;
  if (c.otherBrand) return `другой бренд (${c.brand})`;
  if (c.suspicious) return 'подозрительно дёшево — может быть не оригинал';
  if (st && st.judged >= 5 && st.onTimeShare < 0.5) return `опаздывает в ${Math.round((1 - st.onTimeShare) * 100)}% случаев`;
  if (st && st.positions >= 5 && st.refusedShare >= 0.1) return `отказывает в ${Math.round(st.refusedShare * 100)}% случаев`;
  if (!c.enough) return 'не хватает количества';
  if (c.daysMax > best.daysMax) return `срок до ${c.daysMax} дн.`;
  if (st && st.judged >= 5 && best.stats && best.stats.judged >= 5 && st.onTimeShare < best.stats.onTimeShare) return `вовремя только ${Math.round(st.onTimeShare * 100)}%`;
  if ((!st || st.judged < 5) && !c.trusted && best.stats && best.stats.judged >= 5) return `у магазина нет истории доставок с этим поставщиком (у выбора агента — ${best.stats.judged})`;
  if (st && st.positions >= 5 && best.stats && st.refusedShare > best.stats.refusedShare) return `отказов больше (${Math.round(st.refusedShare * 100)}%)`;
  return 'хуже по сроку и надёжности';
}

/**
 * Pure: offers + supplier stats -> offers sorted best first, each with score
 * and reasons. Unknown supplier = 70 % on time. Exported for tests.
 */
function scoreOffers(offers, stats, want = 1, wantBrand = null, current = null) {
  const curKey = current ? nameKey(current.supplier) : null, curId = current && current.supplierId ? String(current.supplierId) : null;
  const byName = new Map(stats.map(s => [nameKey(s.supplier), s]));
  const byId = new Map(stats.filter(s => s.supplierId).map(s => [s.supplierId, s]));
  if (!offers.length) return [];
  const minPrice = Math.min(...offers.map(o => o.price));
  // «Подозрительно дёшево» (07.11, order 288586374: 11 047 ₽ vs ~20 000 ₽ dealer): below 60 % of the median purchase price.
  const sortedP = offers.map(o => o.price).sort((a, b) => a - b);
  const median = sortedP[Math.floor(sortedP.length / 2)];
  const wb = norm(wantBrand);
  const scored = offers.map(o => {
    const otherBrand = !!(wb && o.brand && norm(o.brand) !== wb);
    const st = (o.supplierId && byId.get(o.supplierId)) || byName.get(nameKey(o.supplier)) || null;
    // 08.11 (VAG Brest 5 866 ₽ vs ~11 000 ₽ online, the manager's own supplier): cheap is not suspicious for
    // the order's supplier, a trusted one, or one that has really delivered to the shop (5+ deliveries, ≥ 60 % on time).
    const isCurrent = (curId && o.supplierId === curId) || (curKey && nameKey(o.supplier) === curKey);
    const proven = st && st.judged >= 5 && st.onTimeShare >= 0.6;
    const suspicious = offers.length >= 3 && o.price < 0.6 * median && !isCurrent && !proven && !isTrusted(o.supplier);
    const known = st && st.judged >= 5;
    const trusted = isTrusted(o.supplier);
    // 07.11: «50 % of 8» was trusted as much as «78 % of 80». Shrink toward the default by the
    // number of deliveries behind the figure (as if PRIOR_N extra deliveries at the default rate).
    const PRIOR_N = 10;
    const p0 = trusted ? 0.9 : 0.7, r0 = trusted ? 0.02 : 0.05;
    const onTime = st && st.judged ? (st.onTimeShare * st.judged + p0 * PRIOR_N) / (st.judged + PRIOR_N) : p0;
    const refused = st && st.positions ? (st.refusedShare * st.positions + r0 * PRIOR_N) / (st.positions + PRIOR_N) : r0;
    const enough = o.qty == null || o.qty >= want;
    // money per day of waiting ~ 2 % of the price; a late / refusing supplier costs a lot more than
    // a few % of price (07.11: 20 % on time won on price alone with the old 0.6 weight)
    const score = o.price * (1 + 0.02 * o.daysMax) * (1 + 2 * (1 - onTime)) * (1 + 3 * refused) * (enough ? 1 : 3) * (known && st.onTimeShare < 0.5 ? 1.5 : 1)
      * (otherBrand ? 3 : 1) * (suspicious ? 1.8 : 1); // a copy / wrong part is worse than paying more
    return { ...o, trusted, otherBrand, suspicious, median, score, stats: st ? { onTimeShare: st.onTimeShare, judged: st.judged, refusedShare: st.refusedShare, medianDays: st.medianDays, positions: st.positions } : null, enough };
  // Hard rule (07.11, order 288586374): a suspicious / other-brand offer is never the pick while a normal one exists.
  }).sort((a, b) => ((a.otherBrand || a.suspicious) - (b.otherBrand || b.suspicious)) || a.score - b.score)
    .filter((o, i, arr) => arr.findIndex(x => nameKey(x.supplier) === nameKey(o.supplier)) === i); // best offer per supplier
  const fastest = Math.min(...offers.map(o => o.daysMax));
  const best = scored[0];
  scored.forEach((o, i) => {
    const r = [];
    // Prices are compared with the agent's pick (07.11: «дороже минимума» measured against a rejected offer read oddly).
    if (i === 0) r.push(o.price === minPrice ? 'самая низкая закупка' : 'выбор агента');
    else {
      const d = o.price - best.price, pct = best.price ? Math.round(Math.abs(d) / best.price * 100) : 0;
      if (d > 0) r.push(`дороже выбора агента на ${rubT(d)} (${pct}%)`);
      else if (d < 0) r.push(`дешевле выбора агента на ${rubT(-d)}, но ${rejectWhy(o, best)}`);
      else r.push('та же закупка, что у выбора агента');
    }
    if (o.daysMax === 0) r.push('в наличии');
    else if (o.daysMax === fastest) r.push(`самый быстрый срок (${o.daysMax} дн.)`);
    else r.push(`срок до ${o.daysMax} дн.`);
    if (o.trusted) r.push('доверенный поставщик');
    if (o.stats && o.stats.judged >= 5) r.push(`${o.stats.onTimeShare < 0.5 ? '⚠ ' : ''}вовремя ${Math.round(o.stats.onTimeShare * 100)}% из ${o.stats.judged}`);
    else if (!o.trusted) r.push('мало истории по поставщику');
    if (o.stats && o.stats.positions >= 5 && o.stats.refusedShare >= 0.1) r.push(`отказы ${Math.round(o.stats.refusedShare * 100)}%`);
    if (!o.enough) r.push('не хватает количества');
    if (o.otherBrand) r.push(`⚠ другой бренд: ${o.brand}`);
    if (o.suspicious) r.push(`⚠ подозрительно дёшево (${Math.round(o.price / o.median * 100)}% от средней) — проверьте, оригинал ли`);
    if (o.noReturn) r.push('без возврата');
    o.reasons = r;
  });
  return scored;
}


/**
 * Pure: switching supplier has its own risk, so the agent recommends another
 * supplier only if it is clearly better (score at least LOGISTICS_SWITCH_MARGIN,
 * default 5 %, lower than the order's supplier). Otherwise the order's supplier
 * goes first with keptCurrent. 07.11: 250 ₽ (0.6 %) for 50 % on time vs 78 %.
 */
function preferCurrent(offers, current = {}) {
  const margin = Number(process.env.LOGISTICS_SWITCH_MARGIN) >= 0 ? Number(process.env.LOGISTICS_SWITCH_MARGIN || 0.05) : 0.05;
  const k = nameKey(current.supplier);
  const i = offers.findIndex(o => (current.supplierId && o.supplierId === current.supplierId) || (k && nameKey(o.supplier) === k));
  if (i <= 0) return offers;
  const best = offers[0], cur = offers[i];
  if (cur.otherBrand || cur.suspicious || !cur.enough) return offers;
  // 08.11: never recommend a supplier > 10 % dearer than the order's one unless the order's one is known to be unreliable
  const curBad = cur.stats && cur.stats.judged >= 5 && cur.stats.onTimeShare < 0.5;
  const muchDearer = best.price > cur.price * 1.1;
  if (best.score < cur.score * (1 - margin) && !(muchDearer && !curBad)) return offers;
  const out = [{ ...cur, keptCurrent: true, gainPct: Math.round((1 - best.score / cur.score) * 1000) / 10 }, ...offers.filter((_, j) => j !== i)];
  out.fetchedAt = offers.fetchedAt;
  return out;
}

/**
 * Pure: why the agent's pick (offers[0]) — compared with the supplier in the
 * order (current: { supplier, supplierId, priceIn }) and with any cheaper
 * offer it rejected. Returns short Russian phrases. Exported for tests.
 */
function explainPick(offers, current = {}) {
  const best = offers[0];
  if (!best) return [];
  const out = [];
  const k = nameKey(current.supplier);
  const curOffer = offers.find(o => (current.supplierId && o.supplierId === current.supplierId) || (k && nameKey(o.supplier) === k));
  const paid = current.priceIn || (curOffer && curOffer.priceIn) || null;
  const isCurrent = curOffer && curOffer === best;
  if (isCurrent) out.push(best.keptCurrent ? `оставить поставщика из заказа — другие варианты лучше меньше чем на ${Math.round((Number(process.env.LOGISTICS_SWITCH_MARGIN) || 0.05) * 100)}%, менять не стоит` : 'тот же поставщик, что в заказе');
  else if (paid && best.priceIn) {
    const d = paid - best.priceIn;
    out.push(d > 0 ? `дешевле поставщика из заказа на ${rubT(d)}` : d < 0 ? `дороже поставщика из заказа на ${rubT(-d)}, зато надёжнее или быстрее` : 'та же закупка, что в заказе');
    // say the trade-off out loud (07.11)
    const bs = best.stats, cs = curOffer && curOffer.stats;
    if (bs && cs && bs.judged >= 5 && cs.judged >= 5 && bs.onTimeShare < cs.onTimeShare - 0.05) out.push(`но вовремя ${Math.round(bs.onTimeShare * 100)}% (из ${bs.judged}) против ${Math.round(cs.onTimeShare * 100)}% (из ${cs.judged}) у текущего`);
  }
  const cheaper = offers.filter(o => o.price < best.price).sort((a, b) => a.price - b.price)[0];
  if (cheaper) {
    const why = rejectWhy(cheaper, best);
    out.push(`самый дешёвый вариант (${cheaper.supplier}, ${rubT(cheaper.price)}) отброшен — ${why}`);
  } else out.push('самая низкая закупка');
  out.push(best.daysMax ? `срок до ${best.daysMax} дн.` : 'в наличии');
  if (best.trusted) out.push('доверенный поставщик');
  if (best.stats && best.stats.judged >= 5) out.push(`вовремя ${Math.round(best.stats.onTimeShare * 100)}% из ${best.stats.judged}`);
  else if (!best.trusted) out.push('новый поставщик — истории доставок ещё нет');
  if (best.otherBrand) out.push(`⚠ другой бренд: ${best.brand}`);
  if (best.suspicious) out.push(`⚠ подозрительно дёшево (${Math.round(best.price / best.median * 100)}% от средней) — проверьте, оригинал ли`);
  if (best.noReturn) out.push('без возврата');
  return out;
}

/** Offers for one article, scored. Cached 20 min. */
async function offersFor(article, brand = 'BMW', qty = 1, fresh = false, current = null) {
  const key = `${norm(brand)}:${norm(article)}`;
  const hit = offerCache.get(key);
  let offers, at = Date.now();
  if (!fresh && hit && Date.now() - hit.at < 20 * 60 * 1000) { offers = hit.offers; at = hit.at; }
  else {
    const params = { number: norm(article), brand, withOutAnalogs: 1, useOnlineStocks: 1 };
    if (process.env.LOGISTICS_PRICE_PROFILE_ID) params.profileId = process.env.LOGISTICS_PRICE_PROFILE_ID;
    let raw = [];
    try { raw = await abcp.apiGet('search/articles', params); }
    catch (err) { if (err.abcpCode != 301) throw err; }
    if (!hit && Array.isArray(raw) && raw[0] && !global.__lgOfferKeysLogged) { global.__lgOfferKeysLogged = 1; console.log(`[logistics] offer fields: ${Object.keys(raw[0]).join(',')}`); }
    offers = normalizeOffers(article, raw, await distributorNames());
    offerCache.set(key, { at: Date.now(), offers });
    if (offerCache.size > 500) offerCache.clear();
  }
  const scored = scoreOffers(offers, await supplierStats().catch(() => []), qty, brand, current);
  scored.fetchedAt = new Date(at).toISOString();
  return scored;
}

module.exports = { preferCurrent, isTrusted, explainPick, nameKey, refreshHistory, supplierStats, offersFor, historyFacts, reliability, normalizeOffers, scoreOffers, distributorNames };
