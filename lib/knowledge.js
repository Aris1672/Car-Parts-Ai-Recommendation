/**
 * lib/knowledge.js — the BMW parts knowledge base (owner 10.11.2026): knowledge/bmw-parts.md.
 *
 * What the catalog doesn't know: the customer's words for a part, the BMW catalog name, where it
 * sits in the system and how to tell similar parts apart. Only ✅ approved entries are used;
 * 📝 drafts wait for the owner. Which part fits a car is always decided by the catalog.
 *
 *   entries()            -> [{ title, group, groupTitle, system, phrases, catalogNames, unit, where, distinguish, models, approved }]
 *   select(text, opts)   -> the approved entries that match the text (customer phrases / catalog names), best first
 *   promptBlock(entries) -> the entries as text for the AI step
 */
const fs = require('fs');
const path = require('path');

const FILE = process.env.KNOWLEDGE_FILE || path.join(__dirname, '..', 'knowledge', 'bmw-parts.md');
const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"]/g, '').replace(/\s+/g, ' ').trim();
const words = s => norm(s).split(/[^a-zа-я0-9-]+/).filter(w => w.length >= 3);
const STOP = new Set(['для', 'или', 'что', 'это', 'как', 'где', 'нет', 'имею', 'виду', 'нужен', 'нужна', 'нужно', 'мне', 'тот', 'та', 'который', 'которая', 'bmw', 'бмв']);
const stem = w => w.slice(0, Math.max(4, Math.min(6, w.length - 1)));

/** Parse the MD text. Pure; exported for tests. */
function parse(md) {
  const out = [];
  let group = null, groupTitle = null, system = '', cur = null, inSystem = false;
  const flush = () => { if (cur && cur.title) out.push(cur); cur = null; };
  for (const raw of String(md || '').split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^##\s+(\d{2})\s+(.+)$/))) { flush(); group = m[1]; groupTitle = m[2].trim(); system = ''; continue; }
    if (/^##\s/.test(line)) { flush(); group = null; groupTitle = null; system = ''; continue; }
    if ((m = line.match(/^\*\*Как устроено[^*]*\*\*\s*(.+)$/))) { system = m[1].replace(/\*\*/g, '').trim(); inSystem = true; continue; }
    if (inSystem) { if (line && !/^[#-]/.test(line)) { system += ' ' + line.replace(/\*\*/g, '').trim(); continue; } inSystem = false; }
    if ((m = line.match(/^###\s+(.+)$/)) && group) {
      flush();
      cur = { title: m[1].trim(), group, groupTitle, system, phrases: [], catalogNames: [], unit: null, where: '', distinguish: '', models: '', approved: false, status: '' };
      continue;
    }
    if (!cur || !(m = line.match(/^-\s*([^:]+):\s*(.*)$/))) continue;
    const key = norm(m[1]), val = m[2].trim();
    if (key.startsWith('клиент говорит')) cur.phrases = val.split(',').map(s => norm(s)).filter(Boolean);
    else if (key.startsWith('в каталоге')) {
      const unitM = val.match(/узел\s+«([^»]+)»/i);
      if (unitM) cur.unit = unitM[1];
      const before = unitM ? val.slice(0, val.search(/узел\s+«/i)) : val;
      cur.catalogNames = [...before.matchAll(/«([^»]+)»/g)].map(x => x[1].trim());
    } else if (key.startsWith('где')) cur.where = val;
    else if (key.startsWith('отличить')) cur.distinguish = val;
    else if (key.startsWith('модели')) cur.models = val;
    else if (key.startsWith('статус')) { cur.status = val; cur.approved = /✅|утвержд/i.test(val) && !/📝/.test(val); }
  }
  flush();
  return out;
}

let cache = null, cacheMtime = 0;
/** All entries (re-read when the file changes). */
function entries() {
  try {
    const st = fs.statSync(FILE);
    if (!cache || st.mtimeMs !== cacheMtime) { cache = parse(fs.readFileSync(FILE, 'utf8')); cacheMtime = st.mtimeMs; }
  } catch (err) {
    if (!cache) { console.error('[knowledge] file not readable:', err.message); cache = []; }
  }
  return cache;
}

/**
 * Approved entries matching the text, best first. A whole customer phrase in the text scores
 * high; shared word stems score low. opts.all = include drafts (tests, review).
 */
function select(text, opts = {}) {
  const t = norm(text);
  const tStems = new Set(words(t).filter(w => !STOP.has(w)).map(stem));
  const scored = [];
  for (const e of (opts.list || entries())) {
    if (!e.approved && !opts.all) continue;
    let score = 0;
    for (const p of e.phrases) {
      if (p && t.includes(p)) score += 10 + p.length / 10;
      else {
        const ps = words(p).filter(w => !STOP.has(w)).map(stem);
        const hit = ps.filter(s => tStems.has(s)).length;
        // all words of a multi-word phrase, in any form («берёт воздух … до фильтра»); a one-word
        // phrase only as a whole word (above) -- «воздуховод» is not «воздухозаборник»
        if (ps.length >= 2 && hit === ps.length) score += 4 + hit;
        else if (hit >= 2) score += hit;
      }
    }
    for (const c of e.catalogNames) if (t.includes(norm(c))) score += 8;
    if (score > 0) scored.push({ e, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, opts.limit || 6).map(x => x.e);
}

/** Entries as text for the AI. */
function promptBlock(list) {
  return (list || []).map(e => [
    `### ${e.title} (группа ${e.group} — ${e.groupTitle})`,
    `- Клиент говорит: ${e.phrases.join(', ')}`,
    `- В каталоге BMW: ${e.catalogNames.map(c => `«${c}»`).join(', ')}${e.unit ? `; узел «${e.unit}»` : ''}`,
    e.where ? `- Где: ${e.where}` : '', e.distinguish ? `- Отличить: ${e.distinguish}` : '',
    e.system ? `- Система: ${e.system}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
}

module.exports = { FILE, parse, entries, select, promptBlock };
