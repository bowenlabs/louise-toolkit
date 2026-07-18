// louise-toolkit/client — structured "sections" editor: the visual block builder for
// bespoke, component-rendered pages (the Sanity-style preconfigured-blocks model).
//
// A *section* is one item of a page's `sections` JSON array — `{ _type, ...fields }`.
// The SITE owns rendering (bespoke Astro components, any design); this owns
// EDITING only, and saves the array back to `sections` (PATCH /api/louise/pages/:id).
// No HTML/markup is ever authored here, so the design stays 100% site-owned.
//
// The UX is HYBRID:
//  • TEXT is edited IN PLACE on the live bespoke render. Each editable text node
//    carries a `data-louise-sfield="<idx>.<key>[.<j>.<subKey>]"` marker; we make
//    it contenteditable and write keystrokes straight into the store. No panel,
//    no reload — you type on the real design. Saved on demand via the dock.
//  • STRUCTURE (which sections exist, their order, array-item membership) and any
//    non-visible field (e.g. a button's link URL) live in a compact floating
//    "dock" — the things you can't point at on the page. Because the bespoke
//    components are server-rendered, a structural change persists then reloads so
//    the server re-renders the new shape (which then becomes inline-editable).
//
// State is a single `createStore` shared by the inline wiring and the dock, so a
// keystroke is a fine-grained path write (`set("items", i, key, value)`) that
// updates only that leaf — no row teardown, no focus loss.

import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
  deleteBlockElement,
  deleteSectionElement,
  insertSectionElement,
  moveBlockElement,
  mountSectionChrome,
  moveSectionElement,
} from "./chrome.js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import { Portal, render } from "solid-js/web";
import { type AutoSaveOption, type Autosave, createAutosave, resolveAutoSave } from "./autosave.js";
import { Icon } from "./icons.jsx";
import { MediaPicker } from "./media-picker.jsx";
import { injectStyles } from "./styles.js";

// The section schema types live in core (server-safe) so the same catalog object
// drives both this on-page editor and the write-time validator (louise-toolkit/content's
// validateSections). Type-only import — no server/validation code enters the
// client bundle.
import type {
  SectionCatalog,
  SectionDef,
  SectionField,
  SectionFieldType,
  SectionItem,
} from "../core/content/sections.js";
export type { SectionCatalog, SectionDef, SectionField, SectionFieldType, SectionItem };

/** Whether a field is edited in place — only plain text is (default). `array`
 *  and `image` are edited in the dock, so they're non-inline. */
function isInline(field: SectionField): boolean {
  return field.inline ?? (field.type === "text" || field.type === "textarea");
}

export interface SectionsEditorProps {
  catalog: SectionCatalog;
  pageId: number;
  initial: SectionItem[];
  /** Auto-save inline section edits as a draft on an idle debounce — never
   *  publishes, and structural changes keep their own save+reload. On by default;
   *  pass `false` to opt out (manual Save draft button), or `{ debounceMs }`. */
  autoSave?: AutoSaveOption;
}

