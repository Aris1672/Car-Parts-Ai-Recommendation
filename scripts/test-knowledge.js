/** Knowledge base (owner 10.11, knowledge/bmw-parts.md): parser, selection, the #563 path. */
process.env.NARROWING = '1';
const a = require('assert');
const k = require('../lib/knowledge');

{
  const list = k.entries();
  const inlet = list.find(e => e.title === 'Впускной канал');
  a.ok(inlet && inlet.approved && inlet.group === '13', 'owner example is an approved entry');
  a.deepStrictEqual(inlet.catalogNames, ['Впускной канал']);
  a.strictEqual(inlet.unit, 'Глушитель шума всас./смен.элем.фил./HFM');
  a.ok(/впускной канал/.test(inlet.system), 'the group\'s flow is attached');
  a.ok(list.some(e => !e.approved), 'drafts exist and are marked');
  // only approved entries are selected
  a.deepStrictEqual(k.select('Нет я имею в виду откуда двигатель берёт воздух до воздушного фильтра').map(e => e.title), ['Впускной канал']);
  a.ok(!k.select('воздуховод после фильтра').some(e => e.title === 'Трубопровод чистого воздуха'), 'draft not used');
  a.ok(k.select('воздуховод после фильтра', { all: true }).some(e => e.title === 'Трубопровод чистого воздуха'));
  // a bare word does not pull an entry
  a.strictEqual(k.select('воздуховод').length, 0);
  a.deepStrictEqual(k.select('подушка КПП').map(e => e.title), ['Подшипник коробки передач']);
  console.log('test-knowledge: parser + selection ok');
}
{
  const md = '## 34 Тормоза\n**Как устроено:** диск,\nсуппорт\n\n### Тормозной диск\n- Клиент говорит: диск тормоза\n- В каталоге BMW: «Тормозной диск»; узел «Тормозной механизм» (группа 34)\n- Статус: 📝 черновик\n';
  const [e] = k.parse(md);
  a.ok(e && !e.approved && e.system === 'диск, суппорт' && e.unit === 'Тормозной механизм');
  console.log('test-knowledge: parse ok');
}
{
  // #563: the customer rejects the «воздуховод» options -> knowledge -> «Впускной канал» from the catalog.
  const laximo = require('../lib/laximo');
  laximo.searchByCatalogNames = async (schema, names) => (names.includes('Впускной канал') ? [{ oem: '13717812058', name: 'Впускной канал' }] : []);
  const n = require('../lib/narrowing');
  const chat = require('../api/chat');
  (async () => {
    const cands = [{ oem: '51647222952', name: 'Воздуховод радиатора' }, { oem: '51747222877', name: 'Воздуховод тормозов Л Пд' }];
    const st = { v: 1, car: 'BMW X5 40dX (E70N)', schema: { catalog: 'C', vid: '1', ssd: 'x' }, items: [{ kw: 'воздуховод', cands, asked: [] }], cur: 0 };
    const q = await chat._narrow.narrowContinue(st, '');
    const msgs = [{ role: 'user', content: 'Воздуховод VIN' }, { role: 'assistant', content: q }, { role: 'user', content: 'Нет я имею в виду откуда двигатель берёт воздух до воздушного фильтра' }];
    const r = await chat._narrow.narrowingFollowUp(msgs);
    a.ok(/Понял: это «Впускной канал»/.test(r), r.slice(0, 400)); // card or its unit diagram
    console.log('test-knowledge: #563 path ok');
  })().catch(e => { console.error(e); process.exit(1); });
}
{
  // 230i «Воздуховод» (#564/565): the first question offers the catalog's ducts AND «Впускной канал» (knowledge).
  const laximo = require('../lib/laximo');
  laximo.getPartDiagram = async () => ({ unitName: 'Воздуховоды', image: 'x' });
  laximo.searchByCatalogNames = async (schema, names) => (names.includes('Впускной канал') ? [{ oem: '13718636460', name: 'Впускной канал' }] : []);
  const n = require('../lib/narrowing');
  const chat = require('../api/chat');
  (async () => {
    const cands = [{ oem: '51747292461', name: 'Воздуховод радиатора сист.охлажд.двиг.' }, { oem: '51747292462', name: 'Воздуховод Нж' }, { oem: '51747292463', name: 'Воздуховод тормозн.механизма П' }];
    const st = { v: 1, car: 'BMW 230i (F22N)', schema: { catalog: 'C', vid: '1', ssd: 'x' }, items: [{ kw: 'воздуховод', cands, asked: [] }], cur: 0 };
    const q = await chat._narrow.narrowContinue(st, '');
    a.ok(!/UNIT_DIAGRAM/.test(q), 'no unit view before the first question');
    a.ok(/Впускной канал — перед воздушным фильтром/.test(q), q.slice(0, 600));
    const msgs = [{ role: 'user', content: 'Воздуховод, VIN' }, { role: 'assistant', content: q }, { role: 'user', content: 'Впускной канал — перед воздушным фильтром' }];
    const r = await chat._narrow.narrowingFollowUp(msgs);
    a.ok(/Впускной канал/.test(r), r.slice(0, 300));
    console.log('test-knowledge: 230i воздуховод probe ok');
  })().catch(e => { console.error(e); process.exit(1); });
}
