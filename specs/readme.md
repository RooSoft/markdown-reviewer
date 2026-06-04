# Specs

Feature specifications live here. Each spec is a Markdown document that defines **what** to build and **why**, with enough precision that a coding agent can implement against it without clarifying questions.

> **This file is guidance for the spec-writing agent** in the development workflow. The coding agent should never need to read this — every spec must be self-sufficient. If you are about to write a new spec, this README tells you how. If you are about to implement an existing spec, stop reading this and open the spec file directly.

---

## Naming

```
NNN-short-kebab-title.md
```

- `NNN` — zero-padded sequence number (`001`, `002`, …). Assign the next available number.
- Title matches the primary feature being specified.

A spec lives at one of two paths depending on its size (see the **Decide: single-file vs multi-file** section below):

```
specs/NNN-short-kebab-title.md              # single-file (small feature)

specs/NNN-short-kebab-title.md              # multi-file (large feature)
specs/NNN/
  ├── 01-<phase-slug>.md
  ├── 02-<phase-slug>.md
  └── …
```

---

## Decide: single-file vs multi-file

This is the **first decision** you make — get it right before writing anything else, because the structure of the rest of the spec depends on it. The single-file layout cannot survive a context compaction during implementation; if the coding agent loses its short-term memory, all in-progress state must live in checkbox files on disk. That is what the multi-file layout provides.

**Use multi-file (default for any non-trivial spec)** if *any* of the following is true:

- The feature touches **both** the server layer and the frontend (`app.js`). This is the dominant trigger — almost every user-visible feature qualifies.
- The implementation will produce ≥3 distinct phases. (Three is enough; do not wait for four.)
- Any single phase would touch ≥4 files or take ≥1 hour of focused implementation.
- The spec, written single-file, would exceed roughly 400 lines or 30 KB.
- The feature involves a data format change, a new API route, or a new CLI flag — these always demand multiple phases (storage → wire-up → UI → docs).

**Use single-file only** when the feature is genuinely a one-shot change with no compaction risk:

- A new field on an existing endpoint, with no UI or pipeline impact.
- A config knob with a default that documents itself.
- A pure refactor with no behaviour change.

When in doubt, multi-file. Splitting *down* later is more painful than the opposite.

> **Docs are a phase.** Every multi-file spec ends with an `0N-documentation.md` phase that updates `AGENTS.md` and `README.md`. Treating docs as their own ticked phase prevents the common "feature shipped, docs forgotten" outcome.

