# Frontend Design System — UniFi-authentic

> **Read this before touching any UI.** This document is derived from actual
> measurements of the live **UniFi Network** dashboard — I inspected the DOM
> with DevTools, pulled computed styles and CSS custom properties directly,
> and transcribed them into `frontend/src/index.css`. No guessing, no "what
> feels right". If a rule here contradicts your intuition, the rule wins.
>
> Token prefix used by UniFi in the wild: `--desktop-*`
> Token prefix used in this project: plain names on `:root`, exposed to
> Tailwind 4 via `@theme inline` in `frontend/src/index.css`.

---

## The Five Non-obvious Truths

Before anything else, internalize these. They are the five things most
developers get wrong about "the UniFi look":

1. **Cards are transparent.** UniFi cards have `background: rgba(0,0,0,0)`.
   The white you see comes from a single full-bleed `bg-page` white panel
   behind everything. Cards are not filled surfaces.

2. **Cards have no shadow.** Zero. `box-shadow: none`. A card is delimited
   by a **1px hairline border** at **7% alpha charcoal** — `hsla(214, 8%,
14%, 0.07)`. That's it. No elevation.

3. **Radii are small.** The default is **`4px`**, not 12 or 14. Buttons,
   cards, chips, inputs — all 4px. Icon tiles bump up to **`8px`**. 16px
   only appears on hero-sized surfaces (rare).

4. **Padding is tight.** Card padding is **`12px`**, not 24. Card-to-card
   gap is **`8px`**, not 20. The whole dashboard is a tightly-packed grid.

5. **Base font is `13px/20px`.** Not 14, not 16. Headings are `15px` (card
   title), captions are `11px`, metrics are `27px`. Font is **Inter**.

If any commit violates truths 1–5, it's wrong. Fix it.

---

## Measured Values (ground truth)

All values below were pulled from `getComputedStyle()` on real elements in
the UniFi Network dashboard. The token column is what this project exposes
on `:root` and via Tailwind's `@theme inline`.

### Colors — light mode

