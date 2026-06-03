---
name: markdown-reviewer
description: CLI markdown annotation tool with a browser-based review UI
colors:
  violet-twilight: "oklch(0.481 0.194 289.55)"
  dark-amethyst: "oklch(0.223 0.090 318.94)"
  violet-tint: "oklch(0.72 0.14 295)"
  surface: "oklch(0.08 0.000 0)"
  surface-raised: "oklch(0.14 0.000 0)"
  text-primary: "oklch(0.94 0.008 300)"
  text-muted: "oklch(0.62 0.01 300)"
  border: "oklch(0.20 0.03 310)"
typography:
  display:
    fontFamily: "Unbounded, sans-serif"
    fontWeight: 700
  headline:
    fontFamily: "Unbounded, sans-serif"
    fontWeight: 400
  body:
    fontFamily: "Albert Sans, system-ui, sans-serif"
    fontWeight: 400
  label:
    fontFamily: "Albert Sans, system-ui, sans-serif"
    fontWeight: 500
  mono:
    fontFamily: "SUSE Mono, ui-monospace, SFMono-Regular, monospace"
    fontWeight: 500
---

<!-- SEED: re-run /impeccable document once there's code to capture the actual tokens and components. -->

# Design System: markdown-reviewer

## 1. Overview

**Creative North Star: "The Annotated Terminal"**

A developer tool that borrows the authority of a terminal and the clarity of a typeset document. The interface is dark, high-contrast, and unapologetically focused on the markdown content. Violet and amethyst accents mark annotations and primary actions — sparse, deliberate, never decorative. Unbounded carries document headings with bold condensed presence; Albert Sans handles body text and all UI chrome with clean humanist readability. SUSE Mono is reserved for code blocks. The pairing signals confidence: expressive display headings, legible prose, precise code.

This explicitly rejects generic SaaS dashboard aesthetics: no card grids, no gradient text, no cream backgrounds, no feature walls. This is a single-purpose tool for people who read and write markdown for a living.

**Key Characteristics:**
- Dark surface by default — the user is reviewing documents, often in dim environments
- Unbounded headings + Albert Sans body — expressive display paired with humanist readability
- SUSE Mono for code only — monospace reserved for code blocks, not headings
- Restrained color — violet twilight and dark amethyst, used sparingly for annotations and actions
- Responsive motion — transitions and state feedback, no choreography
- Content-first layout — the markdown document fills the viewport; chrome is minimal

## 2. Colors

**Strategy: Restrained.** Dark neutrals carry the surface; violet and amethyst mark annotations and primary actions at ≤10% of any given screen.

### Primary
- **Violet Twilight** `oklch(0.481 0.194 289.55)`: Annotation highlights, primary buttons, active states, links. The interactive brand color. White text on this fill.
- **Dark Amethyst** `oklch(0.223 0.090 318.94)`: Annotation overlay backgrounds, borders, tinted surfaces. Too dark for filled buttons; used as a surface modifier.
- **Violet Tint** `oklch(0.72 0.14 295)`: Filled badges, status pills, tag highlights. Derived lighter tint for readable filled elements.

### Neutral
- **Surface** `oklch(0.08 0.000 0)`: Main background. Pure near-black, no hue tint.
- **Surface raised** `oklch(0.14 0.000 0)`: Toolbars, modals, panels. Slightly lighter than surface.
- **Text primary** `oklch(0.94 0.008 300)`: Body copy, headings. Near-white with subtle purple warmth. ≥12:1 against surface.
- **Text muted** `oklch(0.62 0.01 300)`: Metadata, labels, advisory text. ≥4.5:1 against surface.
- **Border** `oklch(0.20 0.03 310)`: Dividers, block boundaries. Subtle purple tint.

### Named Rules
**The Annotation Mark Rule.** The primary accent appears only on annotated blocks, primary actions, and active states. Its rarity is the point — when you see it, something is flagged.

