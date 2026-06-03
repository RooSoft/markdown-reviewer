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
    fontFamily: "SUSE Mono, ui-monospace, SFMono-Regular, monospace"
    fontWeight: 700
  headline:
    fontFamily: "SUSE Mono, ui-monospace, SFMono-Regular, monospace"
    fontWeight: 500
  body:
    fontFamily: "SUSE, Inter, system-ui, sans-serif"
    fontWeight: 400
  label:
    fontFamily: "SUSE, Inter, system-ui, sans-serif"
    fontWeight: 500
---

<!-- SEED: re-run /impeccable document once there's code to capture the actual tokens and components. -->

# Design System: markdown-reviewer

## 1. Overview

**Creative North Star: "The Annotated Terminal"**

A developer tool that borrows the authority of a terminal and the clarity of a typeset document. The interface is dark, high-contrast, and unapologetically focused on the markdown content. Violet and amethyst accents mark annotations and primary actions — sparse, deliberate, never decorative. SUSE Mono carries document headings; SUSE geometric sans handles all UI chrome. The pairing inverts expectation: structure reads as code, interface reads as product.

This explicitly rejects generic SaaS dashboard aesthetics: no card grids, no gradient text, no cream backgrounds, no feature walls. This is a single-purpose tool for people who read and write markdown for a living.

**Key Characteristics:**
- Dark surface by default — the user is reviewing documents, often in dim environments
- SUSE Mono headings + SUSE sans UI — inverted hierarchy, structure as code
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

**Display Font:** SUSE Mono — Monospace display for document headings (h1–h3). SUSE's custom mono carries technical authority and distinctive letterforms.
**Body / UI Font:** SUSE — Bold geometric sans-serif for all body text, labels, buttons, metadata, and UI chrome. SUSE's proprietary sans is confident, structured, and highly legible.

**Character:** The reverse of the usual pairing — mono for headings, geometric sans for body. This inverts the expected hierarchy: the document structure (headings) reads as code, while the UI chrome reads as product. The pairing signals "this is a document being engineered."

### Hierarchy
- **Display** (SUSE Mono, Bold 700, to be sized): Document h1 only. Maximum emphasis.
- **Headline** (SUSE Mono, Medium 500, to be sized): Document h2. Section breaks.
- **Title** (SUSE, Semi-bold 600, to be sized): Document h3–h4, modal titles.
- **Body** (SUSE, Regular 400, to be sized): Document prose, annotation comments. Max 65–75ch line length.
- **Label** (SUSE, Medium 500, to be sized): Block type badges, line numbers, toolbar labels. Possibly uppercase.

### Named Rules
**The Mono Heading Rule.** SUSE Mono appears only in rendered markdown headings (h1–h3). All UI chrome — buttons, labels, metadata, toolbar, body text — uses SUSE (the geometric sans). This inverts the expected hierarchy: document structure reads as code, UI reads as product.

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
- **Do** use SUSE Mono only for document headings. All UI chrome uses SUSE sans.
- **Do** use tonal layering instead of shadows for depth. Surface vs. surface-raised is enough.
- **Do** keep transitions fast (150–250ms). Users are in flow; don't make them wait.

### Don't:
- **Don't** use generic SaaS dashboard patterns: card grids, gradient text, cream backgrounds, feature walls. Don't default to the warm-red/orange terminal palette either — this brand lives in amethyst and violet.
- **Don't** apply SUSE Mono to UI labels, buttons, or data. It belongs in document headings only. Use SUSE sans for all chrome.
- **Don't** decorate with motion. Transitions convey state changes; nothing else.
- **Don't** use `border-left` or `border-right` as colored accent stripes on blocks. Use background tints or the accent overlay instead.
- **Don't** ship with unreadable muted text. All text must hit ≥4.5:1 contrast against its background.
