# 00 · Front Matter

**Product name:** Atlas
**Tagline:** *The operating system for a founder.*
**Customer:** Blyss (initial). Future commercial SaaS.
**Operator:** Justine Gichana — founder of Blyss, running Omnix · Blyss Marketplace · Blyss Studio simultaneously.
**Production domain:** `atlas.blyss.co.ke`
**Dev preview:** `<port>.blyss.co.ke` via code-server + Cloudflare tunnel.
**Repo root:** `/home/ubuntu/workspace/atlas`
**License:** Proprietary, owned by Blyss.

## The one-line mission

Atlas is the **first application Justine opens every morning and the last he closes every evening** — a single keyboard-driven surface that replaces Gmail, WhatsApp Business, spreadsheets, a CRM, a project manager, a calendar, and a quote-and-invoice tool, for someone who runs three companies alone and writes the code for all three.

## Businesses Atlas powers at launch

| Business | What it is | Sales motion | Primary channel |
|---|---|---|---|
| **Omnix** | Offline-first POS/ERP desktop app for Kenyan SMEs (pharmacy, retail, hardware, hospitality). **KES 30,000 per module, paid once, forever.** | Outbound to small businesses → trial → license sale → renewal upsell | WhatsApp + phone + in-person |
| **Blyss Marketplace** | Marketplace for African creators selling digital products (templates, ebooks, courses, beats, subscriptions). Multi-currency (KES + ZAR + USD). | Creator acquisition → first listing → first payout → retention | Email + Twitter/X + Instagram |
| **Blyss Studio** | Custom software dev studio (SaaS, fintech, marketplaces, real-time systems). KES 80K landing → KES 220K site → custom. | Inbound + referrals → discovery call → proposal → deposit → build → handover | Email + WhatsApp |

These three motions are radically different. Atlas must support all three without becoming generic.

## Out of scope (do not build inside Atlas)

- A buyer-facing portal for Blyss Marketplace customers — lives in the marketplace itself.
- A customer-facing portal for Omnix users — lives inside the Omnix desktop app.
- A public studio.blyss.co.ke replacement — Studio's marketing site is separate.
- Accounting features Omnix already does in its own DB — Atlas reads aggregates, never owns the books.
- Marketplace storefront listings — Atlas tracks the *business* of running the marketplace (creators, GMV, payouts), not its products.

## Identity in one paragraph

> Atlas looks like the editor a senior engineer would build for themselves to do the work of a CEO. Dark, calm, fast, keyboard-first, dense with information but never cluttered. Sharp 0px corners. Instrument Serif italic carries one keyword in every section heading. Burnt orange `#FF5B1F` is the only chromatic signal, used ≤ 4× per viewport. Every interaction is felt in the press, not announced by a toast. If you've used Linear, Raycast, and the Blyss Studio site, Atlas reads as their offspring.

## Sibling products to align with

- **Omnix marketing site** (`omnix.co.ke`) — Cormorant italic, warm-bone palette. Atlas reuses the *cadence* (italic emphasis on one keyword per heading) but adopts a dark editorial surface, not warm bone.
- **Blyss Studio site** (`studio.blyss.co.ke`) — ink/paper/burnt-orange, Instrument Serif + Geist + JetBrains Mono. Atlas is the **same family**: same palette, same type system, same motion language.
- **Blyss Marketplace** (`blyss.co.ke`) — slightly different aesthetic (lighter, more commercial). Atlas does not copy it; Atlas is the back-of-house tool, not a storefront.

If Atlas looks like a SaaS dashboard with rounded cards and gradient buttons, the build is wrong.

## Constraints we deliberately accept

- **$0 monthly stack cost at launch.** Every paid service is justified only when free-tier limits bite.
- **Solo founder for the first 6 months.** No team-collaboration UI complexity that isn't multi-tenant-ready but optional.
- **Kenyan-first.** KES default. M-PESA primacy via Paystack. WhatsApp Business as a peer to email. African Talking SMS later.
- **No native mobile.** PWA installable to home screen. Native is post-launch if mobile use proves heavy.
- **No Atlas-as-SaaS surface yet.** Architecture is multi-tenant-ready (orgs, workspaces, roles, encrypted secrets per org) so Blyss can sell Atlas later, but signup / billing / customer portal are not built for v1.
