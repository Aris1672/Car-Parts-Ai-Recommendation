// AI filter keeps rows chosen by the names table (live 06.11, #175). Mock LLM, no network. Run: npm test
const a = require('assert');
const http = require('http');
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
    // the mock AI keeps only rows 2 and 3 (drops the seal in row 1, as DeepSeek did)
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ content: [{ type: 'text', text: '{"keep":[2,3]}' }], usage: { input_tokens: 1, output_tokens: 1 } }));
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
  } finally { srv.close(); }
});
