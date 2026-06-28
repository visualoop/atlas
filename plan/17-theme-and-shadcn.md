# 17 · Theme & shadcn

The shadcn install plan, the Atlas theme tokens, and the component overrides — all in one place. Execute exactly as written in Phase 0.

## Step 1 — Initialize shadcn

```bash
npx shadcn@latest init
```

Answer prompts:

```
Style: new-york
Base color: slate          (we override the values via our own tokens)
CSS variables: yes
Import alias for components: @/components
Import alias for utils: @/lib/utils
React Server Components: yes
```

Result: `components.json` and `app/globals.css` get shadcn defaults.

## Step 2 — Bulk install the full registry we need

One command:

```bash
npx shadcn@latest add \
  accordion alert alert-dialog aspect-ratio avatar \
  badge breadcrumb button calendar card carousel chart checkbox collapsible \
  command context-menu dialog drawer dropdown-menu \
  form hover-card input input-otp label menubar navigation-menu pagination \
  popover progress radio-group resizable scroll-area select separator sheet \
  sidebar skeleton slider sonner switch table tabs textarea toggle toggle-group \
  tooltip
```

This installs ~45 components in one pass. Some bring sub-deps (`embla-carousel-react`, `recharts`, `cmdk`, `vaul`, `react-hook-form`, `@hookform/resolvers`, `date-fns`). All auto-handled by shadcn.

If the CLI complains about specific components not existing yet, install what works and add the rest individually later. (As of June 2026 all of the above are in the registry.)

## Step 3 — Install supporting libraries

```bash
npm install \
  next-themes \
  @tanstack/react-table \
  motion \
  @dnd-kit/core @dnd-kit/sortable \
  @react-pdf/renderer \
  react-pdf \
  @tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-image \
  @tiptap/extension-placeholder @tiptap/extension-mention \
  zod react-hook-form @hookform/resolvers \
  libphonenumber-js \
  mailparser \
  pg-boss \
  pino pino-pretty \
  @sentry/nextjs \
  posthog-js posthog-node \
  ai @ai-sdk/google @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/mistral @ai-sdk/cohere \
  @ai-sdk/openai-compatible \
  @aws-sdk/client-s3 @aws-sdk/s3-request-presigner \
  date-fns \
  nanoid \
  argon2 \
  jose
```

Better Auth:

```bash
npm install better-auth
```

Drizzle:

```bash
npm install drizzle-orm postgres
npm install -D drizzle-kit @types/pg
```

Testing:

```bash
npm install -D \
  vitest @vitest/ui \
  @testing-library/react @testing-library/dom @testing-library/jest-dom \
  jsdom \
  @playwright/test \
  @axe-core/playwright axe-core \
  @lhci/cli
```

## Step 4 — Overwrite `app/globals.css` with Atlas tokens

Replace shadcn's generated `:root` block with the Atlas theme. Final `app/globals.css` shape:

