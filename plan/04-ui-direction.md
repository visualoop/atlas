# 04 · UI Direction

This file is the visual ceiling. Every UI shipped in Atlas must match the discipline described here, or it does not ship. Before designing any new page, re-read this and `14-do-not-do.md`.

## The aesthetic in one paragraph

Atlas is the editor's editor. Dark by default. Sharp 0px corners. Hairline borders, not shadows. Instrument Serif italic carries one keyword in every section heading. Geist for everything that's not display type. Burnt orange `#FF5B1F` — the Blyss accent — is the only chromatic signal, used ≤ 4× per viewport. There are no rounded cards, no gradients, no emoji icons, no animated counters, no "Trusted by N companies" strips. Density is calm: 32–36px table rows, mono numerals, 4pt spacing scale. Motion is felt in the press (scale 0.97 on active), not announced by toasts.

## Surface tokens — the locked palette

OKLCH in source, hex as comments for readability. Defined in `app/globals.css` `:root` for dark mode, `[data-theme="light"]` for the light surface (rare — documents only).

### Dark mode (default)

```css
--bg:               oklch(0.13 0.005 60);  /* #0A0A0B  ink */
--surface:          oklch(0.18 0.005 60);  /* #131313  */
--surface-elev:     oklch(0.22 0.005 60);  /* #1A1A1B  */
--border:           oklch(0.28 0.005 60);  /* #2A2A2C  */
--border-strong:    oklch(0.36 0.005 60);  /* #3D3D3F  */
--text-primary:     oklch(0.94 0.005 80);  /* #F4F2EE  */
--text-secondary:   oklch(0.74 0.01 80);   /* #B8B0A4  */
--text-muted:       oklch(0.50 0.01 80);   /* #6B6660  */
```

### Light mode (documents)

```css
--bg:               oklch(0.95 0.01 80);   /* #F4F2EE  paper */
--surface:          oklch(0.91 0.01 80);   /* #EAE6DF  */
--surface-elev:     oklch(0.97 0.005 80);  /* #F9F7F3  */
--border:           oklch(0.79 0.01 80);   /* #C9C0B5  */
--border-strong:    oklch(0.66 0.01 80);   /* #A89E91  */
--text-primary:     oklch(0.13 0.005 60);  /* #0A0A0B  */
--text-secondary:   oklch(0.22 0.005 60);  /* #2C2A28  */
--text-muted:       oklch(0.50 0.01 80);   /* #6B6660  */
```

### Accent (both modes, single chromatic signal, ≤ 4× per viewport)

```css
--accent:           oklch(0.68 0.20 35);   /* #FF5B1F  burnt orange */
--accent-hover:     oklch(0.74 0.18 35);   /* #FF7A4A  */
--accent-fg-dark:   oklch(0.13 0.005 60);  /* on accent in dark mode */
--accent-fg-light:  oklch(0.95 0.01 80);   /* on accent in light mode */
```

### Semantic (muted, used sparingly)

```css
--success:  oklch(0.70 0.12 145);  /* muted green */
--warning:  oklch(0.75 0.13 75);   /* muted amber */
--danger:   oklch(0.60 0.18 25);   /* muted red */
--info:     oklch(0.70 0.10 220);  /* muted blue */
```

### Forbidden

- Pure `#000000` and pure `#FFFFFF`
- Any blue beyond `--info`'s muted blue (no Bootstrap blue, no Tailwind sky-500)
- Any green, teal, purple, neon, magenta
- Gradients of any kind on UI surfaces (gradients in chart series are OK)

## Type system

| Role | Family | Weight | Style | Use |
|---|---|---|---|---|
| Display | **Instrument Serif** | 300, 400 | Roman + Italic | Section H1/H2/H3, page titles, hero copy. **One italic keyword per heading.** |
| UI body | **Geist** | 400, 500, 600 | Roman | All body text, controls, labels |
| Mono | **Geist Mono** | 400 | Roman | Numbers, currency amounts, IDs, codes, keyboard shortcuts, code blocks |

### Scale (Tailwind-compatible CSS vars)

```css
--text-display: clamp(56px, 7vw, 96px);   /* H0 hero */
--text-4xl:     clamp(36px, 4vw, 56px);   /* H1 page title */
--text-3xl:     32px;                     /* H2 section */
--text-2xl:     24px;                     /* H3 sub-section */
--text-xl:      20px;                     /* H4 / lede */
--text-lg:      17px;                     /* body large */
--text-base:    15px;                     /* body */
--text-sm:      13px;                     /* small / metadata */
--text-xs:      12px;                     /* eyebrow / label */

--leading-tight:    1.05;
--leading-snug:     1.25;
--leading-normal:   1.5;
--leading-relaxed:  1.65;

--tracking-tight:   -0.015em;  /* display */
--tracking-eyebrow: 0.18em;    /* uppercase eyebrows */
```

### Eyebrows / labels (uppercase tracked)

