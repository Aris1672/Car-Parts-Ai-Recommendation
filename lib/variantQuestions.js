/** Catalog-only assistance while a customer is choosing a part. No generated technical claims. */
const text = v => String(v || '').replace(/<<<[\s\S]*?>>>/g, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 700);
const norm = v => text(v).toLowerCase().replace(/ё/g, 'е');
function isQuestion(value, keyword = '') {
  const question = /разниц|отлича|отличи|сравн|характерист|объясн|поясн|помоги.*выб|помогите.*выб|како[йе].*(лучше|подойдет|подходит)|сколько.*(ампер|вольт|ватт)|difference|compare|specification/i.test(value);
  const reference = /эти|этот|этого|у них|у него|из них|из этих/i.test(value);
  const stems = norm(keyword).split(/\s+/).filter(w => w.length >= 5).map(w => w.slice(0, -2));
  const currentPart = stems.some(s => norm(value).includes(s));
  const shortQuestion = /^(чем отличаются|в чем разница|какая разница|какие характеристики|помогите выбрать|помоги выбрать)[?!. ]*$/i.test(value);
  return question && (reference || currentPart || shortQuestion) || /[?？]/.test(value) && reference;
}
async function evidenceFor(st, catalog) {
  const item = st.items[st.cur];
  const candidates = item.cands || [];
  if (!candidates.length || candidates.length > 8) return [];
  const pages = new Map();
  const evidence = [];
  for (const c of candidates) {
    const rows = [c];
    if (st.schema && st.schema.vid) {
      const units = await catalog.partUnits(st.schema, c.oem);
      if (units.length > 4) throw new Error('Too many catalog units for complete comparison');
      for (const u of units) {
        if (!u.ref || (!pages.has(u.ref) && pages.size >= 8)) throw new Error('Catalog evidence request limit');
        if (!pages.has(u.ref)) pages.set(u.ref, await catalog.unitPage(u.ref));
        const page = pages.get(u.ref);
        if (!page) throw new Error('Catalog unit unavailable');
        rows.push(...(page.rows || []).filter(r => catalog.normalizeOem(r.oem) === catalog.normalizeOem(c.oem)).map(r => ({ ...r, evidenceUnit: page.unitName || u.unitName || u.unitCode })));
      }
    }
    const facts = new Set();
    for (const r of rows) {
      if (r.catalogName || r.name) facts.add('Наименование: ' + text(r.catalogName || r.name));
      for (const [key, value] of Object.entries(r.notes || {})) {
        if (value != null && text(value)) facts.add((r.evidenceUnit ? 'Узел «' + text(r.evidenceUnit) + '»: ' : '') + text(key) + ': ' + text(value));
      }
    }
    for (const fact of facts) evidence.push({ id: evidence.length + 1, oem: c.oem, fact });
  }
  return evidence;
}
function render(st, evidence, result) {
  // The model may select source facts, never author specifications or infer interchangeability.
  const ids = result && result.factIds;
  const selected = Array.isArray(ids) ? evidence.filter(e => ids.includes(e.id)) : [];
  const valid = selected.length && ids.every(id => Number.isInteger(id) && evidence.some(e => e.id === id));
  const onlyIdenticalNames = evidence.length > 0 && evidence.every(e => e.fact.startsWith('Наименование: ')) && new Set(evidence.map(e => norm(e.fact))).size === 1;
  const complete = valid && result.sufficient === true && !onlyIdenticalNames;
  const lines = valid ? [...new Set(selected.map(e => '• ' + e.oem + ' — ' + e.fact))] : [];
  const answer = lines.length ? 'В оригинальном каталоге указано:\n' + lines.join('\n') : '';
  const fallback = 'В каталоге недостаточно информации, чтобы достоверно ответить на ваш вопрос. Не буду предполагать характеристики или взаимозаменяемость. Нажмите «Связаться с менеджером» — менеджер уточнит различия и поможет с выбором.\n<<<MANAGER_BUTTON>>>';
  return [answer, complete ? 'Это сведения каталога; они сами по себе не подтверждают взаимозаменяемость. Можно выбрать вариант ниже или задать другой вопрос.' : fallback,
    complete ? '\n<<<BUTTONS>>>\n' + JSON.stringify(st.options) + '\n<<<END_BUTTONS>>>' : ''].filter(Boolean).join('\n\n');
}
module.exports = { isQuestion, evidenceFor, render };
