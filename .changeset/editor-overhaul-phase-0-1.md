---
"louise-toolkit": minor
---

Editor overhaul, Phase 0 (correctness) + Phase 1 (chrome and the add flow).

Backfills the changeset for #323, which merged without one.

## Correctness

**Grammar checker latches off when `harper.js` is missing.** A missing or broken
optional peer made the editor re-import — and re-fail — the linter on every typing
pause, flooding the console and doing repeated rejected-promise work on the hot
path, which could intermittently break a section save. The first load failure now
latches a module-scoped flag: log once, stop scheduling. Teardown gained a
`.catch` so a pending load can't surface as an unhandled rejection.

**Page links, CTAs and forms are inert while editing.** A stray click on a link
used to navigate away mid-session; a form could submit. Both are now suppressed in
edit mode, so the click lands on the label as an inline edit instead. Implemented
as capture-phase `preventDefault` only — no `stopPropagation` — so inline-edit
focus still arrives and site CSS/hover is untouched. The editor's own chrome is
exempt.

**Rich text gained an `inline` single-line mode.** Editing a heading or tagline
used to be able to turn it into a `<p>`/`<h2>` nested *inside* the site's own
heading element, silently losing the brand style. `inline` restricts to inline
formatting, suppresses block-splitting keys, and serializes the value as inline
HTML with no block wrapper. An `image` toggle controls the insert-image button.
Threaded through `mountRichText`.

## Chrome and the add flow

**Toolbar glyphs are phosphor SVGs** (arrow-up/down, x, plus, wrench) rather than
unicode/emoji — monochrome, `currentColor`, consistent across platforms.

⚠️ **This changes how toolbar buttons are located.** They no longer carry glyph
text, so any selector or test matching on `textContent` (`"⚙"`, `"+"`, `"✕"`)
stops matching. Use the `aria-label` instead — e.g. `"Layout & settings"`,
`"Add block after"`, `"Add section above"`.

**`SectionChromeActions.onAdd`** is new (optional): supplying it gives the section
toolbar a `+`.

**The `+` opens a type-picker that inserts ABOVE the clicked section.** The
floating "Add section" control is gone, replaced by an in-flow trailing add — and
a single centred `+` on an empty page. `addSection(type, atIndex)` takes the
insert index.

**`inline: false` array fields render an editable input per item** in the
inspector, so array content (marquee words, contact topics) is finally typeable
rather than read-only.

Additive and backwards-compatible throughout — existing behavior is unchanged
unless a site opts in via `richText` or `onAdd`. The glyph-to-SVG change is the
one thing that can break a downstream selector.
