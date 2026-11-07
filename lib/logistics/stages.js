/**
 * lib/logistics/stages.js — pure logic of the logistics watcher (phase 1,
 * read-only): ABCP order -> board stage + alerts. No I/O, fully tested in
 * scripts/test-logistics.js.
 *
 * ABCP status names are set up by each shop, so the stage of a status is
 * found by keywords (STAGE_RULES). Statuses that match nothing land in
 * «other» and are listed on the «Статусы ABCP» screen of /logistics, so the
 * table can be finished together with Михаил. A shop can override the rules
 * with LOGISTICS_STAGE_MAP (JSON: {"<exact status name>": "<stage>"}).
 */

const STAGES = [
  { id: 'problem',   label: 'Нужно решение' },
  { id: 'payment',   label: 'Ждём оплату' },
  { id: 'new',       label: 'Новые' },
  { id: 'supplier',  label: 'У поставщика' },
  { id: 'transit',   label: 'В пути к нам' },
  { id: 'stock',     label: 'На складе' },
  { id: 'shipped',   label: 'Отправлен' },
  { id: 'done',      label: 'Выдан / доставлен' },
  { id: 'cancelled', label: 'Отказ / снят' },
  { id: 'other',     label: 'Другой статус' },
];
const STAGE_ORDER = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));

// First match wins; order matters («отправлен поставщику» before «отправлен»).
const STAGE_RULES = [
  ['cancelled', /отказ|отмен|снят|аннулир|не поставл|возврат/i],
  ['done',      /выдан|выполнен|доставлен|получен клиент|вручен|закрыт/i],
  ['problem',   /нет на склад|нет в наличии|нет у поставщ|отсутству/i],          // BMW Club77: «Нет на складе»
  ['payment',   /жд[её]м (пред)?оплат|ожидает (пред)?оплат|ожидание оплат/i],     // «Ждем предоплату»
  // BMW Club77: «ОПЛАЧЕНО» is set AFTER «Пришло в СЕРВИС Химки» (customer paid, waits for pickup / shipping)
  ['stock',     /^оплачено\.?!?$/i],
  ['supplier',  /заказан|отправлен поставщ|передан поставщ|в работе|в заказе|подтвержд.*поставщ|ожидает поставщ|склад[ае]? поставщ|комплектуется/i],
  ['transit',   /в пути|отгружен поставщ|едет|на перемещ|поступает/i],
  ['stock',     /пришл|пришел|пришёл|на склад|поступил|готов к выдаче|готов к отгрузке|в наличии|упакован/i], // «Пришло в СЕРВИС Химки»
  ['shipped',   /отгружен|отправлен|передан в (сдэк|службу|доставк|курьер)|у курьера|доставляется|в доставке/i],
  ['new',       /нов|принят|ожида|оформлен|в обработке|оплачен|уточняем|провер/i],
];

function customMap() {
  try { return JSON.parse(process.env.LOGISTICS_STAGE_MAP || '{}') || {}; } catch { return {}; }
}

/** Status name -> stage id. */
function stageOfStatus(status, map = customMap()) {
  const s = String(status || '').trim();
  if (!s) return 'other';
  if (map[s] && STAGE_ORDER[map[s]] != null) return map[s];
  for (const [stage, re] of STAGE_RULES) if (re.test(s)) return stage;
  return 'other';
}

/** Order stage = the EARLIEST stage among its live positions (the order is as far as its slowest part). */
function stageOfOrder(positions, map) {
  const live = (positions || []).map(p => stageOfStatus(p.status, map)).filter(s => s !== 'cancelled');
  if (!live.length) return (positions || []).length ? 'cancelled' : 'other';
  const known = live.filter(s => s !== 'other');
  if (!known.length) return 'other';
  return known.sort((a, b) => STAGE_ORDER[a] - STAGE_ORDER[b])[0];
}

/** Carrier from ABCP's delivery type / office text. */
function carrierOf(order) {
  const t = `${order.deliveryType || ''} ${order.deliveryOffice || ''} ${order.deliveryAddress || ''}`.toLowerCase();
  if (/сдэк|cdek/.test(t)) return 'cdek';
  if (/яндекс|yandex/.test(t)) return 'yandex';
  if (/самовывоз|пункт выдачи магазина|химки|офис/.test(t)) return 'pickup';
  if (/курьер|доставк/.test(t)) return 'courier';
  return t.trim() ? 'other' : null;
}

