// Louise inline-editing chrome — styled to feel like a modern inline editor: soft blue
// accent, clean light surface, rounded corners, a small floating action bar.
// Injected once at mount (only ever loaded in edit mode) so nothing ships to
// public page loads.

const LOUISE_BLUE = "#1481ef";

const CSS = `
:root {
  --louise-blue: ${LOUISE_BLUE};
  --louise-green: #16a34a;
  --louise-orange: #ea7317;
  --louise-yellow: #ca8a04;
  /* BowenLabs brand type: Roboto Flex throughout (variable font). Headings are
     the same family, just a heavier weight. Loaded via a <link> in
     injectStyles() — only on Louise surfaces. */
  --louise-font-head: "Roboto Flex", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --louise-font-body: "Roboto Flex", ui-sans-serif, system-ui, -apple-system, sans-serif;
}

/* Editable region affordance — subtle until hovered/focused, Tina-style. */
.louise-editable {
  position: relative;
  border-radius: 6px;
  transition: box-shadow 120ms ease, background-color 120ms ease;
  outline: none;
}
.louise-editable:hover {
  box-shadow: 0 0 0 2px rgba(20, 129, 239, 0.25);
}
.louise-editable:focus-within {
  box-shadow: 0 0 0 2px var(--louise-blue);
  background-color: rgba(20, 129, 239, 0.03);
}
.louise-editable::after {
  content: "\\270E";
  position: absolute;
  top: -10px;
  right: -10px;
  width: 22px;
  height: 22px;
  display: none;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #fff;
  background: var(--louise-blue);
  border-radius: 999px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  pointer-events: none;
}
.louise-editable:hover::after {
  display: flex;
}
/* Also reveal the pencil on focus — so keyboard users and touch devices (no
   :hover) still get the affordance once a field is entered. */
.louise-editable:focus-within::after {
  display: flex;
}
.louise-editable .ProseMirror:focus {
  outline: none;
}

/* Floating action bar — bottom center, glassy white card. */
.louise-bar {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483000;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 999px;
  box-shadow: 0 8px 30px rgba(15, 23, 42, 0.16);
  font-family: var(--louise-font-body);
  font-size: 14px;
  color: #0f172a;
}
/* Editor identity: a green "live" dot + the signed-in editor's name. Shown in
   the drawer header (it used to sit on the edit bar). Edits save live to D1, so
   green = live is accurate; a draft/orange state would need a publish workflow
   first. */
.louise-who {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.louise-who-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #16a34a;
  box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.18);
  flex: none;
}
.louise-who-name {
  max-width: 22ch;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Transient save feedback trailing the bar's three actions. Empty at rest, so
   :empty collapses it and the bar shows only the buttons. */
.louise-status {
  font-size: 13px;
  color: #64748b;
}
.louise-status:empty {
  display: none;
}
.louise-status[data-status="error"] {
  color: #dc2626;
}
.louise-status[data-status="saved"] {
  color: #16a34a;
}
/* Three text actions: Save (green, filled primary), Settings (blue), Done
   (orange). No icons. */
.louise-save {
  appearance: none;
  border: none;
  cursor: pointer;
  padding: 8px 18px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  background: var(--louise-green);
  transition: opacity 120ms ease, transform 80ms ease, background 120ms ease;
}
.louise-save:hover:not(:disabled) {
  transform: translateY(-1px);
  background: #15803d;
}
.louise-save:disabled {
  opacity: 0.45;
  cursor: default;
}
.louise-settings,
.louise-exit {
  appearance: none;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 8px 12px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: background 120ms ease;
}
.louise-settings { color: var(--louise-blue); }
.louise-settings:hover { background: rgba(20, 129, 239, 0.1); }
.louise-exit { color: var(--louise-orange); }
.louise-exit:hover { background: rgba(234, 115, 23, 0.12); }

/* The sections editor injects its Save-draft / Publish actions here — a leading
   slot on the shared edit bar. display:contents so the buttons participate
   directly in the bar's flex row, sharing its gap + alignment with Settings/Done
   (one uniform row, not a nested group). */
.louise-bar-actions { display: contents; }
/* Save draft (green) / Publish (yellow) — the SAME text-button treatment as the
   bar's Settings/Done (transparent, pill hover), just brand-coloured, so all the
   bar actions read as one consistent row. */
.louise-savedraft,
.louise-publish {
  appearance: none;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 8px 12px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  transition: background 120ms ease;
}
.louise-savedraft { color: var(--louise-green); }
.louise-savedraft:hover:not(:disabled) { background: rgba(22, 163, 74, 0.1); }
.louise-publish { color: var(--louise-yellow); }
.louise-publish:hover:not(:disabled) { background: rgba(234, 179, 8, 0.12); }
.louise-savedraft:disabled,
.louise-publish:disabled { opacity: 0.45; cursor: default; }

/* Enter-edit floating button shown to authed editors (rendered server-side). */
.louise-enter {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 2147483000;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 999px;
  font-family: var(--louise-font-body);
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  background: ${LOUISE_BLUE};
  text-decoration: none;
  box-shadow: 0 8px 30px rgba(20, 129, 239, 0.35);
}

/* ── Explorer drawer (slice 2) ─────────────────────────────────────────── */
/* The drawer is opened from the cog on the unified edit bar (#18) — there is
   no longer a separate floating "Manage" toggle. */
.louise-drawer-scrim {
  position: fixed;
  inset: 0;
  z-index: 2147483001;
  background: rgba(15, 23, 42, 0.28);
}
.louise-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 2147483002;
  width: min(440px, 94vw);
  display: flex;
  flex-direction: column;
  background: #fff;
  box-shadow: -12px 0 40px rgba(15, 23, 42, 0.2);
  font-family: var(--louise-font-body);
  color: #0f172a;
  animation: louise-slide-in 180ms ease;
}
@keyframes louise-slide-in {
  from { transform: translateX(100%); }
  to { transform: none; }
}
.louise-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
}
.louise-drawer-brand {
  font-weight: 700;
  font-size: 16px;
  letter-spacing: -0.01em;
}
/* Cog + close, grouped at the right of the drawer head. */
.louise-drawer-head-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
/* Titles: same Roboto Flex, just a heavier weight. */
.louise-drawer-brand,
.louise-settings-title,
.louise-item-title,
.louise-drawer :is(h1, h2, h3, h4) {
  font-family: var(--louise-font-head);
  font-weight: 700;
}
.louise-drawer-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  color: #64748b;
  padding: 4px 8px;
  border-radius: 8px;
}
.louise-drawer-close:hover {
  background: rgba(15, 23, 42, 0.05);
}
/* Cog while the Settings view is open. */
.louise-drawer-close.is-active {
  color: var(--louise-blue);
  background: rgba(20, 129, 239, 0.1);
}
.louise-drawer-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
}
.louise-tab {
  border: none;
  background: none;
  cursor: pointer;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #475569;
}
.louise-tab.is-active {
  background: rgba(20, 129, 239, 0.1);
  color: var(--louise-blue);
}
.louise-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
}
.louise-muted {
  color: #64748b;
  font-size: 14px;
}
/* Visible failure feedback for drawer actions (create/save/delete/reorder). */
.louise-alert {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
  font-size: 13px;
  line-height: 1.45;
}

/* ── Artworks panel (slice 2) ──────────────────────────────────────────── */
.louise-list { display: flex; flex-direction: column; gap: 8px; }
.louise-pages-search { width: 100%; margin-bottom: 10px; }
.louise-list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 12px;
  background: #fff;
}
.louise-list-item.is-dragover {
  border-color: var(--louise-blue);
  box-shadow: 0 0 0 2px rgba(20, 129, 239, 0.2);
}
.louise-drag-handle {
  display: inline-flex;
  align-items: center;
  cursor: grab;
  color: #cbd5e1;
  font-size: 18px;
  user-select: none;
  flex: none;
  padding-right: 2px;
}
.louise-drag-handle:active { cursor: grabbing; }
.louise-thumb {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  object-fit: cover;
  background: rgba(15, 23, 42, 0.06);
  flex: none;
}
.louise-item-main { flex: 1; min-width: 0; }
.louise-item-title {
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.louise-item-sub { font-size: 12px; color: #64748b; }
.louise-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}
.louise-badge.for_sale { background: rgba(22, 163, 74, 0.12); color: #16a34a; }
.louise-badge.sold { background: rgba(220, 38, 38, 0.1); color: #dc2626; }
.louise-badge.draft { background: rgba(100, 116, 139, 0.14); color: #475569; }

.louise-row { display: flex; align-items: center; gap: 8px; }
.louise-reorder { display: flex; flex-direction: column; gap: 2px; }
.louise-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(15, 23, 42, 0.12);
  background: #fff;
  cursor: pointer;
  width: 26px;
  height: 22px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1;
  color: #475569;
}
.louise-icon-btn:hover:not(:disabled) { background: rgba(15, 23, 42, 0.05); }
.louise-icon-btn:disabled { opacity: 0.35; cursor: default; }

.louise-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  background: #fff;
  cursor: pointer;
  padding: 9px 14px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}
.louise-btn:hover { background: rgba(15, 23, 42, 0.04); }
.louise-btn-primary { background: var(--louise-blue); color: #fff; border-color: transparent; }
.louise-btn-primary:hover { background: #0072e0; }
.louise-btn-danger { color: #dc2626; border-color: rgba(220, 38, 38, 0.3); }
.louise-btn-block { width: 100%; justify-content: center; }

/* ── Media panel ──────────────────────────────────────────────── */
/* File picker styled as the block primary button (real input is visually
   hidden inside the label). */
.louise-media-upload { cursor: pointer; }
.louise-media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}
.louise-media-card {
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}
.louise-media-thumb {
  aspect-ratio: 1 / 1;
  background: rgba(15, 23, 42, 0.06);
}
.louise-media-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.louise-media-meta { padding: 8px 10px 4px; min-width: 0; }
.louise-media-meta .louise-item-title { font-size: 12px; }
.louise-media-actions { display: flex; align-items: center; gap: 6px; padding: 6px 10px 10px; }
.louise-media-actions .louise-btn {
  flex: 1;
  justify-content: center;
  padding: 6px 10px;
  font-size: 12px;
}
/* Asset-level alt shown under the filename (truncated) so the library reads as
   a real, described set of assets rather than a wall of filenames. */
.louise-media-alt {
  font-style: italic;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Inline alt/caption editor revealed by the card's Alt button. */
.louise-media-edit { display: flex; flex-direction: column; gap: 6px; padding: 4px 10px 8px; }
.louise-media-edit .louise-input { width: 100%; font-size: 12px; }

/* ── Settings panel ───────────────────────────────────────────── */
.louise-settings-group { margin-bottom: 26px; }
/* Accordion sections (#10): native <details> so keyboard/AT behavior is free.
   One section per concern keeps the growing panel scannable. */
.louise-accordion {
  margin-bottom: 10px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 12px;
  background: transparent;
}
.louise-accordion-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.louise-accordion-summary::-webkit-details-marker { display: none; }
.louise-accordion-caret { color: #94a3b8; transition: transform 0.15s ease; }
.louise-accordion[open] > .louise-accordion-summary .louise-accordion-caret { transform: rotate(180deg); }
.louise-accordion-body { padding: 0 14px 14px; }
.louise-textarea { width: 100%; resize: vertical; font: inherit; }
/* Inline media picker (settings share image, etc.): compact thumbnail grid. */
.louise-media-pick-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 6px;
  margin-top: 8px;
  max-height: 240px;
  overflow-y: auto;
}
.louise-media-pick {
  padding: 0;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 8px;
  background: none;
  cursor: pointer;
  overflow: hidden;
  aspect-ratio: 1;
}
.louise-media-pick:hover { border-color: var(--louise-blue); }
.louise-media-pick img { width: 100%; height: 100%; object-fit: cover; display: block; }
.louise-ui-strings { display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow-y: auto; }
/* Sign-out lives at the foot of Settings (it replaced the drawer-head button). */
.louise-settings-session {
  margin-bottom: 0;
  padding-top: 18px;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
}
.louise-settings-title { margin: 0 0 2px; font-size: 15px; font-weight: 600; color: #0f172a; }
.louise-settings-hint { margin: 0 0 12px; font-size: 12px; }
.louise-settings-row { align-items: center; gap: 8px; }
.louise-settings-fields { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
.louise-settings-fields .louise-input { width: 100%; }

.louise-form { display: flex; flex-direction: column; gap: 14px; }
.louise-field { display: flex; flex-direction: column; gap: 5px; }
.louise-field label,
.louise-field-label { font-size: 12px; font-weight: 600; color: #475569; }
.louise-check { display: flex; align-items: center; gap: 9px; cursor: pointer; font-size: 13px; color: #334155; }
.louise-check input { width: 16px; height: 16px; accent-color: var(--louise-blue); cursor: pointer; }
.louise-input,
.louise-select {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 10px;
  font-size: 14px;
  color: #0f172a;
  background: #fff;
}
.louise-input:focus,
.louise-select:focus {
  outline: none;
  border-color: var(--louise-blue);
  box-shadow: 0 0 0 3px rgba(20, 129, 239, 0.12);
}
/* Dock textarea for textarea-typed fields (card bodies, FAQ answers, step/tier
   bodies) — multi-line + resizable so they can hold line breaks. Keeps the
   .louise-input frame; textareas don't inherit font-family, so restore it. */
.louise-dock-textarea {
  resize: vertical;
  min-height: 66px;
  line-height: 1.5;
  font-family: inherit;
}
.louise-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
/* ── Rich-text editor: ONE framed unit ────────────────────────────
   The frame lives on .louise-rt and the editing surface carries the padding.
   The formatting toolbar is a floating selection popover (not part of the
   frame). (Callers must not wrap RichText in another bordered box, or the
   borders double up.) */
.louise-rt {
  position: relative;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 10px;
  /* No fill — the editor look is just the border around the item being
     edited, so the surface reads as the page/panel behind it. */
  background: transparent;
}
.louise-rt:focus-within { border-color: var(--louise-blue); box-shadow: 0 0 0 3px rgba(20, 129, 239, 0.12); }
.louise-rt .ProseMirror:focus { outline: none; }
.louise-prose-surface { min-height: 90px; padding: 9px 11px; font-size: 14px; }
/* ── Page-builder blocks (#16): editing chrome ─────────────────────────
   Matches the editor look — no background fill, a border-only outline on
   the hovered/selected block. Controls are editor-only affordances. */
.louise-block { position: relative; border: 1px solid transparent; border-radius: 6px; }
.louise-block:hover { border-color: rgba(15, 23, 42, 0.14); }
.louise-block.is-selected,
.louise-rt .ProseMirror-selectednode .louise-block,
.louise-rt .louise-block.ProseMirror-selectednode {
  border-color: var(--louise-blue);
  background: transparent;
}
.louise-block-control {
  position: absolute;
  top: 4px;
  right: 4px;
  display: none;
  padding: 2px 8px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 999px;
  background: #fff;
  font-size: 11px;
  color: #475569;
  cursor: pointer;
}
.louise-block:hover .louise-block-control,
.louise-block.is-selected .louise-block-control { display: inline-flex; }
/* Editor-side rendering of serialized block elements. */
.louise-rt .pb-hr { border: 0; border-top: 1px solid rgba(15, 23, 42, 0.18); margin: 18px 0; }
.louise-rt .pb-hr[data-size="lg"] { margin: 38px 0; }
/* Container blocks: CSS-only chrome (no node view) — dashed border + a small
   name tag on hover, border-only per the editor look. */
.louise-rt [data-block] { position: relative; border: 1px dashed transparent; border-radius: 6px; padding: 8px; margin: 10px 0; }
.louise-rt [data-block]:hover { border-color: rgba(15, 23, 42, 0.22); }
.louise-rt [data-block]:hover::before {
  content: attr(data-block);
  position: absolute;
  top: -9px;
  left: 8px;
  padding: 0 6px;
  background: #fff;
  font-family: var(--louise-font-body);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #94a3b8;
}
.louise-rt .pb-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.louise-rt .pb-col {
  min-width: 0;
  outline: 1px dashed rgba(219, 99, 39, 0.3);
  outline-offset: 2px;
  border-radius: 4px;
  padding: 6px;
}
/* Editing outlines (brand orange #db6327) so block/component boundaries are
   clear while editing. View mode (public page) is untouched. */
.louise-rt .pb-hero,
.louise-rt .pb-bleed,
.louise-rt .pb-quote,
.louise-rt .pb-cta,
.louise-rt .louise-row,
.louise-rt .louise-block {
  outline: 1px dashed rgba(219, 99, 39, 0.4);
  outline-offset: 3px;
  border-radius: 3px;
}
.louise-rt .pb-hero:hover,
.louise-rt .pb-bleed:hover,
.louise-rt .pb-quote:hover,
.louise-rt .pb-cta:hover,
.louise-rt .louise-row:hover,
.louise-rt .louise-block:hover {
  outline-color: rgba(219, 99, 39, 0.85);
}
.louise-rt .pb-hero h1, .louise-rt .pb-hero h2 { font-size: 1.5em; margin: 0 0 6px; }
.louise-rt .pb-quote { border-top: 1px solid rgba(15, 23, 42, 0.14); border-bottom: 1px solid rgba(15, 23, 42, 0.14); padding: 10px 4px; font-style: italic; }
.louise-rt .pb-cta { text-align: center; }
.louise-rt .pb-bleed img { max-width: 100%; }
/* Adjustable grid (rowBlock) + gallery — editor preview + chrome. */
.louise-rt .pb-row { display: grid; gap: 14px; align-items: start; }
.louise-rt .pb-grid { display: grid; gap: 8px; grid-template-columns: repeat(3, 1fr); }
.louise-rt .pb-grid[data-cols="2"] { grid-template-columns: repeat(2, 1fr); }
.louise-rt .pb-grid[data-cols="4"] { grid-template-columns: repeat(4, 1fr); }
.louise-rt .pb-grid img { width: 100%; height: auto; border-radius: 6px; }
.louise-row { position: relative; border: 1px solid transparent; border-radius: 8px; }
.louise-row.is-selected,
.louise-rt .ProseMirror-selectednode.louise-row { border-color: rgba(20, 129, 239, 0.5); }
.louise-row-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  padding: 5px 6px;
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.04);
  font-size: 11px;
}
.louise-row:not(:hover):not(.is-selected) .louise-row-bar { opacity: 0.55; }
.louise-row-presets,
.louise-row-ops { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.louise-row-presets { margin-right: auto; }
.louise-chip {
  padding: 2px 7px;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 999px;
  background: #fff;
  font-size: 11px;
  font-family: var(--louise-font-body);
  color: #475569;
  cursor: pointer;
}
.louise-chip:hover { background: rgba(20, 129, 239, 0.08); }
.louise-chip.is-active { background: var(--louise-blue); border-color: transparent; color: #fff; }
.louise-col-adj { display: inline-flex; align-items: center; gap: 2px; }
.louise-col-w {
  min-width: 12px;
  text-align: center;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.louise-btn-xs { padding: 1px 6px; font-size: 11px; line-height: 1.4; }
.louise-row-sep { width: 1px; align-self: stretch; margin: 0 2px; background: rgba(15, 23, 42, 0.12); }
.louise-row-count { color: #64748b; font-weight: 600; }
/* "New page from template" chooser (Pages panel). */
.louise-tpl-row { margin-top: 10px; }
.louise-tpl-buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
/* Structured sections — in-place text editing on the bespoke render, plus a
   floating control dock for structure (add/reorder/remove, array items, and
   any field with no visible text on the page, like a link URL). */

/* An inline section field on the live design: it reuses the .louise-editable
   affordance; when empty it surfaces its placeholder so an empty node is still
   discoverable and clickable. */
.louise-sfield:empty::before {
  content: attr(data-louise-placeholder);
  color: rgba(15, 23, 42, 0.35);
  pointer-events: none;
}

/* Control dock — bottom-left, clearing the center save bar and right drawer. */
.louise-sections-dock {
  position: fixed;
  bottom: 20px;
  left: 20px;
  z-index: 2147483000;
  width: 300px;
  max-height: 72vh;
  display: flex;
  flex-direction: column;
  padding: 12px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(8px);
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.18);
  font-family: var(--louise-font-body);
  color: #0f172a;
}
.louise-sections-dock[data-collapsed="1"] { width: auto; }
/* Header doubles as the drag handle — grab it to move the dock off whatever it
   covers. touch-action:none so a touch drag moves it instead of scrolling; the
   collapse toggle inside keeps its own pointer cursor + click. */
.louise-sections-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.louise-sections-dock[data-dragging="1"] { user-select: none; }
.louise-sections-dock[data-dragging="1"] .louise-sections-head { cursor: grabbing; }
.louise-sections-toggle {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 12px;
  color: #475569;
  padding: 0 2px;
}
.louise-sections-title { font-weight: 700; font-size: 14px; }
.louise-sections-status { margin-left: auto; font-size: 12px; color: #64748b; }
.louise-sections-status[data-status="error"] { color: #dc2626; }
.louise-sections-status[data-status="saved"] { color: #16a34a; }
.louise-sections-body { overflow-y: auto; }
.louise-section-row {
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 10px;
  padding: 10px;
  margin-bottom: 8px;
  display: grid;
  gap: 8px;
}
.louise-section-row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.louise-section-type { font-weight: 600; font-size: 13px; }
.louise-section-ops { display: flex; gap: 4px; }
.louise-arr { display: grid; gap: 6px; }
.louise-arr-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #475569;
  padding: 4px 6px;
  border: 1px dashed rgba(15, 23, 42, 0.15);
  border-radius: 8px;
}
.louise-arr-ops { display: inline-flex; gap: 4px; align-items: center; }
/* The currently-live version in history — a solid success-green accent so it
   stands out from the other (also "published") rows. */
.louise-arr-row[data-live] {
  border-style: solid;
  border-color: rgba(22, 163, 74, 0.4);
  background: rgba(22, 163, 74, 0.08);
  color: #16a34a;
  font-weight: 600;
}
/* Add section — full-width block above the version history, matching the section
   rows' width. Relative so its palette anchors to it. */
.louise-sections-add { position: relative; margin: 8px 0; }
/* Fallback home for Save-draft / Publish when no edit bar is present to host
   them (normally they live on the .louise-bar via .louise-bar-actions). */
.louise-sections-footer { display: flex; gap: 8px; margin-top: 8px; }
.louise-sections-img {
  display: block;
  max-width: 100%;
  max-height: 84px;
  border-radius: 8px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  background: rgba(15, 23, 42, 0.03);
}
.louise-sections-img-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.louise-sections-img-error { font-size: 11px; color: #dc2626; }
.louise-sections-history { margin: 4px 0 8px; }
.louise-sections-history-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  padding: 2px 0;
}
.louise-sections-versions { display: grid; gap: 6px; margin-top: 6px; }
.louise-sections-palette {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  z-index: 5;
  min-width: 180px;
  padding: 4px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.14);
}
/* Button block — editor chrome (label/link popup). */
.louise-button-block { position: relative; display: inline-block; margin: 8px 0; }
.louise-button-block .pb-button-link {
  display: inline-block;
  padding: 10px 18px;
  border-radius: 10px;
  background: var(--louise-blue);
  color: #fff;
  text-decoration: none;
  font-weight: 600;
}
.louise-button-pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 2147483003;
  display: none;
  flex-direction: column;
  gap: 6px;
  width: 240px;
  padding: 8px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.14);
}
/* Open on selection (is-selected) or while a field inside has focus, so
   clicking into the label/link input keeps the popup open. */
.louise-button-block.is-selected .louise-button-pop,
.louise-button-block:focus-within .louise-button-pop {
  display: flex;
}
/* Slash-menu inserter (#16 phase 2). */
.louise-slash-menu {
  display: block;
  min-width: 180px;
  padding: 4px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.14);
  z-index: 2147483003;
}
.louise-slash-item {
  display: block;
  padding: 7px 10px;
  border-radius: 7px;
  font-size: 13px;
  color: #0f172a;
  cursor: pointer;
}
.louise-slash-item:hover,
.louise-slash-item[data-focused] { background: rgba(20, 129, 239, 0.08); }
.louise-slash-empty { display: block; padding: 7px 10px; font-size: 12px; color: #94a3b8; }
/* "+ Block" inserter button (deterministic path) below the editing surface. */
.louise-block-add { position: relative; padding: 6px 8px 8px; border-top: 1px solid rgba(15, 23, 42, 0.08); }
.louise-block-add-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 8px;
  min-width: 180px;
  max-height: 320px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.14);
  z-index: 2147483003;
}
.louise-block-add-menu .louise-slash-item { width: 100%; text-align: left; border: none; background: none; }
.louise-icon { line-height: 0; }
.louise-icon svg { width: 100%; height: 100%; display: block; }
/* Floating selection toolbar (#15): a pill that ProseKit's InlinePopover
   positions over the current selection, rather than a strip pinned to the top
   of the field. Layout styling lives here on the inner div; the popup custom
   element controls its own show/hide. */
/* Focus-shown formatting toolbar: a floating pill docked just above the caret
   (top/left set inline from coordsAtPos) so it's there while typing, where you
   are typing — not pinned to the top of the page. */
.louise-toolbar-dock {
  position: fixed;
  transform: translateY(calc(-100% - 8px));
  z-index: 2147483004;
}
.louise-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  padding: 4px;
  /* Never wider than the viewport — on a phone the pill wraps to two rows
     instead of running off the edge (its left is set inline from the caret). */
  max-width: calc(100vw - 12px);
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.22);
}
.louise-tb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #334155;
  font-size: 17px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.louise-tb-btn:hover { background: rgba(15, 23, 42, 0.06); }
.louise-tb-btn.is-active { background: rgba(20, 129, 239, 0.12); color: var(--louise-blue); }
.louise-tb-sep { width: 1px; align-self: stretch; margin: 4px 3px; background: rgba(15, 23, 42, 0.12); }
.louise-tb-color { position: relative; display: inline-flex; }
/* Shown/hidden by <Show> (click-toggled state), so it defaults to flex — no
   :hover disclosure, which previously had a dead-zone gap (#14). */
.louise-tb-swatches {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 10;
  display: flex;
  gap: 4px;
  padding: 6px;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 9px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
}
.louise-swatch {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid rgba(15, 23, 42, 0.15);
  border-radius: 6px;
  cursor: pointer;
}
.louise-swatch-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  color: #64748b;
  font-size: 13px;
}
/* Hidden file input backing the toolbar image button. */
.louise-hidden-file {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* ── In-editor images (resizable node view) ───────────────────── */
.louise-rt-image {
  display: block;
  position: relative;
  max-width: 100%;
  margin: 6px 0;
  outline: 1px solid transparent;
}
.louise-rt-image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 8px;
}
.louise-rt-resize {
  position: absolute;
  right: -5px;
  bottom: -5px;
  width: 14px;
  height: 14px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: var(--louise-blue);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.3);
  cursor: nwse-resize;
}

/* ── Block drag handle (gutter) ───────────────────────────────── */
.louise-rt-drag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 24px;
  margin-left: -6px;
  border-radius: 6px;
  color: #94a3b8;
  cursor: grab;
  font-size: 18px;
}
.louise-rt-drag:hover { background: rgba(15, 23, 42, 0.06); color: #475569; }
.louise-rt-drag:active { cursor: grabbing; }
.louise-dropzone {
  display: flex;
  align-items: center;
  gap: 12px;
}
.louise-dropzone img {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.06);
}
.louise-image-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.louise-image-tile {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(15, 23, 42, 0.06);
}
.louise-image-tile.is-cover { box-shadow: 0 0 0 2px var(--louise-blue); }
.louise-image-tile img { width: 100%; height: 100%; object-fit: cover; }
.louise-image-actions {
  position: absolute;
  top: 3px;
  right: 3px;
  display: flex;
  gap: 3px;
}
.louise-image-actions .louise-icon-btn {
  width: 20px;
  height: 20px;
  background: rgba(255, 255, 255, 0.92);
}
.louise-cover-tag {
  position: absolute;
  bottom: 3px;
  left: 3px;
  font-size: 9px;
  font-weight: 700;
  color: #fff;
  background: var(--louise-blue);
  padding: 1px 5px;
  border-radius: 999px;
}
.louise-image-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border: 1px dashed rgba(15, 23, 42, 0.25);
  border-radius: 10px;
  cursor: pointer;
  font-size: 24px;
  color: #94a3b8;
}
.louise-image-add:hover { border-color: var(--louise-blue); color: var(--louise-blue); }
/* Round-crop adjuster: live circular preview + position/zoom sliders. Preview
   uses the same object-position/scale technique as the public render. */
.louise-crop { display: flex; gap: 16px; align-items: flex-start; }
.louise-crop-preview {
  flex: none;
  width: 150px;
  height: 150px;
  border-radius: 50%;
  overflow: hidden;
  background: #f1f5f9;
  border: 1px solid rgba(15, 23, 42, 0.12);
}
.louise-crop-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
.louise-crop-controls { flex: 1; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.louise-crop-row { display: grid; grid-template-columns: 74px 1fr; align-items: center; gap: 8px; font-size: 12px; color: #475569; }
.louise-crop-row input[type="range"] { width: 100%; accent-color: var(--louise-blue); }
.louise-crop-controls .louise-btn { align-self: flex-start; }
.louise-form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 4px;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
  margin-top: 4px;
}

/* ── Responsive: Louise on tablet & mobile ────────────────────────────
   LOUISE.md: the explorer is a side drawer on desktop and a bottom
   sheet on mobile. Chrome only — page/site styles are untouched. */

/* Comfortable touch targets on coarse pointers, any width. */
@media (pointer: coarse) {
  .louise-btn, .louise-tab, .louise-drawer-close, .louise-save, .louise-exit,
  .louise-savedraft, .louise-publish, .louise-settings {
    min-height: 44px;
  }
  .louise-icon-btn { min-width: 36px; min-height: 36px; }
  /* Formatting toolbar, colour swatches, section-row ops, inputs and the
     dock's disclosure toggles were all below a comfortable tap size. */
  .louise-tb-btn { min-width: 40px; min-height: 40px; font-size: 19px; }
  .louise-swatch { width: 32px; height: 32px; }
  .louise-btn-xs { min-height: 36px; padding: 6px 10px; font-size: 13px; }
  .louise-input, .louise-select { min-height: 42px; }
  .louise-sections-toggle, .louise-sections-history-toggle { min-height: 36px; }
}

/* Tablet: keep the side drawer, cap it so the live site stays visible. */
@media (max-width: 1024px) {
  .louise-drawer { width: min(420px, 88vw); }
}

/* Mobile: bottom sheet. */
@media (max-width: 640px) {
  .louise-drawer {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 88dvh;
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -12px 40px rgba(15, 23, 42, 0.25);
    animation: louise-sheet-up 200ms ease;
  }
  @keyframes louise-sheet-up {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }
  /* Grabbable visual cue on the sheet head. */
  .louise-drawer-head::before {
    content: "";
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    width: 36px;
    height: 4px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.15);
  }
  .louise-drawer-head { position: relative; padding-top: 16px; }
  /* Tabs scroll horizontally instead of wrapping. */
  .louise-drawer-tabs {
    overflow-x: auto;
    flex-wrap: nowrap;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .louise-drawer-tabs::-webkit-scrollbar { display: none; }
  .louise-tab { white-space: nowrap; flex: none; }
  /* Two-column form rows collapse. */
  .louise-grid-2 { grid-template-columns: 1fr !important; }
  /* Edit bar: dock it to the TOP on mobile, so the contextual sections sheet
     can own the bottom (thumb zone) without the two floating bars colliding. */
  .louise-bar {
    top: calc(8px + env(safe-area-inset-top));
    bottom: auto;
    left: 12px;
    right: 12px;
    transform: none;
    width: auto;
    max-width: none;
    justify-content: center;
    flex-wrap: wrap;
    row-gap: 4px;
  }
  /* Structured-sections dock → bottom sheet. The default is a fixed 300px card
     at bottom-left that overflows a phone and sits under the edit bar; here it
     spans full width and docks to the bottom. !important overrides the dragged
     inline position (left/top set by the pointer-drag in sections.tsx), which
     is meaningless for a full-width sheet. */
  .louise-sections-dock {
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    top: auto !important;
    width: auto !important;
    max-width: none;
    max-height: 62dvh;
    padding: 10px 12px calc(12px + env(safe-area-inset-bottom));
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -12px 40px rgba(15, 23, 42, 0.22);
    animation: louise-sheet-up 200ms ease;
  }
  .louise-sections-dock[data-collapsed="1"] { width: auto !important; }
  /* Full-width sheet: the header is no longer a drag grip — swap the grab
     cursor for a sheet grab-bar cue (matching the drawer). */
  .louise-sections-head {
    position: relative;
    cursor: default;
    touch-action: auto;
    padding-top: 10px;
  }
  .louise-sections-head::before {
    content: "";
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 36px;
    height: 4px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.15);
  }
  /* Image grid: keep tiles tappable. */
  .louise-image-grid { grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); }
}

/* Touch devices can't hover, so hover-revealed affordances never appear. Keep a
   faint persistent ring on editable regions so they're discoverable, and reveal
   in-editor block controls on focus instead of hover. */
@media (hover: none) {
  .louise-editable { box-shadow: 0 0 0 1px rgba(20, 129, 239, 0.20); }
  .louise-block:focus-within .louise-block-control { display: inline-flex; }
}

/* Motion sensitivity. */
@media (prefers-reduced-motion: reduce) {
  .louise-drawer, .louise-bar, .louise-sections-dock { animation: none !important; }
}

/* ── Headless <Form> (#46) ────────────────────────────────────────────── */
/* Minimal, neutral defaults — a site typically brings its own form styles; the
   class hooks are here so the unstyled helper is still legible out of the box. */
.louise-form { display: grid; gap: 14px; font-family: var(--louise-font-body); }
.louise-form-row { display: grid; gap: 4px; }
.louise-form-label { font-size: 13px; font-weight: 600; color: #334155; }
.louise-form-req { color: #dc2626; }
.louise-form-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid rgba(15, 23, 42, 0.18);
  border-radius: 8px;
  font: inherit;
  background: #fff;
  color: #0f172a;
}
.louise-form-input:focus { outline: 2px solid var(--louise-blue); outline-offset: 0; }
.louise-form-check { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; }
.louise-form-hint { font-size: 12px; color: #64748b; }
.louise-form-error { font-size: 12px; color: #dc2626; }
.louise-form-submit {
  justify-self: start;
  appearance: none;
  border: none;
  cursor: pointer;
  padding: 9px 18px;
  border-radius: 8px;
  font-weight: 600;
  color: #fff;
  background: var(--louise-blue);
}
.louise-form-submit:disabled { opacity: 0.5; cursor: default; }
.louise-form-status { font-size: 14px; }
.louise-form-status[data-status="success"] { color: var(--louise-green); }
.louise-form-status[data-status="error"] { color: #dc2626; }
`;

/** Google Fonts request for the brand type — Roboto Flex (variable). */
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Roboto+Flex:opsz,wght@8..144,100..1000&display=swap";

export function injectStyles(): void {
  if (document.getElementById("louise-styles")) return;
  // Brand fonts, loaded only on Louise surfaces (edit mode) — never on public
  // page loads. preconnect first so the CSS + font files fetch without a chain.
  for (const [rel, href, cross] of [
    ["preconnect", "https://fonts.googleapis.com", false],
    ["preconnect", "https://fonts.gstatic.com", true],
    ["stylesheet", FONTS_HREF, false],
  ] as const) {
    const link = document.createElement("link");
    link.rel = rel;
    link.href = href;
    if (cross) link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }

  const style = document.createElement("style");
  style.id = "louise-styles";
  style.textContent = CSS;
  document.head.appendChild(style);
}
