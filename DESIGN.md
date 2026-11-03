# SSL Billing design system - "Ledger"

A quiet working surface for people who bill all day, mostly on a phone. Solid
paper surfaces separated by hairlines, ink-dark text, **one** ink-blue accent for
actions and "you are here". No glass, glow, gradients, decorative grids, coloured
icon bubbles or uppercase micro-labels. The figures are the content.

Light is the default; dark re-points the same tokens. Tokens live in
`src/index.css`; primitives in `src/components/ui.tsx`. **Never write a raw hex,
a Tailwind palette colour (`slate-500`, `orange-600`) or a `dark:` variant in a
component.**

## Type

IBM Plex Sans for everything; IBM Plex Mono **only** for identifiers.

| Use | Class |
|---|---|
| Page title (header only) | `text-base font-semibold` |
| Card / section title | `text-sm font-semibold text-ink` |
| Body, table cells, inputs, buttons | `text-sm` (13px) |
| Field labels | `text-xs font-medium text-ink-soft` (sentence case) |
| Captions, hints, column heads, meta | `text-xs text-ink-faint` |
| Smallest allowed | `text-[11px]` (tab-bar labels, dense table meta) |
| KPI figure | `numeral text-lg sm:text-xl` |
| In-table amount | `tabular-nums font-medium text-ink` (sans, not mono) |
| Invoice no / LR / GSTIN / PAN / UTR / vehicle | `font-mono text-[13px]` (weight 400-500) |

The theme caps weight at 600: `font-bold`/`font-extrabold` render as 600, but write
`font-semibold` (headings, key figures) or `font-medium` (emphasis) explicitly.
No `uppercase`, no `tracking-wide*`. Nothing above `text-xl` inside content.

## Colour

| Token | Use |
|---|---|
| `canvas` | page background (warm grey) |
| `surface` | cards, inputs, sidebar, tab bar (white) |
| `surface-muted` | table header row, hover |
| `surface-sunken` | segmented-control track, wells, skeletons, neutral badge |
| `sheet` | dialogs and drawers |
| `line` / `line-strong` | hairlines / hover borders |
| `ink` / `ink-soft` / `ink-faint` | primary / body / secondary text |
| `accent-strong` (+ `-hover`) | **primary button fill only** |
| `accent-soft` + `accent-ink` | active nav item, selected row, links |
| `positive`, `warning`, `danger`, `info` (`-soft`, `-line`, `-ink`) | status only - paid, due, overdue, unpaid |

Colour carries meaning, never decoration: no tinted backgrounds on ordinary cards,
no coloured section headers, no coloured icon tiles. Money that is owed may be
`text-warning-ink`; overdue `text-danger-ink`; received `text-positive-ink`.
Everything else is ink.

## Shape, space, elevation

* Radius: controls 6px (`rounded-control`), cards 8px (`rounded-card` / `.panel`),
  dialogs 10px. Badges 4px. `rounded-full` only for avatars and dots.
* Cards are flat: `.panel` (white + 1px `line`). No shadows on cards. Only things
  that float (dialogs, drawer, menus, toast) get `shadow-overlay`/`shadow-raised`.
* Spacing on a 4px grid. Page gutter 12px phone / 24px desktop. Card padding
  12px phone / 16px desktop. Gap between sections 12px phone / 16px desktop.
* Controls: 40px tall on phones, 36px (`md`) or 32px (`sm`) on desktop - the
  primitives do this. Icon buttons 32px with a 44px hit area (`tap-44`).

## Components (use these, don't hand-roll)

`Button` (one `primary` per screen; `secondary`, `ghost`, `danger`), `IconButton`,
`Card`, `CardHeader` (title row with hairline), `StatCard`, `MetricStrip`/`Metric`,
`Badge`, `StatusBadge`, `Segmented` (every filter/mode switch - **not** orange
pills), `PillTabs` (view tabs), `Field` + `Input`/`Select`/`Textarea`,
`DataTable` (table on desktop, row list on phone), `Modal` (centred dialog on
desktop, bottom sheet on phone; already handles Escape, focus trap, Back button),
`EmptyState`, `ErrorState`, `Spinner`, `SkeletonRows`, `FormError`, `Toast`
(fixed, bottom).

## Layout patterns

* **Screen**: optional KPI strip → toolbar (Segmented filters + search + actions)
  → one `.panel` holding the table. Toolbars wrap on phones; search goes full
  width; secondary actions collapse to icon buttons.
* **Phone lists**: one row per item, 2-3 lines: primary id + status on line 1,
  party / route on line 2, amounts right-aligned. No nested cards.
* **Forms**: label above field, two columns from `sm`, sections separated by a
  `text-sm font-semibold` heading and a hairline, not by coloured boxes. Sticky
  footer with Cancel (ghost) + one primary.
* **Detail views**: header with id + status + actions, then key-value grid
  (`text-xs text-ink-faint` label over `text-sm text-ink` value), then tables.

## Motion

120-180ms ease-out on colour/opacity only. Dialogs rise 6px / sheets slide up.
Nothing loops except spinners and skeletons. `prefers-reduced-motion` is honoured
globally.

## Accessibility

Contrast ≥ 4.5:1 for text in both themes (tokens are tuned for it). Focus ring
never removed. Every icon-only button has a label. Status = dot + word. Touch
targets ≥ 40px tall on phones.
