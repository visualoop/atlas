# Atlas — Build Brief

A complete instruction set for building Atlas, the Founder Operating System for Blyss. Read it end to end before writing application code. Do not build an MVP. Build the production-grade system described here, in the phases described in `15-phases.md`.

This brief is the source of truth. If code disagrees with the brief, the brief wins. If the brief itself is wrong, fix the brief first, then change the code.

## Index

| # | File | What |
|---|---|---|
| – | [00-front-matter.md](./00-front-matter.md) | Identity, audience, scope, one-line mission |
| – | [01-mission.md](./01-mission.md) | What Atlas exists to do, what it refuses to be |
| – | [02-product-philosophy.md](./02-product-philosophy.md) | Engineer-CEO persona, 11 design principles |
| – | [03-tech-stack.md](./03-tech-stack.md) | Exact stack with versions and free-tier verification |
| – | [04-ui-direction.md](./04-ui-direction.md) | Visual identity, type, palette, motion, anti-patterns |
| – | [05-data-model.md](./05-data-model.md) | Drizzle schema sketch: orgs, workspaces, contacts, timeline, AI |
| – | [06-auth-and-permissions.md](./06-auth-and-permissions.md) | Better Auth Org plugin, four-tier secrets, RBAC, invitation flow |
| – | [07-modules.md](./07-modules.md) | Today view, inbox, contacts, deals, tasks, notes, files, search |
| – | [08-ai-gateway.md](./08-ai-gateway.md) | Provider abstraction, free-tier routing, encrypted keys, tools, 14 workflows |
| – | [09-prospector.md](./09-prospector.md) | Google Maps lead generation: search, enrich, import, first-touch |
| – | [10-payments.md](./10-payments.md) | Paystack full-stack: subaccounts, payment links, invoicing, subscriptions, transfers, splits |
| – | [11-security.md](./11-security.md) | Encryption, key management, audit, rate limiting, sessions |
| – | [12-performance.md](./12-performance.md) | Targets, caching, server-first, query budgets |
| – | [13-deployment.md](./13-deployment.md) | Local dev, staging, production, env management |
| – | [14-do-not-do.md](./14-do-not-do.md) | Hard rules — patterns and choices banned across the build |
| – | [15-phases.md](./15-phases.md) | 12 phases (0–11), each a shippable slice with acceptance criteria |
| – | [16-skills-and-references.md](./16-skills-and-references.md) | Which skills to invoke when |
| – | [17-theme-and-shadcn.md](./17-theme-and-shadcn.md) | shadcn install plan, theme tokens, component overrides |

## How to use this brief

- Start with `00-front-matter.md` and `01-mission.md` to internalize what Atlas is.
- Before any new module: re-read its section in `07-modules.md`, plus `04-ui-direction.md` and `14-do-not-do.md`.
- Before any UI: invoke `frontend-design` skill at `.kiro/skills/frontend-design/SKILL.md`. Re-invoke `hallmark` for greenfield pages. Use `emil-design-eng` to audit interactions.
- Before declaring a phase done: run the acceptance checklist in `15-phases.md` for that phase.

## Non-negotiables

1. **No MVP shortcuts.** Phases are sized so each ships a working slice, but the slice's job is to be the foundation the next phase needs.
2. **Single command palette.** ⌘K is the navigation system. If a feature can't be reached in 3 keystrokes from anywhere, it's hidden too deep.
3. **No modal dialogs for data entry.** Slide-overs (Sheet / Drawer) for all record creation and editing.
4. **No animation on keyboard-initiated actions.** Emil rule. Hundreds of times a day = zero animation.
5. **No section titled "Features", "Services", "Why Choose Us".** Use evocative names.
6. **Server-first.** RSC by default. Client components only when interactivity demands.
7. **Audit log on every mutation.** Every write goes through a path that records actor + before + after.
8. **PII never leaves the server.** Tier 1 secrets never appear in client bundles. AI calls redact configurable PII fields.
9. **All money is `numeric(20, 4)`.** Never `real` / `float`. Same lesson as the Omnix audit report.
10. **Test before declaring done.** Vitest unit + integration, Playwright E2E, Lighthouse ≥ 95, axe ≥ 95.
