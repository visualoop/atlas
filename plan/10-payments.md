# 10 · Payments

The full financial spine, Paystack-backed. Covers payment links, invoicing, subscriptions, transfers, splits, settlements, and reconciliation across all workspaces — including the case where a workspace doesn't invoice (Blyss Marketplace).

## The architecture in one diagram

```
                Atlas Org (Blyss)
                       │
                       ▼
         ┌─────────────────────────────────────────┐
         │  Paystack Integration                   │
         │  (1 secret + 1 public key per org,      │
         │   encrypted in org_integration_keys)    │
         └────────────────┬────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┬─────────────────┐
        ▼                 ▼                 ▼                 ▼
 ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
 │ Subaccounts  │ │ Customers    │ │ Plans        │ │ Webhook      │
 │ (1 per ws)   │ │ (per contact)│ │ (per plan)   │ │ Receiver     │
 └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
        │                │                │                │
        ▼                ▼                ▼                ▼
 ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
 │ Bank/M-PESA  │ │ Payment      │ │ Subscriptions│ │ Verified +   │
 │ destination  │ │ Requests     │ │ (card only)  │ │ idempotent   │
 │ per workspace│ │ (invoices)   │ │              │ │ processing   │
 └──────────────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
                         │                 │                │
                         ▼                 ▼                ▼
                   ┌──────────────────────────────────────────┐
                   │  Atlas writes:                            │
                   │  - documents.status update                │
                   │  - timeline_events                        │
                   │  - audit_log                              │
                   │  - notifications                          │
                   │  - deal stage advance (if configured)     │
                   └──────────────────────────────────────────┘

 Outbound (payouts):
  ┌──────────────────────┐
  │ Transfer Recipients  │ ──→ Transfers ──→ Bulk Transfers (creator payouts)
  │ (bank / M-PESA)      │
  └──────────────────────┘

 Marketplace-specific:
  ┌──────────────────────┐
  │ Transaction Splits   │ ──→ Auto-route GMV across creator subaccounts + Blyss
  └──────────────────────┘
```

## Paystack credentials — what we store

In `org_integration_keys` with `provider='paystack'`:

- `secret_key` — `sk_live_xxx` or `sk_test_xxx`, encrypted
- `public_key` — `pk_live_xxx` or `pk_test_xxx`, encrypted (less sensitive but still encrypted)
- `mode` — `live` or `test`
- `meta.live_mode_business_name` — for verification

The Paystack **webhook secret = the same secret key**. Atlas verifies inbound webhooks using HMAC-SHA512 of the raw request body keyed by `secret_key`, compared in constant time to the `x-paystack-signature` header.

## Per-workspace subaccounts

One Paystack subaccount per Atlas workspace. Created via Paystack API when the Workspace Owner adds banking details.

```ts
// During workspace banking setup
const subaccount = await paystack.subaccount.create({
  business_name: workspace.name,                  // "Blyss Studio"
  settlement_bank: bankCode,                      // KEPSS code or MPESA code
  account_number: accountNumber,
  percentage_charge: 0,                           // platform doesn't charge itself
  primary_contact_email: orgOwner.email,
  primary_contact_name: orgOwner.name,
  metadata: { workspace_id: workspace.id },
});
```

For M-PESA destinations:
- Wallet → use M-PESA wallet "bank code"
- Paybill → register paybill as a settlement destination
- Till → similar to paybill

Once created:

```ts
paystack_subaccounts {
  id              uuid pk
  workspace_id    uuid fk
  subaccount_code text          // 'ACCT_xxx'
  settlement_destination text   // 'bank' | 'mpesa_wallet' | 'mpesa_paybill' | 'mpesa_till'
  bank_code       text
  account_number  text          // last 4 visible in UI
  business_name   text
  percentage_charge numeric(5,2)
  active          boolean
  created_at      timestamptz
}
```

All payments routed to this workspace go to this subaccount automatically by including `subaccount` in transaction init.

## The four core payment flows

### 1. Payment Links (generic — no invoice needed)

Use case: "Send me KES 5,000 for the consult call we had on Tuesday."

Backed by Paystack **Payment Pages**:

```ts
const page = await paystack.page.create({
  name: 'Consult call — Patricia Mwangi',
  amount: 500000,           // KES in pesa cents (×100)
  currency: 'KES',
  type: 'payment',
  metadata: { workspace_id, contact_id },
  subaccount: subaccount.code,   // route to workspace
});
// returns { id, slug, url: 'https://paystack.com/pay/<slug>' }
```

Atlas wraps with a branded short link `pay.blyss.co.ke/<short>` (a `payment_links` table maps short → Paystack URL + adds workspace tracking).

Share via email, WhatsApp, copied link. Click → Paystack hosted page. Pay → webhook → Atlas marks paid → notifies.

### 2. Invoices (Payment Requests)

