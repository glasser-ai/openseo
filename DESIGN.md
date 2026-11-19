# OpenSEO design standard

This document is the quality bar for the OpenSEO interface. A review grades the
interface against the numbered criteria below. Each criterion is a statement that
a reviewer can check on a screen.

The token source is `src/ui/style.css`. When this document and the tokens
disagree, fix the disagreement; do not choose one silently.

## Surfaces

| Surface | Where | Size |
|---|---|---|
| Panel | An extension iframe injected at the right edge of the page (`entrypoints/mount.content.ts`) | 560px wide, full height; `max-width: 100vw` |
| Panel navigation | The left column of the panel (`src/ui/Sidebar.tsx`) | 132px |
| Settings in the panel | A view inside the panel, selected from the navigation foot | Panel content width |
| Settings page | `options.html`, opened in a tab | Up to 960px, navigation column 180px |
| Toolbar icon and badge | The browser toolbar | Icon 16–32px; badge up to 4 characters |

## Purpose

OpenSEO answers one question for the open site: how strong is this domain, and
where does its traffic come from? Every screen serves that question first.
Money is the second concern: a person must always know what a result costs and
whether it was paid for.

## Criteria

### Orientation

- **D1** The panel names the domain it reports on, once, at the top. No other
  text competes with it at that level.
- **D2** Exactly one navigation item is current at a time. When Settings is open,
  no report section is current.
- **D3** Each navigation icon reads as its label without the label. An icon that
  most products use for another meaning (for example a sun for theme) fails.

### Hierarchy

- **D4** Text uses only the five size tokens: `hero` 28px, `section` 16px,
  `figure` 20px, `body` 14px, `small` 12px. A size between two steps fails.
- **D5** `muted-foreground` is the only secondary text colour. Lower levels use
  size, weight or the mono face, not a lighter grey.
- **D6** Each card has one lead figure or one heading that the eye reaches first.
- **D7** Section headings use `.lbl` (16px, weight 600). Nothing else looks like
  a section heading.

### Colour

- **D8** Colour means state (`good`, `warn`, `bad`) or identity inside one chart
  (`chart-1` to `chart-6`, `chart-rest`). Colour used for emphasis or decoration
  fails.
- **D9** Colour is never the only signal. With colour removed, every state still
  reads from text, position or shape.
- **D10** Text on `primary` uses `primary-foreground`. Hard-coded white or black
  on a token surface fails.
- **D11** Body text meets 4.5:1. Non-text indicators (focus rings, meter bands,
  chart marks) meet 3:1 against the surface behind them, in light and dark.

### Type and shape

- **D12** Poppins is the interface face. Kode Mono is used only for money and
  machine identifiers (prices, charges, Run links, the Key field).
- **D13** Radii are `radius-token` (cards) and `radius-sm` (controls and small
  blocks). Other radii fail, except true circles.
- **D14** Fonts load from the extension. A request to a font CDN fails, because it
  breaks the promise in `PRIVACY.md`.

### States

Every surface that loads data shows each of these states with its own words,
not a blank area:

- **D15** No Key: says that a Key is needed and where to add it.
- **D16** Loading: shows that a request runs, and for a paid request, that it may
  charge.
- **D17** Saved result: shows its age (for example "3d ago") and a way to refresh.
- **D18** No data: says that the Provider has no data for this domain, which is
  different from a failure.
- **D19** Failure: says what failed and what the person can do next.
- **D20** Budget reached: says that the budget stopped the lookup and where to
  change it.
- **D21** Unsupported page (`chrome://`, the Web Store): says that OpenSEO cannot
  report on this page.

### Money and trust

- **D22** A paid action shows its estimated price before or at the moment it
  runs. A charge that the person did not expect fails.
- **D23** Every paid result links to its Run and shows its charge.
- **D24** A setting that spends money says "Paid" in its description and states
  what it sends.

### Toolbar badge

- **D25** The badge shows a whole number from 0 to 100, or `…` while a lookup
  runs, or nothing. It never shows text that is cut off.
- **D26** The badge belongs to the open tab. Switching tabs never shows another
  site's rating.

### Interaction

- **D27** Every control has a visible focus ring (`ring`, 2px, offset 3px) and a
  pointer cursor.
- **D28** Targets are at least 32px high; primary buttons and fields are at least
  40px.
- **D29** The panel works with the keyboard alone: arrow keys move through the
  navigation, and Escape or the close control closes the panel.

### Layout

- **D30** Nothing scrolls sideways inside the panel at 560px, and the panel stays
  usable when the browser window is narrower than 560px.
- **D31** Light and dark follow the system setting. Both schemes pass D8–D11.