| Name            | Token              | Value                           | Role                                                                                      |
| --------------- | ------------------ | ------------------------------- | ----------------------------------------------------------------------------------------- |
| Page bg         | `page` / `surface` | `#FFFFFF`                       | The single white panel behind everything                                                  |
| Inset bg        | `inset`            | `hsl(214 8% 98%)` ≈ `#F8F9FA`   | Rare inset panels                                                                         |
| Icon tile bg    | `tile`             | `hsl(214 8% 96%)` ≈ `#F4F5F6`   | Small fills behind icons, pills                                                           |
| Hairline        | `hairline`         | `hsla(214 8% 14% / 0.07)`       | **Every** card edge, every divider                                                        |
| Hairline strong | `hairline-strong`  | `hsla(214 8% 14% / 0.12)`       | Hover/focus card edge                                                                     |
| Text 1          | `text-1`           | `hsl(214 8% 14%)` ≈ `#212327`   | Headings, metrics                                                                         |
| Text 2          | `text-2`           | `hsl(214 8% 34%)` ≈ `#50565E`   | Body, default inherited                                                                   |
| Text 3          | `text-3`           | `hsl(214 8% 54%)` ≈ `#80858F`   | Captions, icon default                                                                    |
| Text 4          | `text-4`           | `hsl(214 8% 78%)` ≈ `#C4C9D0`   | Disabled, placeholder                                                                     |
| Brand           | `brand`            | `hsl(214 100% 50%)` = `#006FFF` | Primary, links (ublue-06)                                                                 |
| Brand hover     | `brand-hover`      | `hsl(214 100% 60%)`             | ublue-05                                                                                  |
| Brand active    | `brand-active`     | `hsl(214 100% 40%)`             | ublue-07                                                                                  |
| Success         | `success`          | `hsl(138 59% 51%)` ≈ `#36CB5D`  | green-06                                                                                  |
| Warning         | `warning`          | `hsl(37 91% 55%)` ≈ `#F4A81F`   | orange-06                                                                                 |
| Danger          | `danger`           | `hsl(358 80% 66%)` = `#EE6368`  | project override — lighter than UniFi `red-06` (#EE3B3B) which read too dark on our cards |
| Tint brand      | `tint-brand`       | `hsl(214 100% 95%)`             | soft bg for brand pills                                                                   |
| Tint success    | `tint-success`     | `hsl(138 60% 95%)`              | soft bg for success pills                                                                 |
| Tint warning    | `tint-warning`     | `hsl(37 91% 95%)`               | soft bg for warning pills                                                                 |
| Tint danger     | `tint-danger`      | `hsl(357 82% 96%)`              | soft bg for danger pills                                                                  |

Note: UniFi itself sometimes uses `rgba(0, 0, 0, 0.65)` on white for body
text instead of a solid HSL — the visual result is almost identical to
`text-2`. This project standardizes on solid tokens (`text-2`).

### Radii

| Name    | Token                  | Value     | Use                                             |
| ------- | ---------------------- | --------- | ----------------------------------------------- |
| Default | `rounded` (`--radius`) | **`4px`** | buttons, cards, chips, inputs, chart containers |
| Medium  | `rounded-md`           | **`8px`** | dialogs, popovers, icon tiles                   |
| Large   | `rounded-lg`           | `16px`    | hero blocks (rare)                              |
| Pill    | `rounded-pill`         | `9999px`  | status pills, progress bars, avatars            |

### Shadows

**Cards do not use shadow.** They have `box-shadow: none` and are delimited
by the hairline border. The shadow tokens below exist only for
**popovers, dropdowns, dialogs, and modals** — i.e. floating UI.

| Name    | Token            | Value                                                            | Use                           |
| ------- | ---------------- | ---------------------------------------------------------------- | ----------------------------- |
| Initial | `shadow-initial` | `0 0 0 1px rgba(charcoal, 0.08)`                                 | Border-like halo (rare)       |
| Popover | `shadow-popover` | `0 4px 12px rgba(charcoal, 0.08) + 0 0 1px rgba(charcoal, 0.08)` | Dropdowns, selector menus     |
| Dialog  | `shadow-dialog`  | `0 8px 24px rgba(charcoal, 0.08) + …`                            | Floating/inline dialog panels |
| Modal   | `shadow-modal`   | `0 12px 48px rgba(charcoal, 0.12) + …`                           | Modal dialog                  |

### Typography

Font family: **Inter, "UI Sans", Lato, Arial, sans-serif**

| Role                       | Font            | Token                                                   |
| -------------------------- | --------------- | ------------------------------------------------------- |
| Body (default inherited)   | `400 13px/20px` | `u-body` / `text-[13px]`                                |
| Button label               | `400 13px/20px` | `u-body` (NOT bold — UniFi uses regular 400 on buttons) |
| Caption / section label    | `400 11px/16px` | `u-caption` / `text-[11px]`                             |
| Input label                | `400 11px/16px` | `u-caption`                                             |
| Heading small              | `600 11px/16px` | `u-h-sm`                                                |
| Heading medium             | `600 13px/20px` | `u-h-md`                                                |
| Heading large (card title) | `600 15px/24px` | `u-h-lg`                                                |
| Heading xlarge-1           | `600 19px/28px` | `u-h-xl`                                                |
| Metric (big number)        | `600 27px/36px` | `u-metric`                                              |
| Metric xl                  | `600 35px/48px` | `text-[35px]`                                           |

**IMPORTANT**: The project keeps `html { font-size: 16px }` so Tailwind's
`text-sm`/`text-base` utilities behave as documented. **But** `body` is set
to `font-size: 13px; color: text-2`, which is what UniFi actually uses for
inherited body text. When you need UniFi-accurate sizing on a specific
element, either use the `.u-*` classes defined in `index.css`, or write
explicit `text-[13px] leading-[20px]` / `text-[11px] leading-[16px]`.
Do **not** just use `text-sm` and expect UniFi sizes.

### Spacing rhythm

UniFi's dashboard uses a 4px step scale. The values you'll actually hit:

| Use                                | px     | Tailwind          |
| ---------------------------------- | ------ | ----------------- |
| Within a card (content spacing)    | 8      | `gap-2`           |
| Card padding                       | **12** | `p-3`             |
| Card-to-card gap in a row          | **8**  | `gap-2`           |
| Row outer padding                  | **12** | `p-3`             |
| Section gap (card row to next row) | 16–24  | `gap-4` / `gap-6` |
| Form item gap                      | 8      | `gap-2`           |
| Form section gap                   | 24     | `gap-6`           |

The dashboard is **dense**. Resist the urge to write `p-6` / `gap-5`.

### Borders

- Card/panel edge: `border border-hairline` — `1px solid hsla(214 8% 14% / 0.07)`
- Stronger border (focus/hover on card): `border-hairline-strong`
- Button outlined variant: `1px solid var(--brand)` or `1px solid var(--text-3)`

### Button sizes (measured)

- **Height: 32px** (outlined default)
- **Padding: 0 16px**
- **Radius: 4px**
- **Font: 400 13px/20px Inter** (regular weight, not bold)
- **Border: 1px solid** (brand blue for primary, text-3 for neutral)
- **Background: transparent** for outlined variant, brand-filled for solid

### Icon tiles (the "热门客户端" style squares)

- **40×40 px**
- **background: #FFFFFF** (white, not gray!)
- **border-radius: 8px** (rounded-md)
- **border: 2px solid** the brand color when highlighted, `1px solid hairline` otherwise
- **padding: 0** — icon fills tile via flex centering

---

## The 10 Rules (with citations)

### 1. Cards are transparent hairline boxes

```tsx
<div className="border border-hairline rounded p-3">{/* content */}</div>
```

No `bg-*`, no `shadow-*`. If you need separation on a white page, use
a second `border border-hairline` around a group of cards.

### 2. One white panel, everywhere

The page itself is `bg-page` (= pure white). Every column, every sidebar,
every content area sits on this same white. **Do not** shift background
colors between regions to separate them — use `border-hairline` lines on
the boundaries instead.

Exception — dark mode: in dark mode `page` is `#131418` and `surface` is
`#1C1E22`, a clear lightness bump. In dark mode cards DO get `bg-surface`.

### 3. Radius is 4 by default

- Buttons, cards, chips, inputs, chart containers → `rounded` (4px)
- Icon tiles, dialog panels, selectors, dropdowns → `rounded-md` (8px)
- Status pills, progress bars → `rounded-pill`
- Everything else: ask yourself why you'd go bigger

### 4. 12/8 padding, not 24/20

- Card padding → `p-3` (12px)
- Card-to-card gap → `gap-2` (8px)
- Row outer padding → `p-3`
- Section padding → `p-4` (16px) at most, rarely `p-6`

### 5. Text sizes are 11 / 13 / 15 / 27

- Default (inherited): 13/20 regular, color `text-2`
- Card title: `u-h-lg` → 15/24 semibold, color `text-1`
- Caption / section label: `u-caption` → 11/16 regular, color `text-3`
- Big metric: `u-metric` → 27/36 semibold, color `text-1`
- **No uppercase, no tracking-wide** on labels — UniFi doesn't do that

### 6. Buttons: 32px tall, 4px radius, regular weight

```tsx
/* Outlined primary (the default brand button) */
<button className="h-8 px-4 rounded border border-brand text-brand text-[13px] leading-5 hover:bg-tint-brand transition-colors">
  ISP 速度测试
</button>

/* Solid primary — rare, used for destructive-primary like "Confirm delete" */
<button className="h-8 px-4 rounded bg-brand text-white text-[13px] leading-5 hover:bg-brand-hover transition-colors">
  确认执行
</button>

/* Secondary */
<button className="h-8 px-4 rounded border border-hairline text-text-1 text-[13px] leading-5 hover:bg-tile transition-colors">
  取消
</button>

/* Link */
<button className="text-brand text-[13px] leading-5 hover:text-brand-hover">
  查看全部
</button>
```

Regular weight (`font-weight: 400`), not bold.

### 7. Color is an accent, never a fill

- Status dots, small pills, text color, 1px borders: **yes**
- Large (>200px) filled backgrounds: **no**
- For status blocks, use `bg-tint-*` only for **inline** notices under
  ~40px tall, with `text-*` (the solid accent) for the text
- Section-sized alerts: use a bordered card with an accent icon, never
  a filled background

### 8. Charts use soft fills, no axis lines

- Recharts: `<Line strokeWidth={1.5} />`, `<Area fillOpacity={0.10} />`
- Grid: `stroke: var(--hairline)`, `strokeDasharray: "3 3"`, horizontal-only
- Axes: `axisLine={false} tickLine={false}`, tick `fill: var(--text-3)`, `fontSize: 11`
- Tooltip container: `rounded` (4px), `bg: var(--surface)`, `border: 1px solid var(--hairline-strong)`, `box-shadow: var(--shadow-popover)`, `font-size: 11px`

### 9. Hover is quiet

- Rows, buttons: `hover:bg-tile` (only)
- Cards: `hover:border-hairline-strong` (only — no shadow animation)
- Links: `hover:text-brand-hover` (no underline)
- Focus: `focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1`
- **No transform, no scale, no shadow swap on hover.**

### 10. Tabular numbers

Any time you render a metric, a percentage, a time, a file size, or a
count, add `tabular` (defined in `index.css`) so numbers align vertically.
This is one of the details that makes UniFi feel "engineer-grade".

---

## Component Templates

### Card

```tsx
<div className="border border-hairline rounded p-3">
  <div className="u-h-lg text-text-1 mb-2">China Telecom</div>
  <div className="u-caption text-text-3 mb-1">WAN IP</div>
  <div className="u-body text-text-1 tabular mb-3">192.168.1.4</div>
  <div className="u-caption text-text-3 mb-1">月度数据使用量</div>
  <div className="u-body text-text-1 tabular">231 GB</div>
</div>
```

### Section header (above a row of cards)

```tsx
<div className="u-caption text-text-3 mb-2">热门 AP</div>
<div className="flex gap-2">
  {/* cards */}
</div>
```

### Icon tile (e.g. "top client" icon square)

```tsx
<div className="w-10 h-10 rounded-md border border-hairline bg-page flex items-center justify-center">
  <ClientIcon className="w-6 h-6 text-text-3" strokeWidth={1.5} />
</div>
```

### Status pill

```tsx
<span className="inline-flex items-center gap-1 rounded-pill bg-tint-success px-2 py-0.5 text-[11px] leading-4 text-success tabular">
  <span className="inline-block w-1 h-1 rounded-full bg-success" />
  99.94%
</span>
```

### Metric block

```tsx
<div>
  <div className="u-caption text-text-3 mb-1">吞吐量</div>
  <div className="flex items-baseline gap-1">
    <span className="u-metric text-text-1 tabular">216</span>
    <span className="u-body text-text-3">Kbps</span>
  </div>
</div>
```

### Progress bar (horizontal pill)

```tsx
<div className="h-1 rounded-pill bg-tile overflow-hidden">
  <div className="h-full rounded-pill bg-brand" style={{ width: '67%' }} />
</div>
```

### Dialog (modal)

Dialogs use the `<Dialog>` + `<DialogContent>` primitives from
`components/ui/dialog.tsx`. **All three close mechanisms are always active
— they require zero per-dialog configuration:**

1. **X button** (top-right) — always rendered automatically via context;
   no `onClose` prop needed.
2. **Overlay click** — clicking the backdrop outside the dialog closes it.
3. **Escape key** — pressing Esc anywhere closes the dialog.

```tsx
<Dialog open={showDialog} onOpenChange={setShowDialog}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Title</DialogTitle>
    </DialogHeader>
    {/* body */}
    <DialogFooter>
      <Button variant="outline" size="sm" onClick={() => setShowDialog(false)}>
        Cancel
      </Button>
      <Button size="sm" onClick={handleSubmit}>
        Confirm
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

**Rules:**

- **Never omit the close button.** The X button renders automatically when
  `DialogContent` is inside a `Dialog`. If you need a custom close handler,
  pass `onClose` to `DialogContent`; otherwise leave it off.
- Delete / destructive dialogs must have a confirmation step.
- Dialog width: `max-w-sm` (confirm), `max-w-md` (form), `max-w-lg` (complex).
- Radius: `rounded-md` (8px). Background: `bg-popover`. Shadow: `shadow-dialog`.

---

## Anti-patterns (fix on sight)

| ❌ Wrong                                              | ✅ Right                                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `bg-surface rounded-[14px] shadow-card p-6` on a card | `border border-hairline rounded p-3` (no bg, no shadow)                                  |
| `shadow-lg` / `shadow-pop` on a card                  | Nothing — cards don't elevate. Use shadow on popovers only.                              |
| `rounded-[10px]` / `rounded-[14px]`                   | `rounded` (4px) — default. `rounded-md` only for tiles/dialogs.                          |
| `text-xs uppercase tracking-wide` label               | `u-caption text-text-3` — no uppercase, no tracking                                      |
| `p-6` / `gap-5` / `py-4` on a dense panel             | `p-3` / `gap-2` — UniFi is tight                                                         |
| `bg-red-50 border border-red-200 text-red-700` banner | Small pill: `bg-tint-danger text-danger rounded-pill px-2 py-0.5`                        |
| `bg-tint-warning rounded-[14px] p-6` as a big alert   | Bordered card: `border border-hairline rounded p-3` with a `text-warning` icon + pill    |
| `bg-primary text-white font-bold` button              | `h-8 px-4 rounded border border-brand text-brand text-[13px]` (outlined, regular weight) |
| `bg-page` with softly tinted gray like `#F7F8FA`      | `bg-page` is pure white. There is no tint.                                               |
| `border-border/40` or other `/40` opacity hacks       | `border-hairline` (the token already has 0.07 alpha)                                     |
| `text-muted-foreground`                               | `text-text-2` or `text-text-3` explicitly                                                |
| `font-weight: 500` on body text                       | 400 for body, 600 for headings. 500 is not a UniFi weight.                               |

---

## Dark mode — measured from the same live dashboard

The key insight from inspecting UniFi's dark theme: **cards are still
transparent**. The 10 rules do not change between modes. Only the
following token values flip:

| Token            | Light                                 | Dark                                                                                  |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------------------------- |
| `page`           | `#FFFFFF`                             | `hsl(214 8% 8%)` = `#131416` (measured mainbody-bg-dark)                              |
| `surface`        | `#FFFFFF`                             | `hsl(214 8% 8%)` — **same as page**, cards stay transparent                           |
| `sidebar`        | `#FFFFFF`                             | `hsl(214 8% 12%)` = `#1C1E21` — subtly lifted so columns are visible against the page |
| `popover`        | `#FFFFFF`                             | `hsl(214 8% 17%)` = `#282A2E` — dialogs/menus lift to depth_2                         |
| `inset` / `tile` | `hsl(214 8% 98%)` / `hsl(214 8% 96%)` | `hsl(214 8% 17%)`                                                                     |
| `hairline`       | `hsla(214 8% 14% / 0.07)`             | `hsla(214 8% 98% / 0.07)` — flip to 7% alpha white                                    |
| `brand`          | `hsl(214 100% 50%)` = `#006FFF`       | `hsl(214 100% 64%)` = `#4D8DFF` (one step lighter for contrast)                       |
| `text-2` (body)  | `#50565E`                             | `hsl(214 8% 88%)` ≈ `#DDDFE2`                                                         |

Direct measurements (from DevTools on the UniFi dashboard in dark mode):

- A dashboard card's computed style: `background: rgba(0,0,0,0)`,
  `border: 1px solid rgba(249,250,250,0.07)`, `border-radius: 4px`,
  `box-shadow: none`, `padding: 12px`. **Identical to light mode
  except the border color flipped.**
- MAIN_PANEL (the dashboard area): `background: rgb(19, 20, 22)` — this
  is `--page` in dark mode.
- Body inherited text color: `rgba(255, 255, 255, 0.65)` — visually the
  same as `text-2-dark` = `hsl(214 8% 88%)`.

### Practical rules

- **Card JSX does not change between modes.** `border border-hairline
rounded p-3` (no bg) works correctly in both. The hairline token swaps
  color automatically.
- **Columns/sidebars need `bg-sidebar`** — not `bg-page` — so they lift
  visibly above the dashboard in dark mode. In light mode this is also
  white and the column is delineated by the `border-r/l border-hairline`.
- **Dialogs/popovers use `bg-popover`** so they rise to depth_2 in dark
  mode. In light mode `bg-popover` is also white and the
  `shadow-dialog` (charcoal drop) delineates it.
- **Status tints** (`bg-tint-*`) are deep dark versions in dark mode
  (`hsl(213 88% 16%)` etc) — not pastel. This is measured from UniFi's
  own `ublue-01-dark` / `red-01-dark` / etc tokens.

### Dark mode shadows

On a dark background you can't drop anything darker, so UniFi's shadows
degenerate into what's essentially a **1px alpha-white halo** plus a
nominal dark drop. The visible delineation of a floating surface comes
from:

1. The lifted `bg-popover` color (vs the darker page)
2. The `0 0 0 1px hsla(214 8% 98% / 0.08)` white halo inside the shadow

The drop part (`0 8px 24px hsla(0,0,0,0.6)`) is mostly nominal in dark
mode — it adds a whisper of extra dimming at the edge but cannot lift
the surface visually on its own.

---

## Governance

- `frontend/CLAUDE.md` references this file — it's mandatory reading at
  the start of every session that touches frontend.
- When you find new patterns in the live UniFi dashboard that this file
  doesn't cover, **re-measure them** via DevTools (don't guess) and add
  them here.
- Token changes go through `frontend/src/index.css`. Never hardcode hex
  values in components. Never use raw `rgba()` except for the hairline
  which is already in the token.
- When code and this file disagree, the file wins.
