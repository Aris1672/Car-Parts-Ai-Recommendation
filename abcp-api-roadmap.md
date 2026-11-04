## 🗺️ ABCP API — future to-do list

Everything the ABCP **admin API** (`cp/…`, docs: ABCP API → Административный интерфейс) could add to the bot and the dashboard. **Done** = live. Priority: ⭐⭐⭐ high, ⭐⭐ medium, ⭐ low. **ABCP limits per operation (tariff "S-Klasse", from "Детализация услуг"):** articles/info 10/10/10 (min/hour/day), orders 1 000/20 000/120 000, users 500/10 000/100 000, search/brands 900/9 000/90 000, others 2 000/2 000/10 000. Rule for all items: the bot only **reads**. Any write operation runs only from the admin dashboard, after an explicit click by Михаил, and is whitelisted one by one in `lib/abcpOrders.js` (`READ_ONLY_OPS`) or a separate admin-only client.

### For customers (chat widget)
- [x] **Order status** by order number or "Код заказа" + phone/email — `cp/order`, `cp/orders`, `cp/users`, `cp/statuses` *(session 17, live 23.10.2026)*
- [ ] ⭐⭐⭐ **"Оплатить заказ" button** for verified orders with an amount due — `cp/payment/token` (ABCP's own payment link). Small, builds on order status.
- [ ] ⭐⭐⭐ **Live price & availability for any part number** (not only the photo feed). **Confirmed possible**: `search/articles` (one number+brand, incl. online suppliers) and `search/batch` (up to 100, own price lists), as API-admin with the retail `profileId`. Limits OK: counts under search/brands (90 000/day) or others (10 000/day), plus the monthly "Поисковые запросы" quota (400 000; ~16 000 used in Oct 2026).
- [ ] ⭐⭐ **Order timeline**: accepted → ordered from supplier → in transit → ready, with dates — `cp/order/statusHistory`, `cp/orders/statusHistory`.
- [ ] ⭐⭐ **Product details for parts without a feed card**: description, photos, properties (viscosity, approvals, sizes) — `cp/articles/info/batch` (POST, read-only, max 100 per call; images at `https://imgcdn.abcp.ru/p/<name>`). Also lets the bot answer oil-approval questions from real data.
- [ ] ⭐⭐ **Customer's garage**: after the phone check, use the cars (often with VIN) saved on the site — "Вижу у вас BMW X5 G05 — подбираю для неё?" → VIN to Laximo — `cp/users/garage`.
- [ ] ⭐ **Delivery times by zone** for "сколько ехать в …?" — `/cp/user/shipmentAddressZones` (min. delivery days per zone).
- [ ] ⭐ **Pickup offices** list/addresses kept in sync with ABCP — `cp/offices`.
- [ ] ⭐ **Supplier promotions** mentioned when they fit the request — `cp/distributors/notes`.
- [ ] ⭐ **Oil/fluid selection by catalog filters** (brand, viscosity, approval) — `/cp/catalog/info`, `/cp/catalog/search`, then `/cp/articles/info/batch`. Same paid service as the tyres item.

### For Михаил (admin dashboard)
- [x] **"Нет фото" → ABCP catalog check**: background check of every missing article against ABCP's catalog (`cp/articles/info/batch`), with thumbnail, description and an ABCP filter in the tab *(session 18, 23.10.2026; built but **off**: site tariff allows only 10 `articles/info` per day; needs the paid "API Crosses" tariff, 250 000 ₽ + from 38 400 ₽/month)*
- [ ] ⭐⭐ **"Нет фото" → product card text with one click**: `cp/productCards` (write, admin-only), description + SEO texts. ⚠️ The API does **not** upload photos; the card limit is a paid service (`403 Article cards limit exceeded`).
- [ ] ⭐⭐ **"Нет фото" → photo upload** via "Мои каталоги" import with an image archive — `/cp/usercatalogs/{catalogId}/upload` (`imagesArchive`, multipart) + `/cp/usercatalogs/{catalogId}/tasks/{taskId}/status`. Bigger job; needs a user catalog set up in ABCP.
- [ ] ⭐⭐⭐ **"Неудовлетворённый спрос" tab**: what customers searched on the site and didn't buy (in stock / not / analogs, put in cart or not) — `/cp/reports/unsatisfiedDemands`. Same idea as "Нет фото", for the whole site.
- [ ] ⭐⭐ **Bot conversions**: match chat sessions to real ABCP orders (phone/email from the manager handoff → `cp/orders` by date) → "orders after chat" in the dashboard.
- [ ] ⭐ **Status/notification overview**: which statuses notify customers (`cp/statuses`: notify, paid, delivery flags). Check that ABCP's own SMS/email notifications cover what the bot is asked most.
- [ ] ⭐ **Price-list freshness**: supplier list + status (`cp/distributors`, `cp/routes`) → warn when a supplier is switched off or stale.

### Not for the bot (exists in the API, deliberately not used)
Changing orders (`cp/order` POST, `merge`, `toArchive`/`fromArchive`), sending orders to suppliers (`cp/orders/online`), balances/credit limits/payments (`cp/finance/*`), creating or editing customers (`cp/user/new`, `cp/user`), suppliers and routes (`cp/distributor*`, `cp/routes*`), staff (`cp/manager`), and the password-recovery history (`cp/actionsHistory`).