/** ABCP date "2026-11-07 15:04:05" (Moscow) or ISO -> ms. */
function ts(s) {
  if (!s) return null;
  if (typeof s === 'number') return s;
  const str = String(s).trim();
  const m = str.match(/^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)(?::(\d\d))?$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 3, +m[5], +(m[6] || 0)); // Moscow = UTC+3
  // ABCP status history: «26.10.2026 05:49:14» (Moscow)
  const r = str.match(/^(\d\d)\.(\d\d)\.(\d{4})(?:[ T](\d\d):(\d\d)(?::(\d\d))?)?$/);
  if (r) return Date.UTC(+r[3], +r[2] - 1, +r[1], +(r[4] || 0) - 3, +(r[5] || 0), +(r[6] || 0));
  const t = Date.parse(str);
  return Number.isNaN(t) ? null : t;
}

const H = 3600 * 1000;

function limits() {
  const n = (k, d) => { const v = Number(process.env[k]); return v > 0 ? v : d; };
  return {
    newHours:      n('LOGISTICS_NEW_HOURS', 4),        // not ordered from a supplier after N h
    lateGraceHours: n('LOGISTICS_LATE_GRACE_HOURS', 12), // after the supplier's max deadline
    stockHours:    n('LOGISTICS_STOCK_HOURS', 24),     // arrived but not shipped / handed out
    shippedDays:   n('LOGISTICS_SHIPPED_DAYS', 7),     // shipped but not delivered
    silentDays:    n('LOGISTICS_SILENT_DAYS', 3),      // no status change at all
    forgottenHours: n('LOGISTICS_FORGOTTEN_HOURS', 4), // a sibling went to the supplier N h ago, this one didn't
  };
}

const ALERT_TEXT = {
  not_ordered:     'Не заказан у поставщика',
  supplier_late:   'Поставщик опаздывает',
  not_shipped:     'Пришёл, но не отправлен / не выдан',
  delivery_long:   'Долго в доставке',
  silent:          'Нет движения по заказу',
  no_stock:        'Нет на складе — нужно решение',
  forgotten:       'Забытая позиция: остальные уже заказаны',
  loss:            'Продаём в минус: закупка дороже цены клиента',
  unknown_status:  'Неизвестный статус ABCP',
};

/** paid | partial | unpaid (ABCP: sum, debt). */
function payStateOf(o) {
  const sum = Number(o.sum) || 0, debt = Number(o.debt) || 0;
  if (o.paid || debt <= 0) return 'paid';
  if (sum && debt < sum - 0.5) return 'partial';
  return 'unpaid';
}

/** BMW Club77 orders from the supplier only after payment. LOGISTICS_ORDER_UNPAID=1 = shop orders before payment too. */
const ordersBeforePayment = () => process.env.LOGISTICS_ORDER_UNPAID === '1';

/**
 * Alerts of one order (summary from normalizeOrder). Each alert:
 *   { kind, text, position (number or null), since (ms), detail }
 */
function alertsFor(o, now = Date.now(), lim = limits(), map) {
  const out = [];
  const add = (kind, p, since, detail) => out.push({ kind, text: ALERT_TEXT[kind], position: p ? p.number : null, since, detail });
  const created = ts(o.date);
  // «Забытая позиция»: some positions already went to the supplier (or further) N h ago, this one is still «new».
  const MOVED = ['supplier', 'transit', 'stock', 'shipped', 'done'];
  const movedAt = o.positions.filter(p => MOVED.includes(stageOfStatus(p.status, map)))
    .map(p => ts(p.statusDate) || created).filter(Boolean);
  const siblingMoved = movedAt.length && now - Math.min(...movedAt) > (lim.forgottenHours || 4) * H;
  for (const p of o.positions) {
    const st = stageOfStatus(p.status, map);
    const changed = ts(p.statusDate) || created;
    if (st === 'cancelled' || st === 'done') continue;
    if (st === 'other') { add('unknown_status', p, changed, p.status); continue; }
    if (st === 'problem') { add('no_stock', p, changed, `статус «${p.status}»`); continue; }
    // 07.11, order 288586374: «ЗАКАЗАНО СРОЧНЫМ» at 20 983 ₽ per lever, customer pays 19 400 ₽.
    if (p.priceIn && p.price && p.priceIn > p.price + 0.5) {
      const q = p.quantity || 1;
      add('loss', p, changed, `закупка ${Math.round(p.priceIn)} ₽ > цена клиента ${Math.round(p.price)} ₽, минус ${Math.round((p.priceIn - p.price) * q)} ₽`);
    }
    if (st === 'new' && siblingMoved) {
      add('forgotten', p, created, `остальные позиции заказа уже у поставщика или дальше`);
      continue;
    }
    if (st === 'new' && created && now - created > lim.newHours * H && (payStateOf(o) !== 'unpaid' || ordersBeforePayment())) {
      add('not_ordered', p, created, `${Math.round((now - created) / H)} ч с момента заказа`);
    }
    // «Поставщик опаздывает» only once the part was actually ordered (07.11: it showed on not-ordered orders).
    if ((st === 'supplier' || st === 'transit') && created && p.deadlineMaxHours) {
      const due = created + (p.deadlineMaxHours + lim.lateGraceHours) * H;
      if (now > due) add('supplier_late', p, created + p.deadlineMaxHours * H,
        `срок поставщика ${Math.ceil(p.deadlineMaxHours / 24)} дн. истёк`);
    }
    if (st === 'stock' && changed && now - changed > lim.stockHours * H) {
      add('not_shipped', p, changed, `${Math.round((now - changed) / H)} ч на складе`);
    }
    if (st === 'shipped' && changed && now - changed > lim.shippedDays * 24 * H) {
      add('delivery_long', p, changed, `${Math.floor((now - changed) / (24 * H))} дн. в доставке`);
    }
    if (changed && now - changed > lim.silentDays * 24 * H && !out.some(a => a.position === p.number)) {
      add('silent', p, changed, `статус «${p.status}» не менялся ${Math.floor((now - changed) / (24 * H))} дн.`);
    }
  }
  return out;
}

