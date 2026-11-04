# Review status (Claude)

| Turn id | File | Customer → bot | Owner note | Status | Fix (main) |
|---|---|---|---|---|---|
| 7 | 2026-11-04_2314 | «Свеча зажигания BMW 530» → only 5' E60 / E60 LCI | — | ✅ fixed | `dcdf954` AI-added body code (E60) not used unless the customer wrote/clicked it |
| 3, 5, 12, 14 | 2026-11-04_2314 | «… BMW 530 / 530xi» → 5' G30 LCI → only ALPINA B5 / D5s buttons | «Those buttons are not relevant…», «Here we have the Alpina again», «Agin» | ✅ fixed | `571cd2f` 530xi = 530iX; next commit: the word «BMW» matched only the «BMW ALPINA …» options -- ignored now; a typed model number (530) narrows the «Модель» buttons to 530d / 530i / 530iX… (test in test-laximo-api.js) |
| 2, 4, 8, 9, 10, 1 | 2026-11-04_2314 | ✓ | — | ok | — |
