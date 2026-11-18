# Order automation workflow and test checklist

Updated: 18 November 2026 (Europe/Moscow).

## Scope and evidence

This is the proposed hybrid workflow: official API reads plus ABCP web-panel actions for operations without a confirmed equivalent API. This document does not authorize live tests or changes to production switches.

ABCP support corrected its initial guidance: changing the customer of an existing order directly through POST cp/order is not supported. Creating a replacement order is not equivalent to the panel action. Do not automatically clone/delete orders to imitate guest transfer.

Support confirmed that GET cp/payment/top-balance-link with amount=2000 generates a 2,000 RUB balance top-up link. There is no official API for sending it through ABCP channels or checking notification delivery. Matching a balance payment by client and amount alone does not reliably identify a particular order.

Official reference: [ABCP administrative API](https://www.abcp.ru/d/docs/api/abcp1/api-abcp-admin).

## Workflow table

Legend: **API** = documented API route available; **Web panel** = required for the existing ABCP workflow; **Our database** = internal persistence; **Needs verification** = not yet established.

| # | Step | Access method | What to test |
|---|---|---|---|
| 1 | Find new orders created today, using Moscow time | **API** | Correct date cutoff, pagination, and exclusion of deleted/archived orders. |
| 2 | Read order details, positions, statuses, customer ID and amounts | **API** | Complete, current data and correct processing eligibility. |
| 3 | Determine whether the order belongs to a guest or registered client | **API**, with **Web-panel confirmation** | Validate guest identification against the panel's actual customer state. |
| 4 | Find an existing client by phone/email before creating another | **API method/filter needs verification** | Exact matching, normalized contacts, and safe handling of multiple matches. Support has not yet clarified the recommended method. |
| 5 | Create a client record separately | **API** | Required fields, duplicate handling, and returned client ID. This alone does not transfer the guest order. |
| 6 | Perform «Создать клиентскую запись и перенести заказ» | **Web panel** | Use ABCP's actual transfer action; verify the resulting client and order number. No confirmed equivalent API operation. |
| 7 | Reload and verify the transferred order | **API + Web panel** | Correct client, resulting order number, positions, amounts, statuses, and payment preservation. |
| 8 | Check whether the initial payment request was already sent | **Web panel + Our database** | Recognize green/grey envelope and existing send records. Support says no API send-history tool is available. |
| 9 | Generate a 2,000 RUB balance top-up link | **API** | GET cp/payment/top-balance-link with clientId and amount=2000. Support confirmed the amount and purpose. |
| 10 | Send the initial request through ABCP Email + Telegram | **Web panel** | Correct recipient, amount, and channels; distinguish email success from Telegram failure. No official sending API. |
| 11 | Record initial send outcome and prevent duplicate automatic sends | **Our database + Web-panel evidence** | Persist confirmed success; uncertain outcomes require review rather than blind retries. |
| 12 | Start the one-time reminder timer after confirmed initial email | **Our database** | Store actual successful send time; reminder becomes due after 65 minutes. No historical backfill. |
| 13 | Read incoming online payments / financial records | **API** | Verify available client, amount, time, payment IDs, and order-link information. |
| 14 | Decide whether a particular order's prepayment has been received | **Web panel** for existing rule; **API replacement needs verification** | Both green + and red × mean paid. Client + amount alone is not reliable order matching. Missing/unfamiliar markup remains unknown. |
| 15 | Send the one-time reminder through ABCP | **Web panel + Our database** | Recheck payment, claim reminder before sending, and never automatically retry an uncertain send. |
| 16 | Handle manager activity, merged orders, and changed order state | **API + Web panel + Our database** | Refresh before actions; skip stale/missing orders; verify changed order IDs and avoid duplicate actions. |

Steps describe capabilities, not unconditional writes: standalone API client creation (step 5) must not precede a panel action that itself creates a client unless that sequence is explicitly verified. Avoid duplicate client records.

## Link generation versus delivery

There are two possible routes, not two sends:

- **Keep ABCP delivery:** the web-panel form generates/sends the payment request. A separate API link-generation call is not necessarily needed.
- **Use our own email provider:** generate the link through the API, then deliver it ourselves. This changes the workflow and may not update ABCP's envelope indicator. It requires separate approval, durable tracking, and manager coordination.

The current test direction is the first route: **API reads + ABCP web-panel actions**. Balance top-up links are client-level; do not silently replace them with order-payment links from cp/payment/token.

## Phase 1 — Read-only access

- [ ] Confirm automated writes remain paused; verify production configuration rather than assuming prior switch changes were applied.
- [ ] Open the orders page from Coolify; check HTTP status.
- [ ] Wait for the actual orders table and verify customer/envelope/payment recognition.
- [ ] Open a payment-message form without submitting it.
- [ ] Confirm the persistent browser profile is using the intended account; configured username alone does not prove active session identity.
- [ ] Stop if HTTP 403/414 persists; investigate with ABCP support rather than bypassing the refusal.

### Known web access evidence

The asynchronous orders-table loading defect was corrected locally and deployed by the owner. Subsequent logs showed customer recognition and one successful guest transfer, but payment sends failed without confirmed success. Later diagnostics returned HTTP 403 for the payment form and HTTP 414 for the orders page, including in a clean browser context. A short URL, no redirects, and small cookies were observed. An IP restriction or specific upstream cause has not been proven. Official API logistics reads continued to work independently of the web panel.

## Phase 2 — Offline safety tests

- [ ] Test duplicate prevention and uncertain outcomes, including initial sends.
- [ ] Test guest-transfer responses and changed order numbers.
- [ ] Test paid/unpaid/unknown detection.
- [ ] Test manager changes, merged orders, and missing rows.
- [ ] Test reminder timing and single-attempt protection.

## Phase 3 — Explicitly approved live tests

- [ ] Transfer one selected guest order, then verify the result.
- [ ] Send one initial 2,000 RUB request to an approved test recipient.
- [ ] Confirm delivery and persistent send tracking.
- [ ] Confirm a subsequent check does not resend.
- [ ] Test a reminder only on an approved test case after payment detection is verified.

## Safety constraints

- Keep live writes paused during access diagnosis. ORDER_AUTOPILOT_DRY_RUN=1 blocks transfers/payment sends, but does not by itself stop all browser reads.
- Preserve autopilot and reminder history. Do not reset browser profiles or clear cookies without evidence and a recovery plan.
- Reminder 290231901 was reported uncertain and requires manual reconciliation before another send. Do not use it for repeat-send testing.
- Green/grey envelopes indicate initial-message state, not receipt of payment. Green + and red × in the payment cell both suppress reminders.
- Reminder timing starts from a new confirmed initial email, not the order date, envelope, or mutable audit timestamp.
- Default browser-page pagination remains a limitation; an absent order is unknown, never proof of nonpayment.
- Do not log or commit credentials, cookies, or live payment links.
