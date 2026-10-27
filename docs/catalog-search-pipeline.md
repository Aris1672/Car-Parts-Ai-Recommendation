# AI parts agent — how a catalog answer is built (state 28.10.2026)

Decisions agreed with the owner/agency on 27–28.10, in the order the bot applies them. Technical details per step: README.md (sections from «Smarter catalog search» on).

1. **Understand the request.** The extraction step writes the part keywords and keeps only the place/side words the customer actually wrote. Code removes invented «задний», «передний» and similar (`dropInventedQualifiers`). «Ремень и ролики» means the drive belt plus rollers, since modern BMW engines have a timing chain. Keys and coding questions are workshop services: no catalog search (`workshopServiceTopic`).
2. **Search by the catalog's own words.** The AI gives 1–3 catalog names per part, main noun first (`partSearchNames`, e.g. «суппорт»). The bot searches those, then the customer's own words, then fixed fallbacks. This usually means fewer catalog requests than before.
3. **BMW main-group check.** The first two digits of a BMW/MINI number are its main group (`BMW_MAIN_GROUPS`, verified by the agency: 11 engine, 34 brakes, 82 accessories…). Rows outside the groups allowed for the part are dropped. Common parts have fixed groups in code (`KEYWORD_GROUPS`); the AI fills in the rest (`partGroups`).
4. **AI filter / one clarifying question.** For a precise request the AI keeps only the requested rows. For a vague request with different parts («глушитель», «насос», «ремень») the bot asks one question with buttons made from the real catalog rows, plus «Все варианты» (`aiFilterParts`). It never asks two questions in a row.
5. **Versions of one part** (`versionCheck`).
   - **Date check:** the production date from the VIN drops versions that don't fit.
   - **With a VIN:** the catalog already filters by the car's equipment (confirmed: the Adaptive Drive pump section is empty for a car without it), so an equipment note on a found part means «подходит по VIN».
   - **Without a VIN:** the equipment question «Эта деталь отличается по комплектации» with buttons + «Не знаю».
6. **Self-service purchase.** When a part is found, the customer opens it, picks an offer, adds it to the cart and orders. The bot does not push the manager (`dropNeedlessManagerButton`). The manager is only for what the AI can't solve: a person asked for, nothing found, compatibility not confirmed, discounts, or a problem with an existing order.

**Monitoring:** the dashboard «Каталог» dots are white (not needed), green (used), yellow (searched but nothing found; hover shows what was tried) and red (blocked). Server log lines: `DIAG laximo` (rows, groups, dropped, versions) and `[laximo] AI filter … asks/kept`.
