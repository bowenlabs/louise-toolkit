// Louise Toolkit — inline edit-on-the-live-page client (slice 1).
//
// Progressive enhancement, not hydration: the page is server-rendered
// normally, and in edit mode each editable region carries a
// `data-louise-field="<collection>:<key>:<field>"` marker. This module finds
// those markers, makes them editable in place (plain text via contenteditable,
// rich text via ProseKit), and saves changed fields to `/api/louise/save`.
//
// It self-gates: if there are no markers (i.e. the page wasn't rendered in
// edit mode) it does nothing, so the bootstrap can lazy-import it safely.

import { stegaClean } from "../core/content/stega-clean.js";
import { mountStegaClipboardGuard } from "../core/content/visual-editing.js";
import { type AutoSaveOption, type Autosave, createAutosave, resolveAutoSave } from "./autosave.js";
import {
  connectRealtime,
  initials,
  otherPeers,
  type RealtimeLocks,
  type RealtimeOption,
  type RealtimePeer,
  type RealtimeSession,
  resolveRealtime,
} from "./realtime.js";
import { mountRichText } from "./RichText.jsx";
import { injectStyles } from "./styles.js";

// Re-exported so the Settings artwork form reuses the exact same ProseKit
// rich-text editor as slice-1 inline editing (same ProseMirror JSON storage).
export { mountRichText, RichText, type RichTextField, type RichTextProps } from "./RichText.jsx";
// Re-exported so Settings panels render the same Phosphor icon set as the
// rich-text toolbar (no per-panel glyph literals).
export { Icon, icons, type IconName } from "./icons.jsx";
// Builder blocks (#16): the registry drives the inserter; defineBlock
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
// Re-exported so the site-local Louise Settings (slice 2) can ensure the
// shared Louise stylesheet is present even on pages with no inline fields.
export { injectStyles } from "./styles.js";
// The auto-save option shape, re-exported so consumers can type a shared config
// object passed to both `mountLouise` and `mountSections`.
export { type AutoSaveOption } from "./autosave.js";
// The realtime opt-in shape + the WS client, re-exported so a host can type the
// shared config and (if it wants) drive a session directly.
export {
  connectRealtime,
  type RealtimeOption,
  type RealtimePeer,
  type RealtimeSession,
} from "./realtime.js";
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
  /** Realtime only: render the other editors currently in the session (avatars). */
  setPresence: (peers: RealtimePeer[]) => void;
}

interface ChromeOptions {
  /** Save action — a live field save, or (when `versioned`) a draft save. */
  onSave: () => void;
  /** Versioned pages only: promote the current/latest draft to live. */
  onPublish: () => void;
  /** Opens Louise Settings (the bar's Settings action). */
  onOpenSettings: () => void;
  /** Whether this page has inline `data-louise-field`s. When false there's
   *  nothing for the bar to save (e.g. a sections-only page, which owns its own
   *  Save/Publish in the sections dock), so no save control is shown. */
  hasFields: boolean;
  /** Versioned page: inline saves stage a DRAFT and a Publish button promotes it
   *  (Save draft / Publish), instead of a single live Save. */
  versioned: boolean;
  /** Auto-save is driving saves on a debounce, so the bar shows no manual
   *  Save / Save draft button — only the live status (and Publish, if versioned). */
  autoSave: boolean;
}

