// Louise CMS — inline edit-on-the-live-page client (slice 1).
//
// Progressive enhancement, not hydration: the page is server-rendered
// normally, and in edit mode each editable region carries a
// `data-louise-field="<collection>:<key>:<field>"` marker. This module finds
// those markers, makes them editable in place (plain text via contenteditable,
// rich text via ProseKit), and saves changed fields to `/api/louise/save`.
//
// It self-gates: if there are no markers (i.e. the page wasn't rendered in
// edit mode) it does nothing, so the bootstrap can lazy-import it safely.

import { stegaClean } from "../core/cms/stega-clean.js";
import { mountRichText } from "./RichText.jsx";
import { injectStyles } from "./styles.js";

// Re-exported so the drawer's artwork form reuses the exact same ProseKit
// rich-text editor as slice-1 inline editing (same ProseMirror JSON storage).
export { mountRichText, RichText, type RichTextField, type RichTextProps } from "./RichText.jsx";
// Re-exported so drawer panels render the same Phosphor icon set as the
// rich-text toolbar (no per-panel glyph literals).
export { Icon, icons, type IconName } from "./icons.jsx";
// Page-builder blocks (#16): the registry drives the inserter; defineBlock
// lets future blocks be authored outside this module.
export {
  BLOCKS,
  BlockInserter,
  BlockInserterButton,
  defineBlock,
  defineBlocksExtension,
  type BlockDef,
  type BlockEntry,
} from "./blocks.jsx";
// Re-exported so the site-local explorer drawer (slice 2) can ensure the
// shared Louise stylesheet is present even on pages with no inline fields.
export { injectStyles } from "./styles.js";
// Structured "sections" editor — hybrid in-place editing for bespoke,
// component-rendered pages (site owns rendering; this owns editing).
export {
  mountSections,
  type SectionCatalog,
  type SectionDef,
  type SectionField,
  type SectionItem,
  type SectionsEditorProps,
} from "./sections.jsx";

interface FieldRef {
  collection: string;
  key: string;
  field: string;
}

type ValueGetter = () => unknown;

function parseMarker(el: HTMLElement): FieldRef | null {
  const raw = el.dataset.louiseField;
  if (!raw) return null;
  const [collection, key, field] = raw.split(":");
  if (!collection || !key || !field) return null;
  return { collection, key, field };
}

function exitHref(): string {
  // ?louise=off clears the sticky edit-mode cookie server-side.
  const url = new URL(location.href);
  url.searchParams.set("louise", "off");
  return `${url.pathname}${url.search}`;
}

interface Chrome {
  setDirty: (dirty: boolean) => void;
  setStatus: (status: "idle" | "saving" | "saved" | "error") => void;
}

interface ChromeOptions {
  onSave: () => void;
  /** Opens the explorer/settings drawer (the bar's Settings action). */
  onOpenDrawer: () => void;
  /** Whether this page has inline `data-louise-field`s. When false there's
   *  nothing for the bar to save (e.g. a sections-only page, which owns its own
   *  Save/Publish in the sections dock), so the Save button is omitted to avoid
   *  two competing, half-dead Save controls on screen. */
  hasFields: boolean;
}

/**
 * The single, unified edit bar: Settings (opens the drawer) and Done (leaves
 * edit mode), plus — only on pages with inline fields — a Save button (green)
 * and a transient save-status message that collapses when idle. The editor's
 * identity (live dot + name) lives in the drawer header, not on the bar.
 */
