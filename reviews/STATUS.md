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
| 145, 146 | 2026-11-06_0928 | «Корпус масляного фильтра X5 40i» → only filter elements, «корпуса отдельно нет» | — | ✅ fixed | `314c57f` component keyword (корпус, крышка…) with no matching group row → word search |
| 102–144 (except 145, 146) | 2026-11-06_0928 | ✓ | — | ok | — |
| 107, 108 | 2026-11-06_0928 | (marked ✓, found by Claude) #107 «Принял, сейчас проверю по VIN.» over the ТО cards; #108 «комплект для V8» for the 6-cyl. XM 50e | — | ✅ fixed | `e549535` stall line → summary line; prompt: no «сейчас проверю», engine facts only from data |
| 153 | 2026-11-06_1258 | «CS010502PN» → not recognised as an article, questionnaire | «not correct yet, discuss» | ✅ fixed | `7fbf42a` any article → ABCP search/brands + search/articles → card |
| 147–152, 154–156 | 2026-11-06_1258 | ✓ (149 already fixed: `edee19b`) | — | ok | — |
| 175 | 2026-11-06_1955 | 230i F22 VIN, 5 parts → cards for 3; «прокладки впускного коллектора и поддона АКПП с фильтром в каталоге с фото нет, уточню у специалиста» | «- Прокладка впускного коллектора, - Поддон АКПП с фильтром ?» | ✅ fixed | `8e8e0b7` + `c8eafd1` («прокладка X» = catalog «уплотнение X», owner 06.11) every found part gets a card (gasket rows were found and in the price list); ATF pan / filter → group «Фильтр трансмиссионный»; «— арт.» leftover |
| 157, 158 | 2026-11-06_1955 | «CS010502PN» → Coolstream antifreeze card | «This is a test» | test | — |
| 159–174 (except 175) | 2026-11-06_1955 | ✓ | — | ok | — |
| 213, 215, 219, 225, 227, 229, 242, 244 | 2026-11-06_2211 | 230i, 5-part list: gasket / flange missing or wrong (builds before the evening fixes) | — | ✅ fixed | `f702fb2` «коллектора» key, `c6def99` names-table rows survive the AI filter, `8e8715e` … and the group check |
| 246, 256 | 2026-11-06_2211 | AI question on a 5-part list («Какие детали вам нужны?», «Фланец — вариант 1 / 2») | — | ✅ fixed | `a44f596` no AI variant question for a list |
| 250 | 2026-11-06_2211 | 230i: gearbox pan kit dropped by the AI filter → «менеджер подберёт» | — | ✅ fixed | `15702a9` catalog-group rows of a fully dropped part put back |
| 266 | 2026-11-06_2211 | X5 E70 40d: gasket = 2 AGR «Профильная прокладка» rows | owner: gasket is in «Монтажный комплект турбонагнетателя» | ✅ fixed | `a11416d` kit fallback; confirmed in #271 (2026-11-06_2239) |
| 176–265 other | 2026-11-06_2211 | ✓ / tests | — | ok | — |
| 267, 268, 269 | 2026-11-06_2239 | «5JA071497N 8Z8» → «не нашёл артикул 5JA071497N» | screenshot: VAG 5JA071497N8Z8 21 700 ₽ | ✅ fixed | `b56f5fe` spaced VAG number / suffix joined |
| 270, 271 | 2026-11-06_2239 | ✓ (X5 E70: kit 11652456238 shown for the gasket) | — | ok | — |
| 232–237 | 2026-11-06_2239 | X7 G07 30dX, «Рычаг» → generation / model / axle / side questions → 4 front-left arms | owner rechecked 06.11: correct (#236 ✗ withdrawn) | ok | — (open ideas: one card for a superseded number «см. …»; «рычаг» incl. «тяга») |
