// Louise inline-editing chrome—styled to feel like a modern inline editor: soft blue
// accent, clean light surface, rounded corners, a small floating action bar.
// Injected once at mount (only ever loaded in edit mode) so nothing ships to
// public page loads.

// The brand font (@font-face for Roboto Flex) is base64-inlined into this CSS—no
// Google Fonts, no runtime fetch—and pulled in with `?raw` so it's baked
// into the bundle exactly like the Phosphor icons (see icons.tsx).
import brandFontsCss from "../theme/fonts.css?raw";
import { icons } from "./icons.js";

const LOUISE_BLUE = "#1481ef";

/** An icon as a CSS image, for a pseudo-element that can't hold markup. An
 *  image can't inherit `currentColor`, so the color is baked in. */
const iconUrl = (svg: string, color: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(svg.replace('fill="currentColor"', `fill="${color}"`))}")`;

/**
 * The chrome's roles in dark mode (#603, ADR 0019 §3). Only roles change; the
 * light palette stays as it is. Dark follows the `louise-dark` theme's rule:
 * the brand fills keep their hue and take dark ink (`--louise-on-accent`) on
 * top, and the deep stops get lighter, not darker, so text on a tint still
 * clears 4.5:1 against the dark surface. test/client/contrast.test.ts checks
 * every pair.
 */
const DARK_ROLES = `
  --louise-surface: #0e141b;
  --louise-surface-muted: #1a2330;
  --louise-text: #e6edf3;
  --louise-text-body: #cbd5e1;
  --louise-text-secondary: #a8b3c1;
  --louise-text-muted: #94a3b8;
  --louise-border: #2d3a4a;
  --louise-border-strong: #5b6b80;
  --louise-shadow: #000000;
  --louise-accent: #1481ef;
  --louise-accent-deep: #5eb0ff;
  --louise-on-accent: #0e141b;
  --louise-ring: #1481ef;
  --louise-success: #8ebe59;
  --louise-warning: #f3ae29;
  --louise-warning-deep: #f3ae29;
  --louise-warning-ink: #231903;
  --louise-danger: #db6327;
  --louise-danger-deep: #f0804a;
  color-scheme: dark;
`;

