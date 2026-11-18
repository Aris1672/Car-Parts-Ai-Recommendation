/**
 * lib/narrowing.js — the narrowing dialog (owner 10.11.2026, project doc «narrowing-dialog-plan»).
 *
 * One procedure for every part request: collect ALL candidates from the car's original
 * catalog (word search, no main-group filter), then ask the question that best splits
 * them until one part is left (or only versions of one part). Precise request = the same
 * procedure ending after zero questions.
 *
 * Split of roles:
 *   CODE (this file, pure): the candidate list, their attributes (from catalog data only:
 *     main group of the BMW number, words of the catalog name, axle from the number),
 *     which question splits best, applying an answer, the stop rule, the state block.
 *   AI (injected by chat.js): only maps a free-text answer onto the offered options.
 *   Buttons always come from real candidates.
 */

const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const words = s => norm(s).split(/[^a-zа-я0-9.-]+/).filter(Boolean);

// «Where in the car» from the BMW main group (first two digits of the number). Customer
// words, not the catalog's chapter titles.
const PLACE = {
  '07': 'Крепёж (болты, гайки, клипсы)',
  '11': 'Двигатель', '12': 'Электрика двигателя', '13': 'Впуск воздуха и подача топлива в двигатель',
  '16': 'Топливный бак и топливопроводы', '17': 'Охлаждение двигателя (радиатор)', '18': 'Выхлопная система',
  '21': 'Сцепление', '22': 'Опоры двигателя и КПП', '23': 'Механическая КПП', '24': 'Автоматическая КПП',
  '25': 'Переключение передач', '26': 'Карданный вал', '27': 'Раздаточная коробка',
  '31': 'Передняя подвеска', '32': 'Рулевое управление', '33': 'Задняя подвеска', '34': 'Тормоза',
  '35': 'Педали', '36': 'Колёса и шины', '37': 'Электроника подвески',
  '41': 'Кузов', '51': 'Кузов: облицовка, отделка, воздуховоды кузова', '52': 'Сиденья', '54': 'Люк / складной верх',
  '61': 'Электрика автомобиля', '62': 'Приборная панель', '63': 'Освещение',
  '64': 'Отопление, кондиционер, вентиляция салона', '65': 'Аудио, навигация, электроника',
  '66': 'Парктроник, круиз-контроль, ассистенты', '71': 'Оснащение (инструмент, аптечка)',
  '72': 'Подушки и ремни безопасности', '82': 'Аксессуары BMW', '83': 'Масла и жидкости', '84': 'Телефон / связь',
};
const groupOf = oem => { const n = String(oem || '').replace(/[\s.-]/g, ''); return /^\d{2}/.test(n) ? n.slice(0, 2) : null; };

// Direction words in BMW catalog names: «Пд» / «Зд», «Л» / «П», «сверху» / «снизу».
const FRONT = /^(пд|перед\S*|передн\S*|пер\.?)$/;
const REAR = /^(зд|задн\S*|зад\.?|задн\.?)$/;
const LEFT = /^(л|лев\S*|слева)$/;
// (full words «левой / правой центральной стойки» count as the side too)
const RIGHT = /^(п|прав\S*|справа)$/;
const TOP = /^(сверху|верх\S*|верхн\S*)$/;
const BOTTOM = /^(снизу|нижн\S*|низ)$/;
const DIRECTION = w => FRONT.test(w) || REAR.test(w) || LEFT.test(w) || RIGHT.test(w) || TOP.test(w) || BOTTOM.test(w);