function humanize(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

/** Resolve when an element matching `selector` exists — checking now, then via a
 *  MutationObserver — or `null` after `timeoutMs`. The shared edit bar
 *  (`.louise-bar`) and this sections dock mount independently and in either
 *  order, so the dock can't assume the bar is already in the DOM. */
function whenElement(selector: string, timeoutMs = 3000): Promise<HTMLElement | null> {
  const now = document.querySelector<HTMLElement>(selector);
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => {
      const el = document.querySelector<HTMLElement>(selector);
      if (el) {
        obs.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => {
      obs.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

/** A dragged dock position (viewport px). `null` = the default CSS corner. */
interface DockPos {
  left: number;
  top: number;
}
const DOCK_POS_KEY = "louise:sections-dock-pos";
const DOCK_MARGIN = 8;

/** The last dragged dock position, persisted across the reloads structural edits
 *  trigger so the dock stays where the editor put it. */
function loadDockPos(): DockPos | null {
  try {
    const p = JSON.parse(localStorage.getItem(DOCK_POS_KEY) ?? "null");
    if (p && typeof p.left === "number" && typeof p.top === "number") return p;
  } catch {
    /* ignore malformed/blocked storage */
  }
  return null;
}

/** Keep a position on-screen given the dock's current size (viewport may have
 *  changed since it was saved). Returns `null` unchanged. */
function clampDockPos(pos: DockPos | null): DockPos | null {
  if (!pos) return null;
  const el = document.querySelector<HTMLElement>(".louise-sections-dock");
  const w = el?.offsetWidth ?? 300;
  const h = el?.offsetHeight ?? 200;
  return {
    left: Math.max(DOCK_MARGIN, Math.min(pos.left, window.innerWidth - w - DOCK_MARGIN)),
    top: Math.max(DOCK_MARGIN, Math.min(pos.top, window.innerHeight - h - DOCK_MARGIN)),
  };
}

/** A blank value for a field: `[]` for arrays, `""` for text. */
function blankValue(field: SectionField): unknown {
  return field.type === "array" ? [] : "";
}
function blankRecord(fields: Record<string, SectionField>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(fields)) out[k] = blankValue(f);
  return out;
}

type StoreSetter = (...args: unknown[]) => void;
type Status = "idle" | "saving" | "saved" | "publishing" | "published" | "error";

/** A row from `GET /api/louise/pages/:id/versions`. */
interface VersionRow {
  id: number;
  status: "draft" | "published";
  createdAt?: string | number | null;
  /** The full snapshot stored for this version — used to resume ("Edit") a draft. */
  versionData?: { sections?: SectionItem[] } | null;
}

/** Parse a `data-louise-sfield` path ("1.items.2.title") into store-write args,
 *  coercing the numeric segments (section index, array index) to numbers. */
function pathToArgs(path: string): (string | number)[] {
  return path.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p));
}

/** Resolve the placeholder/label text for a marker path, for empty-field hints. */
function placeholderFor(catalog: SectionCatalog, path: string, items: SectionItem[]): string {
  const parts = path.split(".");
  const item = items[Number(parts[0])];
  const def = item ? catalog[item._type] : undefined;
  let field = def?.fields[parts[1]];
  // Array subfield path: <idx>.<key>.<j>.<subKey>
  if (field?.type === "array" && parts.length >= 4) field = field.itemFields?.[parts[3]];
  return (
    field?.placeholder ?? field?.label ?? (parts.at(-1) ? humanize(parts.at(-1) as string) : "")
  );
}

/**
 * Wire in-place editing over the bespoke render: every `[data-louise-sfield]`
 * text node becomes contenteditable and writes into the shared store. Runs once
 * on mount (the nodes are server-rendered and stable until a structural reload).
 */
function wireInline(
  host: HTMLElement,
  catalog: SectionCatalog,
  items: SectionItem[],
  set: StoreSetter,
  onEdit: () => void,
  onBlur?: () => void,
): void {
  const nodes = host.querySelectorAll<HTMLElement>("[data-louise-sfield]");
  for (const node of Array.from(nodes)) {
    const path = node.dataset.louiseSfield;
    if (!path) continue;
    const hint = placeholderFor(catalog, path, items);
    if (hint) node.dataset.louisePlaceholder = hint;
    node.classList.add("louise-editable", "louise-sfield");
    node.setAttribute("contenteditable", "plaintext-only");
    // Native browser spellcheck on multiline (textarea-backed, prose-y) fields
    // only; single-line headline/label fields stay off, where red squiggles are
    // just noise (#142). Rich-text prose uses ProseKit + Harper (#110) instead.
    const multiline = node.hasAttribute("data-louise-multiline");
    node.setAttribute("spellcheck", multiline ? "true" : "false");
    // Single-line fields swallow Enter; multiline (textarea-backed) keeps it.
    if (!multiline) {
      node.addEventListener("keydown", (e) => {
        if (e.key === "Enter") e.preventDefault();
      });
    }
    node.addEventListener("input", () => {
      // Re-read the marker (don't close over `path`): an instant reorder/delete
      // re-stamps `data-louise-sfield`, so the current attribute is the source of
      // truth for which store path this node now writes to (#182 Phase 1).
      set("items", ...pathToArgs(node.dataset.louiseSfield ?? path), node.textContent ?? "");
      onEdit();
    });
    // Flush a pending auto-save when the editor tabs out of this field.
    if (onBlur) node.addEventListener("blur", onBlur);
  }
}

/**
 * Dock control for an `image` section field (e.g. a hero logo): a preview plus
 * upload, choose-from-library, and clear. Both the upload and the library pick
 * resolve to a media-hosted URL (`/api/louise/media`) — an external URL can't
 * be typed in, so every section image lives in the media collection. `onSet`
 * routes through the persist + reload path, so the new image shows on the
 * bespoke render immediately.
 */
function ImageDockField(props: { label: string; value: string; onSet: (url: string) => void }) {
  const [uploading, setUploading] = createSignal(false);
  const [error, setError] = createSignal("");

  const onUpload = async (e: Event & { currentTarget: HTMLInputElement }) => {
    const input = e.currentTarget;
    const file = (input.files ?? [])[0];
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("scope", "web");
      const res = await fetch("/api/louise/media", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && data.url) props.onSet(data.url);
      else setError(data.error || `Upload failed (${res.status})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      input.value = "";
    }
  };

  return (
    <div class="louise-field">
      <span class="louise-field-label">{props.label}</span>
      <Show when={props.value}>
        <img class="louise-sections-img" src={props.value} alt="" />
      </Show>
      <div class="louise-sections-img-actions">
        <label class="louise-btn louise-btn-xs">
          <Icon name="image" /> {uploading() ? "Uploading…" : props.value ? "Replace" : "Upload"}
          <input
            type="file"
            accept="image/*"
            class="louise-hidden-file"
            onChange={onUpload}
            disabled={uploading()}
          />
        </label>
        <MediaPicker onPick={(url) => props.onSet(url)} />
        <Show when={props.value}>
          <button class="louise-btn louise-btn-xs" type="button" onClick={() => props.onSet("")}>
            <Icon name="trash" /> Clear
          </button>
        </Show>
      </div>
      <Show when={error()}>
        <span class="louise-sections-img-error">{error()}</span>
      </Show>
    </div>
  );
}

/**
 * The hybrid sections editor: it takes over `host` (the bespoke render) with
 * in-place text editing and mounts its own control dock. `mountSections` renders
 * this into a body-level container so the page's own layout is untouched.
 */
function SectionsRoot(props: SectionsEditorProps & { host: HTMLElement }) {
  const [state, setState] = createStore<{ items: SectionItem[] }>({
    items: structuredClone(props.initial),
  });
  // Loosely-typed setter for dynamic deep paths (the SectionItem index signature
  // makes the strict overloads resolve to `never`).
  const set = setState as unknown as StoreSetter;
  const [status, setStatus] = createSignal<Status>("idle");
  const [dirty, setDirty] = createSignal(false);
  const [adding, setAdding] = createSignal(false);
  const [collapsed, setCollapsed] = createSignal(false);
  // A specific save-failure reason (e.g. a server validation violation), shown
  // in place of the generic "Couldn't save".
  const [errorDetail, setErrorDetail] = createSignal("");

  const [versions, setVersions] = createSignal<VersionRow[]>([]);
  // The id of the version that is currently LIVE (page's `published_version_id`),
  // or null if the page is unpublished. Used to flag the live row in history —
  // status alone can't, since multiple versions read "published" over time.
  const [liveVersionId, setLiveVersionId] = createSignal<number | null>(null);
  const [showHistory, setShowHistory] = createSignal(false);
  const hasDraft = () => versions().some((v) => v.status === "draft");

  // A leading slot injected into the shared edit bar (`.louise-bar`) that hosts
  // the Save-draft / Publish actions, so the page shows ONE action bar rather
  // than a second set of buttons in this dock. Null until the bar is found (it
  // mounts separately); the actions fall back into the dock while so.
  const [barSlot, setBarSlot] = createSignal<HTMLElement | null>(null);

  // Drag-to-move: `pos` is the dock's viewport position once dragged (null = the
  // default CSS corner), `dragging` styles the grab cursor. The editor drags the
  // dock by its header to move it off whatever it's covering.
  const [pos, setPos] = createSignal<DockPos | null>(null);
  const [dragging, setDragging] = createSignal(false);

  const autoCfg = resolveAutoSave(props.autoSave);
  // Bumped on every edit; `save()` captures it and only marks clean if it's
  // unchanged when the draft POST resolves — so an edit made during an in-flight
  // save keeps the surface dirty and the auto-saver reschedules.
  let editGen = 0;
  // Assigned once `save()` exists (below); `touched()` only runs on user input.
  let auto: Autosave | null = null;

  const touched = () => {
    editGen++;
    setDirty(true);
    if (status() !== "idle") setStatus("idle");
    if (autoCfg.enabled) auto?.schedule();
  };

  const loadVersions = async () => {
    try {
      const res = await fetch(`/api/louise/pages/${props.pageId}/versions`);
      const body = (await res.json().catch(() => null)) as {
        versions?: VersionRow[];
        publishedVersionId?: number | null;
      } | null;
      setVersions(body?.versions ?? []);
      setLiveVersionId(body?.publishedVersionId ?? null);
    } catch {
      setVersions([]);
      setLiveVersionId(null);
    }
  };

  onMount(() => {
    wireInline(
      props.host,
      props.catalog,
      state.items,
      set,
      touched,
      autoCfg.enabled ? () => auto?.flush() : undefined,
    );
    void loadVersions();

    // On-canvas section chrome (#182 Phase 1): rings + a per-section toolbar over
    // the marked sections, wired to the same structural ops the dock uses (still
    // save+reload for now — instant DOM ops come with the marker re-index slice).
    // Markers are stamped by the render in edit mode; on an unmarked host the
    // chrome simply finds nothing. Disposed with the dock.
    onCleanup(
      mountSectionChrome({
        onMoveUp: (i) => moveSection(i, -1),
        onMoveDown: (i) => moveSection(i, 1),
        onDelete: (i) => removeSection(i),
        // Block layer (#182 Phase 2 / ADR 0005): reorder/delete a section's
        // blocks in place — the block analogue of the section ops. Block add/swap
        // still need the fragment-render route (Phase 3).
        blocks: {
          onMoveUp: (r) => moveBlock(r.section, r.block, -1),
          onMoveDown: (r) => moveBlock(r.section, r.block, 1),
          onDelete: (r) => removeBlock(r.section, r.block),
        },
      }),
    );

    // Auto-save flush + unsaved-changes guard. `visibilitychange → hidden` /
    // `pagehide` are the reliable "leaving" signals; the keepalive draft POST
    // lets a flush fired here still land. `beforeunload` warns while dirty.
    // `astro:before-swap` covers Astro soft navigations (#74) — a view-transition
    // nav fires none of the others, so without it the dock would drop pending
    // edits before the swap. This dock is a disposable Solid component, so the
    // listeners are removed on cleanup (unlike mountLouise, which lives for the
    // whole page).
    if (autoCfg.enabled) {
      const onVis = () => {
        if (document.visibilityState === "hidden") auto?.flush();
      };
      const onPageHide = () => auto?.flush();
      const onSwap = () => auto?.flush();
      const onBeforeUnload = (e: BeforeUnloadEvent) => {
        auto?.flush();
        if (dirty()) {
          e.preventDefault();
          e.returnValue = "";
        }
      };
      document.addEventListener("visibilitychange", onVis);
      window.addEventListener("pagehide", onPageHide);
      document.addEventListener("astro:before-swap", onSwap);
      window.addEventListener("beforeunload", onBeforeUnload);
      onCleanup(() => {
        document.removeEventListener("visibilitychange", onVis);
        window.removeEventListener("pagehide", onPageHide);
        document.removeEventListener("astro:before-swap", onSwap);
        window.removeEventListener("beforeunload", onBeforeUnload);
      });
    }
    // Relocate Save-draft / Publish onto the shared edit bar once it exists — but
    // only if the bar isn't already driven by another versioned surface. The bar
    // is created by `mountLouise`'s chrome, which renders its own Save-draft /
    // Publish when the page has versioned inline fields; stacking a second pair
    // here would duplicate the actions (each wired to a different surface). Only
    // one versioned surface per page should own the bar (see the Drafts &
    // publishing guide), so if the chrome already put actions there, keep ours in
    // the dock footer (the `!barSlot()` fallback) instead of duplicating them.
    void whenElement(".louise-bar").then((bar) => {
      if (!bar) return;
      if (bar.querySelector(".louise-savedraft, .louise-publish, .louise-bar-actions")) return;
      const slot = document.createElement("span");
      slot.className = "louise-bar-actions";
      bar.insertBefore(slot, bar.firstChild);
      setBarSlot(slot);
    });
    setPos(clampDockPos(loadDockPos()));
  });

  // Drag the dock by its header. Pointer move/up are on `window` so the drag
  // survives the pointer leaving the header; persisted on release.
  let dragFrom: { x: number; y: number; left: number; top: number } | null = null;
  const onDragMove = (e: PointerEvent) => {
    if (!dragFrom) return;
    const el = document.querySelector<HTMLElement>(".louise-sections-dock");
    const w = el?.offsetWidth ?? 300;
    const h = el?.offsetHeight ?? 200;
    setPos({
      left: Math.max(
        DOCK_MARGIN,
        Math.min(dragFrom.left + (e.clientX - dragFrom.x), window.innerWidth - w - DOCK_MARGIN),
      ),
      top: Math.max(
        DOCK_MARGIN,
        Math.min(dragFrom.top + (e.clientY - dragFrom.y), window.innerHeight - h - DOCK_MARGIN),
      ),
    });
  };
  const endDrag = () => {
    if (!dragFrom) return;
    dragFrom = null;
    setDragging(false);
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", endDrag);
    const p = pos();
    if (p) {
      try {
        localStorage.setItem(DOCK_POS_KEY, JSON.stringify(p));
      } catch {
        /* ignore blocked storage */
      }
    }
  };
  const startDrag = (e: PointerEvent) => {
    // The collapse toggle inside the header is a click target, not a drag grip.
    if ((e.target as HTMLElement).closest(".louise-sections-toggle")) return;
    const el = document.querySelector<HTMLElement>(".louise-sections-dock");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragFrom = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
    setDragging(true);
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", endDrag);
  };
  onCleanup(() => {
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", endDrag);
  });

  // Parse a `{ error, violations }` body into a display detail (validation reason).
  const detailFrom = (body: { error?: string; violations?: { message: string }[] } | null) =>
    body?.violations?.[0]?.message ?? body?.error;

  // Save the current sections as a DRAFT (the live page is untouched until
  // publish). Returns the new version id, or null on failure.
  const saveDraft = async (): Promise<number | null> => {
    setErrorDetail("");
    try {
      const res = await fetch(`/api/louise/pages/${props.pageId}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sections: unwrap(state.items) }),
        // Survive a flush fired during page-hide / unload.
        keepalive: true,
      });
      const body = (await res.json().catch(() => null)) as {
        version?: { id: number };
        error?: string;
        violations?: { message: string }[];
      } | null;
      if (!res.ok) {
        const detail = detailFrom(body);
        if (detail) setErrorDetail(detail);
        throw new Error(`draft failed: ${res.status}`);
      }
      return body?.version?.id ?? null;
    } catch (err) {
      console.error("[louise] save draft failed", err);
      return null;
    }
  };

  // Save button / auto-save: stage a draft (no reload; the DOM already shows the
  // edit).
  const save = async () => {
    const gen = editGen;
    setStatus("saving");
    if ((await saveDraft()) !== null) {
      // Leave dirty set if an edit landed mid-save, so the auto-saver reschedules.
      if (editGen === gen) setDirty(false);
      setStatus("saved");
      void loadVersions();
    } else {
      setStatus("error");
    }
  };

  // The debounced auto-saver, wrapping the existing draft `save`. Publish and
  // structural changes are never automated. The callback RETURNS the save promise
  // so the scheduler can await it (single-flight overlap guard).
  auto = createAutosave(() => save(), autoCfg.debounceMs);

  // Publish: promote a version to live. With no `versionId`, flush pending edits
  // to a draft first, then publish it. Reload so the published render is
  // authoritative and edit mode stops resuming the (now published) draft.
  const publish = async (versionId?: number) => {
    // Supersede any queued auto-save so it can't stage a draft mid-publish.
    auto?.cancel();
    setErrorDetail("");
    setStatus("publishing");
    let vid = versionId;
    if (vid === undefined && dirty()) {
      const saved = await saveDraft();
      if (saved === null) {
        setStatus("error");
        return;
      }
      vid = saved;
      setDirty(false);
    }
    try {
      const res = await fetch(`/api/louise/pages/${props.pageId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(vid !== undefined ? { versionId: vid } : {}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          violations?: { message: string }[];
        } | null;
        const detail = detailFrom(body);
        if (detail) setErrorDetail(detail);
        throw new Error(`publish failed: ${res.status}`);
      }
      location.reload();
    } catch (err) {
      console.error("[louise] publish failed", err);
      setStatus("error");
    }
  };

  // Discard a draft version from history. Doesn't touch the live render (a draft
  // is never live), so just re-fetch the list — no reload.
  const discardDraft = async (versionId: number) => {
    setErrorDetail("");
    try {
      const res = await fetch(`/api/louise/pages/${props.pageId}/discard`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (body?.error) setErrorDetail(body.error);
        throw new Error(`discard failed: ${res.status}`);
      }
      void loadVersions();
    } catch (err) {
      console.error("[louise] discard draft failed", err);
      setStatus("error");
    }
  };

  // Structural change: mutate, save a draft, then reload so the server
  // re-renders the new shape (edit mode resumes the draft).
  const structural = async (mutate: () => void) => {
    // This path saves + reloads, so drop any queued debounce (it would fire into
    // a page that's about to navigate).
    auto?.cancel();
    mutate();
    setStatus("saving");
    if ((await saveDraft()) !== null) location.reload();
    else setStatus("error");
  };

  // Resume editing a draft from history: load its snapshot as the working copy,
  // then persist + reload so the server re-renders it (the newest draft is what
  // edit mode resumes) and it comes back inline-editable. Unlike publish, this
  // never touches the live page.
  const editDraft = (versionId: number) => {
    const sections = versions().find((v) => v.id === versionId)?.versionData?.sections;
    if (!Array.isArray(sections)) return;
    void structural(() => set("items", structuredClone(sections)));
  };

  // POST one section item to the fragment-render route and return its
  // server-rendered HTML (an Astro partial — the same `<Sections>` markup the
  // page uses), or null on any failure so the caller can fall back to reload.
  const renderSectionFragment = async (item: SectionItem): Promise<string | null> => {
    try {
      const res = await fetch("/louise-fragment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item }),
      });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  };

  // Add is INSTANT (#182 Phase 3 / ADR 0005 §4): optimistically splice the item
  // into the store, fetch its server-rendered fragment, insert + re-stamp it in
  // place (no reload), wire its inline fields, then stage a draft via autosave.
  // Falls back to the save-and-reload path if the fragment can't be rendered, so
  // the item is never lost.
  const addSection = async (type: string) => {
    const def = props.catalog[type];
    if (!def) return;
    setAdding(false);
    const item = { _type: type, ...blankRecord(def.fields) } as SectionItem;
    const index = state.items.length; // appended at the end
    set("items", (a: SectionItem[]) => {
      const next = a.slice();
      next.splice(index, 0, item);
      return next;
    });

    const html = await renderSectionFragment(item);
    const tmp = html ? document.createElement("div") : null;
    if (tmp) tmp.innerHTML = html as string;
    const el = tmp?.querySelector<HTMLElement>("[data-louise-section]") ?? null;
    if (!el) {
      // Fragment unavailable → persist the (already-mutated) store and reload so
      // the server re-renders the new shape from the draft.
      auto?.cancel();
      setStatus("saving");
      if ((await saveDraft()) !== null) location.reload();
      else setStatus("error");
      return;
    }
    insertSectionElement(el, index, props.host);
    wireInline(
      el,
      props.catalog,
      state.items,
      set,
      touched,
      autoCfg.enabled ? () => auto?.flush() : undefined,
    );
    touched();
  };
  // Reorder + delete are INSTANT (#182 Phase 1 / ADR 0005 §4): reconcile the
  // store, mirror the change on the already-rendered DOM (move/remove the marked
  // section element + re-stamp markers), and stage a draft via autosave — no
  // save-and-reload round-trip. (Add / array-item ops still reload — they need
  // markup that doesn't exist yet, i.e. the Phase 3 fragment-render route.)
  const removeSection = (i: number) => {
    set("items", (a: SectionItem[]) => a.filter((_, idx) => idx !== i));
    deleteSectionElement(i);
    touched();
  };
  const moveSection = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= state.items.length) return;
    set("items", (a: SectionItem[]) => {
      const next = a.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    moveSectionElement(i, j);
    touched();
  };
  // Block reorder/delete (#182 Phase 2 / ADR 0005 §4): the block analogue of the
  // section ops above, scoped within one section's `blocks` array. Reconcile the
  // store and mirror the change on the already-rendered DOM (move/remove the
  // marked block element + re-stamp block markers), then stage a draft.
  const removeBlock = (section: number, block: number) => {
    set("items", section, "blocks", (b: unknown) =>
      (Array.isArray(b) ? b : []).filter((_, idx) => idx !== block),
    );
    deleteBlockElement(section, block);
    touched();
  };
  const moveBlock = (section: number, block: number, delta: number) => {
    const blocks = state.items[section]?.blocks;
    const to = block + delta;
    if (!Array.isArray(blocks) || to < 0 || to >= blocks.length) return;
    set("items", section, "blocks", (b: unknown) => {
      const next = (Array.isArray(b) ? b : []).slice();
      [next[block], next[to]] = [next[to], next[block]];
      return next;
    });
    moveBlockElement(section, block, to);
    touched();
  };
  const addItem = (i: number, key: string, itemFields: Record<string, SectionField>) =>
    void structural(() =>
      set("items", i, key, (arr: unknown) => [
        ...(Array.isArray(arr) ? arr : []),
        blankRecord(itemFields),
      ]),
    );
  const removeItem = (i: number, key: string, k: number) =>
    void structural(() =>
      set("items", i, key, (arr: Record<string, unknown>[]) => arr.filter((_, z) => z !== k)),
    );

  // Discriminated arrays (#182 Phase 0): an item's `key` field holds its variant.
  // `add` pre-fills the shared `itemFields` + the chosen variant's blank fields +
  // the key; `switch` keeps the shared field values and swaps in a new variant's
  // blanks. Both mirror what `validateSections` expects (base ∪ variant fields).
  const variantKeys = (field: SectionField): string[] =>
    Object.keys(field.discriminator?.variants ?? {});
  const variantLabel = (field: SectionField, v: string): string =>
    field.discriminator?.variantsAdmin?.[v]?.label ?? humanize(v);
  const variantIcon = (field: SectionField, v: string): string | undefined =>
    field.discriminator?.variantsAdmin?.[v]?.icon;
  const variantOf = (field: SectionField, item: Record<string, unknown>): string =>
    String(item[field.discriminator?.key ?? ""] ?? "");
  const addVariantItem = (i: number, key: string, field: SectionField, variant: string) =>
    void structural(() =>
      set("items", i, key, (arr: unknown) => [
        ...(Array.isArray(arr) ? arr : []),
        {
          ...blankRecord(field.itemFields ?? {}),
          ...blankRecord(field.discriminator?.variants[variant] ?? {}),
          [field.discriminator?.key ?? "_variant"]: variant,
        },
      ]),
    );
  const switchVariant = (i: number, key: string, k: number, field: SectionField, variant: string) =>
    void structural(() => {
      const disc = field.discriminator;
      const cur =
        (
          (unwrap(state).items[i] as Record<string, unknown>)[key] as
            | Record<string, unknown>[]
            | undefined
        )?.[k] ?? {};
      // Preserve the shared itemFields' values; reset the variant-specific ones.
      const shared: Record<string, unknown> = {};
      for (const bk of Object.keys(field.itemFields ?? {})) shared[bk] = cur[bk];
      // `reconcile` (not a plain set, which shallow-*merges*) so the previous
      // variant's fields are dropped rather than lingering on the item.
      set(
        "items",
        i,
        key,
        k,
        reconcile({
          ...shared,
          ...blankRecord(disc?.variants[variant] ?? {}),
          [disc?.key ?? "_variant"]: variant,
        }),
      );
    });

  /** Fields edited in the dock (not visible text you can point at). */
  const dockFields = (item: SectionItem): [string, SectionField][] =>
    Object.entries(props.catalog[item._type]?.fields ?? {}).filter(
      ([, f]) => f.type !== "array" && !isInline(f),
    );
  const arrayFields = (item: SectionItem): [string, SectionField][] =>
    Object.entries(props.catalog[item._type]?.fields ?? {}).filter(([, f]) => f.type === "array");

  // The page's primary save actions — Save draft (green) and Publish (yellow) —
  // rendered onto the shared edit bar (or the dock as fallback). A component so
  // the same markup mounts in either place.
  // With auto-save on, the manual Save draft button is dropped — edits stage a
  // draft on a debounce and the status line reports it. Publish is never
  // automated, so it stays.
  const SaveActions = () => (
    <>
      <Show when={!autoCfg.enabled}>
        <button
          class="louise-savedraft"
          type="button"
          disabled={status() === "saving" || status() === "publishing" || !dirty()}
          onClick={() => {
            auto?.cancel();
            void save();
          }}
        >
          {status() === "saving" ? "Saving…" : "Save draft"}
        </button>
      </Show>
      <button
        class="louise-publish"
        type="button"
        disabled={status() === "publishing" || (!dirty() && !hasDraft())}
        onClick={() => void publish()}
      >
        {status() === "publishing" ? "Publishing…" : "Publish"}
      </button>
    </>
  );

  return (
    <div
      class="louise-sections-dock"
      data-theme="louise"
      data-collapsed={collapsed() ? "1" : undefined}
      data-dragging={dragging() ? "1" : undefined}
      style={
        pos()
          ? { left: `${pos()?.left}px`, top: `${pos()?.top}px`, right: "auto", bottom: "auto" }
          : undefined
      }
    >
      <div class="louise-sections-head" onPointerDown={startDrag}>
        <button
          class="louise-sections-toggle"
          type="button"
          title={collapsed() ? "Expand" : "Collapse"}
          onClick={() => setCollapsed((v) => !v)}
        >
          <Icon name={collapsed() ? "caretRight" : "caretDown"} />
        </button>
        <span class="louise-sections-title">Page sections</span>
        <span
          class="louise-sections-status"
          data-status={status()}
          title={status() === "error" ? errorDetail() : undefined}
        >
          {status() === "saving"
            ? "Saving…"
            : status() === "saved"
              ? "Draft saved"
              : status() === "publishing"
                ? "Publishing…"
                : status() === "error"
                  ? errorDetail() || "Couldn’t save"
                  : dirty()
                    ? "Unsaved"
                    : hasDraft()
                      ? "Draft"
                      : ""}
        </span>
      </div>

      <Show when={!collapsed()}>
        <div class="louise-sections-body">
          <For
            each={state.items}
            fallback={<p class="louise-muted">No sections yet — add one below.</p>}
          >
            {(item, i) => (
              <div class="louise-section-row">
                <div class="louise-section-row-head">
                  <span class="louise-section-type">
                    {props.catalog[item._type]?.label ?? item._type}
                  </span>
                  <div class="louise-section-ops">
                    <button
                      class="louise-btn louise-btn-xs"
                      type="button"
                      title="Move up"
                      disabled={i() === 0}
                      onClick={() => moveSection(i(), -1)}
                    >
                      <Icon name="caretUp" />
                    </button>
                    <button
                      class="louise-btn louise-btn-xs"
                      type="button"
                      title="Move down"
                      disabled={i() === state.items.length - 1}
                      onClick={() => moveSection(i(), 1)}
                    >
                      <Icon name="caretDown" />
                    </button>
                    <button
                      class="louise-btn louise-btn-xs louise-btn-danger"
                      type="button"
                      title="Remove section"
                      onClick={() => removeSection(i())}
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                </div>

                {/* Non-visible fields (edited here, not on the page). */}
                <For each={dockFields(item)}>
                  {([key, field]) => (
                    <Show
                      when={field.type === "image"}
                      fallback={
                        <label class="louise-field">
                          <span class="louise-field-label">{field.label ?? humanize(key)}</span>
                          <Show
                            when={field.type === "textarea"}
                            fallback={
                              <input
                                class="louise-input"
                                value={String(item[key] ?? "")}
                                placeholder={field.placeholder}
                                onInput={(e) => {
                                  set("items", i(), key, e.currentTarget.value);
                                  touched();
                                }}
                              />
                            }
                          >
                            {/* A textarea (not a single-line input) so dock-edited
                                body copy — card bodies, FAQ answers, step/tier
                                bodies — can hold line breaks, saved as `\n`. The
                                site renders them with `white-space: pre-line`. */}
                            <textarea
                              class="louise-input louise-dock-textarea"
                              rows={3}
                              value={String(item[key] ?? "")}
                              placeholder={field.placeholder}
                              onInput={(e) => {
                                set("items", i(), key, e.currentTarget.value);
                                touched();
                              }}
                            />
                          </Show>
                        </label>
                      }
                    >
                      <ImageDockField
                        label={field.label ?? humanize(key)}
                        value={String(item[key] ?? "")}
                        onSet={(url) => void structural(() => set("items", i(), key, url))}
                      />
                    </Show>
                  )}
                </For>

                {/* Array membership — the text of each item is edited in place.
                    A discriminated array swaps the plain "Item N" label + single
                    add for a per-item variant switcher + one add per variant. */}
                <For each={arrayFields(item)}>
                  {([key, field]) => (
                    <div class="louise-arr">
                      <span class="louise-field-label">{field.label ?? humanize(key)}</span>
                      <For each={(item[key] as Record<string, unknown>[]) ?? []}>
                        {(arrItem, k) => (
                          <div class="louise-arr-row">
                            <Show
                              when={field.discriminator}
                              fallback={
                                <span>
                                  {field.itemLabel ?? "Item"} {k() + 1}
                                </span>
                              }
                            >
                              <select
                                class="louise-variant-switch"
                                title="Block type"
                                value={variantOf(field, arrItem)}
                                onChange={(e) =>
                                  switchVariant(i(), key, k(), field, e.currentTarget.value)
                                }
                              >
                                <For each={variantKeys(field)}>
                                  {(v) => <option value={v}>{variantLabel(field, v)}</option>}
                                </For>
                              </select>
                            </Show>
                            <button
                              class="louise-btn louise-btn-xs louise-btn-danger"
                              type="button"
                              title="Remove"
                              onClick={() => removeItem(i(), key, k())}
                            >
                              <Icon name="trash" />
                            </button>
                          </div>
                        )}
                      </For>
                      <Show
                        when={field.discriminator}
                        fallback={
                          <button
                            class="louise-btn louise-btn-xs"
                            type="button"
                            onClick={() => addItem(i(), key, field.itemFields ?? {})}
                          >
                            <Icon name="plus" /> {field.itemLabel ?? "item"}
                          </button>
                        }
                      >
                        <div class="louise-variant-add">
                          <For each={variantKeys(field)}>
                            {(v) => (
                              <button
                                class="louise-btn louise-btn-xs"
                                type="button"
                                onClick={() => addVariantItem(i(), key, field, v)}
                              >
                                <Show when={variantIcon(field, v)} fallback={<Icon name="plus" />}>
                                  <i class={variantIcon(field, v)} aria-hidden="true" />
                                </Show>{" "}
                                {variantLabel(field, v)}
                              </button>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>

          {/* Add section — full-width, above the version history. */}
          <div class="louise-sections-add">
            <button
              class="louise-btn louise-btn-block"
              type="button"
              onClick={() => setAdding((v) => !v)}
            >
              <Icon name="plus" /> Add section
            </button>
            <Show when={adding()}>
              <div class="louise-sections-palette" role="menu">
                <For each={Object.entries(props.catalog)}>
                  {([type, def]) => (
                    <button
                      class="louise-slash-item"
                      type="button"
                      role="menuitem"
                      onClick={() => addSection(type)}
                    >
                      {def.label}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Version history — publish (restore) any version to make it live. */}
          <div class="louise-sections-history">
            <button
              class="louise-sections-history-toggle"
              type="button"
              onClick={() => {
                const next = !showHistory();
                setShowHistory(next);
                if (next) void loadVersions();
              }}
            >
              <Icon name={showHistory() ? "caretDown" : "caretRight"} /> Version history
            </button>
            <Show when={showHistory()}>
              <div class="louise-sections-versions">
                <For each={versions()} fallback={<p class="louise-muted">No versions yet.</p>}>
                  {(v) => {
                    const isLive = () => v.id === liveVersionId();
                    return (
                      <div class="louise-arr-row" data-live={isLive() ? "1" : undefined}>
                        <span>
                          {isLive() ? "Live" : v.status === "published" ? "Published" : "Draft"}
                          {v.createdAt ? ` · ${new Date(v.createdAt).toLocaleString()}` : ""}
                        </span>
                        <div class="louise-arr-ops">
                          {/* Drafts resume for editing (never publish straight from
                              history) + can be deleted; published versions restore live. */}
                          <Show
                            when={v.status === "draft"}
                            fallback={
                              <button
                                class="louise-btn louise-btn-xs"
                                type="button"
                                disabled={status() === "publishing" || isLive()}
                                onClick={() => void publish(v.id)}
                              >
                                {isLive() ? "Current" : "Restore"}
                              </button>
                            }
                          >
                            <button
                              class="louise-btn louise-btn-xs"
                              type="button"
                              title="Resume editing this draft"
                              onClick={() => editDraft(v.id)}
                            >
                              Edit
                            </button>
                            <button
                              class="louise-btn louise-btn-xs louise-btn-danger"
                              type="button"
                              title="Delete draft"
                              onClick={() => void discardDraft(v.id)}
                            >
                              <Icon name="trash" />
                            </button>
                          </Show>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
          </div>

          {/* Fallback home for Save draft + Publish when no edit bar exists. */}
          <Show when={!barSlot()}>
            <div class="louise-sections-footer">
              <SaveActions />
            </div>
          </Show>
        </div>
      </Show>
      {/* Save draft + Publish, relocated onto the shared edit bar. Kept outside
          the collapse toggle so they stay on the bar when the dock is collapsed. */}
      <Show when={barSlot()}>
        <Portal mount={barSlot()!}>
          <SaveActions />
        </Portal>
      </Show>
    </div>
  );
}

/**
 * Vanilla-DOM adapter: enable in-place editing over `el` (the server-rendered
 * bespoke sections) and mount the control dock, in edit mode. The bespoke render
 * is left in place — only made editable. Returns the disposer.
 */
export function mountSections(el: HTMLElement, opts: SectionsEditorProps): () => void {
  injectStyles();
  const dock = document.createElement("div");
  document.body.appendChild(dock);
  const dispose = render(() => <SectionsRoot {...opts} host={el} />, dock);
  return () => {
    dispose();
    dock.remove();
  };
}
