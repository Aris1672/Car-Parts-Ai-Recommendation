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
| 320 | 2026-11-09_1241 | Mercedes CLA, «А какие есть алтернативы?» → brake / CD / DVD discs with the wheel rim | — | ✅ fixed | `42c9832` bare «диск» next to «колесный диск» dropped |
| 311 | 2026-11-09_1241 | «Liqui moly 4087» → empty «Вот что нашлось» | «LiquiMoly Очист.кондиционера Klima Anlagen Rein. (0,25л)» | ✅ fixed | `42c9832` brand + digit number → ABCP search/brands, named brand |
| 288 | 2026-11-09_1241 | «в наличии (1 шт.)», «менеджер закажет второй» | «the product page has several offers» | ✅ fixed | `42c9832` prompt: no stock quantity, quantity set in the cart; also bare «диск» dropped |
| 272–319 (except 288, 311) | 2026-11-09_1241 | ✓ / test turns | — | ok | — |
| 326 | 2026-11-09_1325 | «Датчик абсолютного давления и температуры воздуха» 230i → 14 sensors | «= Датчик T-Map» | ✅ fixed | `98bd4fd` one keyword, catalog «Датчик T-Map» only |
| 323–325 | 2026-11-09_1325 | ✓ (325: «- —» leftovers cleaned in `98bd4fd`) | — | ok | — |
| 329, 331 (and 327, 330) | 2026-11-09_1502 | «Датчик температуры о.ж» 230i → «ничего не найдено» | — | ✅ fixed | `76fbbe1` sensor keyword matched the fluids group rule (83), group check dropped 13 62 7 580 635 (group 13); sensors get their own group rule. Short form «охл.жидкости» (`44e3970`) was searched correctly |
| 328 | 2026-11-09_1502 | A2903303600 | — | ok | — |
| 332–336, 338, 339 | 2026-11-09_1644 | 230i `WBA2H71010VF78880`: «Датчик температуры о.ж», «Датчик температуры» → variant buttons → pick (испарителя / головки блока цил. / охл.жидкости) | owner's live tests 09.11 («This was corrected») | ✅ done | `44e3970` short forms, `76fbbe1` sensor groups, `6c7451c`…`c5e60b0` whole unit diagram + position buttons, `0c94902` / `958bec1` variant question in code, `62b592d` soft group check, `4a8abb5` typed answers |
| 337 | 2026-11-09_1644 | «BMW 11 28 2 339 110» | — | ok | — |
| 340–361 | 2026-11-09_1651 | 230i `WBA2H71010VF78880`: «Датчик температуры» / «… охлаждающей жидкости» → variant buttons → whole unit diagram → position card (поз. 4, 18, 2) | owner's live tests 09.11 (✓) | ✅ done | `0c94902` variant question, `6c7451c`…`c5e60b0` unit diagram, `8983853` same-kind buttons, `62b592d` soft group check |
| 362–371 | 2026-11-09_1651 | 230i: «Серводвигатель» → (362 before the fix: harness only) → variants «Серводвигатель / Жгут проводов…» → cylinder head поз. 3 → «Да 3» (365, 368 before the fix: normal path) / «да» (371) → 11 37 8 652 738 | owner's live tests 09.11 (✓) | ✅ done | `958bec1` variants by contained name + actuator groups, `4a8abb5` typed answers |
| 372 | 2026-11-09_1651 | «Датчик положения распредвала» 230i | ✓ | ok | — |
| 375 | 2026-11-09_1734 | 225xe `WBA6Y310707F26748` «Моторное масло» → «знаете ли допуск?» though the catalog lists LL17FE+ 0W20 | — | ✅ fixed | `310078e` approval from the catalog rows, prompt: don't ask |
| 376 | 2026-11-09_1734 | 225xe «Задние тормозные колодки» → + «Опора подъемной платформы» (keyword «задние накладки» → «Накладки порога») | — | ✅ fixed | `310078e` «накладки» only as the pads' search word |
| 373, 374 | 2026-11-09_1734 | ТО 225xe | ✓ | ok | — |
| 381 | 2026-11-09_1750 | 225xe «Передние и задние» pads + discs → front pads missing («подберёт менеджер»), rear disc / sensor without cards, «— (…)» lines | — | ✅ fixed | `fa3e7d2` one-axle group → word search for the other axle; axle-aware card check; text rules |
| 377–380 | 2026-11-09_1750 | 225xe ТО, моторное масло (approval from the catalog, `310078e` confirmed), axle question | ✓ | ok | — |
| 393, 396 | 2026-11-09_1758 | 225xe «и тормозные колодки/диски» after the ТО kit → the 9 ТО keywords carried over, kit cards repeated, AI axle question without buttons | ✗ | ✅ fixed | `51078a0` a follow-up naming parts keeps only those; the kit path skipped → code axle question with buttons |
| 391, 392, 394, 395 | 2026-11-09_1758 | 225xe ТО, oil, pads | ✓ | ok | — |
| 400 | 2026-11-09_1810 | 225xe «Передние и задние» pads + discs → front pads missing again («no front brakr pads») | ✗ | ✅ fixed | `51f618a` pads still missing for an axle → taken from that axle's brake unit (the front disc's unit «Тормозной механизм переднего колеса») |
| 382–386 | 2026-11-09_1810 | X5 G05 40i «Колпак ступицы колеса неподв.» → the hub group «Ступица колеса, составляющие» gave hubs, axle question, «колпаков в каталоге нет», hub cards | — | ✅ fixed | `51f618a` «колпак» counts as a component → no rows in the hub group → word search «колпак» (group 36) |
| 401 | 2026-11-09_1810 | «нужен комплект, который не крутится» → «показал в карточках ниже» with no cards | ✗ | ✅ fixed | `51f618a` card/«есть» sentences dropped when no card came + an honest line |
| 402 | 2026-11-09_1810 | «не вижу карточки» → generation asked again (X5 G05 fell out of the last 10 messages) | — | ✅ fixed | `51f618a` widget sends the customer's older messages as one short first message |
| 397–399 | 2026-11-09_1810 | 225xe ТО → «тормозные колодки/диски» → axle buttons | ✓ | ok | — |
| 406, 410 | 2026-11-09_1818 | 225xe ТО → «и тормозные колодки/диски» → «Передние и задние» → the ТО kit again (13 cards), no brake cards / «в данных нет позиций» | ✗ | ✅ fixed | `6453e18` a short axle answer takes the parts from the message that asked for them; the kit path skipped |
| 403–405, 407–409 | 2026-11-09_1818 | 225xe ТО, axle buttons for the brakes (`51078a0` confirmed) | ✓ | ok | — |
| 416, 420 | 2026-11-09_1856 | 225xe «Передние и задние» pads + discs → «Левая / Правая / Обе» question | ✗ | ✅ fixed | `4dac256` caused by `51f618a`: the front-unit fallback also took «Направляющая тормозных колодок Л / П»; now only the pad set, and fitting parts never trigger the side question |
| 417, 421 | 2026-11-09_1856 | «Обе стороны» → front discs missing (#417) / guide rails as cards (#421) | ✗ | ✅ fixed | `4dac256` same cause; front pads 34118867481 now found from the front brake unit |
| 411–415, 418, 419 | 2026-11-09_1856 | part number 51317389423, ТО, axle buttons | ✓ | ok | — |
| 423, 425 | 2026-11-09_1913 | 225xe «Тормозные колодки» + VIN → only the rear set, no axle question (the group «Колодки тормозные дисковые» lists only the rear set) | ✗ | ✅ fixed | `30a7ac2` pads of one axle found -> the other axle's set from the brake unit «Сервисное обслуживание тормозов» (front 34118867481, pos. 02) -> axle question |
| 422, 424 | 2026-11-09_1913 | «Тормозные колодки» without a car -> VIN asked | ✓ | ok | — |
| 427, 429 | 2026-11-09_1920 | 225xe «Тормозные колодки» + VIN → only the rear set again (`30a7ac2` looked only in the rear set's own unit «Тормозной механизм заднего колеса» -> 0 rows); AI axle question in text (#427); «менеджер подберёт замену» | ✗ | ✅ fixed | `af820b6` axle always asked for pads/discs (owner); the other axle's pads from every unit of the found rows («Сервисное обслуживание тормозов») and the wear sensors' units; the manager-replacement clause removed |
| 426, 428 | 2026-11-09_1920 | «Тормозные колодки» without a car -> VIN asked | ✓ | ok | — |
| 390 | 2026-11-09_1920 (from 14:55 UTC) | 225xe «тормозные колодки/диски» → «Передние и задние» → front pads missing, «менеджер подскажет замену» | ✗ | ✅ same cause as #400 / #427 | `51f618a`, `af820b6` (missed in the earlier STATUS rows; checked 10.11) |
| 468 | 2026-11-10_1044 | «288674242 этот заказ пришёл его можно забрать сейчас?» → the same full status again, no answer | ✗ | ✅ fixed | `b9ab6f6` pickup question → a direct lead line (Да, можно забирать / Пришла часть / Пока нет + expected date), then the status |
| 430–467 | 2026-11-10_1044 | brake chips multi-select / no-car reply, X5 / X6 axle + sides, колпак ступицы, F16 pads, order status | ✓ | ok | — |
| 472 | 2026-11-10_1051 | «этот заказ пришёл, можно забрать?» → answer good («Пока нет…»), but the full order details repeated | ✗ | ✅ fixed | `ea712f8` order already shown in this chat → only the answer line |
| 469–471 | 2026-11-10_1051 | order status 288674242 | ✓ | ok | — |
