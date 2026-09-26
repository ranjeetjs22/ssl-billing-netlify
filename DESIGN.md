# SSL Billing design system

Deep charcoal, glass surfaces, restrained ember. Panels are translucent white
over charcoal rather than solid fills, so they layer and the ambient light reads
through them. Orange is an accent, not a theme: it marks the primary action, the
active destination, and the one data series that matters. Nothing else.

**Dark is the default. Light is a complete alternate**, not an afterthought: it
re-points the same token names, which is why there is not one `dark:` variant in
the codebase.

Everything below is defined once in `src/index.css`. **Never write a raw hex or a
`slate-500`-style class in a component.** If a value is missing, add a token. A
class naming a token that no longer exists silently renders nothing, which is how
nine modals ended up with no backdrop at all, so this rule is load-bearing rather
than stylistic.

## Principles

1. **Glass layers, it does not stack.** Panels sit barely above the background and
   separate by hairline, not by contrast or by a heavy shadow.
2. **Anything that covers live content stops being glass.** Dialogs, the mobile
   drawer and tooltips use the opaque `sheet` surface. Translucency is for
   decoration, never for something you have to read through.
3. **One accent does all the work.** Ember drives the CTA, the active nav marker
   and the primary chart series. There is no second brand hue.
4. **Numbers are the loudest thing on the page.** Labels are 11px uppercase and recede.
5. **Status reads as a dot plus a word**, never colour alone.

## Colour

### Surfaces and text

| Token | Dark (default) | Light | Use |
|---|---|---|---|
| `canvas` | `#08080A` | `#F4F4F6` | Page background; carries the decorative layer |
| `surface` | white / 3.4% | white / 78% | Panels, cards, inputs |
| `surface-muted` | white / 6.2% | white / 95% | Hover tint, sticky table heads |
| `surface-sunken` | black / 30% | ink / 4.5% | Desktop rail, wells, skeletons |
| `sheet` | `#121217` | `#FFFFFF` | **Opaque.** Dialogs, mobile drawer, tooltips |
| `scrim` | black / 72% | ink / 45% | The backdrop behind any overlay |
| `line` | white / 7.5% | ink / 10% | Default hairline |
| `line-strong` | white / 16% | ink / 20% | Hover border, decorative ticks |
| `ink` | `#ECECEF` | `#15151A` | Headings, figures |
| `ink-soft` | `#9C9CA5` | `#4E4E58` | Body copy, cells |
| `ink-faint` | `#74747E` | `#6B6B76` | Labels, captions, the secondary chart series |

### Ember, the one accent

| Token | Dark | Light | Use |
|---|---|---|---|
| `accent` | `#FF6A2B` | `#D9480F` | Marks, active indicator, primary chart series |
| `accent-strong` | `#E8541A` | `#D9480F` | CTA fill; carries white text |
| `accent-ink` | `#FF9E74` | `#B8380B` | Accent-coloured text |
| `accent-soft` / `accent-line` | ember 10% / 28% | ember 8% / 24% | Tinted backgrounds and borders |

The `ember-100..800` and `char-50..950` ramps exist for the rare case that needs a
literal step (the GST arcs use `ember-300`). Prefer the semantic names.

### Status

`positive` `warning` `danger` `info`, each with `-soft`, `-line`, `-ink`, and a base
used only for the dot. Rendered as a dot plus text:

```tsx
<Badge tone="positive" dot>Paid</Badge>
```

### The decorative layer

`body::before` is a fixed, non-interactive layer carrying two radial ember washes
and a `--grid-size` (44px) technical grid, masked with
`radial-gradient(130% 100% at 50% 0%, ...)` so it fades out down the page.
`--glow-alpha` and `--deco-alpha` set its strength per theme.

**The app shell must not paint over it.** `body` owns the canvas colour and
`#root` is `position: relative; z-index: 1`; no shell element sets `bg-canvas`.

## Charts

All data viz is ember-plus-neutral and translucent, so the ambient light reads
through the plot. Four rules:

- **One series is ember, the rest are `ink-faint`.** In "Billed vs collected",
  billed is the neutral baseline and collected is the ember highlight. A second
  saturated hue turns a chart into a rainbow.
- **Gradient fills fade to transparent**, `stopOpacity 1` to `0.12` top to bottom,
  never a flat block of colour.