/** Catalog data -> the attributes the questions use. Pure. */
function attributesOf(c) {
  const w = words(c.name).flatMap(x => x.split('.').filter(Boolean)); // «задн.части» -> задн, части
  const has = re => w.some(x => re.test(x));
  const g = groupOf(c.oem);
  const axle = c.axle === 'передняя ось' ? 'Передний' : c.axle === 'задняя ось' ? 'Задний' : null;
  // The kind: the catalog name without the short direction marks («Воздуховод радиатора сверху»
  // -> «Воздуховод радиатора»; «Л», «Пд», «слева» go), so those become their own questions.
  // Words like «задней части салона» stay: they say WHERE the part is.
  let kind = String(c.name || '').replace(/,/g, ' ').split(/\s+/)
    .filter(t => { const x = norm(t).replace(/[.]$/, ''); return !/^(л|п|пд|зд|сверху|снизу|слева|справа|левый|левая|левое|левой|левого|правый|правая|правое|правой|правого)$/.test(x); })
    .join(' ').replace(/\s+/g, ' ').trim();
  // A bare noun («Воздуховод») says nothing about the place -> add it.
  if (kind && words(kind).length === 1 && g && PLACE[g]) kind = `${kind} — ${PLACE[g].split(/[,(:]/)[0].trim().toLowerCase()}`;
  return {
    place: g && PLACE[g] ? PLACE[g] : null,
    kind: kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : null,
    frontRear: has(FRONT) ? 'Передний' : has(REAR) ? 'Задний' : axle,
    topBottom: has(TOP) ? 'Верхний' : has(BOTTOM) ? 'Нижний' : null,
    side: has(LEFT) ? 'Левый' : has(RIGHT) ? 'Правый' : null,
  };
}

// The order questions are tried in: where first (owner 10.11), then which one, then direction.
const ATTRS = ['place', 'kind', 'frontRear', 'topBottom', 'side'];
const QUESTION = {
  place: kw => `«${kw}» — где в автомобиле? Выберите систему:`,
  kind: kw => `Какой вариант «${kw}» нужен? В каталоге для вашей машины есть такие:`,
  frontRear: () => 'Передний или задний?',
  topBottom: () => 'Верхний или нижний?',
  side: () => 'Левый или правый?',
};
const BOTH = { frontRear: 'Оба (передний и задний)', topBottom: 'Оба (верхний и нижний)', side: 'Оба (левый и правый)' };
const DONT_KNOW = 'Не знаю — покажите схемы';
const MAX_CARDS = 8;

/** Rows that ARE the asked part (the noun starts the name), not its neighbours («Штуцер воздуховода»). */
function headFilter(cands, stems) {
  const st = (stems || []).filter(s => s && s.length >= 4);
  if (!st.length) return cands;
  const head = c => {
    const w = words(c.name).flatMap(x => x.split('.').filter(Boolean));
    // «Рем.к-т торм.накладок», «К-т …», «Комплект …»: the noun after the kit word counts
    let i = 0;
    while (i < w.length && /^(рем|к-т|комплект|ремкомплект|ремонтный|торм|тормозн\S*)$/.test(w[i])) i++;
    return w[i] || w[0] || '';
  };
  // «Дополнительный воздуховод Л»: an adjective before the noun.
  const second = c => { const w = words(c.name); return w.length > 1 && /(ый|ий|ой|ая|ое|ые)$/.test(w[0]) ? w[1] : ''; };
  // No row IS the asked part -> nothing (10.11 #531-535: «Ремкомплект для черной дизайн.
  // накладки» came through as «тормозные колодки»). The chat then uses the old flow.
  return cands.filter(c => st.some(s => head(c).startsWith(s) || second(c).startsWith(s)));
}

/** Stems for the head filter: the customer's noun + the catalog vocabulary names. */
function stemsFor(kw, vocab) {
  const firstNoun = s => (words(s).find(x => x.length >= 4 && !/^(тормозн|передн|задн|левы|правы)/.test(x)) || '');
  const all = [kw, ...(vocab || [])].map(firstNoun).filter(Boolean);
  return [...new Set(all.map(x => x.slice(0, Math.max(4, Math.min(7, x.length - 2)))))];
}