```css
.eyebrow {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: var(--tracking-eyebrow);
  color: var(--text-muted);
  font-weight: 500;
}
```

## Spacing scale (4pt base)

```css
--space-1:  4px;
--space-2:  8px;
--space-3:  12px;
--space-4:  16px;
--space-5:  20px;
--space-6:  24px;
--space-8:  32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
--space-20: 80px;
--space-24: 96px;
--space-32: 128px;
```

Section vertical rhythm: **64px on mobile, 96–128px on desktop** for marketing-style pages. Internal app pages: **32–48px** between sections.

## Borders, radii, shadows

- **Borders:** `1px solid var(--border)` everywhere. `--border-strong` for emphasized boundaries (table headers, sticky toolbars).
- **Radii:** `0px` on primary surfaces (buttons, cards, dialogs). `4px` permitted on dense inputs and chip-like badges. **No `rounded-xl`, ever.**
- **Shadows:** none on cards or surfaces. Allowed only on floating elements: popovers, dropdowns, modals, tooltips. Shadow recipe:
  ```css
  box-shadow:
    0 0 0 1px var(--border),
    0 8px 32px -8px oklch(0 0 0 / 0.4);
  ```

## Components — Atlas voice

shadcn ships defaults that are too rounded, too padded, too softly drop-shadowed. We override every interactive component. Specifics:

### Buttons

- Sharp 0px corners
- Label: Geist Mono uppercase tracked `.12em` for primary CTAs, Geist 500 normal-case for secondary actions
- Padding: `12px 24px` (primary), `8px 16px` (compact)
- Press: `transform: scale(0.97)` with `transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1)` (custom ease-out)
- Focus ring: 2px `--accent` outline, instant (no animation on appearance)
- Disabled: opacity 0.4, no hover state, `cursor: not-allowed`

```tsx
// Primary
className="bg-[--accent] text-[--accent-fg-dark] font-mono uppercase tracking-[.12em] px-6 py-3 active:scale-[0.97]"

// Secondary
className="bg-transparent text-[--text-primary] border-b border-[--border-strong] hover:border-[--accent]"

// Destructive
className="bg-transparent text-[--danger] border border-[--danger] hover:bg-[--danger] hover:text-[--bg]"
```

### Inputs

- Transparent background
- Single bottom border (`border-b`), not full box
- Focus: bottom border becomes `--accent`
- Label sits above (uppercase eyebrow), placeholder is `--text-muted`
- No rounded corners

### Cards

- 1px hairline border, no shadow
- Padding: `32px` on featured cards, `16px` in dense lists
- Hover (when card is clickable): border color shifts to `--border-strong`

### Tables (data tables)

- Row height: 36px default, 32px compact
- Mono font for numbers, currency, IDs
- Sticky header with `--border-strong` bottom border
- Zebra striping: NO — use whitespace and dividers instead
- Hover: row gets `bg: var(--surface-elev)`
- Keyboard navigation: `j/k` to move, `Enter` to open record
- Inline edit on `Enter` with single-cell focus state

### Sheets / drawers (slide-overs for data entry)

- Open from right (records) or bottom (mobile, Vaul drawer)
- Width: 540px (default), 720px (wide), full (campaign builder)
- Overlay: `oklch(0 0 0 / 0.6)` with backdrop blur 4px
- Animation: 200ms ease-out enter, 120ms ease-in exit

### Modals

- Use sparingly — only for confirmations + true blocking decisions
- Never use modals for data entry (use Sheet)
- `transform-origin: center` (modals are not anchored to a trigger)

### Popovers / dropdowns

- `transform-origin` derived from trigger (Radix CSS variable)
- 150ms ease-out enter, 100ms ease-in exit
- Scale from 0.95, not from 0

### Toasts (Sonner)

- Position: bottom-right desktop, top mobile
- Style: hairline border, no shadow, sharp corners, dark surface
- 4s default dismiss, 8s for errors
- Cap: 3 toasts visible, older queued

### Tooltips

- 800ms delay first time, 0ms once another tooltip is already open (Emil rule)
- No animation on focus tooltips (instant)
- Background: `--surface-elev`, border `--border-strong`

## Motion — Emil-school discipline

Read `.kiro/skills/emil-design-eng/SKILL.md` before touching motion. Specifics:

### Custom easings (always use these — never `ease` / `ease-in-out` defaults)

```css
--ease-out:        cubic-bezier(0.23, 1, 0.32, 1);     /* strong out for UI */
--ease-in-out:     cubic-bezier(0.77, 0, 0.175, 1);    /* strong in-out for movement */
--ease-drawer:     cubic-bezier(0.32, 0.72, 0, 1);     /* iOS drawer */
--dur-fast:        100ms;
--dur-normal:      160ms;
--dur-slow:        200ms;
--dur-drawer:      300ms;
```

### Rules

