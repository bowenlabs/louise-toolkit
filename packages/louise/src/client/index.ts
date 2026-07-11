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
// Headless <Form> render helper (#46, Tier 2) — renders a `defineForm` catalog
// with the SAME validation the server runs, and posts to its `formRoute`.
export { Form, type FormProps, mountForm } from "./forms.jsx";

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

type ChromeStatus = "idle" | "saving" | "saved" | "publishing" | "error";

interface Chrome {
  setDirty: (dirty: boolean) => void;
  setStatus: (status: ChromeStatus) => void;
  /** Versioned pages only: whether an unpublished draft exists (Publish enable). */
  setHasDraft: (hasDraft: boolean) => void;
}

interface ChromeOptions {
  /** Save action — a live field save, or (when `versioned`) a draft save. */
  onSave: () => void;
  /** Versioned pages only: promote the current/latest draft to live. */
  onPublish: () => void;
  /** Opens the explorer/settings drawer (the bar's Settings action). */
  onOpenDrawer: () => void;
  /** Whether this page has inline `data-louise-field`s. When false there's
   *  nothing for the bar to save (e.g. a sections-only page, which owns its own
   *  Save/Publish in the sections dock), so no save control is shown. */
  hasFields: boolean;
  /** Versioned page: inline saves stage a DRAFT and a Publish button promotes it
   *  (Save draft / Publish), instead of a single live Save. */
  versioned: boolean;
}

/**
 * The unified edit bar: Settings (opens the drawer) and Done (leaves edit mode),
 * plus its save controls. A versioned page shows **Save draft** (green) +
 * **Publish** (yellow); a plain collection page shows a single live **Save**; a
 * page with no inline fields shows neither (its surface — e.g. the sections dock
 * — owns saving). A transient save-status message trails the actions.
 */
function createChrome(opts: ChromeOptions): Chrome {
  const bar = document.createElement("div");
  bar.className = "louise-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Louise editing toolbar");

  const btn = (className: string, label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = className;
    b.textContent = label;
    b.disabled = true;
    b.addEventListener("click", onClick);
    return b;
  };

  // Save controls only when this page owns inline fields for the bar to save. A
  // versioned page with no inline fields (its sections dock owns Save/Publish)
  // shows neither, so the dock's relocated actions are the bar's only pair — one
  // versioned surface per page drives the bar (see the Drafts & publishing guide).
  const saveDraft =
    opts.versioned && opts.hasFields ? btn("louise-savedraft", "Save draft", opts.onSave) : null;
  const publish =
    opts.versioned && opts.hasFields ? btn("louise-publish", "Publish", opts.onPublish) : null;
  const save = !opts.versioned && opts.hasFields ? btn("louise-save", "Save", opts.onSave) : null;
  const status = opts.hasFields ? document.createElement("span") : null;

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
  for (const el of [saveDraft, publish, save, settings, exit, status]) if (el) bar.appendChild(el);
  document.body.appendChild(bar);

  const savedText = opts.versioned ? "Draft saved" : "Saved";
  let isDirty = false;
  let hasDraft = false;
  // Publish is available whenever there are pending edits or an unpublished draft.
  const refreshPublish = () => {
    if (publish) publish.disabled = !(isDirty || hasDraft);
  };

  return {
    setDirty: (dirty) => {
      isDirty = dirty;
      if (save) save.disabled = !dirty;
      if (saveDraft) saveDraft.disabled = !dirty;
      refreshPublish();
    },
    setHasDraft: (draft) => {
      hasDraft = draft;
      refreshPublish();
    },
    setStatus: (s) => {
      if (!status) return;
      status.dataset.status = s;
      status.textContent =
        s === "saving"
          ? "Saving…"
          : s === "saved"
            ? savedText
            : s === "publishing"
              ? "Publishing…"
              : s === "error"
                ? "Couldn’t save"
                : "";
    },
  };
}

export interface MountLouiseOptions {
  /** Opens the explorer/settings drawer (wired to the bar's Settings action). */
  onOpenDrawer: () => void;
  /** When set, this page uses the versioned draft workflow: inline saves stage a
   *  draft on this page id (`POST …/pages/:id/versions`) merging every changed
   *  field, and a Publish button promotes it (`POST …/publish`) — instead of
   *  writing each field live via `/save`. The page must render its editable
   *  fields' current draft values in edit mode (see the site's draft resume). */
  versionedPageId?: number;
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

  const pageId = opts.versionedPageId;
  const versioned = pageId !== undefined;

  // Non-versioned: write each changed field LIVE (POST /save).
  const saveLive = async () => {
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

  // Versioned: snapshot every changed field into ONE draft (the live row is
  // untouched until publish). Returns success. No reload — the page already
  // shows the edit, and edit mode resumes this draft on the next load.
  const saveDraft = async (): Promise<boolean> => {
    if (dirty.size === 0) return true;
    chrome.setStatus("saving");
    const changed: Record<string, unknown> = {};
    for (const [fieldKey, getter] of dirty) changed[fieldKey.split(":")[2]] = getter();
    try {
      const res = await fetch(`/api/louise/pages/${pageId}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(changed),
      });
      if (!res.ok) throw new Error(`draft failed: ${res.status}`);
      dirty.clear();
      chrome.setDirty(false);
      chrome.setStatus("saved");
      chrome.setHasDraft(true);
      return true;
    } catch (err) {
      console.error("[louise] save draft failed", err);
      chrome.setStatus("error");
      return false;
    }
  };

  // Versioned: flush pending edits to a draft, then promote it to live. Reload so
  // the server re-renders the published content authoritatively.
  const publish = async () => {
    if (dirty.size > 0 && !(await saveDraft())) return;
    chrome.setStatus("publishing");
    try {
      const res = await fetch(`/api/louise/pages/${pageId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error(`publish failed: ${res.status}`);
      location.reload();
    } catch (err) {
      console.error("[louise] publish failed", err);
      chrome.setStatus("error");
    }
  };

  chrome = createChrome({
    onSave: () => void (versioned ? saveDraft() : saveLive()),
    onPublish: () => void publish(),
    onOpenDrawer: opts.onOpenDrawer,
    hasFields: fieldEls.length > 0,
    versioned,
  });

  // Reflect whether an unpublished draft already exists, so Publish is available
  // even before this session makes an edit.
  if (versioned) {
    void fetch(`/api/louise/pages/${pageId}/versions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        const body = b as { versions?: { status: string }[] } | null;
        chrome.setHasDraft(Boolean(body?.versions?.some((v) => v.status === "draft")));
      })
      .catch(() => {});
  }

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
      // Isolate + surface editor-init failures: mountRichText clears el and
      // Solid-renders the editor, so a throw here (e.g. a ProseKit error during
      // render) would otherwise leave the field blank AND abort the whole field
      // loop as an unhandled rejection — silently, with no editor. Log it and
      // move on so one bad field can't take down the rest of the page.
      try {
        const field = mountRichText(
          el,
          () => markDirty(fieldKey, () => stegaClean(field.getHTML())),
          undefined,
          { blocks },
        );
      } catch (err) {
        console.error(`[louise] rich-text editor failed to mount for ${fieldKey}`, err);
      }
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