const CSS = `
:root {
  /* ── Palette: raw values, named for what they are. Rules don't read these;
     they read the roles below, so a palette change moves every rule that
     means the same thing, and a dark set (ADR 0019 §3) only has to redefine
     roles. ── */
  --louise-blue: ${LOUISE_BLUE};
  /* Text stops, one stop darker than their ring—text needs 4.5:1 (WCAG 1.4.3)
     where a ring, border, or focus outline only needs 3:1. The brand blue is
     3.88:1 against white, so it's a ring color; --louise-blue-strong (5.08:1)
     carries text and fills, and --louise-blue-deep (5.89:1 on a 10% tint) is
     blue text on a blue tint. test/client/contrast.test.ts holds the line. */
  --louise-blue-strong: #0f6ecd;
  --louise-blue-deep: #0b5cad;
  --louise-green: #15803d;
  /* The theme's error orange (louise.css), 4.99:1 on white. Orange means
     danger and nothing else in the chrome, so it isn't a ring or a tone
     (#603). The deep stop is text on an orange tint, 5.7:1 on 10%. */
  --louise-orange: #b8501f;
  --louise-orange-deep: #9a4219;
  /* Amber: white on it is 4.92:1; the deep stop is text on its tint. */
  --louise-amber: #a16207;
  --louise-amber-deep: #854d0e;
  --louise-amber-ink: #231903;
  --louise-ink: #0f172a;
  --louise-slate-700: #334155;
  --louise-slate-600: #475569;
  --louise-slate-500: #64748b;
  --louise-slate-300: #cbd5e1;
  --louise-slate-200: #e2e8f0;
  --louise-slate-100: #f1f5f9;
  --louise-white: #ffffff;
  --louise-black: #000000;

  /* ── Roles: what every rule reads (#603). ── */
  --louise-surface: var(--louise-white);
  /* Muted text is for the surface; on the muted surface it's 4.34:1, so text
     there takes --louise-text-secondary or darker. */
  --louise-surface-muted: var(--louise-slate-100);
  --louise-text: var(--louise-ink);
  --louise-text-body: var(--louise-slate-700);
  --louise-text-secondary: var(--louise-slate-600);
  --louise-text-muted: var(--louise-slate-500);
  --louise-border: var(--louise-slate-200);
  --louise-border-strong: var(--louise-slate-300);
  --louise-shadow: var(--louise-black);
  /* The one accent: fills, links, and the primary action. Text on it is
     --louise-on-accent. */
  --louise-accent: var(--louise-blue-strong);
  --louise-accent-deep: var(--louise-blue-deep);
  --louise-on-accent: var(--louise-white);
  /* Focus rings, borders, and outlines: 3:1 is enough, so the brand blue. */
  --louise-ring: var(--louise-blue);
  --louise-success: var(--louise-green);
  --louise-warning: var(--louise-amber);
  --louise-warning-deep: var(--louise-amber-deep);
  --louise-warning-ink: var(--louise-amber-ink);
  --louise-danger: var(--louise-orange);
  --louise-danger-deep: var(--louise-orange-deep);
  /* Every editable node rings in one color, and the toolbar's tag says what the
     node is (ADR 0018 §2, ADR 0019 §4). Tone stays a semantic the tag reads;
     it no longer picks a color. */
  --louise-node-ring: var(--louise-ring);
  --louise-node-bar: var(--louise-accent);

  /* ── Type scale (#603): five text steps in rem, so they follow the browser's
     text size (#598). Glyph boxes (toolbar icons, drag handles, the close
     button) size their icon, not text, and keep their own values. ── */
  --louise-text-2xs: 0.6875rem;
  --louise-text-xs: 0.75rem;
  --louise-text-sm: 0.8125rem;
  --louise-text-md: 0.875rem;
  --louise-text-lg: 1rem;

  /* BowenLabs brand type: Roboto Flex throughout (variable font). Headings are
     the same family, just a heavier weight. The @font-face is bundled (base64)
     via brandFontsCss in injectStyles() — only on Louise surfaces. */
  --louise-font-head: "Roboto Flex", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --louise-font-body: "Roboto Flex", ui-sans-serif, system-ui, -apple-system, sans-serif;
}
/* Dark roles follow the system setting, and a page can pin either scheme with
   data-louise-scheme on the root element (ADR 0019 §3). */
@media (prefers-color-scheme: dark) {
  :root:not([data-louise-scheme="light"]) {${DARK_ROLES}}
}
:root[data-louise-scheme="dark"] {${DARK_ROLES}}

/* Editable region affordance — subtle until hovered/focused, Tina-style. */
.louise-editable {
  position: relative;
  border-radius: 6px;
  transition: box-shadow 120ms ease, background-color 120ms ease;
  /* Transparent, not none: invisible here, and painted in the system color
     under forced colors, which drop the box-shadow ring (#598). */
  outline: 2px solid transparent;
  outline-offset: 2px;
}
.louise-editable:hover {
  box-shadow: 0 0 0 2px color-mix(in oklch, var(--louise-ring) 25%, transparent);
}
.louise-editable:focus-within {
  box-shadow: 0 0 0 2px var(--louise-ring);
  background-color: color-mix(in oklch, var(--louise-ring) 3%, transparent);
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
  font-size: var(--louise-text-xs);
  color: var(--louise-on-accent);
  background: var(--louise-accent);
  border-radius: 999px;
  box-shadow: 0 1px 3px color-mix(in oklch, var(--louise-shadow) 20%, transparent);
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
  outline: 2px solid transparent;
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
  background: color-mix(in oklch, var(--louise-surface) 92%, transparent);
  backdrop-filter: blur(8px);
  border: 1px solid color-mix(in oklch, var(--louise-text) 8%, transparent);
  border-radius: 999px;
  box-shadow: 0 8px 30px color-mix(in oklch, var(--louise-text) 16%, transparent);
  font-family: var(--louise-font-body);
  font-size: var(--louise-text-md);
  color: var(--louise-text);
}
/* Editor identity: a green "live" dot + the signed-in editor's name. Shown in
   the drawer header (it used to sit on the edit bar). Edits save live to D1, so
   green = live is accurate; a draft state would need a publish workflow
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
  background: var(--louise-success);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--louise-success) 18%, transparent);
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
  font-size: var(--louise-text-sm);
  color: var(--louise-text-muted);
}
.louise-status:empty {
  display: none;
}
.louise-status[data-status="error"],
.louise-status[data-status="conflict"],
.louise-status[data-status="locked"] {
  color: var(--louise-danger);
}
/* A draft-save conflict's two ways out (#572), beside the status. */
.louise-conflict {
  display: inline-flex;
  gap: 6px;
}
.louise-conflict[hidden] {
  display: none;
}
.louise-status[data-status="saved"],
.louise-status[data-status="published"] {
  color: var(--louise-success);
}
/* The live Save is the bar's filled action on a page without versions; Settings
   and Sign out are accent text. No icons. */
.louise-save {
  appearance: none;
  border: none;
  cursor: pointer;
  padding: 8px 18px;
  border-radius: 999px;
  font-size: var(--louise-text-md);
  font-weight: 600;
  color: var(--louise-on-accent);
  background: var(--louise-success);
  transition: opacity 120ms ease, transform 80ms ease, background 120ms ease;
}
.louise-save:hover:not(:disabled):not([aria-disabled="true"]) {
  transform: translateY(-1px);
  background: var(--louise-success);
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
  font-size: var(--louise-text-md);
  font-weight: 600;
  text-decoration: none;
  transition: background 120ms ease;
}
/* Settings and Sign out are both accent text, over 4.5:1 on their 8% hover
   tint (4.61:1). At 10% the tint was 4.49:1. Orange means danger only, so Sign
   out no longer takes it (#603). */
.louise-settings { color: var(--louise-accent); }
.louise-settings:hover { background: color-mix(in oklch, var(--louise-ring) 8%, transparent); }
.louise-exit { color: var(--louise-accent); }
.louise-exit:hover { background: color-mix(in oklch, var(--louise-ring) 8%, transparent); }

/* Realtime presence (ADR 0002 / #71): a compact strip of the OTHER editors in the
   session, leading the bar. Empty at rest, so a solo editor sees nothing. */
.louise-presence {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
/* No :empty { display: none }: the strip is a live region, and a hidden one
   leaves the accessibility tree. Empty, it takes no space. */
.louise-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: var(--louise-accent);
  color: var(--louise-on-accent);
  font-size: var(--louise-text-2xs);
  font-weight: 700;
  border: 2px solid var(--louise-surface);
  box-shadow: 0 1px 2px color-mix(in oklch, var(--louise-shadow) 15%, transparent);
}

/* A rich field a peer holds (soft-lock): dimmed + non-interactive + a badge naming
   the holder. Advisory only — the server also drops a non-holder's change. The
   badge is a real text element (#597), so the editable's aria-describedby can
   point at it; generated content never reached a screen reader. It fills with
   the warning amber, since a held field is a caution, not an error: white on it
   is 4.92:1. Only the field's content dims: opacity on the field itself would
   fade the badge too, and take white on it under 3:1. */
.louise-editable.louise-locked {
  position: relative;
  pointer-events: none;
}
.louise-editable.louise-locked > :not(.louise-lock-note) { opacity: 0.6; }
.louise-lock-note {
  position: absolute;
  top: -10px;
  left: 8px;
  z-index: 2;
  padding: 2px 8px 2px 22px;
  border-radius: 999px;
  background: var(--louise-warning) ${iconUrl(icons.lock, "#fff")} no-repeat 8px center / 11px 11px;
  color: var(--louise-on-accent);
  font-size: var(--louise-text-2xs);
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
}

/* The sections editor injects its Save-draft / Publish actions here — a leading
   slot on the shared edit bar. display:contents so the buttons participate
   directly in the bar's flex row, sharing its gap + alignment with Settings/Done
   (one uniform row, not a nested group). */
.louise-bar-actions { display: contents; }
/* Save draft is a text button, like Settings and Sign out. Publish is the one
   action that changes the live site, so it's the one filled button (#597):
   white on the blue text stop, 5.08:1, set apart by fill and weight as well as
   hue. An unavailable action is aria-disabled rather than disabled, so it stays
   in the tab order; it dims but keeps its text readable. */
.louise-savedraft,
.louise-publish {
  appearance: none;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 8px 12px;
  border-radius: 999px;
  font-size: var(--louise-text-md);
  font-weight: 600;
  transition: background 120ms ease;
}
.louise-savedraft { color: var(--louise-success); }
.louise-savedraft:hover:not(:disabled):not([aria-disabled="true"]) { background: color-mix(in oklch, var(--louise-success) 10%, transparent); }
.louise-publish {
  padding: 8px 18px;
  font-weight: 700;
  color: var(--louise-on-accent);
  background: var(--louise-accent);
}
.louise-publish:hover:not(:disabled):not([aria-disabled="true"]) { background: var(--louise-accent-deep); }
.louise-savedraft:disabled,
.louise-publish:disabled,
.louise-savedraft[aria-disabled="true"],
.louise-publish[aria-disabled="true"],
.louise-save[aria-disabled="true"] { opacity: 0.55; cursor: default; }
/* Why Publish is unavailable, beside it and tied to it with aria-describedby. */
.louise-publish-reason {
  font-size: var(--louise-text-xs);
  color: var(--louise-text-muted);
}
.louise-publish-reason[hidden] { display: none; }

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
  font-size: var(--louise-text-md);
  font-weight: 600;
  color: var(--louise-on-accent);
  background: var(--louise-accent);
  text-decoration: none;
  box-shadow: 0 8px 30px color-mix(in oklch, var(--louise-ring) 35%, transparent);
}

/* ── Explorer drawer (slice 2) ─────────────────────────────────────────── */
/* The drawer is opened from the cog on the unified edit bar (#18) — there is
   no longer a separate floating "Manage" toggle. */
.louise-drawer-scrim {
  position: fixed;
  inset: 0;
  z-index: 2147483001;
  background: color-mix(in oklch, var(--louise-text) 28%, transparent);
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
  background: var(--louise-surface);
  box-shadow: -12px 0 40px color-mix(in oklch, var(--louise-text) 20%, transparent);
  font-family: var(--louise-font-body);
  color: var(--louise-text);
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
  border-bottom: 1px solid color-mix(in oklch, var(--louise-text) 8%, transparent);
}
.louise-drawer-brand {
  font-weight: 700;
  font-size: var(--louise-text-lg);
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
  font-size: 1.25rem;
  line-height: 1;
  color: var(--louise-text-muted);
  padding: 4px 8px;
  border-radius: 8px;
}
.louise-drawer-close:hover {
  background: color-mix(in oklch, var(--louise-text) 5%, transparent);
}
/* Cog while the Settings view is open. Blue on a blue tint takes the deep stop
   (5.89:1 on the 10% tint), as the active drawer tab does. */
.louise-drawer-close.is-active {
  color: var(--louise-accent-deep);
  background: color-mix(in oklch, var(--louise-ring) 10%, transparent);
}
.louise-drawer-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid color-mix(in oklch, var(--louise-text) 8%, transparent);
}
.louise-tab {
  border: none;
  background: none;
  cursor: pointer;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: var(--louise-text-md);
  font-weight: 500;
  color: var(--louise-text-secondary);
}
/* The tab's text label on the 10% tint: --louise-blue-strong is 4.49:1 here,
   the deep stop 5.89:1. */
.louise-tab.is-active {
  background: color-mix(in oklch, var(--louise-ring) 10%, transparent);
  color: var(--louise-accent-deep);
}
.louise-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
}

/* The full-page presentation (mountStudio). Same head/tabs/body/footer parts as
   the drawer — only the frame differs: no scrim, no slide-in, no fixed width,
   and it fills the viewport instead of overlaying a page. A wider body gets a
   max-width so panel rows don't stretch to 2560px on a desktop monitor. */
.louise-studio {
  position: relative;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--louise-surface);
  font-family: var(--louise-font-body);
  color: var(--louise-text);
}
.louise-studio-head {
  position: sticky;
  top: 0;
  z-index: 1;
}
.louise-studio-body {
  width: 100%;
  max-width: 1100px;
  margin-inline: auto;
}
/* A page-level studio owns the viewport, so stop the host document scrolling
   behind it — the drawer needs the opposite (the page beneath stays live). */
html[data-louise-studio],
html[data-louise-studio] body {
  height: 100%;
  margin: 0;
}
.louise-muted {
  color: var(--louise-text-muted);
  font-size: var(--louise-text-md);
}
/* Visible failure feedback for drawer actions (create/save/delete/reorder). */
.louise-alert {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: color-mix(in oklch, var(--louise-danger) 8%, transparent);
  border: 1px solid color-mix(in oklch, var(--louise-danger) 30%, transparent);
  color: var(--louise-danger-deep);
  font-size: var(--louise-text-sm);
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
  border: 1px solid color-mix(in oklch, var(--louise-text) 8%, transparent);
  border-radius: 12px;
  background: var(--louise-surface);
}
.louise-list-item.is-dragover {
  border-color: var(--louise-ring);
  box-shadow: 0 0 0 2px color-mix(in oklch, var(--louise-ring) 20%, transparent);
}
.louise-drag-handle {
  display: inline-flex;
  align-items: center;
  cursor: grab;
  color: var(--louise-border-strong);
  font-size: 1.125rem;
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
  background: color-mix(in oklch, var(--louise-text) 6%, transparent);
  flex: none;
}
.louise-item-main { flex: 1; min-width: 0; }
.louise-item-title {
  font-weight: 600;
  font-size: var(--louise-text-md);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.louise-item-sub { font-size: var(--louise-text-xs); color: var(--louise-text-muted); }
.louise-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: var(--louise-text-2xs);
  font-weight: 600;
}
.louise-badge.for_sale { background: color-mix(in oklch, var(--louise-success) 12%, transparent); color: var(--louise-success); }
.louise-badge.sold { background: color-mix(in oklch, var(--louise-danger) 10%, transparent); color: var(--louise-danger); }
.louise-badge.draft { background: color-mix(in oklch, var(--louise-text-muted) 14%, transparent); color: var(--louise-text-secondary); }

.louise-row { display: flex; align-items: center; gap: 8px; }
.louise-reorder { display: flex; flex-direction: column; gap: 2px; }
.louise-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in oklch, var(--louise-text) 12%, transparent);
  background: var(--louise-surface);
  cursor: pointer;
  width: 26px;
  height: 22px;
  border-radius: 6px;
  font-size: var(--louise-text-sm);
  line-height: 1;
  color: var(--louise-text-secondary);
}
.louise-icon-btn:hover:not(:disabled) { background: color-mix(in oklch, var(--louise-text) 5%, transparent); }
.louise-icon-btn:disabled { opacity: 0.35; cursor: default; }

.louise-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid color-mix(in oklch, var(--louise-text) 12%, transparent);
  background: var(--louise-surface);
  cursor: pointer;
  padding: 9px 14px;
  border-radius: 10px;
  font-size: var(--louise-text-md);
  font-weight: 600;
  color: var(--louise-text);
}
.louise-btn:hover { background: color-mix(in oklch, var(--louise-text) 4%, transparent); }
/* White 14px labels need 4.5:1 (WCAG 1.4.3), so the fill is the text stop,
   --louise-blue-strong (5.08:1), the same blue as every other filled control,
   and the hover goes one stop darker again (6.67:1). */
.louise-btn-primary { background: var(--louise-accent); color: var(--louise-on-accent); border-color: transparent; }
.louise-btn-primary:hover { background: var(--louise-accent-deep); }
.louise-btn-danger { color: var(--louise-danger); border-color: color-mix(in oklch, var(--louise-danger) 30%, transparent); }
.louise-btn-block { width: 100%; justify-content: center; }
/* Compact AI-assist button — the SEO "Suggest" affordance (#75/#166). */
.louise-btn-ai { padding: 5px 10px; font-size: var(--louise-text-xs); gap: 4px; }
.louise-btn-ai:disabled { opacity: 0.55; cursor: default; }
.louise-btn-ai:disabled:hover { background: var(--louise-surface); }
/* Header row above the SEO fields: the "Search engine listing" label with the
   Suggest button pushed to the trailing edge. */
.louise-seo-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

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
  border: 1px solid color-mix(in oklch, var(--louise-text) 8%, transparent);
  border-radius: 12px;
  overflow: hidden;
  background: var(--louise-surface);
}
.louise-media-thumb {
  aspect-ratio: 1 / 1;
  background: color-mix(in oklch, var(--louise-text) 6%, transparent);
}
.louise-media-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.louise-media-meta { padding: 8px 10px 4px; min-width: 0; }
.louise-media-meta .louise-item-title { font-size: var(--louise-text-xs); }
.louise-media-actions { display: flex; align-items: center; gap: 6px; padding: 6px 10px 10px; }
.louise-media-actions .louise-btn {
  flex: 1;
  justify-content: center;
  padding: 6px 10px;
  font-size: var(--louise-text-xs);
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
.louise-media-edit .louise-input { width: 100%; font-size: var(--louise-text-xs); }

/* ── Settings panel ───────────────────────────────────────────── */
.louise-settings-group { margin-bottom: 26px; }
/* Accordion sections (#10): native <details> so keyboard/AT behavior is free.
   One section per concern keeps the growing panel scannable. */
.louise-accordion {
  margin-bottom: 10px;
  border: 1px solid color-mix(in oklch, var(--louise-text) 8%, transparent);
  border-radius: 12px;
  background: transparent;
}
.louise-accordion-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  font-size: var(--louise-text-lg);
  font-weight: 600;
  color: var(--louise-text);
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.louise-accordion-summary::-webkit-details-marker { display: none; }
.louise-accordion-caret { color: var(--louise-text-muted); transition: transform 0.15s ease; }
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
  border: 1px solid color-mix(in oklch, var(--louise-text) 10%, transparent);
  border-radius: 8px;
  background: none;
  cursor: pointer;
  overflow: hidden;
  aspect-ratio: 1;
}
.louise-media-pick:hover { border-color: var(--louise-ring); }
.louise-media-pick img { width: 100%; height: 100%; object-fit: cover; display: block; }
.louise-ui-strings { display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow-y: auto; }
/* Sign-out lives at the foot of Settings (it replaced the drawer-head button). */
.louise-settings-session {
  margin-bottom: 0;
  padding-top: 18px;
  border-top: 1px solid color-mix(in oklch, var(--louise-text) 8%, transparent);
}
.louise-settings-title { margin: 0 0 2px; font-size: var(--louise-text-lg); font-weight: 600; color: var(--louise-text); }
.louise-settings-hint { margin: 0 0 12px; font-size: var(--louise-text-xs); }
.louise-settings-row { align-items: center; gap: 8px; }
.louise-settings-fields { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
.louise-settings-fields .louise-input { width: 100%; }

.louise-form { display: flex; flex-direction: column; gap: 14px; }
.louise-field { display: flex; flex-direction: column; gap: 5px; }
/* A toggle field reads as "[x] Open in new tab", not a stacked label over a lone
   checkbox — so this one flips to a row. (No backticks in this file: the CSS
   lives in a template literal and one would terminate it.) */
.louise-field-inline { flex-direction: row; align-items: center; gap: 8px; }
.louise-field-inline input { margin: 0; }
.louise-field label,
.louise-field-label { font-size: var(--louise-text-xs); font-weight: 600; color: var(--louise-text-secondary); }
.louise-check { display: flex; align-items: center; gap: 9px; cursor: pointer; font-size: var(--louise-text-sm); color: var(--louise-text-body); }
.louise-check input { width: 16px; height: 16px; accent-color: var(--louise-ring); cursor: pointer; }
.louise-input,
.louise-select {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid color-mix(in oklch, var(--louise-text) 14%, transparent);
  border-radius: 10px;
  font-size: var(--louise-text-md);
  color: var(--louise-text);
  background: var(--louise-surface);
}
.louise-input:focus,
.louise-select:focus {
  outline: 2px solid transparent;
  outline-offset: 2px;
  border-color: var(--louise-ring);
  /* With the border, a 2 px ring at 3.88:1 against white (#598); the old
     12 percent tint read as a 1 px border change. */
  box-shadow: 0 0 0 1px var(--louise-ring);
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
  border: 1px solid color-mix(in oklch, var(--louise-text) 14%, transparent);
  border-radius: 10px;
  /* No fill — the editor look is just the border around the item being
     edited, so the surface reads as the page/panel behind it. */
  background: transparent;
}
.louise-rt:focus-within { border-color: var(--louise-ring); box-shadow: 0 0 0 1px var(--louise-ring); }
.louise-rt .ProseMirror:focus { outline: 2px solid transparent; }
.louise-prose-surface { min-height: 90px; padding: 9px 11px; font-size: var(--louise-text-md); }
/* ── Builder blocks (#16): editing chrome ─────────────────────────
   Matches the editor look — no background fill, a border-only outline on
   the hovered/selected block. Controls are editor-only affordances. */
.louise-block { position: relative; border: 1px solid transparent; border-radius: 6px; }
.louise-block:hover { border-color: color-mix(in oklch, var(--louise-text) 14%, transparent); }
.louise-block.is-selected,
.louise-rt .ProseMirror-selectednode .louise-block,
.louise-rt .louise-block.ProseMirror-selectednode {
  border-color: var(--louise-ring);
  background: transparent;
}
.louise-block-control {
  position: absolute;
  top: 4px;
  right: 4px;
  display: none;
  padding: 2px 8px;
  border: 1px solid color-mix(in oklch, var(--louise-text) 12%, transparent);
  border-radius: 999px;
  background: var(--louise-surface);
  font-size: var(--louise-text-2xs);
  color: var(--louise-text-secondary);
  cursor: pointer;
}
.louise-block:hover .louise-block-control,
.louise-block.is-selected .louise-block-control { display: inline-flex; }
/* Editor-side rendering of serialized block elements. */
.louise-rt .pb-hr { border: 0; border-top: 1px solid color-mix(in oklch, var(--louise-text) 18%, transparent); margin: 18px 0; }
.louise-rt .pb-hr[data-size="lg"] { margin: 38px 0; }
/* Container blocks: CSS-only chrome (no node view) — dashed border + a small
   name tag on hover, border-only per the editor look. */
.louise-rt [data-block] { position: relative; border: 1px dashed transparent; border-radius: 6px; padding: 8px; margin: 10px 0; }
.louise-rt [data-block]:hover { border-color: color-mix(in oklch, var(--louise-text) 22%, transparent); }
.louise-rt [data-block]:hover::before {
  content: attr(data-block);
  position: absolute;
  top: -9px;
  left: 8px;
  padding: 0 6px;
  background: var(--louise-surface);
  font-family: var(--louise-font-body);
  font-size: var(--louise-text-2xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--louise-text-muted);
}
.louise-rt .pb-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.louise-rt .pb-col {
  min-width: 0;
  outline: 1px dashed color-mix(in oklch, var(--louise-node-ring) 30%, transparent);
  outline-offset: 2px;
  border-radius: 4px;
  padding: 6px;
}
/* Editing outlines in the node ring color, so block and component boundaries
   are clear while editing. View mode (public page) is untouched. */
.louise-rt .pb-hero,
.louise-rt .pb-bleed,
.louise-rt .pb-quote,
.louise-rt .pb-cta,
.louise-rt .louise-row,
.louise-rt .louise-block {
  outline: 1px dashed color-mix(in oklch, var(--louise-node-ring) 40%, transparent);
  outline-offset: 3px;
  border-radius: 3px;
}
.louise-rt .pb-hero:hover,
.louise-rt .pb-bleed:hover,
.louise-rt .pb-quote:hover,
.louise-rt .pb-cta:hover,
.louise-rt .louise-row:hover,
.louise-rt .louise-block:hover {
  outline-color: color-mix(in oklch, var(--louise-node-ring) 85%, transparent);
}
.louise-rt .pb-hero h1, .louise-rt .pb-hero h2 { font-size: 1.5em; margin: 0 0 6px; }
.louise-rt .pb-quote { border-top: 1px solid color-mix(in oklch, var(--louise-text) 14%, transparent); border-bottom: 1px solid color-mix(in oklch, var(--louise-text) 14%, transparent); padding: 10px 4px; font-style: italic; }
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
.louise-rt .ProseMirror-selectednode.louise-row { border-color: color-mix(in oklch, var(--louise-ring) 50%, transparent); }
.louise-row-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  padding: 5px 6px;
  border-radius: 7px;
  background: color-mix(in oklch, var(--louise-text) 4%, transparent);
  font-size: var(--louise-text-2xs);
}
.louise-row:not(:hover):not(.is-selected) .louise-row-bar { opacity: 0.55; }
.louise-row-presets,
.louise-row-ops { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.louise-row-presets { margin-right: auto; }
.louise-chip {
  padding: 2px 7px;
  border: 1px solid color-mix(in oklch, var(--louise-text) 14%, transparent);
  border-radius: 999px;
  background: var(--louise-surface);
  font-size: var(--louise-text-2xs);
  font-family: var(--louise-font-body);
  color: var(--louise-text-secondary);
  cursor: pointer;
}
.louise-chip:hover { background: color-mix(in oklch, var(--louise-ring) 8%, transparent); }
.louise-chip.is-active { background: var(--louise-accent); border-color: transparent; color: var(--louise-on-accent); }
.louise-col-adj { display: inline-flex; align-items: center; gap: 2px; }
.louise-col-w {
  min-width: 12px;
  text-align: center;
  color: var(--louise-text);
  font-variant-numeric: tabular-nums;
}
.louise-btn-xs { padding: 1px 6px; font-size: var(--louise-text-2xs); line-height: 1.4; }
.louise-row-sep { width: 1px; align-self: stretch; margin: 0 2px; background: color-mix(in oklch, var(--louise-text) 12%, transparent); }
.louise-row-count { color: var(--louise-text-muted); font-weight: 600; }

/* ── Inspector popover (#182 Phase 4) — contextual layout + settings ──────── */
.louise-inspector-scrim { position: fixed; inset: 0; z-index: 2147483300; }
.louise-inspector {
  position: fixed;
  z-index: 2147483301;
  width: 264px;
  max-height: 70vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 14px;
  background: var(--louise-surface);
  border: 1px solid color-mix(in oklch, var(--louise-text) 10%, transparent);
  border-radius: 12px;
  box-shadow: 0 12px 34px color-mix(in oklch, var(--louise-text) 22%, transparent);
  font-family: var(--louise-font-body);
  font-size: var(--louise-text-sm);
  color: var(--louise-text);
}
.louise-inspector-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.louise-inspector-title { font-weight: 700; font-size: var(--louise-text-sm); letter-spacing: -0.01em; }
.louise-inspector-close {
  appearance: none;
  border: none;
  background: transparent;
  cursor: pointer;
  /* The glyph is an inline Phosphor SVG sized to 1em, so font-size is what
     scales it — and the flex centring is what keeps it off the text baseline,
     the same shape .louise-drawer-close uses. */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--louise-text-md);
  line-height: 1;
  color: var(--louise-text-muted);
  padding: 2px 6px;
  border-radius: 6px;
}
.louise-inspector-close:hover { background: color-mix(in oklch, var(--louise-text) 6%, transparent); }
.louise-inspector-group { display: flex; flex-direction: column; gap: 8px; }
.louise-inspector-layouts { display: flex; flex-wrap: wrap; gap: 6px; }
.louise-inspector-active { background: var(--louise-accent); color: var(--louise-on-accent); border-color: transparent; }
.louise-inspector-empty { margin: 0; color: var(--louise-text-muted); font-size: var(--louise-text-xs); }
/* Source-settings group (Phase B): the caption carries the write-path warning —
   these values save immediately, unlike everything else in the popover. */
.louise-inspector-note { margin: 2px 0 6px; color: var(--louise-text-muted); font-size: var(--louise-text-2xs); }
/* The green panel's persistent warning band (#376) — tinted with the shared
   tone so the panel reads as the ring that opened it. Not a confirm(): the
   count is readable the whole time the panel is open. */
.louise-shared-band {
  margin: 0 0 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: color-mix(in oklch, var(--louise-success) 12%, transparent);
  border: 1px solid color-mix(in oklch, var(--louise-success) 35%, transparent);
  color: var(--louise-shared, var(--louise-success));
  font-size: var(--louise-text-2xs);
  line-height: 1.4;
}
.louise-multiselect { display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow-y: auto; }
.louise-multiselect .louise-field-inline { display: flex; align-items: center; gap: 6px; font-size: var(--louise-text-xs); }
/* "New page from template" chooser (Pages panel). */
.louise-tpl-row { margin-top: 10px; }
.louise-tpl-buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
/* Louise Sections — in-place text editing on the bespoke render, plus a
   floating control dock for structure (add/reorder/remove, array items, and
   any field with no visible text on the page, like a link URL). */

/* An inline section field on the live design: it reuses the .louise-editable
   affordance; when empty it surfaces its placeholder so an empty node is still
   discoverable and clickable. */
.louise-sfield:empty::before {
  content: attr(data-louise-placeholder);
  /* 0.6 alpha ≈ 4.7:1 on white — this hint doubles as the only cue that an empty
     field is there to click, so it has to clear AA like body text (WCAG 1.4.3). */
  color: color-mix(in oklch, var(--louise-text) 60%, transparent);
  pointer-events: none;
}

/* The floating "Page sections" dock is gone (#182). Its jobs relocated: Save /
   Publish / status / History onto the shared edit bar, per-section editing onto
   the ⚙ inspector, reorder/delete onto the on-canvas toolbar, Add-section to an
   on-canvas floating control, and version history to the right-side drawer. */

/* History button on the edit bar — opens the version-history drawer. */
.louise-bar-history {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid color-mix(in oklch, var(--louise-text) 14%, transparent);
  border-radius: 8px;
  background: color-mix(in oklch, var(--louise-surface) 80%, transparent);
  cursor: pointer;
  font: inherit;
  font-size: var(--louise-text-sm);
  font-weight: 600;
  color: var(--louise-text-body);
  padding: 4px 10px;
}
.louise-bar-history:hover {
  background: var(--louise-surface);
  border-color: color-mix(in oklch, var(--louise-text) 24%, transparent);
}
/* Fixed fallback strip hosting the bar controls when the page has no .louise-bar
   to inject into (e.g. a standalone harness / test host). */
.louise-sections-barfallback {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483000;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid color-mix(in oklch, var(--louise-text) 10%, transparent);
  border-radius: 12px;
  background: color-mix(in oklch, var(--louise-surface) 96%, transparent);
  backdrop-filter: blur(8px);
  box-shadow: 0 12px 40px color-mix(in oklch, var(--louise-text) 18%, transparent);
  font-family: var(--louise-font-body);
  color: var(--louise-text);
}
/* Only shown on a failed save (auto-save makes the routine saved/unsaved status
   redundant); the danger color, so it reads as an error the editor must notice. */
.louise-sections-status { font-size: var(--louise-text-xs); font-weight: 600; }
.louise-sections-status[data-status="error"] { color: var(--louise-danger); }
.louise-arr { display: grid; gap: 6px; }
.louise-arr-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--louise-text-xs);
  color: var(--louise-text-secondary);
  padding: 4px 6px;
  border: 1px dashed color-mix(in oklch, var(--louise-text) 15%, transparent);
  border-radius: 8px;
}
.louise-arr-ops { display: inline-flex; gap: 4px; align-items: center; }
/* Discriminated array (#182 Phase 0): a per-variant "add" row + the per-item
   variant switcher select. */
.louise-variant-add { display: flex; flex-wrap: wrap; gap: 4px; }
.louise-variant-switch {
  font-size: var(--louise-text-xs);
  padding: 2px 4px;
  border: 1px solid color-mix(in oklch, var(--louise-text) 20%, transparent);
  border-radius: 6px;
  background: var(--louise-surface);
  color: var(--louise-text);
}
/* The currently-live version in history — a solid success-green accent so it
   stands out from the other (also "published") rows. */
.louise-arr-row[data-live] {
  border-style: solid;
  border-color: color-mix(in oklch, var(--louise-success) 40%, transparent);
  background: color-mix(in oklch, var(--louise-success) 8%, transparent);
  color: var(--louise-success);
  font-weight: 600;
}
/* Add section (#182): relative so its palette anchors to it. The --floating
   modifier lifts it onto the canvas (bottom-left, clearing the centre edit bar)
   now that the dock that used to host it is gone. */
.louise-sections-add { position: relative; margin: 8px 0; }
.louise-sections-add--floating {
  position: fixed;
  bottom: 20px;
  left: 20px;
  z-index: 2147483000;
  width: 190px;
  margin: 0;
  font-family: var(--louise-font-body);
  color: var(--louise-text);
}
.louise-sections-img {
  display: block;
  max-width: 100%;
  max-height: 84px;
  border-radius: 8px;
  border: 1px solid color-mix(in oklch, var(--louise-text) 10%, transparent);
  background: color-mix(in oklch, var(--louise-text) 3%, transparent);
}
.louise-sections-img-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.louise-sections-img-error { font-size: var(--louise-text-2xs); color: var(--louise-danger); }
/* A picker whose choices come from an API and didn't arrive (#344). Same color as
   the image error above — it is the same kind of message: the thing you asked
   for isn't here, and here is why. */
.louise-field-error { font-size: var(--louise-text-2xs); color: var(--louise-danger); }
/* The visible labels on a link row's two inputs (#592), quieter than a field's. */
.louise-field .louise-row-label { font-size: var(--louise-text-2xs); }
/* A fieldset that groups inputs without drawing a box. */
.louise-fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
/* Version history drawer (#182) — a dedicated right-side drawer opened from the
   bar's History button, reusing the Louise drawer visual family (.louise-drawer).
   The versions list is the same rows the old dock showed, in the drawer body. */
.louise-history-drawer .louise-sections-versions { display: grid; gap: 6px; }
.louise-sections-versions { display: grid; gap: 6px; margin-top: 6px; }
.louise-sections-palette {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  z-index: 5;
  min-width: 180px;
  padding: 4px;
  border: 1px solid color-mix(in oklch, var(--louise-text) 12%, transparent);
  border-radius: 10px;
  background: var(--louise-surface);
  box-shadow: 0 10px 30px color-mix(in oklch, var(--louise-text) 14%, transparent);
}
/* Button block — editor chrome (label/link popup). */
.louise-button-block { position: relative; display: inline-block; margin: 8px 0; }
.louise-button-block .pb-button-link {
  display: inline-block;
  padding: 10px 18px;
  border-radius: 10px;
  background: var(--louise-accent);
  color: var(--louise-on-accent);
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
  border: 1px solid color-mix(in oklch, var(--louise-text) 12%, transparent);
  border-radius: 10px;
  background: var(--louise-surface);
  box-shadow: 0 10px 30px color-mix(in oklch, var(--louise-text) 14%, transparent);
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
  border: 1px solid color-mix(in oklch, var(--louise-text) 12%, transparent);
  border-radius: 10px;
  background: var(--louise-surface);
  box-shadow: 0 10px 30px color-mix(in oklch, var(--louise-text) 14%, transparent);
  z-index: 2147483003;
}
.louise-slash-item {
  display: block;
  padding: 7px 10px;
  border-radius: 7px;
  font-size: var(--louise-text-sm);
  color: var(--louise-text);
  cursor: pointer;
}
.louise-slash-item:hover,
.louise-slash-item[data-focused] { background: color-mix(in oklch, var(--louise-ring) 8%, transparent); }
.louise-slash-empty { display: block; padding: 7px 10px; font-size: var(--louise-text-xs); color: var(--louise-text-muted); }
/* "+ Block" inserter button (deterministic path) below the editing surface. */
.louise-block-add { position: relative; padding: 6px 8px 8px; border-top: 1px solid color-mix(in oklch, var(--louise-text) 8%, transparent); }
.louise-block-add-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 8px;
  min-width: 180px;
  max-height: 320px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid color-mix(in oklch, var(--louise-text) 12%, transparent);
  border-radius: 10px;
  background: var(--louise-surface);
  box-shadow: 0 10px 30px color-mix(in oklch, var(--louise-text) 14%, transparent);
  z-index: 2147483003;
}
.louise-block-add-menu .louise-slash-item { width: 100%; text-align: left; border: none; background: none; }
.louise-icon { line-height: 0; }
.louise-icon svg { width: 100%; height: 100%; display: block; }
/* Format bubble (#182 Phase 5): ProseKit's InlinePopover positions this pill over
   the current text selection and controls its own show/hide; we only set the
   stacking context here -- the inner pill look lives on the .louise-toolbar
   class. (No backticks in this comment: the whole block is a JS template string.) */
.louise-format-bubble {
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
  border: 1px solid color-mix(in oklch, var(--louise-text) 12%, transparent);
  border-radius: 10px;
  background: var(--louise-surface);
  box-shadow: 0 10px 30px color-mix(in oklch, var(--louise-text) 22%, transparent);
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
  color: var(--louise-text-body);
  font-size: 1.0625rem;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.louise-tb-btn:hover { background: color-mix(in oklch, var(--louise-text) 6%, transparent); }
/* The icon buttons need 3:1 today; the deep stop clears 4.5:1 on the 12% tint
   (5.76:1), so a text label added later passes too. The tint stays at 12%, so
   the active state keeps its blue fill, apart from the gray hover. */
.louise-tb-btn.is-active { background: color-mix(in oklch, var(--louise-ring) 12%, transparent); color: var(--louise-accent-deep); }
.louise-tb-sep { width: 1px; align-self: stretch; margin: 4px 3px; background: color-mix(in oklch, var(--louise-text) 12%, transparent); }
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
  border: 1px solid color-mix(in oklch, var(--louise-text) 14%, transparent);
  border-radius: 9px;
  background: var(--louise-surface);
  box-shadow: 0 8px 24px color-mix(in oklch, var(--louise-text) 16%, transparent);
}
.louise-swatch {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid color-mix(in oklch, var(--louise-text) 15%, transparent);
  border-radius: 6px;
  cursor: pointer;
}
.louise-swatch-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--louise-surface);
  color: var(--louise-text-muted);
  font-size: var(--louise-text-sm);
}
/* AI rewrite menu (#75/#166) — same click-toggled popover as the color swatches,
   as a vertical list of rewrite modes. Anchored right so it stays on-screen at
   the toolbar's trailing edge. */
.louise-tb-btn:disabled { opacity: 0.4; cursor: default; }
.louise-tb-btn:disabled:hover { background: transparent; }
.louise-tb-ai { position: relative; display: inline-flex; }
.louise-tb-ai-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  min-width: 132px;
  padding: 5px;
  border: 1px solid color-mix(in oklch, var(--louise-text) 14%, transparent);
  border-radius: 9px;
  background: var(--louise-surface);
  box-shadow: 0 8px 24px color-mix(in oklch, var(--louise-text) 16%, transparent);
}
.louise-tb-ai-item {
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--louise-text-body);
  font: inherit;
  font-size: var(--louise-text-sm);
  text-align: left;
  cursor: pointer;
}
.louise-tb-ai-item:hover { background: color-mix(in oklch, var(--louise-text) 6%, transparent); }
.louise-tb-ai-busy {
  padding: 6px 10px;
  color: var(--louise-text-muted);
  font-size: var(--louise-text-sm);
  white-space: nowrap;
}
/* A failed rewrite's reason, such as a selection past the length cap. Fixed
   width so a long message wraps instead of widening the menu off-screen. */
.louise-tb-ai-error {
  width: 220px;
  margin: 0 0 4px;
  padding: 6px 10px;
  color: var(--louise-danger);
  font-size: var(--louise-text-xs);
  line-height: 1.4;
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
/* Alt-text control on an inline image (WCAG 1.1.1). Sits bottom-left so it never
   collides with the bottom-right resize handle. "Alt?" (amber) flags a missing
   description; "Alt" (neutral) means one is set. */
.louise-rt-alt {
  position: absolute;
  left: 6px;
  bottom: 6px;
  display: flex;
}
.louise-rt-alt-btn {
  appearance: none;
  border: none;
  cursor: pointer;
  padding: 2px 7px;
  border-radius: 6px;
  font-size: var(--louise-text-2xs);
  font-weight: 600;
  line-height: 1.6;
  color: var(--louise-on-accent);
  background: color-mix(in oklch, var(--louise-text) 75%, transparent);
}
.louise-rt-alt-btn.is-unset { background: var(--louise-warning); }
.louise-rt-alt-btn:hover { background: color-mix(in oklch, var(--louise-text) 90%, transparent); }
.louise-rt-alt-btn.is-unset:hover { background: var(--louise-warning-deep); }
.louise-rt-alt-btn:focus-visible { outline: 2px solid var(--louise-on-accent); outline-offset: 2px; }
/* Icon-only controls rely on the UA's default ring, which is easy to lose against
   the toolbar/drawer fills. Give them a deliberate, high-contrast one (WCAG 2.4.7
   / 2.4.11). Inputs and editables already pair outline:none with a box-shadow
   ring — these are the ones that had nothing explicit. */
.louise-tb-btn:focus-visible,
.louise-chip:focus-visible,
.louise-drawer-close:focus-visible,
.louise-icon-btn:focus-visible,
.louise-media-upload:focus-within {
  outline: 2px solid var(--louise-ring);
  outline-offset: 2px;
}
/* Forced colors (a Windows contrast theme) drop box shadows and backgrounds, so
   every state the chrome draws with one needs an outline or a border here
   (#598). System colors, so the owner's theme picks them. */
@media (forced-colors: active) {
  .louise-editable:focus-within,
  .louise-input:focus,
  .louise-select:focus,
  .louise-rt:focus-within {
    outline: 2px solid Highlight;
    outline-offset: 2px;
  }
  .louise-chip.is-active,
  .louise-tab.is-active,
  .louise-tb-btn.is-active,
  .louise-drawer-close.is-active {
    outline: 2px solid Highlight;
    outline-offset: -2px;
  }
}
.louise-rt-alt-input {
  width: min(320px, 60vw);
  padding: 3px 8px;
  border: 1px solid var(--louise-ring);
  border-radius: 6px;
  font-size: var(--louise-text-xs);
  background: var(--louise-surface);
  color: var(--louise-text);
}
.louise-rt-resize {
  position: absolute;
  right: -5px;
  bottom: -5px;
  width: 14px;
  height: 14px;
  border: 2px solid var(--louise-surface);
  border-radius: 50%;
  background: var(--louise-ring);
  box-shadow: 0 1px 3px color-mix(in oklch, var(--louise-text) 30%, transparent);
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
  color: var(--louise-text-muted);
  cursor: grab;
  font-size: 1.125rem;
}
.louise-rt-drag:hover { background: color-mix(in oklch, var(--louise-text) 6%, transparent); color: var(--louise-text-secondary); }
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
  background: color-mix(in oklch, var(--louise-text) 6%, transparent);
}
.louise-image-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.louise-image-tile {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 10px;
  overflow: hidden;
  background: color-mix(in oklch, var(--louise-text) 6%, transparent);
}
.louise-image-tile.is-cover { box-shadow: 0 0 0 2px var(--louise-ring); }
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
  background: color-mix(in oklch, var(--louise-surface) 92%, transparent);
}
.louise-cover-tag {
  position: absolute;
  bottom: 3px;
  left: 3px;
  font-size: var(--louise-text-2xs);
  font-weight: 700;
  color: var(--louise-on-accent);
  background: var(--louise-accent);
  padding: 1px 5px;
  border-radius: 999px;
}
.louise-image-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border: 1px dashed color-mix(in oklch, var(--louise-text) 25%, transparent);
  border-radius: 10px;
  cursor: pointer;
  font-size: 1.5rem;
  color: var(--louise-text-muted);
}
.louise-image-add:hover { border-color: var(--louise-ring); color: var(--louise-accent); }
/* Round-crop adjuster: live circular preview + position/zoom sliders. Preview
   uses the same object-position/scale technique as the public render. */
.louise-crop { display: flex; gap: 16px; align-items: flex-start; }
.louise-crop-preview {
  flex: none;
  width: 150px;
  height: 150px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--louise-surface-muted);
  border: 1px solid color-mix(in oklch, var(--louise-text) 12%, transparent);
}
.louise-crop-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
.louise-crop-controls { flex: 1; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.louise-crop-row { display: grid; grid-template-columns: 74px 1fr; align-items: center; gap: 8px; font-size: var(--louise-text-xs); color: var(--louise-text-secondary); }
.louise-crop-row input[type="range"] { width: 100%; accent-color: var(--louise-ring); }
.louise-crop-controls .louise-btn { align-self: flex-start; }
.louise-form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 4px;
  border-top: 1px solid color-mix(in oklch, var(--louise-text) 8%, transparent);
  margin-top: 4px;
}

/* ── Drawer action footer (#109) ──────────────────────────────────────
   Shell-owned, always-visible home for the active panel/editor's actions +
   "did it save?" status. Pinned below the scrolling body (both are flex
   children of the drawer column); collapses when the active view has none. */
.louise-drawer-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid color-mix(in oklch, var(--louise-text) 10%, transparent);
  background: var(--louise-surface);
}
/* Status on the left, actions pinned right (works with or without a status). */
.louise-foot-actions { display: flex; gap: 8px; margin-left: auto; }
.louise-foot-status { font-size: var(--louise-text-sm); color: var(--louise-text-muted); }
.louise-foot-status[data-state="saved"] { color: var(--louise-success); }
.louise-foot-status[data-state="error"] { color: var(--louise-danger); }

/* ── Owner Home dashboard (#108) ──────────────────────────────────────
   Attention-first landing: a traffic-light summary over a grid of cards. */
.louise-dashboard { display: flex; flex-direction: column; gap: 16px; }
.louise-dashboard-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 12px;
  background: color-mix(in oklch, var(--louise-success) 8%, transparent);
  border: 1px solid color-mix(in oklch, var(--louise-success) 20%, transparent);
}
.louise-dashboard-summary[data-state="attention"] {
  background: color-mix(in oklch, var(--louise-warning) 10%, transparent);
  border-color: color-mix(in oklch, var(--louise-warning) 28%, transparent);
}
.louise-dashboard-summary-text {
  font-family: var(--louise-font-head);
  font-weight: 700;
  font-size: var(--louise-text-lg);
  /* It's an <h2> for heading order — neutralize the UA margin so it still reads
     as the inline summary line it looks like. */
  margin: 0;
  line-height: inherit;
}
/* A card's at-a-glance status dot (also used inline in the summary). */
.louise-card-dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--louise-border-strong);
}
.louise-card-dot[data-state="ok"] { background: var(--louise-success); }
.louise-card-dot[data-state="attention"] { background: var(--louise-warning); }

.louise-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

/* Core Web Vitals badge (#106) — plain "Fast / Slow" pill + the three metrics. */
.louise-cwv-badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: var(--louise-text-sm);
  font-weight: 600;
  color: var(--louise-on-accent);
  background: var(--louise-text-muted);
}
.louise-cwv-badge[data-rating="good"] { background: var(--louise-success); }
/* The three ratings are success, warning, and danger, each with white text over
   4.5:1 (5.02:1, 4.92:1, 4.99:1); the badge's word says which, too. */
.louise-cwv-badge[data-rating="needs-improvement"] { background: var(--louise-warning); }
.louise-cwv-badge[data-rating="poor"] { background: var(--louise-danger); }
/* A last check older than the threshold (#559). The text says "Out of date" too,
   so the amber isn't the only signal. Dark amber text keeps AA contrast. */
.louise-health-stale {
  padding: 8px 10px;
  border-radius: 8px;
  background: color-mix(in oklch, var(--louise-warning) 10%, transparent);
  border: 1px solid color-mix(in oklch, var(--louise-warning) 40%, transparent);
  color: var(--louise-warning-deep);
  font-size: var(--louise-text-sm);
  line-height: 1.45;
}
.louise-cwv-metrics { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 8px; font-size: var(--louise-text-sm); }
.louise-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border: 1px solid color-mix(in oklch, var(--louise-text) 8%, transparent);
  border-radius: 12px;
  background: var(--louise-surface);
}
/* Loading, empty, and error states (#468). */
.louise-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
.louise-skeleton { display: grid; gap: 8px; }
.louise-skeleton[data-shape="grid"] { grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); }
.louise-skeleton-item {
  display: block;
  height: 44px;
  border-radius: 8px;
  background: color-mix(in oklch, var(--louise-text) 7%, transparent);
  animation: louise-skeleton-pulse 1.4s ease-in-out infinite;
}
.louise-skeleton[data-shape="grid"] .louise-skeleton-item { height: 72px; }
.louise-skeleton[data-shape="panel"] .louise-skeleton-item { height: 12px; border-radius: 4px; }
.louise-skeleton[data-shape="panel"] .louise-skeleton-item:last-child { width: 60%; }
@keyframes louise-skeleton-pulse {
  50% { opacity: 0.45; }
}
@media (prefers-reduced-motion: reduce) {
  .louise-skeleton-item { animation: none; }
}
.louise-empty,
.louise-error-state {
  display: grid;
  justify-items: start;
  gap: 8px;
  padding: 8px 0;
}
.louise-empty p,
.louise-error-text { margin: 0; }
/* No :empty { display: none } here: a hidden region leaves the accessibility
   tree, so filling it would read as an insertion, which isn't announced. */
.louise-error-text { color: var(--louise-danger); font-weight: 600; }
/* Numbers that sit in columns or change in place take aligned digits, so a
   reading doesn't shift as it updates (#603): the vitals, the dashboard's
   counts, and the media panel's file sizes. */
.louise-cwv-metrics,
.louise-card-body,
.louise-dashboard-summary-text,
.louise-media-meta .louise-item-sub {
  font-variant-numeric: tabular-nums;
}
.louise-card-head { display: flex; align-items: center; gap: 8px; }
.louise-card-title { font-size: var(--louise-text-md); margin: 0; }
.louise-card-body { font-size: var(--louise-text-md); color: var(--louise-text-body); line-height: 1.45; }
/* One verb per card; sits at the bottom-left, self-sized. */
.louise-card-action { align-self: flex-start; margin-top: auto; }

/* ── Responsive: Louise on tablet & mobile ────────────────────────────
   LOUISE.md: the explorer is a side drawer on desktop and a bottom
   sheet on mobile. Chrome only — page/site styles are untouched. */

/* Comfortable touch targets on coarse pointers, any width. */
@media (pointer: coarse) {
  .louise-btn, .louise-tab, .louise-drawer-close, .louise-save, .louise-exit,
  .louise-savedraft, .louise-publish, .louise-settings {
    min-height: 44px;
  }
  /* Every control a finger taps is at least 44 px each way (WCAG 2.5.5, #543).
     36 px was too small where delete sits beside move: a miss there is a
     destructive miss. */
  .louise-icon-btn { min-width: 44px; min-height: 44px; }
  .louise-tb-btn { min-width: 44px; min-height: 44px; font-size: 1.1875rem; }
  .louise-swatch { width: 32px; height: 32px; }
  .louise-btn-xs { min-height: 44px; padding: 6px 10px; font-size: var(--louise-text-sm); }
  .louise-input, .louise-select { min-height: 44px; }
  .louise-bar-history { min-height: 44px; }
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
    box-shadow: 0 -12px 40px color-mix(in oklch, var(--louise-text) 25%, transparent);
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
    background: color-mix(in oklch, var(--louise-text) 15%, transparent);
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
  /* Keep the action footer clear of the home indicator on the bottom sheet. */
  .louise-drawer-foot { padding-bottom: calc(10px + env(safe-area-inset-bottom)); }
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
  /* On-canvas "Add section" control (#182): the edit bar docks to the top on
     mobile, so span this across the bottom (thumb zone), clear of the home
     indicator. */
  .louise-sections-add--floating {
    left: 12px;
    right: 12px;
    bottom: calc(12px + env(safe-area-inset-bottom));
    width: auto;
  }
  /* Image grid: keep tiles tappable. */
  .louise-image-grid { grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); }
}

/* Touch devices can't hover, so hover-revealed affordances never appear. Keep a
   faint persistent ring on editable regions so they're discoverable, and reveal
   in-editor block controls on focus instead of hover. */
@media (hover: none) {
  .louise-editable { box-shadow: 0 0 0 1px color-mix(in oklch, var(--louise-ring) 20%, transparent); }
  .louise-block:focus-within .louise-block-control { display: inline-flex; }
}

/* Motion sensitivity. */
@media (prefers-reduced-motion: reduce) {
  .louise-drawer, .louise-bar { animation: none !important; }
}

/* ── Headless <Form> (#46) ────────────────────────────────────────────── */
/* Minimal, neutral defaults — a site typically brings its own form styles; the
   class hooks are here so the unstyled helper is still legible out of the box. */
.louise-form { display: grid; gap: 14px; font-family: var(--louise-font-body); }
.louise-form-row { display: grid; gap: 4px; }
.louise-form-label { font-size: var(--louise-text-sm); font-weight: 600; color: var(--louise-text-body); }
.louise-form-req { color: var(--louise-danger); }
.louise-form-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid color-mix(in oklch, var(--louise-text) 18%, transparent);
  border-radius: 8px;
  font: inherit;
  background: var(--louise-surface);
  color: var(--louise-text);
}
.louise-form-input:focus { outline: 2px solid var(--louise-ring); outline-offset: 0; }
.louise-form-check { display: inline-flex; align-items: center; gap: 8px; font-size: var(--louise-text-md); }
.louise-form-hint { font-size: var(--louise-text-xs); color: var(--louise-text-muted); }
.louise-form-error { font-size: var(--louise-text-xs); color: var(--louise-danger); }
.louise-form-submit {
  justify-self: start;
  appearance: none;
  border: none;
  cursor: pointer;
  padding: 9px 18px;
  border-radius: 8px;
  font-weight: 600;
  color: var(--louise-on-accent);
  background: var(--louise-accent);
}
.louise-form-submit:disabled { opacity: 0.5; cursor: default; }
.louise-form-status { font-size: var(--louise-text-md); }
.louise-form-status[data-status="success"] { color: var(--louise-success); }
.louise-form-status[data-status="error"] { color: var(--louise-danger); }

/* Live OG / social-card preview (pages drawer). The box holds the OG aspect
   ratio; the generated card is inline SVG (fills exactly, same ratio), a custom
   image is object-fit: cover to mimic how a share card crops it. */
.louise-og-preview {
  aspect-ratio: 1200 / 630;
  width: 100%;
  border: 1px solid var(--louise-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--louise-text);
}
.louise-og-card { display: block; width: 100%; height: 100%; line-height: 0; }
.louise-og-card svg { display: block; width: 100%; height: 100%; }
.louise-og-img { display: block; width: 100%; height: 100%; object-fit: cover; }

/* Grammar/spelling checker (#110): a wavy danger-colored underline on issues + a small
   suggestion popover (appended to <body>, so it needs a very high z-index to sit
   above the editor chrome). */
.louise-grammar-issue {
  text-decoration: underline wavy var(--louise-danger);
  text-decoration-skip-ink: none;
  text-underline-offset: 2px;
  cursor: pointer;
}
.louise-grammar-popover {
  position: absolute;
  z-index: 2147483000;
  min-width: 180px;
  max-width: 280px;
  padding: 6px;
  background: var(--louise-surface);
  border: 1px solid var(--louise-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px color-mix(in oklch, var(--louise-text) 14%, transparent);
  font-size: var(--louise-text-sm);
}
.louise-grammar-popover-msg { padding: 4px 6px 6px; color: var(--louise-text-secondary); font-size: var(--louise-text-xs); line-height: 1.35; }
.louise-grammar-suggest {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font: inherit;
  font-weight: 600;
  color: var(--louise-text);
  cursor: pointer;
}
.louise-grammar-suggest:hover { background: var(--louise-surface-muted); }
.louise-grammar-popover-none { padding: 4px 8px 6px; color: var(--louise-text-muted); font-size: var(--louise-text-xs); }
`;

export function injectStyles(): void {
  if (document.getElementById("louise-styles")) return;
  // Brand font (bundled @font-face, base64) + chrome CSS, injected only on Louise
  // surfaces (edit mode)—never on public page loads. The font is self-contained
  // in brandFontsCss, so there's no third-party request and nothing to preconnect.
  const style = document.createElement("style");
  style.id = "louise-styles";
  style.textContent = `${brandFontsCss}\n${CSS}`;
  document.head.appendChild(style);
}