- **The primary series glows** via an SVG `feGaussianBlur` + `feMerge` filter
  (`#lineGlow`). The comparison series is left unfiltered so the two separate.
- **Form follows the data.** The dashboard renders a glowing **area** at 4+ points
  and **gradient columns** below that; an area over two points collapses into a
  meaningless wedge.

Axis labels are words, not codes: `2026-09` renders as `Sep`.

`RingGauge`, `Sparkbars` and `BarRank` each carry their own gradient and
`box-shadow` glow, and the GST panel uses concentric `RadialBar` arcs in
`accent` / `ember-300` / `ink-faint`. CGST and SGST are the same figure on an
intra-state bill, so IGST is the one that has to read as a different thing.

Tooltips are glass: `color-mix(... 82%, transparent)` plus `backdrop-filter`.

## Typography

Apple's own type where it exists, and the closest match everywhere else.

- **Sans:** `-apple-system` / SF Pro on Apple devices, **Geist** elsewhere, at
  **15px** base with `-0.008em` tracking. Geist shares SF's tall x-height, open
  apertures and neutral humanist shapes, so the product reads the same on both.
- **Mono:** SF Mono where available, **Geist Mono** otherwise, for dense table
  columns and identifiers (invoice numbers, GSTIN, references).
- **`.numeral`**, the class for large figures (KPI values, totals): the sans at
  600 with `tabular-nums` and `-0.032em` tracking. Smoother than mono at display
  size while still never jittering as digits change.

`index.html` downloads only Geist and Geist Mono. Keep that link and the
`--font-sans` / `--font-mono` tokens in step: they drifted once, the CSS asked
for a family the page never fetched, and every screen quietly fell back to the
system sans.

| Role | Size | Weight |
|---|---|---|
| KPI figure | `text-[1.75rem]` | 600 |
| Page title | `text-base` / `text-lg` | 600 |
| Section heading | `text-base` | 600 |
| Body | `text-sm` | 400 |
| Nav item | `text-[13px]` | 400, 500 when active |
| Label / caption | `text-xs` | 500, uppercase, `tracking-[0.05em]` (`.label-micro`) |

Form fields are lifted to 16px under `@supports (-webkit-touch-callout: none)`;
below that iOS auto-zooms on focus.

**No em dashes or en dashes anywhere**, in UI copy, comments or commit messages.

## Spacing, radius, elevation

**Spacing** is Tailwind's 4px scale: `gap-2` inside a component, `gap-3`/`gap-4`
between them, `space-y-4` between page sections.

**Radius** is assigned by role, not picked per element:

| Token | Value | Applies to |
|---|---|---|
| `rounded-control` | 8px | Buttons, inputs, chips, nav items |
| `rounded-card` | 12px | Cards, panels, table containers |
| `rounded-overlay` | 16px | Modals and sheets |

**Elevation**, four steps, never ad-hoc: `shadow-card` (resting, almost invisible
by design), `shadow-raised` (hover, popovers, tooltips), `shadow-overlay` (modals),
and `.ring-focus` for the focus ring. `.glow-ember` is the ember bloom on active
markers and on the CTA hover.

## Component classes (`src/index.css`)

| Class | What it is |
|---|---|
| `.panel` | The glass card: translucent, `blur(20px) saturate(140%)`, hairline border, lit top edge via `::after` |
| `.panel-hover` | Adds the lift and the warmer border on hover |
| `.sheet` | **Opaque** layered surface for dialogs, the mobile drawer and the bottom bar |
| `.tip` | Floating tooltip: `sheet` background, strong border, raised shadow |
| `.rule-fade` | A hairline rule that fades at both ends |
| `.pip` | Small live indicator: a dot with a slow halo |
| `.metric-strip` | The KPI band: one continuous surface split by hairlines, 4-up collapsing to 2-up |
| `.status-dot`, `.table-quiet`, `.table-sticky` | Table and status primitives |
| `.stagger` | Staggers children in at 35ms intervals, capped at the 6th |
| `.tap-44` | Reaches the 44px touch minimum without changing visual size. Lives in `@layer components` so it cannot beat Tailwind's `absolute` |

## Components (`src/components/ui.tsx`)