```css
@import "tailwindcss";

@theme inline {
  /* Color tokens (light mode — paper, used for documents) */
  --color-background: oklch(0.95 0.01 80);
  --color-surface: oklch(0.91 0.01 80);
  --color-surface-elev: oklch(0.97 0.005 80);
  --color-border: oklch(0.79 0.01 80);
  --color-border-strong: oklch(0.66 0.01 80);
  --color-text-primary: oklch(0.13 0.005 60);
  --color-text-secondary: oklch(0.22 0.005 60);
  --color-text-muted: oklch(0.50 0.01 80);

  /* Accent (both modes) */
  --color-accent: oklch(0.68 0.20 35);
  --color-accent-hover: oklch(0.74 0.18 35);

  /* Semantic */
  --color-success: oklch(0.70 0.12 145);
  --color-warning: oklch(0.75 0.13 75);
  --color-danger: oklch(0.60 0.18 25);
  --color-info: oklch(0.70 0.10 220);

  /* Type families */
  --font-display: var(--font-instrument-serif);
  --font-sans: var(--font-geist);
  --font-mono: var(--font-geist-mono);

  /* Type scale */
  --text-display: clamp(56px, 7vw, 96px);
  --text-4xl: clamp(36px, 4vw, 56px);
  --text-3xl: 32px;
  --text-2xl: 24px;
  --text-xl: 20px;
  --text-lg: 17px;
  --text-base: 15px;
  --text-sm: 13px;
  --text-xs: 12px;

  /* Tracking */
  --tracking-tight: -0.015em;
  --tracking-eyebrow: 0.18em;

  /* Spacing scale (4pt base) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;
  --space-24: 96px;
  --space-32: 128px;

  /* Easings */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);

  /* Durations */
  --dur-fast: 100ms;
  --dur-normal: 160ms;
  --dur-slow: 200ms;
  --dur-drawer: 300ms;

  /* Radii */
  --radius-none: 0px;
  --radius-sm: 2px;
  --radius-md: 4px;
}

/* Dark mode override (the default surface) */
:root,
[data-theme="dark"] {
  --color-background: oklch(0.13 0.005 60);
  --color-surface: oklch(0.18 0.005 60);
  --color-surface-elev: oklch(0.22 0.005 60);
  --color-border: oklch(0.28 0.005 60);
  --color-border-strong: oklch(0.36 0.005 60);
  --color-text-primary: oklch(0.94 0.005 80);
  --color-text-secondary: oklch(0.74 0.01 80);
  --color-text-muted: oklch(0.50 0.01 80);
}

/* Base */
html {
  font-family: var(--font-sans);
  color: var(--color-text-primary);
  background: var(--color-background);
  font-feature-settings: "ss01" on, "cv01" on;
}

body {
  min-height: 100vh;
}

* {
  border-color: var(--color-border);
}

/* Eyebrows */
.eyebrow {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: var(--tracking-eyebrow);
  color: var(--color-text-muted);
  font-weight: 500;
}

/* Reduce motion */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* Focus visible — instant, accent color */
*:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

## Step 5 — Load fonts via `next/font/google`

In `app/layout.tsx`:

```tsx
import { Instrument_Serif, Geist, Geist_Mono } from 'next/font/google';

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: ['400'],            // Instrument Serif only ships 400
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-instrument-serif',
});