/**
 * The unified edit bar: Settings (opens Louise Settings) and Done (leaves edit mode),
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
  // With auto-save on, the manual Save / Save draft button is dropped entirely —
  // edits persist on a debounce and the status span reports it. Publish is never
  // automated, so it stays.
  const saveDraft =
    opts.versioned && opts.hasFields && !opts.autoSave
      ? btn("louise-savedraft", "Save draft", opts.onSave)
      : null;
  const publish =
    opts.versioned && opts.hasFields ? btn("louise-publish", "Publish", opts.onPublish) : null;
  const save =
    !opts.versioned && opts.hasFields && !opts.autoSave
      ? btn("louise-save", "Save", opts.onSave)
      : null;
  const status = opts.hasFields ? document.createElement("span") : null;

  // Presence avatars (realtime): a compact strip of the other editors in the
  // session, rendered leading so it reads as "who else is here". Empty at rest.
  const presence = document.createElement("span");
  presence.className = "louise-presence";
  presence.setAttribute("aria-live", "polite");

  const settings = document.createElement("button");
  settings.type = "button";
  settings.className = "louise-settings";
  settings.textContent = "Settings";
  settings.addEventListener("click", opts.onOpenSettings);

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
  for (const el of [presence, saveDraft, publish, save, settings, exit, status])
    if (el) bar.appendChild(el);
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
    setPresence: (peers) => {
      presence.replaceChildren();
      for (const peer of peers) {
        const dot = document.createElement("span");
        dot.className = "louise-avatar";
        dot.textContent = initials(peer.name);
        dot.title = `${peer.name} is editing`;
        presence.appendChild(dot);
      }
    },
  };
}

/** Toggle a field's soft-lock UI: read-only + a "locked by X" badge when held by a
 *  peer, cleared when free/mine. Advisory only — the server enforces the lock. */
function setFieldLock(el: HTMLElement, byName: string | null): void {
  if (byName) {
    el.classList.add("louise-locked");
    el.setAttribute("aria-disabled", "true");
    el.dataset.louiseLockedBy = `🔒 ${byName} is editing`;
  } else {
    el.classList.remove("louise-locked");
    el.removeAttribute("aria-disabled");
    delete el.dataset.louiseLockedBy;
  }
}

export interface MountLouiseOptions {
  /** Opens Louise Settings (wired to the bar's Settings action). */
  onOpenSettings: () => void;
  /** When set, this page uses the versioned draft workflow: inline saves stage a
   *  draft on this page id (`POST …/pages/:id/versions`) merging every changed
   *  field, and a Publish button promotes it (`POST …/publish`) — instead of
   *  writing each field live via `/save`. The page must render its editable
   *  fields' current draft values in edit mode (see the site's draft resume). */
  versionedPageId?: number;
  /** Auto-save inline edits on an idle debounce, reusing this surface's existing
   *  save (a live field save, or a draft on a versioned page) — never publishes.
   *  On by default; pass `false` to opt out (back to a manual Save button), or an
   *  object to tune the debounce (`{ debounceMs }`). */
  autoSave?: AutoSaveOption;
  /** Enable the Harper grammar/spelling checker (#110) on rich-text fields. Off by
   *  default; when on, the WASM checker is lazy-loaded (runs on-device — the text
   *  never leaves the browser) and issues are underlined with click-to-apply
   *  suggestions. English-only for now. */
  grammar?: boolean;
  /** Opt this page into a real-time multi-editor session (ADR 0002 / #71):
   *  connect to the per-page Durable Object for presence, live field echo, and a
   *  rich-text soft-lock. **Versioned pages only** (realtime persists as drafts), so
   *  it's ignored unless `versionedPageId` is set. Degradation-first: if the socket
   *  can't open (no `EDIT_SESSION` binding → the route 503s) editing silently falls
   *  back to the debounced-fetch auto-save. Off by default; `{ throttleMs }` tunes
   *  the outbound change rate. */
  realtime?: RealtimeOption;
  /**
   * Typed Astro Action callables for the **normal** (debounced) auto-save path
   * (#138). The site injects `actions.louise.save` / `actions.louise.saveDraft`
   * — which it can import from `astro:actions`; this framework-agnostic client
   * can't. Each must **resolve on success and reject on failure** (the site wraps
   * the action's `{ data, error }` accordingly).
   *
   * The **unload** flush (tab-hide / page-hide / `beforeunload`) always uses the
   * raw `keepalive` fetch instead — Astro's action client can't set `keepalive`,
   * so a save fired while navigating away would be dropped. Omit `actions` to keep
   * every save on the raw `/api/louise/*` routes (unchanged).
   */
  actions?: {
    /** Live field save — mirrors `louiseSaveAction`'s input. */
    save?: (input: {
      collection: string;
      key: string;
      field: string;
      value: unknown;
    }) => Promise<unknown>;
    /** Versioned draft save — mirrors `louiseSaveDraftAction`'s input. */
    saveDraft?: (input: { id: number; data: Record<string, unknown> }) => Promise<unknown>;
  };
}