function createChrome(opts: ChromeOptions): Chrome {
  const bar = document.createElement("div");
  bar.className = "louise-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Louise editing toolbar");

  // Save + status only exist when there are inline fields to save; otherwise the
  // sections dock is the page's sole save authority.
  const save = opts.hasFields ? document.createElement("button") : null;
  const status = opts.hasFields ? document.createElement("span") : null;
  if (save) {
    save.type = "button";
    save.className = "louise-save";
    save.textContent = "Save";
    save.disabled = true;
    save.addEventListener("click", opts.onSave);
  }

  const settings = document.createElement("button");
  settings.type = "button";
  settings.className = "louise-settings";
  settings.textContent = "Settings";
  settings.addEventListener("click", opts.onOpenDrawer);

  const exit = document.createElement("a");
  exit.className = "louise-exit";
  exit.href = exitHref();
  exit.textContent = "Done";

  if (status) {
    // Transient save feedback, trailing the actions. Empty at rest (:empty in CSS
    // collapses it) so the bar reads as just the buttons until a save runs.
    status.className = "louise-status";
    status.dataset.status = "idle";
    status.setAttribute("aria-live", "polite");
  }

  // appendChild (single node), not the variadic append(): the latter's DOM
  // signature collides with @cloudflare/workers-types' HTMLRewriter `append`
  // when both type libs are in scope.
  for (const el of [save, settings, exit, status]) if (el) bar.appendChild(el);
  document.body.appendChild(bar);

  return {
    setDirty: (dirty) => {
      if (save) save.disabled = !dirty;
    },
    setStatus: (s) => {
      if (!status) return;
      status.dataset.status = s;
      status.textContent =
        s === "saving" ? "Saving…" : s === "saved" ? "Saved" : s === "error" ? "Couldn’t save" : "";
    },
  };
}

export interface MountLouiseOptions {
  /** Opens the explorer/settings drawer (wired to the bar's Settings action). */
  onOpenDrawer: () => void;
}

export function mountLouise(opts: MountLouiseOptions): void {
  // Idempotent under Astro view-transition re-runs.
  if (document.documentElement.dataset.louiseMounted === "1") return;
  document.documentElement.dataset.louiseMounted = "1";

  injectStyles();

  // The unified bar mounts for ANY editor page (it hosts the manage cog +
  // sign-out), independent of whether this page has inline fields.
  const fieldEls = Array.from(document.querySelectorAll<HTMLElement>("[data-louise-field]"));

  // fieldKey -> getter for its current value. Only populated when a field
  // actually changes, so only edited fields are sent on save.
  const dirty = new Map<string, ValueGetter>();
  let chrome: Chrome;

  const markDirty = (fieldKey: string, getter: ValueGetter) => {
    dirty.set(fieldKey, getter);
    chrome.setDirty(dirty.size > 0);
    chrome.setStatus("idle");
  };

  const saveAll = async () => {
    if (dirty.size === 0) return;
    chrome.setStatus("saving");
    try {
      for (const [fieldKey, getter] of Array.from(dirty.entries())) {
        const [collection, key, field] = fieldKey.split(":");
        const res = await fetch("/api/louise/save", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ collection, key, field, value: getter() }),
        });
        if (!res.ok) throw new Error(`save failed: ${res.status}`);
      }
      dirty.clear();
      chrome.setDirty(false);
      chrome.setStatus("saved");
    } catch (err) {
      console.error("[louise] save failed", err);
      chrome.setStatus("error");
    }
  };

  chrome = createChrome({
    onSave: () => void saveAll(),
    onOpenDrawer: opts.onOpenDrawer,
    hasFields: fieldEls.length > 0,
  });

  for (const el of fieldEls) {
    const ref = parseMarker(el);
    if (!ref) continue;
    const fieldKey = `${ref.collection}:${ref.key}:${ref.field}`;
    el.classList.add("louise-editable");

    if (el.dataset.louiseType === "richtext") {
      // Rich fields save serialized HTML — the site stores and renders HTML
      // (no ProseMirror on the Worker), and the editor re-parses it on load.
      // stegaClean before persisting: if stega visual-editing tagged this
      // field's text, its invisible payload must never round-trip into stored
      // HTML / ProseMirror JSON (it would compound on every save). No-op when
      // stega isn't in use.
      // `data-louise-blocks` opts the field into the full page-builder block set
      // (rows/columns, gallery, hero, …) — so a page body can be built in place
      // on the live page, not just in the drawer.
      const blocks = el.dataset.louiseBlocks === "1";
      const field = mountRichText(
        el,
        () => markDirty(fieldKey, () => stegaClean(field.getHTML())),
        undefined,
        { blocks },
      );
    } else {
      // Plain-text field: contenteditable, single line.
      el.setAttribute("contenteditable", "plaintext-only");
      el.setAttribute("spellcheck", "false");
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") e.preventDefault();
      });
      el.addEventListener("input", () =>
        markDirty(fieldKey, () => stegaClean(el.textContent?.trim() ?? "")),
      );
    }
  }
}