const geist = Geist({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-geist',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
  variable: '--font-geist-mono',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${instrumentSerif.variable} ${geist.variable} ${geistMono.variable}`}
    >
      <body>
        <ThemeProvider attribute="data-theme" defaultTheme="dark" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

Note: Instrument Serif only has weight 400. Variation through italic vs roman.

## Step 6 — `next-themes` setup

```tsx
// components/theme-provider.tsx
'use client';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export function ThemeProvider({ children, ...props }) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
```

Default theme: `dark`. Light mode reserved for documents (PDF preview, print).

## Step 7 — Component overrides

shadcn defaults are too rounded, too padded, too soft. Replace with Atlas voice. Below are the spec patches; actual code lives in `components/ui/*.tsx` after generation.

### `Button`

```tsx
// components/ui/button.tsx — Atlas voice
const buttonVariants = cva(
  "inline-flex items-center justify-center font-mono uppercase tracking-[0.12em] " +
  "text-xs transition-transform duration-[var(--dur-normal)] ease-[var(--ease-out)] " +
  "active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] " +
  "focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-40 " +
  "cursor-pointer select-none",
  {
    variants: {
      variant: {
        // Primary — accent fill, sharp corners, mono uppercase
        default: "bg-[var(--color-accent)] text-[oklch(0.13_0.005_60)] hover:bg-[var(--color-accent-hover)]",
        // Secondary — transparent, hairline border bottom only
        ghost: "bg-transparent text-[var(--color-text-primary)] border-b border-[var(--color-border-strong)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]",
        // Destructive — red, hairline
        destructive: "bg-transparent text-[var(--color-danger)] border border-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-[var(--color-background)]",
        // Outline — hairline border
        outline: "bg-transparent text-[var(--color-text-primary)] border border-[var(--color-border-strong)] hover:bg-[var(--color-surface-elev)]",
      },
      size: {
        sm: "h-8 px-4",
        md: "h-10 px-6",
        lg: "h-12 px-8",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  }
);
```

All `rounded-*` removed. Always sharp.

### `Input`

```tsx
// Single bottom border, transparent bg
className="bg-transparent border-0 border-b border-[var(--color-border-strong)] " +
  "px-0 py-2 text-base text-[var(--color-text-primary)] " +
  "placeholder:text-[var(--color-text-muted)] " +
  "focus:border-[var(--color-accent)] focus:outline-none " +
  "transition-colors duration-[var(--dur-normal)]"
```

No box. No padding-x. No rounded.

### `Card`

```tsx
// 1px hairline, no shadow, no rounded
className="border border-[var(--color-border)] bg-[var(--color-surface)] p-8"
```

For dense lists use `p-4`. Hover state: `hover:border-[var(--color-border-strong)]`.

### `Sheet` / `Drawer` (slide-overs)

Sheet from the right (records), Drawer from bottom (mobile via Vaul). Override Sheet's default content padding + corner radius:

```tsx
className="border-l border-[var(--color-border-strong)] bg-[var(--color-background)] " +
  "p-0 sm:max-w-[540px]"
```

Animation already in Vaul / Radix — let shadcn defaults pass but reduce duration to 200ms.

### `Badge`

```tsx
// Flat, no pill, mono uppercase tracked
className="inline-flex items-center px-2 py-0.5 font-mono uppercase tracking-[0.12em] " +
  "text-xs border border-[var(--color-border-strong)] bg-transparent " +
  "text-[var(--color-text-secondary)]"
```

Variants for semantic colors swap `border` + `text` to `--color-success` / `--color-warning` / `--color-danger` / `--color-info`.

### `Tabs`

```tsx
// Underline indicator, not background pill
"TabsList": "border-b border-[var(--color-border)] bg-transparent p-0",
"TabsTrigger": "rounded-none border-b-2 border-transparent px-4 py-2 " +
  "data-[state=active]:border-[var(--color-accent)] data-[state=active]:text-[var(--color-text-primary)] " +
  "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] " +
  "transition-colors duration-[var(--dur-normal)]"
```

### `Table` (TanStack-wrapped)

```tsx
// Dense, mono numbers, sticky header
className="w-full text-sm",
header: "sticky top-0 bg-[var(--color-background)] border-b border-[var(--color-border-strong)] " +
  "font-mono uppercase tracking-[0.12em] text-xs text-[var(--color-text-muted)] " +
  "h-9 px-4 text-left",
row: "border-b border-[var(--color-border)] h-9 hover:bg-[var(--color-surface-elev)]",
cell: "px-4 py-2",
// Numeric cells:
numericCell: "font-mono tabular-nums text-right"
```

### `Tooltip`

```tsx
// 800ms default delay, 0ms when one is already open
<TooltipProvider delayDuration={800} skipDelayDuration={0}>
// Content:
className="bg-[var(--color-surface-elev)] border border-[var(--color-border-strong)] " +
  "px-3 py-1.5 text-xs text-[var(--color-text-primary)]"
```

### `Sonner` (toasts)

```tsx
<Toaster
  position="bottom-right"
  duration={4000}
  visibleToasts={3}
  toastOptions={{
    className: "border border-[var(--color-border-strong)] bg-[var(--color-surface-elev)] " +
      "text-[var(--color-text-primary)] rounded-none",
  }}
/>
```

### `Dialog` (modals — sparingly)

Keep `transform-origin: center` (modals are not anchored to a trigger). Sharp corners, hairline border.

### `Popover` / `DropdownMenu` / `HoverCard`

```tsx
// transform-origin from trigger (Radix CSS var)
className="origin-[var(--radix-popover-content-transform-origin)] " +
  "border border-[var(--color-border-strong)] bg-[var(--color-surface-elev)] " +
  "rounded-none p-2 " +
  "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 " +
  "duration-[var(--dur-normal)] ease-[var(--ease-out)]"
```

### `Command` (cmdk — for ⌘K)

Atlas-styled command palette. Wider than default, monospace input.

```tsx
className="border border-[var(--color-border-strong)] bg-[var(--color-surface-elev)] " +
  "rounded-none w-[640px] max-h-[480px]",
input: "font-mono uppercase tracking-[0.12em] text-sm placeholder:text-[var(--color-text-muted)] " +
  "border-0 border-b border-[var(--color-border)] px-4 py-3 bg-transparent",
item: "px-4 py-2 cursor-pointer aria-selected:bg-[var(--color-surface)] " +
  "aria-selected:text-[var(--color-text-primary)]"
```

### `Skeleton`

```tsx
className="bg-[var(--color-surface-elev)] animate-pulse rounded-none"
// motion-reduce: no animate-pulse
```

### `Switch`

```tsx
// Sharp corners, accent fill when on
className="h-6 w-10 rounded-none border border-[var(--color-border-strong)] " +
  "bg-transparent data-[state=checked]:bg-[var(--color-accent)] " +
  "transition-colors duration-[var(--dur-normal)]",
thumb: "h-4 w-4 bg-[var(--color-text-primary)] rounded-none " +
  "translate-x-1 data-[state=checked]:translate-x-5 " +
  "transition-transform duration-[var(--dur-normal)] ease-[var(--ease-out)]"
```

### `Chart` (Recharts)

Tokens for chart colors using the muted semantic palette:

```ts
const chartColors = [
  'var(--color-accent)',           // primary series
  'var(--color-info)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-danger)',
];
```

No gradients on data series. No 3D effects. No animations on hover lines (except cursor follow).

## Step 8 — Custom composites built on top

These don't exist in shadcn; we build them in `components/atlas/*.tsx`:

- `<WorkspaceSwitcher />` — topbar dropdown using `DropdownMenu`
- `<CommandPalette />` — full ⌘K wrapper around `Command`
- `<RecordSheet />` — generic slide-over with tabs (`Sheet` + `Tabs`)
- `<TimelineFeed />` — chronological event renderer
- `<InboxThreeP ane />` — Inbox layout
- `<ThreadList />`, `<ThreadView />`, `<Message />` — inbox primitives
- `<KanbanBoard />`, `<KanbanColumn />`, `<DealCard />` — pipeline primitives (built with `@dnd-kit`)
- `<MetricCard />` — Today view metric cards
- `<AIDraftPanel />` — the embedded AI-drafted message + approve/edit/regenerate
- `<EmptyState />` — empty list/inbox/pipeline empty states (cohesive)
- `<KeyboardHint />` — shows keyboard shortcut next to action
- `<StatusPill />` — for invoice/document/deal status

## Step 9 — Verify

After Step 1–7, run:

```bash
npm run dev
```

Open the app shell. Check:

- [ ] Dark default surface, ink background
- [ ] Burnt orange accent (only on primary button)
- [ ] Instrument Serif on headings (italic carry one keyword)
- [ ] Geist on body
- [ ] Geist Mono on numbers + buttons
- [ ] No rounded corners on surfaces
- [ ] No drop shadows
- [ ] Hairline borders everywhere
- [ ] `next-themes` toggle works
- [ ] All shadcn components render in Atlas voice

If any check fails — fix before declaring Phase 0 done.

## Why we install everything up front

Avoid the "death by a thousand `shadcn add`s" — each install regenerates `components.json`, occasionally rewrites neighboring files, and prompts. One bulk install at Phase 0 means we never touch the shadcn CLI again unless a new component lands in the registry that we want.
