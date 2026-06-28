# 10 · Payments

Paystack-only, end to end. Implemented as Convex `action`s for outbound API calls and `httpAction`s for inbound webhooks. No direct Daraja integration.

## Architecture

```
                   Atlas Org (Blyss)
                          │
                          ▼
            ┌──────────────────────────────────────────┐
            │  Paystack integration (encrypted Tier-1) │
            │  orgIntegrationKeys[provider=paystack]   │
            │  meta: { mode: 'live'|'test', publicKey }│
            └────────────────┬─────────────────────────┘
                             │
       ┌─────────────────────┼─────────────────────┐
       ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Subaccounts  │    │ Customers    │    │ Webhook       │
│ (1 per ws)   │    │ (per contact)│    │ Receiver      │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       ▼                   ▼                    ▼
┌──────────────┐    ┌──────────────┐    ┌─────────────────┐
│ Bank/M-PESA  │    │ Payment      │    │ HMAC-SHA512     │
│ destination  │    │ Requests     │    │ verified +      │
│ per workspace│    │ (invoices)   │    │ idempotent      │
└──────────────┘    └──────────────┘    └─────────────────┘

Outbound (payouts) — Paystack Transfers API to KE bank / M-PESA wallet / paybill / till
Marketplace splits — Paystack Transaction Splits API
```

## Where the code lives

```
convex/payments/
  paystack.ts         Outbound API client (verify, charge, transfer, etc.)
  webhook.ts          httpAction for /paystack/webhook (registered in convex/http.ts)
  subaccounts.ts      Create/manage subaccount per workspace
  paymentLinks.ts     Generic Payment Pages
  invoices.ts         Payment Requests (one-off invoices)
  subscriptions.ts    Plans + Subscriptions (card-only)
  reminders.ts        M-PESA renewal reminder loop
  transfers.ts        Outbound payouts
  splits.ts           Marketplace multi-split definitions
  settlements.ts      Daily reconciliation cron
  types.ts            Zod schemas for webhook payloads
```

## Paystack credentials (Tier-1 row)

In `orgIntegrationKeys` with `provider='paystack'`:

- `encryptedValue` = the **secret key** (`sk_live_xxx` / `sk_test_xxx`)
- `meta` = `{ mode: 'live'|'test', publicKey: 'pk_…', businessName: '…' }`

The **webhook secret is the same secret key.** Atlas verifies inbound webhooks using HMAC-SHA512 of the raw body, compared in constant time to the `x-paystack-signature` header.

## Per-workspace subaccounts

One Paystack subaccount per Atlas workspace. Created when Workspace Owner adds banking details:

```ts
// convex/payments/subaccounts.ts → internalAction
const sa = await paystack.subaccount.create({
  business_name: workspace.name,
  settlement_bank: bankCode,             // KE bank or 'MPESA' for wallet
  account_number: accountNumber,
  percentage_charge: 0,
  primary_contact_email: ownerEmail,
  metadata: { workspace_id: workspace._id },
});
// Persist to paystackSubaccounts table
```

Then every charge for that workspace includes `subaccount: sa.subaccount_code` so settlement routes to the right destination.

## The four core flows

### 1. Payment Links (no invoice needed)

Use case: "Send me KES 5,000 for the consult call."

- Convex action `createPaymentLink` calls `POST /page` with `subaccount` set
- Returns `{ id, slug, paystackUrl }` — Atlas wraps with branded short link `pay.atlas.blyss.co.ke/<slug>` that 302s to Paystack
- Share via email, WhatsApp, copy link
- Customer pays → webhook → `payments` row marked paid

### 2. Invoices (Payment Requests)

Use case: Studio sends formal invoice for Karen project.

1. Compose in TipTap with line items, total in KES cents (`v.int64()`)
2. Generate PDF via `@react-pdf/renderer` in a Convex action; store via `ctx.storage.store(blob)`
3. Create Paystack Payment Request:
   ```ts
   await paystack.paymentRequest.create({
     customer: customerCode,
     amount: totalCents,
     currency: "KES",
     due_date,
     line_items,
     send_notification: false,           // Atlas sends via its own templates
     metadata: { workspaceId, documentId, dealId },
   });
   ```
4. Send via email + WhatsApp (PDF attached + Paystack pay URL CTA)
5. Customer pays → `paymentrequest.success` webhook → invoice marked paid → timeline event → deal advances if configured

### 3. Subscriptions (card-only)

Paystack subscriptions support **card + Nigerian Direct Debit only** — no M-PESA recurring (STK push requires PIN entry every time).

- **Card customers** → Paystack Plans + Subscriptions API. Webhooks: `subscription.create`, `invoice.create`, `invoice.payment_failed`.
- **M-PESA customers** → Atlas runs an **invoice + reminder loop** (next section).

### 4. M-PESA renewal reminder loop