/**
 * The currently-mounted inline editor's leave hooks, so the shared handlers below
 * can flush + guard whichever page is active. A soft (view-transition) navigation
 * replaces `<body>` — and this editor with it — so it's cleared on `astro:after-swap`
 * and re-set by the next page's `mountLouise`.
 */
interface ActiveInline {
  /** Flush pending auto-saved edits (routes through the raw keepalive fetch). */
  flush: () => void;
  /** Whether edits are genuinely unsaved — drives the `beforeunload` guard. */
  hasDirty: () => boolean;
  /** Mark the page as leaving so saves use the keepalive fetch, not an Action. */
  setUnloading: (leaving: boolean) => void;
}
let activeInline: ActiveInline | null = null;
// The current page's realtime session (if any), closed on a soft nav so the DO
// socket doesn't leak across a view-transition re-mount.
let activeRealtime: RealtimeSession | null = null;
let leaveHandlersWired = false;

/**
 * Wire the auto-save flush + unsaved-changes guard **once** for the page's lifetime,
 * delegating to whichever inline editor is currently mounted ({@link activeInline}).
 * Registering once (rather than per `mountLouise`) means a view-transition re-mount
 * doesn't stack duplicate `window` listeners.
 *
 * - `visibilitychange → hidden` / `pagehide` / `beforeunload` — hard navigations and
 *   tab-hide. The keepalive fetches let a flush fired here still reach the Worker.
 * - `astro:before-swap` — Astro **soft** navigations, which fire none of the above;
 *   without this a view-transition nav would drop pending edits. Flushes before the
 *   DOM (and the current editor) is swapped away (#74).
 * - `astro:after-swap` — clears the mount guard (a runtime `<html>` attribute that
 *   survives the swap) and drops the now-defunct editor, so the next page re-mounts
 *   cleanly on `astro:page-load`.
 *
 * `astro:*` are plain DOM events; in a non-Astro host they simply never fire, so this
 * stays framework-agnostic.
 */