- Animate `transform` + `opacity` only — never layout properties
- Enter: `--ease-out`, `--dur-normal` (~160ms)
- Exit: `--ease-in-out`, `--dur-fast` (~100ms) — exits faster than enters
- Press: `scale(0.97)`, `--dur-fast`, `--ease-out`
- Stagger 30–80ms between list items on first paint
- `prefers-reduced-motion: reduce` collapses spatial motion to opacity-only crossfade
- **Never animate keyboard-initiated actions** (palette open, j/k navigation, ⌘1 workspace switch)
- **Never use `ease-in` on UI elements** — feels sluggish
- **Never `scale(0)` entry** — start from `scale(0.95) opacity(0)`
- Tooltips delay 800ms first time, 0ms thereafter
- Focus rings appear instantly, never animated

### Loading + skeletons

- No spinners over 200ms — replace with skeleton
- Skeleton uses `--surface-elev` with subtle shimmer (15% opacity gradient, 1.5s linear, `prefers-reduced-motion` disables shimmer)
- Optimistic updates everywhere — UI shows the new state immediately, server confirms in background

## Icons

- **Lucide React only.** No emoji in UI ever.
- Thin line weight (1.5–2px stroke)
- Size: 16px / 20px / 24px
- Color: `--text-muted` by default, `currentColor` for inline-with-text contexts
- Accent color only when icon represents primary state (active filter, selected item)

## Imagery

- Real screenshots, never stock
- Avatars: monogram if image not present (no default-avatar silhouette)
- Photo color treatment: `mix-blend-mode: multiply` with `oklch(0.13 0.005 60 / 0.05)` overlay to harmonize with the dark surface

## Layout patterns

### Application shell

```
┌──────────────────────────────────────────────────────────┐
│ TOPBAR — 48px                                            │
│ [Blyss ▼] [Studio]      [⌘K search…]      [⊕] [bell] [@]│
├────┬─────────────────────────────────────────────────────┤
│ SI │                                                     │
│ DE │  MAIN CONTENT                                       │
│ BA │  • RSC streamed                                     │
│ R  │  • paged or scrolling list                          │
│ 56 │  • slide-over panels for record detail              │
│ px │                                                     │
│    │                                                     │
├────┴─────────────────────────────────────────────────────┤
│ STATUS BAR (optional, 32px)                              │
└──────────────────────────────────────────────────────────┘
```

- **Topbar:** workspace switcher (left, monospace), search palette opener (center), quick-create + notification bell + user menu (right). Hairline bottom border.
- **Sidebar (collapsed default):** 56px wide, icons only. Expand on hover or `⌘\`. When expanded, shows labels + nested sub-items. Sidebar items per workspace: Today, Inbox, Contacts, Pipelines, Prospector, Documents, Campaigns, Analytics, Calendar, Settings.
- **Main:** 1280px max content width, 80px gutters on wide screens, 16px on mobile. Text columns max 72ch.
- **Status bar:** optional, shows AI provider health, background job count, last sync time.

### Slide-over (record detail)

```
┌──────────────────────────────────────┬─────────────────┐
│                                      │ COMPANY PANEL   │
│  MAIN VIEW (list/board behind)        │ ━━━━━━━━━━━━━━ │
│                                      │ Header          │
│                                      │ Quick actions   │
│                                      │ ━━━━━━━━━━━━━━ │
│                                      │ Tabs: Timeline /│
│                                      │ Contacts /      │
│                                      │ Deals / Files / │
│                                      │ Notes           │
│                                      │ ━━━━━━━━━━━━━━ │
│                                      │ Tab content     │
│                                      │ (AI summary at  │
│                                      │  top of Timeline│
│                                      │  tab)           │
│                                      │                 │
└──────────────────────────────────────┴─────────────────┘
```

Width: 540px default, 720px wide. Esc closes. `e` opens edit. `⌘↵` saves.

## Anti-pattern checklist (run before declaring any page done)

- [ ] No section title "Features", "Services", "Why Choose Us", "What we offer"
- [ ] No drop-shadow cards
- [ ] No gradient buttons or hero backgrounds
- [ ] No emoji icons anywhere
- [ ] No three-column emoji feature grid
- [ ] No "Trusted by N companies" strip
- [ ] No animated counter
- [ ] No autoplay video with sound
- [ ] No carousel auto-rotation under 8 seconds
- [ ] No spinner over 200ms without skeleton
- [ ] No modal for data entry (use Sheet)
- [ ] No `rounded-xl` anywhere
- [ ] No system fonts, Inter, Roboto, Arial, Space Grotesk
- [ ] No pure `#000` or `#FFF`
- [ ] No blue/green/purple/teal outside semantic muted variants
- [ ] No animation on keyboard-initiated action
- [ ] No `scale(0)` entry
- [ ] No `ease-in` on UI
- [ ] No animation on focus ring appearance
- [ ] Accent used ≤ 4× per viewport
- [ ] Reduced-motion respected