/** ABCP cp/orders item -> compact summary kept in our DB and shown on the board. */
function normalizeOrder(raw) {
  const positions = (raw.positions || []).filter(p => p && !Number(p.isDelete)).map(p => ({
    id: p.id != null ? String(p.id) : null,
    brand: p.brand || null,
    number: p.number || null,
    description: p.description || null,
    quantity: Number(p.quantityFinal || p.quantity) || null,
    priceIn: Number(p.priceIn) || null,     // purchase price (admin API)
    price: Number(p.priceOut || p.price) || null,
    supplier: p.distributorName || p.distributor || null,
    supplierId: p.distributorId != null ? String(p.distributorId) : null,
    status: p.status || null,
    statusCode: p.statusCode != null ? String(p.statusCode) : null,
    statusDate: p.statusChangeDate || null,
    deadlineHours: Number(p.deadline) || null,
    deadlineMaxHours: Number(p.deadlineMax) || null,
    dsRouteId: p.dsRouteId != null && p.dsRouteId !== '' ? String(p.dsRouteId) : null, // empty = cannot be sent online
  }));
  return {
    number: String(raw.number),
    date: raw.date || null,
    sum: Number(raw.sum) || null,
    debt: Number(raw.debt) || 0,
    paid: !!Number(raw.paid) || raw.paid === true,
    customer: raw.userName || raw.userFullName || null,
    customerId: raw.userId != null ? String(raw.userId) : null,
    phone: raw.userMobile || raw.userPhone || null,
    email: raw.userEmail || null,
    deliveryType: raw.deliveryType || null,
    deliveryOffice: raw.deliveryOffice || null,
    deliveryAddress: raw.deliveryAddress || null,
    shipmentDate: raw.shipmentDate || null,
    comment: raw.comment || null,
    manager: raw.managerName || raw.manager || null,
    positions,
  };
}

const RISK_ONLY = new Set(['silent', 'unknown_status']);

/** Summary + derived fields for the board. health: ok | risk (yellow) | late (red). */
function describe(o, now = Date.now(), lim, map) {
  let stage = stageOfOrder(o.positions, map);
  // «Заказ принят» with nothing paid = the shop waits for the customer's money (07.11), unless the shop orders before payment.
  if (stage === 'new' && payStateOf(o) === 'unpaid' && !ordersBeforePayment()) stage = 'payment';
  const cnt = {};
  for (const p of o.positions) { const st = stageOfStatus(p.status, map); cnt[st] = (cnt[st] || 0) + 1; }
  const alerts = ['done', 'cancelled'].includes(stage) ? [] : alertsFor(o, now, lim, map);
  return { ...o, stage, stageCounts: cnt, carrier: carrierOf(o), payState: payStateOf(o), alerts, health: alerts.some(a => !RISK_ONLY.has(a.kind)) ? 'late' : alerts.length ? 'risk' : 'ok' };
}

module.exports = { payStateOf, STAGES, STAGE_RULES, ALERT_TEXT, stageOfStatus, stageOfOrder, carrierOf, alertsFor, normalizeOrder, describe, ts, limits };