function ensureLeaveHandlers(): void {
  if (leaveHandlersWired) return;
  leaveHandlersWired = true;
  const leave = () => {
    activeInline?.setUnloading(true);
    activeInline?.flush();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") leave();
    else activeInline?.setUnloading(false);
  });
  window.addEventListener("pagehide", leave);
  window.addEventListener("beforeunload", (e) => {
    leave();
    if (activeInline?.hasDirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  document.addEventListener("astro:before-swap", leave);
  document.addEventListener("astro:after-swap", () => {
    delete document.documentElement.dataset.louiseMounted;
    activeInline = null;
    // Tear down the realtime socket for the page being navigated away from; the
    // next page's mountLouise opens a fresh one for its own DO.
    activeRealtime?.close();
    activeRealtime = null;
  });
}

export function mountLouise(opts: MountLouiseOptions): void {
  // Idempotent within a page render; cleared on `astro:after-swap` so a soft
  // navigation re-mounts the (replaced) body's editor. See {@link ensureLeaveHandlers}.
  if (document.documentElement.dataset.louiseMounted === "1") return;
  document.documentElement.dataset.louiseMounted = "1";

  injectStyles();
  // In edit mode, rendered text may carry an invisible stega source pointer;
  // strip it from clipboard copies so an editor never pastes zero-width chars.
  // Idempotent, so re-mounting after a soft nav doesn't stack listeners.
  mountStegaClipboardGuard();

  // The unified bar mounts for ANY editor page (it hosts the manage cog +
  // sign-out), independent of whether this page has inline fields.
  const fieldEls = Array.from(document.querySelectorAll<HTMLElement>("[data-louise-field]"));

  // fieldKey -> getter for its current value. Only populated when a field
  // actually changes, so only edited fields are sent on save.
  const dirty = new Map<string, ValueGetter>();
  let chrome: Chrome;

  const { enabled: autoSaveOn, debounceMs } = resolveAutoSave(opts.autoSave);
  const { enabled: realtimeOn, throttleMs: realtimeThrottleMs } = resolveRealtime(opts.realtime);
  // Bumped on every edit. A save captures it up front and only clears `dirty` if
  // it's unchanged when the save resolves — so a field edited *during* an
  // in-flight save is never cleared unsaved (the auto-saver reschedules).
  let editGen = 0;
  // Assigned once the save fns exist (below); markDirty only runs on user input,
  // long after, so the null window is never hit in practice.
  let auto: Autosave | null = null;
  // The realtime session (assigned after the field loop, once we know the
  // collection slug); null when realtime is off or the socket can't open.
  let rt: RealtimeSession | null = null;
  // Per-field appliers for inbound remote edits (plain-text fields only — the DO
  // never broadcasts lock-guarded rich fields), and the lock-guarded field
  // elements, both keyed by field name. Populated in the field loop.
  const remoteAppliers = new Map<string, (value: unknown) => void>();
  const lockEls = new Map<string, HTMLElement>();
  // Every field's current-value getter, keyed by field name — used to force the
  // latest realtime edits into a fresh draft right before Publish (the DO's own
  // coalesced flush might not have fired yet). Populated in the field loop.
  const fieldGetters = new Map<string, ValueGetter>();
  // True while the page is hiding/unloading (set by the leave handlers below).
  // The save fns fall back to a raw `keepalive` fetch then — an Astro Action
  // can't keepalive, so its request would be aborted mid-navigation (#138).
  let unloading = false;

  const markDirty = (fieldKey: string, getter: ValueGetter) => {
    editGen++;
    // Realtime connected → the DO is the coalescer/persister. Publish the change
    // and DON'T retain local dirty: the DO stores it durably on receipt (so a
    // quick tab-close won't lose it) and flushes it as a draft, so the save bar +
    // unload guard shouldn't nag. On a dropped socket we fall through to the
    // debounced-fetch path below.
    if (rt?.connected()) {
      rt.publish(fieldKey.split(":")[2], getter());
      chrome.setStatus("saved");
      // A draft is (being) created in the DO — enable Publish even though we don't
      // track local dirty on the realtime path.
      chrome.setHasDraft(true);
      return;
    }
    dirty.set(fieldKey, getter);
    chrome.setDirty(dirty.size > 0);
    chrome.setStatus("idle");
    if (autoSaveOn) auto?.schedule();
  };

  const pageId = opts.versionedPageId;
  const versioned = pageId !== undefined;

  // Non-versioned: write each changed field LIVE (POST /save).
  const saveLive = async () => {
    if (dirty.size === 0) return;
    const gen = editGen;
    chrome.setStatus("saving");
    try {
      for (const [fieldKey, getter] of Array.from(dirty.entries())) {
        const [collection, key, field] = fieldKey.split(":");
        const input = { collection, key, field, value: getter() };
        // Normal path → the typed Action when the site injected it; unload path
        // → the raw `keepalive` fetch (the Action client can't keepalive) (#138).
        if (opts.actions?.save && !unloading) {
          await opts.actions.save(input);
        } else {
          const res = await fetch("/api/louise/save", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
            // Survive a flush fired during page-hide / unload (a normal fetch is
            // aborted mid-navigation).
            keepalive: true,
          });
          if (!res.ok) throw new Error(`save failed: ${res.status}`);
        }
      }
      // Only clear if nothing was edited mid-save; otherwise leave the map dirty
      // and let the auto-saver's re-run persist the newer value.
      if (editGen === gen) {
        dirty.clear();
        chrome.setDirty(false);
      }
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
    const gen = editGen;
    chrome.setStatus("saving");
    const changed: Record<string, unknown> = {};
    for (const [fieldKey, getter] of dirty) changed[fieldKey.split(":")[2]] = getter();
    try {
      // Normal path → the typed Action when injected; unload path → the raw
      // `keepalive` fetch (the Action client can't keepalive) (#138).
      if (opts.actions?.saveDraft && pageId !== undefined && !unloading) {
        await opts.actions.saveDraft({ id: pageId, data: changed });
      } else {
        const res = await fetch(`/api/louise/pages/${pageId}/versions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(changed),
          // Survive a flush fired during page-hide / unload.
          keepalive: true,
        });
        if (!res.ok) throw new Error(`draft failed: ${res.status}`);
      }
      // Leave dirty intact if an edit landed mid-save (auto-saver reschedules).
      if (editGen === gen) {
        dirty.clear();
        chrome.setDirty(false);
      }
      chrome.setStatus("saved");
      chrome.setHasDraft(true);
      return true;
    } catch (err) {
      console.error("[louise] save draft failed", err);
      chrome.setStatus("error");
      return false;
    }
  };

  // Realtime: force the CURRENT field values into a fresh draft before publishing.
  // Edits published over the socket are coalesced in the DO and flushed on its
  // alarm (≤10s), so at publish time the newest keystrokes may not be in a draft
  // yet — this snapshot guarantees Publish promotes the latest, not a stale draft.
  const flushRealtimeDraft = async (): Promise<boolean> => {
    const data: Record<string, unknown> = {};
    for (const [field, getter] of fieldGetters) data[field] = getter();
    chrome.setStatus("saving");
    try {
      if (opts.actions?.saveDraft && pageId !== undefined) {
        await opts.actions.saveDraft({ id: pageId, data });
      } else {
        const res = await fetch(`/api/louise/pages/${pageId}/versions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error(`draft failed: ${res.status}`);
      }
      chrome.setStatus("saved");
      return true;
    } catch (err) {
      console.error("[louise] realtime pre-publish draft failed", err);
      chrome.setStatus("error");
      return false;
    }
  };

  // Versioned: flush pending edits to a draft, then promote it to live. Reload so
  // the server re-renders the published content authoritatively.
  const publish = async () => {
    // Supersede any queued auto-save so it can't fire a draft mid-publish.
    auto?.cancel();
    // Realtime → snapshot the live values into a fresh draft; otherwise flush the
    // locally-tracked dirty fields. Either way, bail if the draft write fails.
    if (rt?.connected()) {
      if (!(await flushRealtimeDraft())) return;
    } else if (dirty.size > 0 && !(await saveDraft())) {
      return;
    }
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

  // The debounced auto-saver, wrapping this page's save (a live field save, or a
  // draft on a versioned page). Publish is never automated. The callback RETURNS
  // the save promise so the scheduler can await it (single-flight overlap guard).
  auto = createAutosave(() => (versioned ? saveDraft() : saveLive()), debounceMs);

  chrome = createChrome({
    onSave: () => {
      // Manual Save (only shown when auto-save is off) supersedes any pending
      // debounce, then saves immediately.
      auto?.cancel();
      void (versioned ? saveDraft() : saveLive());
    },
    onPublish: () => void publish(),
    onOpenSettings: opts.onOpenSettings,
    hasFields: fieldEls.length > 0,
    versioned,
    autoSave: autoSaveOn,
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

  // The collection slug all inline fields on this page share (from the marker) —
  // the realtime DO is addressed by `<slug>/<id>`.
  let collectionSlug: string | undefined;

  for (const el of fieldEls) {
    const ref = parseMarker(el);
    if (!ref) continue;
    collectionSlug ??= ref.collection;
    const fieldKey = `${ref.collection}:${ref.key}:${ref.field}`;
    el.classList.add("louise-editable");

    if (el.dataset.louiseType === "richtext") {
      // Rich fields save serialized HTML — the site stores and renders HTML
      // (no ProseMirror on the Worker), and the editor re-parses it on load.
      // stegaClean before persisting: if stega visual-editing tagged this
      // field's text, its invisible payload must never round-trip into stored
      // HTML / ProseMirror JSON (it would compound on every save). No-op when
      // stega isn't in use.
      // `data-louise-blocks` opts the field into the full builder block set
      // (rows/columns, gallery, hero, …) — so a page body can be built in place
      // on the live page, not just in Louise Settings.
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
          { blocks, grammar: opts.grammar },
        );
        fieldGetters.set(ref.field, () => stegaClean(field.getHTML()));
      } catch (err) {
        console.error(`[louise] rich-text editor failed to mount for ${fieldKey}`, err);
      }
      // Flush on tab-out. blur doesn't bubble and ProseKit's editable is a child,
      // so listen for focusout on the field container.
      if (autoSaveOn) el.addEventListener("focusout", () => auto?.flush());
      // Realtime: the rich body is soft-locked — claim it on focus so peers see
      // it as taken, release on blur. The server enforces the lock (drops a
      // non-holder change) and never broadcasts the body, so peers never receive
      // raw rich-text; onLocks (below) reflects a peer's hold read-only.
      if (realtimeOn) {
        lockEls.set(ref.field, el);
        el.addEventListener("focusin", () => rt?.claim(ref.field));
        el.addEventListener("focusout", () => rt?.release(ref.field));
      }
    } else {
      // Plain-text field: contenteditable, single line.
      el.setAttribute("contenteditable", "plaintext-only");
      el.setAttribute("spellcheck", "false");
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") e.preventDefault();
      });
      const plainGetter = () => stegaClean(el.textContent?.trim() ?? "");
      fieldGetters.set(ref.field, plainGetter);
      el.addEventListener("input", () => markDirty(fieldKey, plainGetter));
      if (autoSaveOn) el.addEventListener("blur", () => auto?.flush());
      // Realtime: apply a peer's edit to this plain-text field — unless it's
      // focused locally, where clobbering the caret would be jarring (LWW still
      // holds; the echo reconciles on the next blur).
      if (realtimeOn) {
        remoteAppliers.set(ref.field, (value) => {
          if (document.activeElement !== el) el.textContent = value == null ? "" : String(value);
        });
      }
    }
  }

  // Realtime session (ADR 0002 / #71). Versioned pages only (realtime persists as
  // drafts), and only when the page has inline fields to sync. Degradation-first:
  // if the socket can't open (no EDIT_SESSION binding → the route 503s) nothing
  // breaks — `rt.connected()` stays false and markDirty keeps using the fetch path.
  if (realtimeOn && versioned && collectionSlug && pageId !== undefined && fieldEls.length > 0) {
    // The latest peer list, so a lock holder's id can be shown as their name.
    let currentPeers: RealtimePeer[] = [];
    // Reflect a peer's held soft-locks: a lock-guarded field held by someone else
    // goes read-only with a badge; a field I hold (or that's free) is editable.
    const applyLocks = (locks: RealtimeLocks) => {
      const meId = rt?.you()?.id ?? "";
      for (const [field, el] of lockEls) {
        const holder = locks[field];
        const byName = currentPeers.find((p) => p.id === holder)?.name ?? "Someone";
        setFieldLock(el, holder && holder !== meId ? byName : null);
      }
    };
    rt = connectRealtime({
      slug: collectionSlug,
      id: pageId,
      throttleMs: realtimeThrottleMs,
      onPresence: (peers) => {
        currentPeers = peers;
        chrome.setPresence(otherPeers(peers, rt?.you()?.id));
      },
      onRemoteChange: (field, value) => remoteAppliers.get(field)?.(value),
      onLocks: applyLocks,
      onStatus: (connected) => {
        if (!connected) {
          // Socket down — clear presence + any lock UI; edits fall back to fetch.
          currentPeers = [];
          chrome.setPresence([]);
          for (const el of lockEls.values()) setFieldLock(el, null);
        }
      },
    });
    activeRealtime = rt;
  }

  // Point the shared leave/flush handlers (wired once, below) at this mount, so a
  // tab-hide, hard nav, or Astro soft nav flushes THIS page's pending edits and
  // routes them through the raw `keepalive` fetch (#138). Only when this page owns
  // inline fields with auto-save — otherwise there's nothing to flush (a sections
  // page guards its own edits in the dock).
  if (autoSaveOn && fieldEls.length > 0) {
    activeInline = {
      flush: () => auto?.flush(),
      hasDirty: () => dirty.size > 0,
      setUnloading: (leaving) => {
        unloading = leaving;
      },
    };
  }
  // Always wire the shared handlers: even a no-fields editor page needs the
  // `astro:after-swap` guard-reset so navigating to the next page re-mounts it.
  ensureLeaveHandlers();
}
