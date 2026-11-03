/** lib/pii.js -- contacts masked before any LLM call (152-ФЗ, session 30). Run: npm test */
const a = require('assert');
const P = require('../lib/pii');
const t = P.redactText('Мой телефон +7 (916) 123-45-67, почта ivan.petrov@mail.ru, нужен 83 19 2 158 851 и 11 42 8 507 683, VIN WBS11CS0609158489');
a.ok(!/916|123-45-67|ivan\.petrov|mail\.ru/.test(t), t);
a.ok(t.includes(P.PHONE_MASK) && t.includes(P.EMAIL_MASK), t);
for (const keep of ['83 19 2 158 851', '11 42 8 507 683', 'WBS11CS0609158489']) a.ok(t.includes(keep), `${keep} must stay: ${t}`);
a.ok(P.redactText('Подойдёт 13627823945?').includes('13627823945')); // an 11-digit BMW number is not a phone
a.ok(!P.redactText('звоните 89161234567').includes('89161234567'));
const msgs = P.redactMessages([{ role: 'user', content: 'мой номер 8 916 123 45 67' }, { role: 'assistant', content: 'Спасибо' }]);
a.ok(!/916/.test(msgs[0].content) && msgs[1].content === 'Спасибо');
console.log('test-pii: all ok');
