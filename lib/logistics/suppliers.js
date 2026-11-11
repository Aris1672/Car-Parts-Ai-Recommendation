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
// 10.11 (owner): Рольф (Мерседес Каширка Рольф, Рольф Ясенево нал … — one of the biggest dealer groups) trusted too.
// 11.11 (Михаил): «Все Рольфы, все Автодомы (in ABCP also «Автд Вернадка», «Автд Мкад»), Zlata, Мезенцев, ОригаТо, Germsp, Марат» (+ БорисХоф from the owner).
const TRUSTED_DEFAULT = 'борисхоф,рольф,автодом,автд,zlata,злата,мезенцев,оригато,origato,germsp,марат';
const trustedList = () => String(process.env.LOGISTICS_TRUSTED_SUPPLIERS || TRUSTED_DEFAULT).split(',').map(x => nameKey(x)).filter(Boolean);
// 11.11 (owner): EARNED trust — a supplier not on the list whose own record is strong (30+ judged deliveries,
// ≥ 85 % on time, ≤ 5 % refusals) counts as «проверенный»; it loses that status when its record drops.
const EARN = () => ({ n: Number(process.env.LOGISTICS_EARN_MIN) || 30, onTime: Number(process.env.LOGISTICS_EARN_ONTIME) || 0.85, refused: Number(process.env.LOGISTICS_EARN_REFUSED) || 0.05 });
const isEarned = st => { const e = EARN(); return !!(st && st.judged >= e.n && st.onTimeShare >= e.onTime && (st.refusedShare || 0) <= e.refused); };
// 11.11 (managers, 34 × «нет доставки» on the stats page): these sources are not delivered to the shop —
// never picked while a delivered offer exists. Substring match, comma-separated.
const noDeliveryList = () => String(process.env.LOGISTICS_NO_DELIVERY ?? 'наличие борисхоф').toLowerCase().split(',').map(x => nameKey(x)).filter(Boolean);
const isNoDelivery = name => { const k = nameKey(name || ''); return noDeliveryList().some(x => k.includes(x)); };
// 11.11 (Михаил): «пока не покупаем у БорисХофа» — the managers have no time for the extra pickup step.
// Paused suppliers are never picked while another offer exists; back on autopilot → set LOGISTICS_PAUSED_SUPPLIERS empty.
const pausedList = () => String(process.env.LOGISTICS_PAUSED_SUPPLIERS ?? 'борисхоф').toLowerCase().split(',').map(x => nameKey(x)).filter(Boolean);
const isPaused = name => { const k = nameKey(name || ''); return pausedList().some(x => k.includes(x)); };
const isTrusted = name => { const k = nameKey(name); return !!k && trustedList().some(t => k.includes(t)); };
// 10.11 (order 289076134: «Алексей Химки» matched autoskyimport.ru by a shared id): same supplier = same
// NAME; the id is used only when one of the names is missing.
function sameSup(aName, aId, bName, bId) {
  const a = nameKey(aName), b = nameKey(bName);
  if (a && b) return a === b;
  return !!(aId && bId && String(aId) === String(bId));
}
// Own stock (10.11: «Наше наличие» 23 000 ₽ «replaced» by motexc.ru 6 895 ₽): the part is already on the shelf,
// buying it elsewhere saves nothing. LOGISTICS_OWN_STOCK = comma list (substring), default «наше наличие».
const ownList = () => String(process.env.LOGISTICS_OWN_STOCK || 'наше наличие').split(',').map(x => nameKey(x)).filter(Boolean);
const isOwnStock = name => { const k = nameKey(name); return !!k && ownList().some(t => k.includes(t)); };
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
// 10.11 (Bosch 0 445 110 435: autoeuro.ru, 116 deliveries, flagged «suspicious» — the stats had failed to load and
// the agent silently worked with NO history): on a DB error the last good list is used; only with none at all it throws.
let lastGood = null;
async function supplierStats(days = 120) {
  if (relCache && Date.now() - relAt < 5 * 60 * 1000 && relCache.days === days) return relCache.list;
  let rows;
  try {
    await ensureHistoryTable();
    rows = await withDb(async c => (await c.query(
      `select supplier, supplier_id, order_date, promised_hours, history
         from logistics_pos_history where order_date > now() - ($1::int * interval '1 day')`, [days])).rows);
  } catch (err) {
    console.error('[logistics] supplier stats failed, using the last good list:', err.message);
    if (lastGood) return lastGood;
    throw err;
  }
  // Facts recomputed from the stored history every time (07.11: dates «26.10.2026 05:49:14» were misread before).
  const iso = ms => (ms ? new Date(ms).toISOString() : null);
  const list = reliability(rows.map(r => { const f = historyFacts(r.history || []); return { ...r, ordered_at: iso(f.orderedAt), arrived_at: iso(f.arrivedAt), refused: f.refused }; }));
  relCache = { days, list }; relAt = Date.now();
  if (list.length) lastGood = list;
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
    const isCurrent = !!current && sameSup(o.supplier, o.supplierId, current.supplier, curId);
    // 10.11 (owner): a supplier the shop has EVER ordered from is a real source — never «suspicious»
    const proven = st && st.positions >= 1;
    // 08.11 (Gates T36296: 1 143 ₽ vs 1 223 ₽ «suspicious» only because dealers quote ~2 000 ₽): also clearly
    // below the next-cheapest OTHER supplier (≥ 15 %), not just below the median.
    const nextOther = offers.filter(x => x !== o && nameKey(x.supplier) !== nameKey(o.supplier) && x.price >= o.price).map(x => x.price).sort((a, b) => a - b)[0];
    const farBelowNext = !nextOther || o.price < 0.85 * nextOther;
    const suspicious = offers.length >= 3 && o.price < 0.6 * median && farBelowNext && !isCurrent && !proven && !isTrusted(o.supplier);
    const known = st && st.judged >= 5;
    const trusted = isTrusted(o.supplier);
    const earned = !trusted && isEarned(st);
    // 07.11: «50 % of 8» was trusted as much as «78 % of 80». Shrink toward the default by the
    // number of deliveries behind the figure (as if PRIOR_N extra deliveries at the default rate).
    const PRIOR_N = 10;
    const p0 = trusted || earned ? 0.9 : 0.7, r0 = trusted || earned ? 0.02 : 0.05; // earned: its real record is weighed against a good prior
    let onTime = st && st.judged ? (st.onTimeShare * st.judged + p0 * PRIOR_N) / (st.judged + PRIOR_N) : p0;
    let refused = st && st.positions ? (st.refusedShare * st.positions + r0 * PRIOR_N) / (st.positions + PRIOR_N) : r0;
    // 10.11 (owner): «when Рольф is cheaper we order from Рольф — a solid supplier»: trusted ones count as solid
    if (trusted) { onTime = Math.max(onTime, 0.85); refused = Math.min(refused, 0.02); }
    const enough = o.qty == null || o.qty >= want;
    // money per day of waiting ~ 2 % of the price; a late / refusing supplier costs a lot more than
    // a few % of price (07.11: 20 % on time won on price alone with the old 0.6 weight)
    const score = o.price * (1 + 0.02 * o.daysMax) * (1 + 2 * (1 - onTime)) * (1 + 3 * refused) * (enough ? 1 : 3) * (known && !trusted && st.onTimeShare < 0.5 ? 1.5 : 1)
      * (otherBrand ? 3 : 1) * (suspicious ? 1.8 : 1); // a copy / wrong part is worse than paying more
    return { ...o, trusted, earned, noDelivery: isNoDelivery(o.supplier), paused: isPaused(o.supplier), otherBrand, suspicious, median, score, stats: st ? { onTimeShare: st.onTimeShare, judged: st.judged, refusedShare: st.refusedShare, medianDays: st.medianDays, positions: st.positions } : null, enough };
  // Hard rule (07.11, order 288586374): a suspicious / other-brand offer is never the pick while a normal one exists.
  }).sort((a, b) => ((a.otherBrand || a.suspicious || a.noDelivery || a.paused) - (b.otherBrand || b.suspicious || b.noDelivery || b.paused)) || a.score - b.score)
    .filter((o, i, arr) => arr.findIndex(x => nameKey(x.supplier) === nameKey(o.supplier)) === i); // best offer per supplier
  // 11.11 (owner): «don't pay more for a promise nobody has checked». Independent of the manager (works on autopilot):
  // an UNPROVEN supplier (not trusted, < 5 judged deliveries) never comes first when it is dearer than the cheapest
  // PROVEN normal offer — the best proven-or-not-dearer offer goes first instead.
  // the reference is the cheapest proven GOOD supplier (a proven late one, < 50 % on time, is no reference)
  const isProven = o => o.trusted || (o.stats && o.stats.judged >= 5);
  const provenGood = o => o.trusted || o.earned || (o.stats && o.stats.judged >= 5 && o.stats.onTimeShare >= 0.5);
  const normal = scored.filter(o => !o.otherBrand && !o.suspicious && !o.noDelivery && !o.paused && o.enough);
  const cheapestProven = normal.filter(provenGood).map(o => o.price).sort((a, b) => a - b)[0];
  if (cheapestProven != null && scored[0] && !isProven(scored[0]) && scored[0].price > cheapestProven + 0.5) {
    const j = scored.findIndex(o => !o.otherBrand && !o.suspicious && !o.noDelivery && !o.paused && o.enough && (provenGood(o) || o.price <= cheapestProven + 0.5));
    if (j > 0) { const [g] = scored.splice(j, 1); g.riskGated = { supplier: scored[0].supplier, price: scored[0].price }; scored.unshift(g); }
  }
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
    if (o.paused) r.push('⏸ поставщик на паузе (решение Михаила)');
    if (o.noDelivery) r.push('⚠ нет доставки в магазин');
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
  const i = offers.findIndex(o => sameSup(o.supplier, o.supplierId, current.supplier, current.supplierId));
  // own stock: always keep it, even when it is not in the search results
  if (isOwnStock(current.supplier)) {
    const own = i >= 0 ? offers[i] : { supplier: current.supplier, supplierId: current.supplierId || null, price: Number(current.priceIn) || 0, priceIn: Number(current.priceIn) || null, daysMax: 0, hours: 0, hoursMax: 0, reasons: [], score: 0, enough: true };
    const out = [{ ...own, keptCurrent: true, ownStock: true }, ...offers.filter((_, j) => j !== i)];
    out.fetchedAt = offers.fetchedAt;
    return out;
  }
  const best0 = offers[0];
  const known = o => !!(o && (o.trusted || (o.stats && o.stats.judged >= 5)));
  // 10.11 (Rolf Ясенево 62 833 -> froza 78 413; Мерседес Каширка 86 000 -> adeo 99 525): the order's supplier has no
  // offer right now -> its purchase from the order is the reference; a dearer pick that is > 10 % above it, or from an
  // unknown supplier, is not recommended — the order's supplier is kept («предложения сейчас нет»).
  if (i < 0) {
    const ref = Number(current.priceIn) || 0;
    if (ref && best0 && best0.price > ref + 0.5 && (best0.price > ref * 1.1 || !known(best0))) {
      const ghost = { supplier: current.supplier, supplierId: current.supplierId || null, price: ref, priceIn: ref, daysMax: null, hours: 0, hoursMax: 0, reasons: [], score: 0, enough: true, keptCurrent: true, missingNow: true };
      const out = [ghost, ...offers];
      out.fetchedAt = offers.fetchedAt;
      return out;
    }
    return offers;
  }
  if (i === 0) return offers;
  const best = offers[0], cur = offers[i];
  if (cur.otherBrand || cur.suspicious || !cur.enough) return offers;
  // 08.11: never recommend a supplier > 10 % dearer than the order's one unless the order's one is known to be unreliable
  const curBad = cur.stats && cur.stats.judged >= 5 && cur.stats.onTimeShare < 0.5;
  const muchDearer = best.price > cur.price * 1.1;
  // 08.11 (VAG 1T0075111): customer pays 5 900 ₽, the pick cost 11 144 ₽. Never leave a supplier that is within the
  // customer's price for one that is above it — that turns the order into a loss.
  const priceOut = Number(current.priceOut) || 0;
  const pickLoses = priceOut && best.price > priceOut + 0.5 && cur.price <= priceOut + 0.5;
  const clearlyBetter = !pickLoses && best.score < cur.score * (1 - margin) && !(muchDearer && !curBad);
  if (clearlyBetter && !(best.price > cur.price + 0.5 && !known(best))) return offers;
  if (pickLoses) {
    const out = [{ ...cur, keptCurrent: true, keptForMargin: true, priceOut }, ...offers.filter((_, j) => j !== i)];
    out.fetchedAt = offers.fetchedAt;
    return out;
  }
  // 10.11: never a DEARER unknown supplier (no history, not trusted) over the order's supplier
  if (best.price > cur.price + 0.5 && !known(best)) {
    const out = [{ ...cur, keptCurrent: true }, ...offers.filter((_, j) => j !== i)];
    out.fetchedAt = offers.fetchedAt;
    return out;
  }
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
  const curOffer = offers.find(o => sameSup(o.supplier, o.supplierId, current.supplier, current.supplierId));
  // 08.11: the position is not ordered yet, so the order's supplier's price TODAY is what the shop would pay;
  // the purchase recorded in the order (often older) is mentioned when it differs.
  const live = curOffer ? (curOffer.priceIn || curOffer.price) : null;
  const recorded = current.priceIn || null;
  const paid = live || recorded;
  const isCurrent = curOffer && curOffer === best;
  if (isCurrent && best.ownStock) return ['деталь есть на своём складе — заказывать у других поставщиков не нужно'];
  if (best.missingNow) {
    const alt = offers[1];
    return [`у поставщика из заказа сейчас нет предложения (закупка в заказе ${rubT(best.priceIn)}); ${alt ? `остальные дороже — самое выгодное ${alt.supplier}, ${rubT(alt.priceIn || alt.price)}` : 'других предложений нет'} — оставить его`];
  }
  if (isCurrent && best.keptForMargin) {
    out.push(`оставить поставщика из заказа: остальные варианты дороже цены клиента (${rubT(best.priceOut)}) — заказ ушёл бы в минус`);
    if (best.stats && best.stats.judged >= 5 && best.stats.onTimeShare < 0.5) out.push(`⚠ этот поставщик часто опаздывает (вовремя ${Math.round(best.stats.onTimeShare * 100)}% из ${best.stats.judged}) — предупредите клиента или согласуйте цену на другого`);
  } else if (isCurrent) out.push(best.keptCurrent ? `оставить поставщика из заказа — другие варианты лучше меньше чем на ${Math.round((Number(process.env.LOGISTICS_SWITCH_MARGIN) || 0.05) * 100)}%, менять не стоит` : 'тот же поставщик, что в заказе');
  else if (paid && best.priceIn) {
    const d = paid - best.priceIn;
    const who = live ? `текущего предложения ${curOffer.supplier} (${rubT(live)})` : 'поставщика из заказа';
    out.push(d > 0 ? `дешевле ${who} на ${rubT(d)}` : d < 0 ? `дороже ${who} на ${rubT(-d)}, зато надёжнее или быстрее` : `та же закупка, что у ${who}`);
    if (live && recorded && Math.abs(live - recorded) > 0.5) out.push(`в заказе записана закупка ${rubT(recorded)}`);
    // say the trade-off out loud (07.11)
    const bs = best.stats, cs = curOffer && curOffer.stats;
    if (bs && cs && bs.judged >= 5 && cs.judged >= 5 && bs.onTimeShare < cs.onTimeShare - 0.05) out.push(`но вовремя ${Math.round(bs.onTimeShare * 100)}% (из ${bs.judged}) против ${Math.round(cs.onTimeShare * 100)}% (из ${cs.judged}) у текущего`);
  }
  const cheaper = offers.filter(o => o.price < best.price).sort((a, b) => a.price - b.price)[0];
  if (cheaper) {
    const why = rejectWhy(cheaper, best);
    out.push(`самый дешёвый вариант (${cheaper.supplier}, ${rubT(cheaper.price)}) отброшен — ${why}`);
  } else out.push('самая низкая закупка');
  if (best.riskGated) out.push(`${best.riskGated.supplier} (${rubT(best.riskGated.price)}) обещает лучше, но истории доставок у магазина нет — платить больше за непроверенное обещание не стоит`);
  out.push(best.daysMax ? `срок до ${best.daysMax} дн.` : 'в наличии');
  if (best.trusted) out.push('доверенный поставщик');
  else if (best.earned) out.push('проверенный поставщик (заслужил доверие своей историей)');
  if (best.stats && best.stats.judged >= 5) out.push(`вовремя ${Math.round(best.stats.onTimeShare * 100)}% из ${best.stats.judged}`);
  else if (!best.trusted) out.push('новый поставщик — истории доставок ещё нет');
  if (best.paused) out.push('⏸ поставщик на паузе — других подходящих предложений нет');
  if (best.noDelivery) out.push('⚠ нет доставки в магазин — других подходящих предложений нет');
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
  // only a FAILED load counts as «no history» (an empty history on a fresh DB is legitimate)
  let stats = [], statsFailed = false;
  try { stats = await supplierStats(); } catch (err) { statsFailed = true; console.error('[logistics] offers scored WITHOUT supplier history:', err.message); }
  const scored = scoreOffers(offers, stats, qty, brand, current);
  if (statsFailed) scored.noHistory = true;
  scored.fetchedAt = new Date(at).toISOString();
  return scored;
}