/** Values of attribute `a` among the candidates (null = not specific, kept in every answer). */
// «Воздуховод задней части салона» and «Воздуховод в задн.части салона» are one kind.
// Material / make-up words don't make another kind («колодок» = «колодок безасбест.»).
const NOISE_RE = /^(безасбест\S*|асбест\S*|безасб\S*|оригинал\S*)$/;
const kindKey = v => words(v).flatMap(x => x.split('.')).filter(x => x.length >= 3 && x !== 'для' && !NOISE_RE.test(x)).map(x => x.slice(0, 4)).join(' ');
const valueKey = (a, v) => (a === 'kind' ? kindKey(v) : v);
function valuesOf(cands, a) {
  const m = new Map(); // key -> { label, count }
  for (const c of cands) {
    const v = attributesOf(c)[a]; if (!v) continue;
    const k = valueKey(a, v);
    const e = m.get(k) || { label: v, count: 0 };
    e.count++; if (v.length < e.label.length) e.label = v; // the shorter spelling as the button
    m.set(k, e);
  }
  return m;
}

/** The customer's own words already answer some questions («задние», «радиатора снизу»). Pure. */
function applyRequestWords(cands, text, kw) {
  let out = cands;
  const w = words(text).flatMap(x => x.split('.').filter(Boolean));
  const pick = (a, val) => { const f = out.filter(c => { const v = attributesOf(c)[a]; return !v || v === val; }); if (f.length) out = f; };
  // (direction words below; kind words further down)
  if (w.some(x => FRONT.test(x)) && !w.some(x => REAR.test(x))) pick('frontRear', 'Передний');
  if (w.some(x => REAR.test(x)) && !w.some(x => FRONT.test(x))) pick('frontRear', 'Задний');
  if (w.some(x => TOP.test(x)) && !w.some(x => BOTTOM.test(x))) pick('topBottom', 'Верхний');
  if (w.some(x => BOTTOM.test(x)) && !w.some(x => TOP.test(x))) pick('topBottom', 'Нижний');
  if (w.some(x => /^(лев\S*|слева)$/.test(x)) && !w.some(x => /^(прав\S*|справа)$/.test(x))) pick('side', 'Левый');
  if (w.some(x => /^(прав\S*|справа)$/.test(x)) && !w.some(x => /^(лев\S*|слева)$/.test(x))) pick('side', 'Правый');
  // The request's own adjectives («тормозные диски» -> «торм») keep only rows that carry them:
  // «Диск датчика» is not a brake disc (owner 10.11: skip it, go straight to the axle).
  // Nouns are not used here (front «Ремкомплект тормозных колодок» / rear «Рем.к-т торм.накладок»).
  for (const adj of words(kw).filter(x => x.length >= 5 && /(ые|ий|ый|ая|ое|ой|ого|ых|ей)$/.test(x) && !DIRECTION(x))) {
    const st = adj.slice(0, 4);
    const f = out.filter(c => norm(c.name).includes(st));
    if (f.length) out = f;
  }
  // Other content words of the request («радиатора», «салона») narrow the kind by name.
  const kwStems = words(kw).map(x => x.slice(0, 5));
  const extra = w.filter(x => x.length >= 5 && !DIRECTION(x) && !/^(нужен|нужна|нужно|подбер|подоб|пожал|какой|деталь|запчаст|автомоб|машин|bmw)/.test(x)
    && !kwStems.some(s => x.startsWith(s)) && !/^[a-z0-9-]+$/.test(x)).map(x => x.slice(0, 5));
  for (const s of extra) {
    const f = out.filter(c => norm(c.name).includes(s));
    if (f.length) out = f;
  }
  return out;
}

/**
 * Next step for one item. Returns { done: true, cards: [...] } or
 * { done: false, attr, question, options }. Pure.
 */