Use case: Studio sends a formal invoice for the Karen project.

Atlas's invoice flow:

1. **Compose** — TipTap editor + line items + due date + payment terms
2. **Generate PDF** — `@react-pdf/renderer` server-side; stored in R2
3. **Create Paystack Payment Request:**
   ```ts
   const req = await paystack.paymentRequest.create({
     customer: customerCode,              // create-or-find by email
     amount: total_in_cents,
     currency: 'KES',
     due_date: '2026-07-15',
     description: 'Karen project — phase 1',
     line_items: lineItems,
     tax: [],                            // optional VAT breakout
     send_notification: false,           // we send via our own templates
     metadata: { workspace_id, document_id, deal_id },
   });
   // → returns request_code (PRQ_xxx) and offline_reference
   ```
4. **Send** — Atlas-composed email (with PDF attached + Paystack pay URL CTA) and/or WhatsApp message (with PDF + short link)
5. **Customer pays** via Paystack hosted page (any method: card, M-PESA, bank, Apple Pay, etc.)
6. **Webhook fires** `paymentrequest.success` → Atlas marks `documents.status='paid'`, fires timeline event, advances deal if configured, sends "thanks" template

Invoice PDF layout: see `04-ui-direction.md`. Includes Paystack pay button + QR code on the page.

### 3. Subscriptions (card-only)

Use case: Studio retainer KES 50,000/month auto-charged to customer's card.

Limited by Paystack — **M-PESA recurring is NOT supported**. So:

- **Card-paying customers:** use Paystack Subscriptions (Plans + Subscriptions API)
  - Customer signs up via a checkout flow that creates a plan and authorizes the card
  - Atlas stores `paystack_subscription_code`
  - Webhooks `subscription.create` / `invoice.create` / `invoice.payment_failed` keep Atlas in sync
- **M-PESA-paying customers:** Atlas runs a **reminder loop** instead:
  - 30 / 14 / 7 / 1 day before next due, auto-create new Payment Request invoice
  - Auto-send via email + WhatsApp at each interval
  - Webhook on payment → marks paid → schedules next due date
  - Cron job `subscriptions-reminder-loop` runs daily at 6am

UI surfaces both as "Subscriptions" but tags each with the billing mode.

### 4. Transfers (payouts out)

Use case: pay a contractor, refund a customer, pay a Marketplace creator.

```ts
// Create or fetch transfer recipient (bank or M-PESA)
const recipient = await paystack.transferRecipient.create({
  type: 'mobile_money',        // or 'nuban' for bank account
  name: 'Patricia Mwangi',
  account_number: '254712345678',  // M-PESA number in international format
  bank_code: 'MPESA',
  currency: 'KES',
});

// Initiate transfer
const transfer = await paystack.transfer.initiate({
  source: 'balance',
  amount: 250000,              // KES 2,500 in pesa cents
  recipient: recipient.recipient_code,
  reason: 'Refund — invoice #INV-2026-014',
  reference: 'atlas-refund-xxx',
});
// → may require OTP verification flow (paystack.transfer.finalize)
```

Bulk transfers for Marketplace creator payouts:

```ts
const bulk = await paystack.transfer.bulk({
  transfers: [
    { amount: 250000, recipient: 'RCP_a', reason: 'Payout 2026-07' },
    { amount: 180000, recipient: 'RCP_b', reason: 'Payout 2026-07' },
    // …
  ],
});
```

## Marketplace splits

For Blyss Marketplace, every buyer payment is auto-split: creator gets 90%, Blyss takes 10% take-rate.

Setup once per creator:

```ts
// 1. Creator's subaccount (their bank/M-PESA destination)
const creatorSub = await paystack.subaccount.create({...});

// 2. Define the split
const split = await paystack.split.create({
  name: `Creator split — ${creator.name}`,
  type: 'percentage',
  currency: 'KES',
  subaccounts: [
    { subaccount: creatorSub.code, share: 90 },
  ],
  bearer_type: 'subaccount',     // creator bears the Paystack fee
  bearer_subaccount: creatorSub.code,
});
```

When a buyer pays for a creator's product:

```ts
const tx = await paystack.transaction.initialize({
  email: buyer.email,
  amount: productPriceInCents,
  currency: 'KES',
  split_code: split.split_code,    // routes funds
  metadata: { product_id, creator_id },
});
```

Settlement happens automatically — creator's subaccount gets credited, Blyss gets the remainder.

Atlas Marketplace workspace shows: today's GMV, Blyss take, payouts disbursed today, creators with pending balance.

## Webhook receiver

Single endpoint: `POST /api/webhooks/paystack`

