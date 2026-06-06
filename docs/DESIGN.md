---
name: Share HTML
register: product
# Design language adapted from modern short-link tools (dub.co): minimal, light,
# near-black solid primary, blue accent, generous whitespace, mono for links.
# OKLCH, tinted neutrals, no pure #000/#fff. Pairs with HeroUI (Tailwind v4).
colors:
  background:  "oklch(0.99 0.003 255)"    # cool near-white
  surface:     "oklch(1 0.001 255)"       # card white (faint tint)
  surface-alt: "oklch(0.975 0.004 255)"   # subtle zebra / inset
  foreground:  "oklch(0.20 0.012 265)"    # near-black ink
  muted:       "oklch(0.55 0.012 265)"    # secondary gray text
  border:      "oklch(0.92 0.004 265)"    # hairline
  primary:     "oklch(0.24 0.015 265)"    # near-black solid button (dub style)
  on-primary:  "oklch(0.99 0.002 255)"    # white text on primary
  accent:      "oklch(0.55 0.19 255)"     # blue (links, focus, highlight)
  on-accent:   "oklch(0.99 0.002 255)"
  success:     "oklch(0.62 0.14 150)"     # green (clean status)
  warning:     "oklch(0.76 0.15 75)"      # amber (needs-review)
  danger:      "oklch(0.58 0.20 25)"      # red (blocked/expired/error)
typography:
  fontSans: "Inter, ui-sans-serif, system-ui, sans-serif"
  fontMono: "ui-monospace, 'SF Mono', 'JetBrains Mono', monospace"  # links / curl / IDs
  h1:   { fontFamily: fontSans, fontSize: "2.5rem",  fontWeight: 700, lineHeight: "1.05", letterSpacing: "-0.025em" }
  h2:   { fontFamily: fontSans, fontSize: "1.5rem",  fontWeight: 640, lineHeight: "1.2",  letterSpacing: "-0.015em" }
  body: { fontFamily: fontSans, fontSize: "0.9375rem", fontWeight: 420, lineHeight: "1.6" }
  small:{ fontFamily: fontSans, fontSize: "0.8125rem", fontWeight: 420, lineHeight: "1.5" }
  code: { fontFamily: fontMono, fontSize: "0.875rem", fontWeight: 460, lineHeight: "1.5" }
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.75rem"
  full: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "2rem"
  xl: "4rem"        # generous section breathing room
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    radius: "{rounded.md}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    border: "1px solid {colors.border}"
    radius: "{rounded.md}"
  input:
    backgroundColor: "{colors.surface}"
    border: "1px solid {colors.border}"
    focusRing: "{colors.accent}"
    radius: "{rounded.md}"
  dropzone:
    backgroundColor: "{colors.surface-alt}"
    border: "1.5px dashed {colors.border}"
    radius: "{rounded.lg}"
  result-card:
    backgroundColor: "{colors.surface}"
    border: "1px solid {colors.border}"
    radius: "{rounded.lg}"
  link-row:
    backgroundColor: "{colors.surface-alt}"
    textColor: "{colors.foreground}"
    fontFamily: "{typography.fontMono}"
    radius: "{rounded.md}"
---

## Overview

Share HTML is, in interaction terms, a short-link tool: put one thing in (an HTML file), get one shareable link out. The interface borrows the dub.co playbook: **minimal, light, fast, zero clutter**. A single confident input/action is the hero; everything else recedes. Built on **HeroUI** (Tailwind v4 + React Aria + OKLCH), so a11y and components come from the library; we own the palette, the generous rhythm, and the link-centric surfaces.

Anti-reference: busy SaaS landing pages, decorative gradients, the warm/earthy palette this project used before. Go clean and neutral; let the link be the star.

## Colors

Strategy: **Restrained** — cool near-white surface, near-black ink, one **near-black solid `primary`** for the single main action (Create share), and a **blue `accent`** reserved for links, focus rings, and highlights. Semantics: clean→success(green), needs-review→warning(amber), blocked/expired→danger(red).

- Never `#000`/`#fff`: background and ink are both faintly tinted.
- `primary` is the solid dark button, used once per view. `accent` blue is for interactive text (the generated links) and focus states, not for filling buttons.

## Typography

- Inter for everything human; tight negative tracking on large headings; cap body at 65–75ch.
- **Mono for every machine string**: the generated Share URL / Preview URL, share ID, claim token, and the `curl` example. On a link tool the URL IS the product, so it gets the monospace, copy-ready treatment, not buried in sans.
- Scale + weight hierarchy (≥1.25 between steps).

## Layout

- Generous whitespace (`xl` between major sections). The upload input is centered and dominant, like a short-link box. Result links sit directly below in a tight, scannable stack.
- Don't box everything: the dropzone and the result block earn a `surface` card; status lines, meta, and copy do not. Never nest cards.

## Elevation & Depth

- Mostly flat. One very soft neutral shadow (`oklch(0.20 0.012 265 / 0.06)`) for the result card and dropzone-hover. No glassmorphism, no heavy borders.

## Shapes

- `md` (0.5rem) radius on inputs/buttons/link-rows; `lg` (0.75rem) on dropzone/result-card. `full` only for tiny pills/avatars. Consistent, modern, not overly round.

## Components

- **Button (primary)**: near-black solid, white text. One per view. HeroUI `Button`.
- **Input / Dropzone**: light surface, hairline border, blue focus ring; dropzone is the hero affordance, filename shown in mono once chosen.
- **Result block**: a clean card stacking Share URL / Preview URL / (anon) Share ID + Claim token, each a **mono `link-row`** with copy + open. Risk reasons as a quiet inline list.
- **Share page**: title + lifecycle/risk/expiry meta line, then the sandboxed iframe in an `lg`-rounded framed surface; report control low-emphasis.

## Do's and Don'ts

- DO keep it minimal, light, neutral. Let the generated link be the focus.
- DO render every URL / token / curl in mono with one-tap copy.
- DO use the near-black `primary` once per view; blue `accent` only for links/focus.
- DON'T bring back gradients, warm/earthy palettes, or busy decoration.
- DON'T box every line; DON'T nest cards; DON'T use side-stripe borders or gradient text.
- DON'T use em dashes in UI copy.