> **A static integration test is mandatory.** Every multi-file spec that adds or changes any frontend↔server call MUST include a **static integration test** — a code-reading cross-check that every UI API call maps to a real server route with matching method, path, and request/response shapes. It is *static*: read `app.js` against the server's router, do **not** launch the app. This catches the recurring class of bugs where a UI call hits a path/method the server doesn't serve, before the first manual run. See [Static integration test](#static-integration-test-multi-file-specs) below for what it covers and where it goes.

---

## Required sections (single-file specs)

Every single-file spec must contain, in order:

1. **Overview** — one paragraph. What this feature does, for whom, and why it exists.
2. **Motivation** — the problem being solved. Concrete, not aspirational.
3. **Goals** — bulleted list of what success looks like. Each goal is verifiable.
4. **Non-goals** — explicit list of what is deferred or out of scope. Prevents scope creep mid-implementation.
5. **Data model** — schema changes, new types, migration strategy.
6. **API contract** — HTTP endpoints, request/response shapes, error codes.
7. **Concurrency & failure modes** — locks, races, timeouts, fallback behavior.
8. **UI specification** — layout, interaction model, state transitions, accessibility.
9. **Implementation phases** — ordered work units with acceptance criteria. Each phase has runnable verification commands so a resuming agent can confirm what's done.
10. **Open questions** — unresolved decisions that must be answered before or during implementation. Mark `_None._` if you have nothing.

Sections without content should be marked `_None._` rather than omitted, so a reader knows the section was considered.

---

## Required structure (multi-file specs)

The root file `specs/NNN-title.md` is a **thin index**; per-phase files under `specs/NNN/` are **self-contained work units**. Each phase file inlines the data model, API contract, and UI specification details its work actually needs — the coding agent should be able to complete the phase by reading just that one file plus the relevant source code.

> **Why this layout** (and not "root carries shared design, phases reference it"): the auto-loaded `AGENTS.md` + the root spec + the active phase file all stack into the agent's context window. Putting full shared design in the root forces the agent to read both the root and the phase file in detail every turn, which can burn 30–50% of a 128k window before any code is opened. Self-contained phase files mean the agent reads one phase file per phase, period.

### Root file — required sections, in order

1. **Title + `Status:` line** — `# NNN — Title` then `**Status:** `READY`` (or current value).
2. **Coding agent: start here** prelude — copy the template below **verbatim**, substituting `NNN` and `<title-slug>`. The prelude explicitly tells the agent each phase file is self-contained and that re-reading the root for shared design is unnecessary.
3. **Overview** — one paragraph.
4. **Motivation** — concrete problem statement.
5. **Goals** — bulleted, each verifiable.
6. **Non-goals** — explicit deferrals.
7. **Implementation phases** — a one-paragraph intro plus the **Phase dashboard** table plus the **How to resume after a context compaction** routine (template below).
8. **Open questions** — `_None._` if you have nothing.

> Do NOT put shared **Data model**, **API contract**, **Concurrency & failure modes**, or **UI specification** sections in the root file. Push that content into the phase file(s) that actually need it. Phase 1 typically carries the storage / config / REST contract; Phase 2 carries server integration; Phase 3 carries the UI spec. If two phases need the same fact (e.g. the JSON shape of a new HTTP response), repeat it in each — duplication is cheaper than a context round-trip.

### Per-phase file — required sections, in order

Each `specs/NNN/0M-<phase-slug>.md` is self-contained. Required sections, in order:

1. **Title + Status block** — see skeleton below. `**Status:**` must be in the top 5 lines so `head -5` shows it.
2. **Run this phase in a worker subagent** — the cold-start context the orchestrator hands the per-phase worker (branch, read-scope, one-line prior-phases summary, definition of done). Required because the coder orchestrates phase→worker; without it the orchestrator has no per-phase handoff. Final phase adds the STOP-before-merge line.
3. **Files touched** — the concrete paths this phase edits.
4. **Pre-flight check** — runnable `rg` / `bun test` / `curl` commands that reflect on-disk reality. The resume-from-cold survival kit.
5. **Data model** / **API contract** / **UI specification** — inline whichever sections this phase actually needs to do its work. The phase file is self-sufficient; do not say "see parent spec for Data model."
6. **Work items** — checkboxes (`- [ ]` / `- [x]`). A ticked box means "shipped to disk and committed."
7. **Acceptance criteria** — also checkboxes.
8. **When done** — explicit handoff steps.

### Size budget (target, not cap)

- **Target:** ~200 lines per phase file. Hitting it is a signal to consider extraction, not a hard rule.
- **When a phase file exceeds the target, in priority order:**
  1. **Split if there's a clean dependency boundary.** Rare — if it were natural you'd already have split.
  2. **Extract heavyweight reference material to `specs/NNN/refs/<topic>.md`.** Examples: full error-code matrices, large JSON-shape galleries, exhaustive enum tables. The phase file references them by relative path; the agent only opens the ref file when needed.
  3. **Add a phase-file table of contents** so the agent can jump to the section it needs.
  4. **Accept the size.** If (1)–(3) don't apply, a fat phase file is the right answer.
- **Hard rule:** *ambiguity is a bug* trumps *phase file is long*. If you can't be both short and unambiguous, be unambiguous. Resolution beats brevity, every time.

### Static integration test (multi-file specs)

Any multi-file spec that touches both the server and the frontend MUST include a **static integration test** — a verification step that confirms, by reading code, that every frontend API call the spec adds or changes is correctly wired to the server. Do **not** require running the app; this is a paper/code cross-check.

**Where it goes:** as a dedicated **Static integration test** section (a Work-items group + matching Acceptance criteria) inside the final phase — typically the `0N-documentation.md` phase, which already runs last. If the surface is large, make it its own short phase right before documentation. Either way it must be a ticked checklist, not prose.

**What it checks** — for every frontend call the spec adds or changes (look in `src/frontend/app.js` and any `fetch` callers):

1. **Route exists** — the exact path (including `:id`-style params) and HTTP method appear in the server router (`src/server/index.ts`). Path typos and method mismatches (`POST` vs `PUT`) are the most common failure.
2. **Request shape matches** — every field the frontend sends in the body maps to a field the server handler expects, with **matching casing** (TS `camelCase` throughout).
3. **Response shape matches** — every field the frontend reads off the response exists on what the handler returns, again with matching casing. Flag fields the UI reads that the server never sends.
4. **Error/empty paths** — the status codes and error-body shape the UI branches on are actually what the handler returns.

**How to run it:** read `src/frontend/app.js` against `src/server/index.ts` manually as a checklist table in the phase file, e.g. `app.js POST /api/annotations → server route POST /api/annotations ✓`. Any row that can't be matched is a bug to fix before the phase is `DONE`, not a deferral.

### Copy-paste templates

#### Root prelude

```markdown
## Coding agent: start here

This spec is your complete brief — you do not need to read `specs/README.md` (that file is for the spec author, not you). Each per-phase file under [`NNN/`](NNN/) is **self-contained** for completing its phase; you do not need to read this root file in detail or the other phase files.

**How to use this spec:**

1. Read **Overview**, **Motivation**, **Goals**, **Non-goals** once to anchor on what is being built and what is intentionally excluded.
2. Open the **Phase dashboard** below. The first row whose `Status` is not `DONE` is your active phase. Open that `NNN/0N-*.md` file and work entirely from it.
3. As you finish work items, tick the checkboxes in the per-phase file. When a phase is complete, set its `Status` to `DONE` in both that file's top-of-file line AND the dashboard row in this file — same commit as the code change.
4. If you lose context mid-feature (a compaction wiped your short-term memory), use the **How to resume after a context compaction** routine in the Implementation phases section.

**Reading discipline — read lazily, one phase at a time. Do NOT front-load.**

- Read **only this root's** Overview / Motivation / Goals / Non-goals, then open **only the one active phase file**. Do **not** read the other phase files, and do **not** re-read this root for design — each phase file is self-contained by construction.
- Read **source files on demand**, when a work item actually requires touching them — start from the phase's **Pre-flight check** commands (they use `rg`/`ls` to surface the few relevant lines), not by opening whole files up front. Prefer targeted searches over full-file reads.
- Read referenced docs (e.g. `DESIGN.md`) **only when the phase you are on tells you to**. Don't open a doc a later phase needs while working an earlier phase.
- Finish and commit a phase before opening the next one. Opening everything at once burns the context window before any code is written and gives no benefit — phases are sequential and self-contained on purpose.

Implementation work happens on the branch `spec/NNN-<title-slug>` per the rule in `AGENTS.md`. Do not merge the branch to `main` autonomously — that requires explicit operator approval.
```

#### Phase dashboard + resume routine

```markdown
## Implementation phases

This spec is split into per-phase work files under [`NNN/`](NNN/) so each phase fits comfortably in a context window alongside the relevant source code. Each phase file is self-contained — it carries the data model, API contract, and UI specification details relevant to its work. The **Phase dashboard** below is the single source of truth for "what's done."

### Phase dashboard

| # | Phase | File | Status |
|---|-------|------|--------|
| 1 | <phase title> | [`NNN/01-<slug>.md`](NNN/01-<slug>.md) | `TODO` |
| 2 | <phase title> | [`NNN/02-<slug>.md`](NNN/02-<slug>.md) | `TODO` |
| … | … | … | … |
| N | Documentation | [`NNN/0N-documentation.md`](NNN/0N-documentation.md) | `TODO` |

Statuses: `TODO` → `IN PROGRESS` → `DONE`. Update both this table AND the top of the corresponding phase file in the same commit — they must always agree.

### How to resume after a context compaction

If you are reading this AFTER a compaction (you don't remember what you were doing), follow this routine exactly:

1. **Confirm which spec** — run `git branch --show-current`. It should be `spec/NNN-<title-slug>`. If not, you may be on the wrong feature.
2. **Find the current phase** — look at the dashboard table above. The first row whose status is NOT `DONE` is where to resume. The dashboard is authoritative for phase-level status. (If you want to double-check, the top ~5 lines of any `NNN/0N-*.md` file restate the same `Status:` value; the two must agree. If they ever disagree, trust whichever is `IN PROGRESS` and reconcile.)
3. **Open the current phase file and work entirely from it.** Every per-phase file is structured the same way:
   - A `Status:` line at the top (top ~5 lines) so you can tell its state with a single `head -5`.
   - **Files touched** — the concrete paths you will edit.
   - A **Pre-flight check** block with concrete `rg` / `bun test` / `curl` commands. **Run these every time you resume** — they're cheap and remove ambiguity.
   - **Data model / API contract / UI** sections containing every contract your phase needs. **You do not need to re-read the root spec for shared design** — it is all in the phase file.
   - A **Work items** section with checkboxes (`- [ ]` / `- [x]`). The first unticked item is where you pick up.
4. **Make progress, then update state, then commit.** Commit the phase file along with the code changes — that way the next resume sees ticked boxes that match the on-disk reality. If a phase transitions from `TODO` → `IN PROGRESS` because you started it, update both the dashboard row above AND the phase file's `Status:` line in the same commit.
5. **When the phase is fully done**, set both the dashboard row AND the phase file's `Status:` to `DONE`, then open the next phase file. The phase file's "When done" footer reminds you of this.
6. **Never skip a phase.** Dependencies are listed in each file's `Depends on:` line near the top.

The contract between you-now and you-after-compaction is: **dashboard row + phase file `Status:` line + phase file work-item checkboxes** are the only state you can trust. Anything else (your memory, in-context plans) may be gone. Keep all three honest after every commit.
```

#### Per-phase file skeleton

Save as `specs/NNN/0M-<phase-slug>.md`:

```markdown
# Phase M — <phase title>

**Status:** `TODO`
**Depends on:** <comma-separated list of prior phases, or "—">
**Parent spec:** [`../NNN-<title-slug>.md`](../NNN-<title-slug>.md) (read only Overview / Motivation / Goals / Non-goals — everything else this phase needs is below)

This file is self-sufficient for completing Phase M. Do not pre-emptively open other phase files or re-read the root spec.

---

## Run this phase in a worker subagent

The coder acts as **orchestrator** and implements this phase in a dedicated `worker` subagent that starts cold. Hand the worker exactly this context:

- **Branch:** `spec/NNN-<title-slug>` (already checked out — commit here, never merge to `main`).
- **Read in full:** this file (`specs/NNN/0M-<phase-slug>.md`) — it is self-contained — plus the root spec's Overview / Motivation / Goals / Non-goals for framing. Do **not** read the other phase files.
- **Prior phases landed:** <one line on what earlier phases shipped that this phase builds on — e.g. "Phase 1 added the X module/API; use it, don't re-add it". Write "none — this is the first phase" for Phase 1.>
- **Definition of done:** all Work items + Acceptance criteria ticked; gates green (`bun run typecheck`, `bun test`; add `curl` smoke tests if this phase adds routes); committed on the branch with this file's `Status:` AND the root dashboard row both set to `DONE` in the same commit. <For the final phase, add: "This is the last phase — STOP after committing and wait for operator approval before merging.">

---

## Files touched

- `<absolute path>` — <one-line reason>
- …

## Pre-flight check (resume-after-compaction hint)

```sh
# concrete rg / bun test / curl commands that inspect on-disk reality
```

If a step's outputs show the code already exists, that step is done — skip it and re-run its tests to confirm.

## Data model        <!-- include only if this phase introduces or relies on a schema / type / file-layout -->

<inline the storage layout, JSON shapes, sanitisation rules, migration steps this phase needs. If a future phase needs the same fact, repeat it there too.>

## API contract      <!-- include only if this phase adds or modifies HTTP / RPC -->

<inline the route(s), request/response shapes, error codes, validation order this phase implements or consumes.>

## UI specification  <!-- include only if this phase is the frontend UI phase -->

<inline layout, interactions, accessibility, error-string mapping.>

> ⚠ **Before writing UI:** load the `impeccable` skill (if available) and read the repo-root `DESIGN.md`. Match existing component styling. This is non-optional — UI phases without this step produce off-brand results.

## Work items

Tick each box as you complete it. Commit after each logical group.

### 1. <Group title>

- [ ] <item>
- [ ] <item>

## Acceptance criteria

- [ ] (a) <concrete, verifiable assertion — usually a passing test or curl round-trip>
- [ ] (b) …

All tests pass under `bun test`. `bun run typecheck` is clean.

## When done

1. Verify the acceptance test list above is fully ticked.
2. `bun run typecheck && bun test` (and any curl smoke tests for new routes).
3. Update this file's `Status:` to `DONE`.
4. Update the parent spec's **Phase dashboard** row for Phase M to `DONE`.
5. Commit on the spec branch. Move to [`0(M+1)-<next-slug>.md`](0(M+1)-<next-slug>.md). The final phase's "When done" tells the agent to STOP and wait for operator approval before merging.
```

### Per-phase rules

- **Status must live in the top 5 lines** of every phase file so `head -5` is enough to read it.
- **Work-item checkboxes are the durable progress contract.** A ticked box is "shipped to disk and committed," not "almost there."
- **Acceptance criteria are also checkboxes**, separate from work items — they encode the verification step.
- **Self-contained, not referencing.** Inline the data model / API / UI sections this phase needs. If two phases need the same fact, repeat it in each. The cost of duplication is small; the cost of an agent context-switching back to the root spec mid-implementation is large.
- **Respect the size target but never sacrifice resolution.** If the phase file grows past ~200 lines, try splitting, extracting to `specs/NNN/refs/`, or adding a TOC. If none of those work, leave the file long — ambiguity is a bug, length isn't.
- **Any phase that builds or changes frontend UI MUST instruct the coding agent to (1) load the `impeccable` skill and (2) read the repo-root `DESIGN.md`, before writing components — and to match the existing styling.** Put this as a **Before you start** block near the top of the UI phase file (and list "load impeccable + read DESIGN.md" as the first work-item checkbox). This is non-optional: UI phases without it produce off-brand, unpolished results.

---

## Gates (Bun/TypeScript repo)

Run these before marking any phase `DONE`:

```sh
bun install            # once, and after any dependency change
bun run typecheck      # tsc --noEmit; MUST be clean
bun test               # run all tests; MUST be green
```

There is no `cargo`, no `npm run lint`, no `clippy` — this is a Bun-only repo. Do not invent linting steps that don't exist.

---

## Writing style

- Write for a coding agent reading the spec cold. No assumed context from Slack, GitHub issues, or prior conversations. No assumed reading of any other file in `specs/` — every spec is self-sufficient.
- Prefer tables and concrete examples over prose paragraphs for contracts and schemas.
- All field names use the exact casing that will appear in code (`camelCase` for TypeScript).
- Ambiguities are bugs. Resolve every "it depends" before marking a spec ready.
- Mark unresolved items with `> ⚠ UNRESOLVED: …` blockquotes so they are visually distinct.

---

## Starting a spec: confirm the goal

Before any design or exploration, **lock the goal.** Infer it from what the user asked and propose a one-paragraph goal statement back to them, then get sign-off (or a correction):

- **Problem** — what's wrong / missing today, concretely.
- **Intended outcome** — what "good" looks like once shipped.
- **Success signal** — how we'll know it worked (an observable behavior, a metric, a test).

Propose, don't interrogate: a drafted goal the user can correct beats an open "what do you want?". If the request is genuinely ambiguous, ask. A misunderstood goal is the most expensive bug in the whole pipeline — it survives the spec, the review, and the implementation.

The agreed goal becomes the spec's `Overview` + `Goals`. Keep tabs on it for the rest of the session: when a new requirement appears, test it against the goal before folding it in — serve-the-goal or scope-creep-that-needs-its-own-spec. If the goal shifts, re-state and re-confirm it.

## Finishing a spec: pre-READY checklist, adversarial review, handoff

A spec is not done when the last section is written — it is done when it is hardened and handed off. Three steps close the loop:

### 1. Pre-`READY` checklist

Run this before flipping the status to `READY`. Each item is a "have I asked?", not a formality — most mid-implementation surprises trace back to a missed one:

- [ ] **Invariant by construction?** If the spec defends an invariant with bookkeeping (persisting fields to keep a derived form consistent, escape/unescape round-trips, reconciliation), did you first consider a canonical source of truth that removes the derivation entirely? Surface that option to the user rather than defaulting to the defensive design.
- [ ] **Observability/transparency preserved?** Does the change keep existing inspection/debug surfaces working? If a feature touches persistence or the output format, name explicitly what stays observable.
- [ ] **Migration of existing on-disk data?** If an on-disk format changes, is there a migration (or an explicit, documented "best-effort / not needed") for pre-existing sessions/configs?
- [ ] **Coder execution model stated?** For multi-file specs, does each phase file carry its "Run this phase in a worker subagent" block (sequential workers, cold-start context to pass)?
- [ ] **Every `> ⚠ UNRESOLVED` resolved.**

### 2. Adversarial review (offer it)

Before marking `READY`, **ask the user whether they want an adversarial review.** If yes, generate a copy-paste prompt for a hostile reviewer (a separate model, or a fresh agent) whose job is to *break* the spec. The prompt must:

- name the spec's **core invariants/claims** and demand the reviewer try to falsify *those* (not surface nits);
- tell the reviewer to read the actual source the spec names and quote `file:line`, not reason from memory;
- demand findings as bracket-numbered items `[1]`/`[2]` with severity + a concrete failure scenario + a fix/decision;
- ask for a steelman of what the spec gets right, so good decisions aren't "corrected."

Triage the findings *with the user* — accept real ones, push back on overblown ones — and fold accepted fixes in **before** `READY`. Keep the review file out of `specs/` (e.g. `reviews/NNN-*.md`) so the coder never mistakes it for a spec.

### 3. Handoff block (deliver it)

End the session with a copy-paste block the user drops into the coder's CLI. Template for a multi-file spec:

```
Implement spec NNN on branch `spec/NNN-<slug>` (already pushed; check it out).

This is a multi-file spec — act as ORCHESTRATOR: delegate EACH phase to its own `worker`
subagent, run them STRICTLY SEQUENTIALLY, and hand each worker the context in that phase
file's "Run this phase in a worker subagent" block. Do not implement phases in your own context.

Start: read specs/NNN-<slug>.md (Overview/Motivation/Goals/Non-goals + the Phase dashboard),
then open the first non-DONE phase file and spawn its worker.

Per phase: tick work items + acceptance criteria; run the gates (bun run typecheck,
bun test; curl smoke tests if routes changed); set the phase Status AND the root dashboard
row to DONE in the same commit; commit on the branch.

Do NOT merge to main. When all phases are DONE, open a PR titled
"<title> (spec NNN)" and STOP for operator review.
```

For a single-file spec, the Handoff is the same minus the orchestrator/worker paragraph: read the spec, implement the phases in order, run the gates, commit, open the PR, stop.

## Status lifecycle

Add a status line near the top of each spec (root file for multi-file specs):

| Status | Meaning |
|--------|---------|
| `DRAFT` | Under discussion, not ready for implementation |
| `READY` | Spec is locked. Implementation may begin. |
| `IN PROGRESS` | Implementation underway. Spec should not change without a note. |
| `DONE` | Shipped. Spec is an archival record. |

For multi-file specs the root file uses these same four values to describe the feature as a whole; per-phase files use the simpler `TODO` / `IN PROGRESS` / `DONE` triad to describe individual phase progress.