/**
 * When the exact number has no offers (08.11: connecting-rod bolt 11247516808 × 8 — probably superseded),
 * search again WITH replacements / analogs. Shown to the manager only — never picked or switched to automatically.
 * -> [{ number, brand, offers, cheapest: { supplier, priceIn, days } }] (other numbers only, max 6).
 */
async function replacementsFor(article, brand = 'BMW') {
  const params = { number: norm(article), brand, withOutAnalogs: 0, useOnlineStocks: 1 };
  if (process.env.LOGISTICS_PRICE_PROFILE_ID) params.profileId = process.env.LOGISTICS_PRICE_PROFILE_ID;
  let raw = [];
  try { raw = await abcp.apiGet('search/articles', params); } catch (err) { if (err.abcpCode != 301) throw err; }
  const names = await distributorNames();
  const want = norm(article);
  const by = new Map();
  for (const o of Array.isArray(raw) ? raw : Object.values(raw || {})) {
    if (!o || !(Number(o.price) > 0) || Number(o.isUsed)) continue;
    const num = norm(o.numberFix || o.number);
    if (!num || num === want) continue;
    const key = `${norm(o.brand)}:${num}`;
    const cost = Number(o.priceIn) > 0 ? Number(o.priceIn) : Number(o.price);
    const days = Math.ceil(Math.max(Number(o.deliveryPeriod) || 0, Number(o.deliveryPeriodMax) || 0) / 24);
    const sup = (o.distributorId != null && names.get(String(o.distributorId))) || o.distributorName || 'поставщик ?';
    const g = by.get(key) || { number: o.number, brand: o.brand || null, description: o.description || null, offers: 0, cheapest: null };
    g.offers++;
    if (!g.cheapest || cost < g.cheapest.priceIn) g.cheapest = { supplier: sup, priceIn: Math.round(cost), days };
    by.set(key, g);
  }
  // the requested brand first, then by number of offers
  const wb = norm(brand);
  return [...by.values()].sort((a, b) => ((norm(b.brand) === wb) - (norm(a.brand) === wb)) || b.offers - a.offers).slice(0, 6);
}

module.exports = { isPaused, isNoDelivery, isEarned, sameSup, isOwnStock, replacementsFor, preferCurrent, isTrusted, explainPick, nameKey, refreshHistory, supplierStats, offersFor, historyFacts, reliability, normalizeOffers, scoreOffers, distributorNames };
