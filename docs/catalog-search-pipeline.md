# AI parts agent — how a catalog answer is built (state 28.10.2026, evening)

Decisions agreed with the owner/agency on 27–28.10, in the order the bot applies them. Technical details per step: README.md (sections from «Smarter catalog search» on).

**Models:** every AI step runs on **Claude Sonnet 5**. Claude Haiku 4.5 is only the emergency fallback (Sonnet error / timeout / unreadable answer). Owner tests 28.10: same cost (~$0.07–0.09 per message either way), clearly better quality — Haiku missed search words and judged rows poorly. Quality over speed: request reading keeps Sonnet's thinking (~12 s).

1. **Understand the request (Sonnet 5, `extractVehicleInfo`).** Part keywords keep only the place/side words the customer actually wrote; code removes invented «задний», «передний» (`dropInventedQualifiers`). It also gives catalog search names (`partSearchNames`, main noun first, e.g. «суппорт») and allowed BMW main groups (`partGroups`). «Ремень и ролики» = drive belt + rollers (modern BMW engines have a timing chain). Keys and coding are workshop services: no catalog search (`workshopServiceTopic`).
2. **Search by the catalog's own words (code + site catalog).** AI names first, then the customer's words, then fixed fallbacks. «Стойка» and «амортизатор» are one family — both are always searched (`DAMPER_FAMILY`).
3. **BMW main-group check (code).** First two digits = main group (`BMW_MAIN_GROUPS`, verified by the agency); rows outside the allowed groups are dropped. Fixed groups for common parts (`KEYWORD_GROUPS`), the AI fills in the rest.
4. **Front / rear axle (code, `axleOf`).** 31… front axle, 33… rear axle, brakes 34 1x… front, 34 2x… rear — every row is marked; the bot names the axle itself instead of asking for a VIN or the manager.
5. **AI filter / one clarifying question (Sonnet 5, `aiFilterParts`).** Precise request → only the requested rows. Vague request with different parts («глушитель», «насос», «подшипник», «колодки» → «Передние / Задние») → one question with buttons from the real rows + «Все варианты». Never two questions in a row.
6. **Re-search.** If rows were found but none fits, the filter suggests other catalog words (`searchAgain`, e.g. «амортизатор»); the code searches once more and the filter decides again or asks.
7. **Versions of one part (code, `versionCheck`).** Production-date check from the VIN. With a VIN the catalog already filters by equipment (confirmed live), so an equipment note means «подходит по VIN»; without a VIN — the equipment question with «Не знаю».
8. **Answer (Sonnet 5).** Cards / «Открыть деталь», live prices, diagrams in the same order as the text (`orderCardsByText`). **Self-service purchase:** open the part, pick an offer, cart, «Оформить заказ» — the manager only for what the AI can't solve (`dropNeedlessManagerButton`).

**Monitoring:** dashboard «Каталог» dots — white (not needed), green (used), yellow (searched, nothing found; hover shows what was tried), red (blocked). Log lines: `[extract] <model>: N ms`, `DIAG laximo` (rows with axle, groups, dropped, versions, searchedAgain), `[laximo] AI filter … kept / asks / search again`, `[cost] message: … total ~$…`.
