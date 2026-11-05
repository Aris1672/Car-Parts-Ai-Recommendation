# Review status (Claude)

| Turn id | File | Customer → bot | Owner note | Status | Fix (main) |
|---|---|---|---|---|---|
| 7 | 2026-11-04_2314 | «Свеча зажигания BMW 530» → only 5' E60 / E60 LCI | — | ✅ fixed | `dcdf954` AI-added body code (E60) not used unless the customer wrote/clicked it |
| 3, 5, 12, 14 | 2026-11-04_2314 | «… BMW 530 / 530xi» → 5' G30 LCI → only ALPINA B5 / D5s buttons | «Those buttons are not relevant…», «Here we have the Alpina again», «Agin» | ✅ fixed | `571cd2f` 530xi = 530iX; next commit: the word «BMW» matched only the «BMW ALPINA …» options -- ignored now; a typed model number (530) narrows the «Модель» buttons to 530d / 530i / 530iX… (test in test-laximo-api.js) |
| 2, 4, 8, 9, 10, 1 | 2026-11-04_2314 | ✓ | — | ok | — |
| 36 | 2026-11-05_1418 | «Воздушный фильтр BMW M5» → asked year/engine, no buttons | «We have corrected this issue» | ✅ fixed | `c8e2879` M cars: generation buttons of the family that had the M car |
| 38, 40 | 2026-11-05_1418 | «5' G90 M5» → two air filters, «оба варианта», empty «** **», marker on 3 for pos. 4 | «два фильтра, маркер поз. 4 не тот» | ✅ fixed | `d168bea` diagram from the group's own unit; same-name cards show the note (cyl. 1–4 / 5–8); prompt: both needed |
| 34 | 2026-11-05_1418 | «Писал в телеграм - нет ответа» → order status + «напишите в Telegram» | — | ✅ fixed | `d168bea` no-answer complaint → request form instead of the Telegram line |
| 37, 39, 35, 32, 33, 30, 31, 27, 26, 25, 24, 19–23, 15–18 | 2026-11-05_1412 / _1418 | ✓ | — | ok | — |