For recurring customers paying via M-PESA, Atlas auto-creates a new Payment Request each renewal date and sends reminders. Cron `subscription-reminders` (`crons.cron` daily 06:00 UTC):

- 30 / 14 / 7 / 1 day before next due, create new Payment Request
- Send invoice via email + WhatsApp at each interval
- Webhook on payment → mark paid → schedule next due date

### 5. Transfers (payouts out)

Contractor payment, refund, creator payout. `convex/payments/transfers.ts`:

```ts
// 1. Create/fetch recipient
const recipient = await paystack.transferRecipient.create({
  type: 'mobile_money',        // or 'nuban' for bank
  name: 'Patricia Mwangi',
  account_number: '254712345678',
  bank_code: 'MPESA',
  currency: 'KES',
});

// 2. Initiate transfer
const transfer = await paystack.transfer.initiate({
  source: 'balance',
  amount: 250000n,             // cents
  recipient: recipient.recipient_code,
  reason: 'Refund — invoice #INV-2026-014',
  reference: `atlas-refund-${nanoid()}`,
});
```

Bulk for marketplace payouts: `paystack.transfer.bulk({ transfers: [...] })`.

### 6. Marketplace splits

Buyer pays for a creator's product → 90% to creator subaccount, 10% to Blyss. Set up once per creator:

```ts
const split = await paystack.split.create({
  name: `Creator split — ${creator.name}`,
  type: 'percentage',
  currency: 'KES',
  subaccounts: [{ subaccount: creatorSub.code, share: 90 }],
  bearer_type: 'subaccount',
  bearer_subaccount: creatorSub.code,
});
// store split.split_code on the creator's profile

// At checkout:
await paystack.transaction.initialize({
  email: buyer.email,
  amount: productPriceCents,
  currency: 'KES',
  split_code: creator.splitCode,
  metadata: { productId, creatorId },
});
```

Settlement happens automatically — both subaccounts get credited.

## Webhook receiver (`convex/payments/webhook.ts`)

Single endpoint registered in `convex/http.ts`:

```ts
http.route({
  path: "/paystack/webhook",
  method: "POST",
  handler: paystackWebhook,
});
```

The handler:

1. Reads raw body + `x-paystack-signature` header
2. **Multi-org match** — Paystack doesn't include org info, so we iterate active orgs that have Paystack configured, decrypt each one's secret key, compute HMAC-SHA512 of the raw body, constant-time compare. First match wins.
3. **Idempotency** — skip if `webhookEvents.externalId` already exists for this provider
4. Insert `webhookEvents` row with raw payload
5. Schedule processing via `scheduler.runAfter(0, internal.payments.webhook.process, { id })`
6. Return `200` immediately

Handled events: `charge.success`, `paymentrequest.success`, `paymentrequest.pending`, `transfer.success/failed/reversed`, `subscription.create/disable/not_renew`, `invoice.create/update/payment_failed`.

## Reconciliation

Daily cron `payments-reconcile` at 04:00 UTC (`crons.cron`):

1. Pull all Paystack transactions since last sync per workspace's subaccount
2. Match to existing `paymentRequests` by reference or metadata
3. Orphans (paid without an Atlas invoice) → "Unmatched payment" row, surfaced in Reconciliation tab
4. Pull settlement reports per subaccount → `paystackSettlements` rows
5. Surface in Workspace → Payments → Settlements

## UI surfaces

`/workspace/[slug]/payments` with tabs:

- **Links** — table of Payment Pages, create/share/archive
- **Invoices** — by status (draft/sent/viewed/paid/overdue/cancelled), filters, send reminder, mark paid manually with audit reason
- **Subscriptions** — card-based vs M-PESA-reminder mode, MRR, next due
- **Transfers / Payouts** — outbound, bulk, retry on failure
- **Settlements** — daily rollup (gross / fees / net), CSV export
- **Reconciliation** — unmatched payments, drag-to-match

## Acceptance (Phase 7b)

- [ ] Org Owner pastes Paystack secret + public, test connection succeeds
- [ ] Workspace Owner adds bank account → Paystack subaccount created
- [ ] Workspace Owner adds M-PESA destination → subaccount with M-PESA settlement
- [ ] Create Payment Page → short link works, hosted page loads
- [ ] Pay link with M-PESA test → webhook → page marked paid → timeline event
- [ ] Create Invoice from Deal → PDF in Convex storage → Paystack Payment Request created
- [ ] Send invoice via email (PDF attached + pay link) → customer pays → marked paid → deal advances
- [ ] Send same invoice via WhatsApp
- [ ] Card Subscription Plan → monthly auto-charge
- [ ] M-PESA reminder loop → invoices auto-generate at 30/14/7/1d
- [ ] Transfer to KE M-PESA wallet (test mode) → webhook → status tracked
- [ ] Marketplace 90/10 split → buyer pays → both subaccounts credited
- [ ] Daily reconciliation finds matches, flags orphans