```ts
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-paystack-signature');

  if (!signature) return Response.json({ ok: false }, { status: 400 });

  // Find which org this webhook is for — we use per-org secret keys
  // Paystack doesn't include org info, so we try matching against active orgs
  const orgs = await db.organization.findMany({ where: { paystack_enabled: true } });

  let matchedOrgId: string | null = null;
  let secretKey: string | null = null;
  for (const org of orgs) {
    const key = await getOrgKey(org.id, 'paystack');
    if (!key) continue;
    const computed = crypto
      .createHmac('sha512', key.secret_key)
      .update(rawBody)
      .digest('hex');
    if (crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature))) {
      matchedOrgId = org.id;
      secretKey = key.secret_key;
      break;
    }
  }
  if (!matchedOrgId) return Response.json({ ok: false }, { status: 401 });

  const event = JSON.parse(rawBody);

  // Idempotency: skip if event.id already processed
  const seen = await db.webhook_events.findFirst({
    where: { provider: 'paystack', external_id: event.id }
  });
  if (seen) return Response.json({ ok: true, duplicate: true });

  // Persist + process via pg-boss job
  await db.webhook_events.insert({
    provider: 'paystack',
    external_id: event.id,
    event_type: event.event,
    org_id: matchedOrgId,
    raw_payload: event,
    received_at: new Date(),
  });
  await pgboss.send('process-paystack-webhook', { id: event.id, orgId: matchedOrgId });

  // Return 200 immediately
  return Response.json({ ok: true });
}
```

Handled events:
- `charge.success` — payment captured (one-off or invoice)
- `paymentrequest.success` — invoice paid
- `paymentrequest.pending` — payment initiated
- `transfer.success` / `transfer.failed` / `transfer.reversed`
- `subscription.create` / `subscription.disable` / `subscription.not_renew`
- `invoice.create` / `invoice.update` / `invoice.payment_failed`
- `customeridentification.success` / `.failed` — for BVN-like flows in NG (not used in KE)

## Reconciliation

Daily cron `payments-reconcile` at 4am:

1. Fetch all Paystack transactions since last sync per workspace's subaccount
2. Match each to an existing `payment_requests` row by `reference` or metadata
3. Orphan transactions (paid by customer without an Atlas-issued invoice) get a "Unmatched payment" row in the Reconciliation tab
4. Fetch settlement reports per subaccount, store in `paystack_settlements` table
5. Show in Workspace → Payments → Settlements: "KES 245,000 settled to Studio bank on 2026-06-28"

## UI surfaces

### Workspace → Payments → Links

- Table of all payment pages (active + archived)
- Create new: name, amount (optional — leave blank for "customer enters"), description, image, slug
- Quick actions: copy short link, share via email, share via WhatsApp, archive

### Workspace → Payments → Invoices

- Table of invoices (status: draft / sent / viewed / paid / overdue / cancelled)
- Filter by status, contact, date range
- Quick actions: send reminder, view PDF, view in Paystack dashboard, mark paid manually (with audit reason), cancel

### Workspace → Payments → Subscriptions

- Two tabs: Card-based (Paystack Subscriptions) + M-PESA reminder loops
- Per row: customer, plan, status, next due, MRR, actions

### Workspace → Payments → Transfers

- Table of outbound transfers
- "New transfer" button → form (recipient, amount, reason)
- "Bulk transfer" for marketplace payouts
- Status with retry on failure

### Workspace → Payments → Settlements

- Daily settlement rollup, last 90 days
- Per-day: gross / fees / net / settlement bank deposit timestamp
- Export CSV

### Workspace → Payments → Reconciliation

- Unmatched payments (customer paid without Atlas invoice)
- Drag-and-drop to match to an invoice or create a one-off "received payment" record

## Acceptance (end of Phase 7b)

- [ ] Org Owner pastes Paystack secret + public, mode (live/test), test connection succeeds
- [ ] Workspace Owner adds bank account for Studio workspace → Paystack subaccount created
- [ ] Workspace Owner adds M-PESA destination for Omnix workspace → subaccount with M-PESA settlement
- [ ] Create a Payment Page: "Consult call — KES 5,000" → short link works, hosted page loads
- [ ] Pay the link with M-PESA in test mode → webhook fires → page marked paid → timeline event recorded
- [ ] Create an Invoice from a Deal: line items, PDF rendered, Paystack Payment Request created
- [ ] Send invoice via email: client receives PDF + pay link → opens → pays → invoice marked paid → deal stage advances (if configured)
- [ ] Send same invoice via WhatsApp: receives doc + short link
- [ ] Set up a Subscription Plan + enroll a card customer → recurring charge fires monthly
- [ ] Set up M-PESA reminder loop for a recurring customer → reminder invoices auto-generate at 30/14/7/1 days, mark paid on webhook
- [ ] Issue a Transfer to a Kenyan M-PESA wallet (test mode) → webhook fires → status tracked
- [ ] Marketplace: create a split with 90% creator / 10% Blyss → buyer pays → split executes → both subaccounts credited
- [ ] Daily reconciliation: settlements appear, unmatched payments flagged