Layout and shell: `Card` (`.panel`), `SectionHeading`, `Modal`, `Toast`, `FormError`
Data: `DataTable`, `StatusBadge`, `Badge`, `EmptyState`, `ErrorState`, `SkeletonRows`
Form: `Field`, `Input`, `Select`, `Button`, `IconButton`

| Component | What it is |
|---|---|
| `MetricStrip` + `Metric` | The KPI band. One panel split by hairlines, not four cards |
| `TrendChip` | The rise/fall pill. `invert` marks a rise as bad news (outstanding, overdue) |
| `Sparkbars` | Inline ember bar trend. Renders nothing below 3 points; two bars is debris, not a trend |
| `RingGauge` | The donut gauge in the KPI strip, 0 to 100 |
| `AvatarChip` | Initials chip; hue derived from the name so a person keeps their colour |
| `PillTabs` | Segmented tabs with a solid active pill |
| `BarRank` | The ranked value / bar / label rows (top freight lanes) |

### Button variants

| Variant | Appearance |
|---|---|
| `primary` | Solid ember. The one loud control, use once per screen |
| `secondary` | Surface with a hairline border. The default |
| `ghost` | Text until hovered |
| `danger` / `success` | Surface with a coloured border and matching text |

## Navigation

`NAV_ITEMS` in `src/components/Sidebar.tsx` is the single source of truth; the
desktop rail, the collapsed rail and the mobile bottom bar all read it, so the
three cannot drift.

- On desktop the rail is a **floating island**: inset 12px on three sides,
  `rounded-overlay`, so the canvas and its ambient light continue around it.
- It toggles between **228px** and **64px**, persisted in
  `localStorage['ssl_sidebar_collapsed']`, and `App.tsx` mirrors the geometry as
  `lg:pl-[252px]` / `lg:pl-[88px]` (12px inset + width + a 12px gutter).
- Items are grouped (main, Manage, Tools) with `.label-micro` headings that
  become a `.rule-fade` divider when collapsed.
- The mobile bar is a floating island too, so `main` needs `pb-28` to clear it.
- Collapsed, each row grows a floating `.tip` label. The nav must stay
  `overflow-visible` when collapsed, because a scroll container clips on **both**
  axes and would cut the tooltips off at the rail edge.
- Icons are lucide at `strokeWidth={1.5}` and 17px, one consistent thin-line set.
- Active reads as a filled `surface-muted` pill with an ember icon, so the whole
  row is the target. On mobile the active tab fills with `accent-soft`.
- The primary action is an `accent-soft` outline that fills to solid ember on
  hover, rather than a permanent orange slab shouting from the top of the rail.
- The mobile bar carries at most five destinations; the rest live behind "More",
  which opens the drawer.
- Nav labels use the app's own vocabulary (Customers, not Consignees; Users, not
  Access), so the rail and the screen it opens never disagree.

## Rules that are enforced, not suggested

- Touch targets are **42px or taller**; icon buttons use `.tap-44` to reach 44px
  without changing their visual size.
- Focus rings are **never** removed. `:focus-visible` is styled globally.
- `prefers-reduced-motion` collapses every animation to 0.01ms.
- Motion is **140ms** (`--duration-fast`) or **220ms** (`--duration-base`),
  ease-out. Nothing longer except the sidebar width at 260ms.
- Colour never carries meaning alone; status has a dot *and* a word.
- Native checkboxes and radios take `accent-color: var(--color-accent)` globally,
  so no control renders in the browser's default blue.
- **Never put `hidden md:inline-flex` on a `Button` or `IconButton`.** They set
  `inline-flex` in their own base classes, and which display utility wins depends
  on stylesheet order rather than class order, so the element stays visible.
  Wrap it in a `<span className="hidden md:flex">` instead.
- A control that switches between modes shows all of them (the theme switcher is
  a three-way segmented control, not a button that cycles blind).

## Adding a screen

1. Compose from `ui.tsx`. Do not write a new card, button or modal shell.
2. Token class names only: `bg-surface`, `text-ink-faint`, `border-line`. If you
   reach for `slate-400`, a token is missing; add it to `index.css`.
3. Anything that floats over content gets `sheet` and a `bg-scrim` backdrop.
4. Money and counts go in `font-mono`, display figures in `.numeral`.
5. Check it in both themes and at 390px wide before calling it done. The theme
   toggle is one click in the header.
