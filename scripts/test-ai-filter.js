// AI filter keeps rows chosen by the names table (live 06.11, #175). Mock LLM, no network. Run: npm test
const a = require('assert');
const http = require('http');
let calls = 0;
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
    // 1st call: the mock AI keeps only rows 2 and 3 (drops the seal in row 1, as DeepSeek did);
    // 2nd call: it asks «Фланец (патрубок) — вариант 1 / 2» on a 5-part list (live 06.11)
    calls++;
    const text = calls === 1 ? '{"keep":[2,3]}' : calls === 3 ? '{"keep":[1,2]}' : '{"ask":{"question":"Уточните","options":[{"label":"Фланец (патрубок) — вариант 1","rows":[1]},{"label":"Фланец (патрубок) — вариант 2","rows":[2]}]}}';
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
srv.listen(0, '127.0.0.1', async () => {
  process.env.LLM_API_KEY = 'test';
  process.env.LLM_BASE_URL = `http://127.0.0.1:${srv.address().port}`;
  const chat = require('../api/chat.js');
  try {
    const parts = [
      { oem: '11627617523', name: 'Уплотнение выпускного коллектора', query: 'прокладка впускного коллектора', fixedName: 'прокладка впускного коллектора' },
      { oem: '11428575211', name: 'К-т сменного элемента масляного фильтра', query: 'масляный фильтр' },
      { oem: '12120040551', name: 'Свеча зажигания High Power', query: 'свечи' },
      { oem: '11618637800', name: 'Уплотнение системы впуска', query: 'прокладка впускного коллектора' },
    ];
    const kept = await chat.aiFilterParts(parts, { partKeywords: ['прокладка впускного коллектора', 'масляный фильтр', 'свечи'] }, [{ role: 'user', content: 'прокладка впускного коллектора, масляный фильтр, свечи' }], {});
    a.deepStrictEqual(kept.map(p => p.oem), ['11627617523', '11428575211', '12120040551']);
    console.log('test-ai-filter: names-table rows kept ok');
    const flange = [{ oem: '11531', name: 'Соединительный патрубок', query: 'фланец' }, { oem: '11532', name: 'Соединительный патрубок', query: 'фланец' }, { oem: '11428575211', name: 'Фильтр', query: 'масляный фильтр' }];
    const r = await chat.aiFilterParts(flange, { partKeywords: ['фланец', 'масляный фильтр'] }, [{ role: 'user', content: 'фланец, масляный фильтр' }], { allowAsk: true });
    a.ok(!r.clarify, 'no variant question for a list of parts');
    a.deepStrictEqual(r.map(p => p.oem), ['11531', '11532', '11428575211'], 'other parts of the list stay');
    console.log('test-ai-filter: no variant question for a list ok');
    // #250: the AI drops the gearbox pan (only row of its part, from a catalog group) -> put back;
    // a part whose only row came from the word search stays dropped
    const list = [
      { oem: '11428575211', name: 'К-т сменного элемента масляного фильтра', query: 'масляный фильтр', viaGroup: true },
      { oem: '12120040551', name: 'Свеча зажигания', query: 'свечи', viaGroup: true },
      { oem: '24115A13116', name: 'К-т масляный картер, масл.фильтр, АКПП', query: 'поддон акпп с фильтром', viaGroup: true },
      { oem: '64119999999', name: 'Патрубок отопителя', query: 'фланец системы охлаждения' },
    ];
    const k = await chat.aiFilterParts(list, { partKeywords: ['масляный фильтр', 'свечи', 'поддон АКПП с фильтром', 'фланец системы охлаждения'] }, [{ role: 'user', content: 'список' }], {});
    a.deepStrictEqual(k.map(p => p.oem), ['11428575211', '12120040551', '24115A13116']);
    console.log('test-ai-filter: group rows of a dropped part put back ok');
  } finally { srv.close(); }
});