**The Dark Default Rule.** The UI ships dark. The user is reviewing documents in a focused work session, often alongside a terminal or IDE. Light mode is not a priority.

## 3. Typography

**Display Font:** Unbounded — Condensed display sans-serif for document headings (h1–h3). Bold, expressive, high-impact letterforms that command attention without needing large sizes.
**Body / UI Font:** Albert Sans — Humanist sans-serif for all body text, labels, buttons, metadata, and UI chrome. Clean, readable, and highly legible at small sizes.
**Mono Font:** SUSE Mono — Monospace for code blocks and inline code only. Self-hosted .woff2 files.

**Character:** Three-font pairing with clear separation of concerns. Unbounded carries the document structure with bold condensed presence. Albert Sans handles everything else with humanist warmth and readability. SUSE Mono is strictly for code — never headings, never UI. The pairing signals "expert tool, not generic scaffold."

### Hierarchy
- **Display** (Unbounded, Bold 700, to be sized): Document h1 only. Maximum emphasis.
- **Headline** (Unbounded, Regular 400, to be sized): Document h2–h3. Section breaks.
- **Title** (Albert Sans, Semi-bold 600, to be sized): Modal titles, section headers.
- **Body** (Albert Sans, Regular 400, to be sized): Document prose, annotation comments. Max 65–75ch line length.
- **Label** (Albert Sans, Medium 500, to be sized): Block type badges, line numbers, toolbar labels. Possibly uppercase.
- **Mono** (SUSE Mono, Medium 500 / Bold 700, to be sized): Code blocks, inline code.

### Named Rules
**The Display Heading Rule.** Unbounded appears only in rendered markdown headings (h1–h3). All UI chrome — buttons, labels, metadata, toolbar, body text — uses Albert Sans. Code blocks and inline code use SUSE Mono exclusively.

**The Mono-For-Code Rule.** SUSE Mono is strictly for code. Never apply it to headings, labels, buttons, or data. It belongs in `<code>` and `<pre>` only.

## 4. Elevation

Flat by default. Depth is conveyed through tonal layering (surface vs. surface-raised) rather than shadows. Shadows appear only as a response to state — a modal backdrop or a focused element — never as decoration.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. Elevation is tonal, not shadow-based. If a shadow exists, it responds to user interaction.

## 5. Components

No components exist yet. To be documented in scan mode once code is written.

Key components anticipated:
- **Toolbar** — fixed top bar with file name, annotation count, Done button
- **Annotation modal** — click-to-open dialog for adding/editing comments
- **Block highlight** — subtle overlay on annotated blocks
- **Sidebar** — annotation list with stale/orphaned status indicators

## 6. Do's and Don'ts

### Do:
- **Do** keep the markdown document as the dominant visual element. Chrome should frame, not compete.
- **Do** use the accent color only for annotations and primary actions. Its scarcity makes it meaningful.
- **Do** use Unbounded only for document headings. All UI chrome uses Albert Sans.
- **Do** use SUSE Mono only for code blocks and inline code.
- **Do** use tonal layering instead of shadows for depth. Surface vs. surface-raised is enough.
- **Do** keep transitions fast (150–250ms). Users are in flow; don't make them wait.

### Don't:
- **Don't** use generic SaaS dashboard patterns: card grids, gradient text, cream backgrounds, feature walls. Don't default to the warm-red/orange terminal palette either — this brand lives in amethyst and violet.
- **Don't** apply SUSE Mono to headings, UI labels, buttons, or data. It belongs in code blocks only.
- **Don't** apply Unbounded to body text or UI chrome. It's a display font for headings only.
- **Don't** decorate with motion. Transitions convey state changes; nothing else.
- **Don't** use `border-left` or `border-right` as colored accent stripes on blocks. Use background tints or the accent overlay instead.
- **Don't** ship with unreadable muted text. All text must hit ≥4.5:1 contrast against its background.