function nextStep(item) {
  const cands = item.cands;
  if (cands.length <= 1) return { done: true, pick: cands };
  // The kind first when its names say where the part is (2..10 kinds); too many kinds ->
  // the place (system of the car) first, then the kind among fewer rows.
  let kinds = valuesOf(cands, 'kind').size;
  // Kinds that only follow the axle (each kind on one axle) -> ask the axle, the plainer question.
  const fr = valuesOf(cands, 'frontRear');
  if (kinds >= 2 && fr.size >= 2 && cands.every(c => attributesOf(c).frontRear)) {
    const axleOfKind = new Map();
    for (const c of cands) { const x = attributesOf(c); const k = kindKey(x.kind || ''); axleOfKind.set(k, (axleOfKind.get(k) || new Set()).add(x.frontRear)); }
    if ([...axleOfKind.values()].every(set => set.size === 1)) kinds = 1;
  }
  // After the kind was chosen the place (BMW main group) means little to a customer -- last.
  const order = (item.asked || []).includes('kind') ? ['frontRear', 'topBottom', 'side', 'place']
    : kinds >= 2 && kinds <= 16 ? ['kind', 'frontRear', 'topBottom', 'side', 'place'] : ATTRS; // owner 10.11: kinds (where the part sits) before systems
  for (const a of order) {
    if ((item.asked || []).includes(a)) continue;
    const vals = valuesOf(cands, a);
    if (vals.size < 2) continue;
    const options = [...vals.values()].sort((x, y) => (y.count - x.count) || x.label.localeCompare(y.label, 'ru')).map(e => e.label).slice(0, 16);
    if (BOTH[a]) options.push(BOTH[a]);
    options.push(DONT_KNOW);
    return { done: false, attr: a, question: QUESTION[a](item.kw), options };
  }
  // Nothing left to ask: versions of one part (same attributes, different numbers), or the
  // customer chose «Оба» -> cards.
  const sig = c => { const x = attributesOf(c); return [kindKey(x.kind || ''), x.frontRear, x.topBottom, x.side].join('|'); };
  const versions = cands.length > 1 && new Set(cands.map(sig)).size === 1;
  return { done: true, pick: cands.slice(0, MAX_CARDS), versions };
}

/** Apply a chosen option to the item. Returns the new item (asked + cands). Pure. */
function applyAnswer(item, attr, option) {
  const asked = [...(item.asked || []), attr];
  if (!option || option === DONT_KNOW) return { ...item, asked, gaveUp: true };
  if (BOTH[attr] && option === BOTH[attr]) return { ...item, asked };
  const key = valueKey(attr, option);
  const cands = item.cands.filter(c => { const v = attributesOf(c)[attr]; return !v || valueKey(attr, v) === key; });
  return { ...item, asked, cands: cands.length ? cands : item.cands };
}

/** Exact button text -> option (case / spaces / «ё» insensitive). Pure. */
function matchOption(text, options) {
  const t = norm(text);
  return (options || []).find(o => norm(o) === t) || null;
}

// ── State travels in the reply (hidden by the widget), like <<<CONFIRM_STATE>>>. ──
const STATE_RE = /<<<NARROW_STATE>>>([\s\S]*?)<<<END_NARROW_STATE>>>/;
function stateOf(messages) {
  const last = [...(messages || [])].reverse().find(m => m.role === 'assistant');
  const m = last && String(last.content || '').match(STATE_RE);
  if (!m) return null;
  try { return JSON.parse(m[1].trim()); } catch { return null; }
}
const stateBlock = st => `\n<<<NARROW_STATE>>>\n${JSON.stringify(st)}\n<<<END_NARROW_STATE>>>`;

/** Compact candidate for the state (the vehicle schema is stored once). */
const compact = p => ({ oem: p.oem, name: p.name, ...(p.axle ? { axle: p.axle } : {}),
  ...(p.notes && Object.keys(p.notes).length ? { notes: p.notes } : {}),
  ...(p.catalogName ? { catalogName: p.catalogName } : {}) });

module.exports = {
  PLACE, ATTRS, DONT_KNOW, MAX_CARDS, attributesOf, headFilter, stemsFor, applyRequestWords,
  nextStep, applyAnswer, matchOption, stateOf, stateBlock, compact, groupOf,
};
