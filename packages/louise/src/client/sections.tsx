// louise-toolkit/client — structured "sections" editor: the visual block builder for
// bespoke, component-rendered pages (the Sanity-style preconfigured-blocks model).
//
// A *section* is one item of a page's `sections` JSON array — `{ _type, ...fields }`.
// The SITE owns rendering (bespoke Astro components, any design); this owns
// EDITING only, and saves the array back to `sections` (PATCH /api/louise/pages/:id).
// No HTML/markup is ever authored here, so the design stays 100% site-owned.
//
// The UX is HYBRID, and fully on-canvas (the old floating "dock" is gone, #182):
//  • TEXT is edited IN PLACE on the live bespoke render. Each editable text node
//    carries a `data-louise-sfield="<idx>.<key>[.<j>.<subKey>]"` marker; we make
//    it contenteditable and write keystrokes straight into the store. No panel,
//    no reload — you type on the real design.
//  • STRUCTURE (reorder / delete / add a node) is the on-canvas chrome — one ring
//    + toolbar over the hovered `data-louise-node`, drawn from the capabilities
//    `describeNode` resolves for its path (ADR 0010; see node-chrome.ts).
//    NON-VISIBLE fields (a button's link URL, an image, array membership, layout,
//    settings) live in the ⚙ inspector popover anchored to the node — the whole
//    section/block for a container, or just that one field for a value. Because
//    the bespoke components are server-rendered, a structural change persists then
//    reloads so the server re-renders the new shape (then inline-editable again).
//  • PAGE-LEVEL controls sit on the shared edit bar (status, History, Save,
//    Publish); Add-section is an on-canvas floating control; version History opens
//    a right-side drawer.
//
// State is a single `createStore` shared by the inline wiring and the inspector,
// so a keystroke is a fine-grained path write (`set("items", i, key, value)`) that
// updates only that leaf — no row teardown, no focus loss.

import { createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { describeNode } from "./describe-node.js";
import { createFieldOptions } from "./field-options.js";
import { mountNodeChrome } from "./node-chrome.js";
import {
  deleteNodeElement,
  insertNodeElement,
  moveNodeElement,
  replaceNodeElement,
  siblingsAt,
} from "./node-ops.js";
import { formatNodePath, NODE_MARKER_ATTR, type NodePath } from "./node.js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import { Portal, render } from "solid-js/web";
import { stegaClean } from "../core/content/stega-clean.js";
import { nameEditable, wireDialogA11y, wirePopoverDismiss } from "./a11y.js";
import { type AutoSaveOption, type Autosave, createAutosave, resolveAutoSave } from "./autosave.js";
import {
  connectRealtime,
  initials,
  otherPeers,
  type RealtimeOption,
  type RealtimePeer,
  type RealtimeSession,
  resolveRealtime,
} from "./realtime.js";
import { HISTORY_READY_ATTR, OPEN_HISTORY_EVENT, SETTINGS_READY_EVENT } from "./editor-events.js";
import { Icon } from "./icons.jsx";
import { LinkField, type PageChoice, setBuiltInRoutes } from "./link-field.jsx";
import { MediaPicker } from "./media-picker.jsx";
import { type RichTextField, mountRichText } from "./RichText.jsx";
import { injectStyles } from "./styles.js";

// The section schema types live in core (server-safe) so the same catalog object
// drives both this on-page editor and the write-time validator (louise-toolkit/content's
// validateSections). Type-only import — no server/validation code enters the
// client bundle.
import type {
  BlockCatalog,
  BlockDef,
  BlockItem,
  SectionCatalog,
  SectionDef,
  SectionField,
  SectionFieldType,
  RichTextFieldOptions,
  SectionItem,
} from "../core/content/sections.js";
export type { SectionCatalog, SectionDef, SectionField, SectionFieldType, SectionItem };

// Whether a field is edited in place is the field TYPE's business now (ADR 0010
// A2) — one answer in `field-types.ts`, where the validator reads it too. This
// module and `describe-node.ts` each carried their own copy of the same list, and
// they agreed only because they were written on the same afternoon.
import { isInlineField as isInline } from "../core/content/field-types.js";

/**
 * Rich-text editor options — an alias for the schema's {@link RichTextFieldOptions},
 * which is where these now belong (ADR 0010 A2 / #345): a field declares its own,
 * in the catalog, next to the rest of what it is.
 *
 * Kept as a name because it is the published one, and because `mountSections`
 * still accepts a site-wide default under it.
 *
 * Omit for the light-inline bubble (`{ minimal: true }`) — inline formatting only
 * (bold/italic/underline/strike/link/colour), the mode #182 designed for section
 * fields. For the full formatting bar pass `{ minimal: false, grammar: true }`:
 * `minimal: false` surfaces the prose block buttons plus the AI-rewrite sparkle,
 * and `grammar` lazy-loads Harper. `blocks` is a SEPARATE opt-in — the page
 * BUILDER palette (#16), meant for full page bodies rather than a one-line
 * heading.
 */
export type SectionRichTextOptions = RichTextFieldOptions;

export interface SectionsEditorProps {
  catalog: SectionCatalog;
  /** The block palette (ADR 0005) — enables adding blocks to a section whose
   *  `blocks` policy allows a type. Optional: omit for a sections-only site. */
  blocks?: BlockCatalog;
  /** Editor options for section `richtext` fields (headings/prose the render
   *  marks `data-louise-type="richtext"`). Defaults to the light-inline bubble;
   *  pass `{ minimal: false, grammar: true }` to opt into the full formatting bar
   *  (heading/list/quote/image buttons + grammar + AI rewrite). See
   *  {@link SectionRichTextOptions}. */
  richText?: SectionRichTextOptions;
  /**
   * Named rich-text presets a render can opt individual fields into, by stamping
   * `data-louise-rt="<name>"` next to `data-louise-type="richtext"`. Falls back to
   * {@link richText} for any field that names no mode (or an unknown one).
   *
   * `richText` alone is all-or-nothing, which breaks down as soon as one page has
   * both kinds of rich text: a site whose headings need `inline` (so editing can't
   * turn an `<h1>` into a nested `<p>`) would force that same single-line mode onto
   * a prose body, losing paragraphs and lists. Per-field modes let both coexist:
   *
   *   richText: { inline: true },                              // headings
   *   richTextModes: { prose: { minimal: false, grammar: true } }, // bodies
   */
  richTextModes?: Record<string, SectionRichTextOptions>;
  /**
   * Code-defined routes to offer in a `link` field's page picker, alongside the
   * `pages` rows it fetches (#38).
   *
   * The picker's page list comes from `/api/louise/pages`, which only knows about
   * DB-backed pages. A site's hand-authored routes — `/shop`, `/contact` — have no
   * row, so without this the picker is missing exactly the destinations most CTAs
   * point at and reads as broken. Same idea as the Settings Pages panel's
   * `builtInPages`.
   */
  builtInRoutes?: PageChoice[];
  pageId: number;
  initial: SectionItem[];
  /** Auto-save inline section edits as a draft on an idle debounce — never
   *  publishes, and structural changes keep their own save+reload. On by default;
   *  pass `false` to opt out (manual Save draft button), or `{ debounceMs }`. */
  autoSave?: AutoSaveOption;
  /** The collection slug this sections page belongs to (for the realtime DO
   *  address `<slug>/<id>`). Default `"pages"`. */
  collection?: string;
  /** Opt this sections page into a real-time session (ADR 0002 / #71) — **presence
   *  only** for now: the shared bar shows the other editors on the page. Sections
   *  persistence stays on the proven debounced-fetch draft path (a live canvas sync
   *  is a follow-up). Off by default; degrades silently when the socket can't open. */
  realtime?: RealtimeOption;
}

function humanize(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

/** Resolve when an element matching `selector` exists — checking now, then via a
 *  MutationObserver — or `null` after `timeoutMs`. The shared edit bar
 *  (`.louise-bar`) and this sections editor mount independently and in either
 *  order, so the editor can't assume the bar is already in the DOM. */
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

/** A blank value for a field: `[]` for arrays, `""` for text. */
function blankValue(field: SectionField): unknown {
  return field.type === "array" ? [] : "";
}

/**
 * The input for one non-image scalar field — text, textarea, or a closed choice.
 *
 * Shared by the inspector's field group and its settings rail, which render the
 * same three shapes against different stores (`item[key]` vs `_settings[key]`).
 * Before this they each carried their own nested `<Show>` ladder, so a new field
 * type meant editing both and a `select` would have been a third level of
 * nesting in each.
 */
function ScalarField(props: {
  field: SectionField;
  value: string;
  /** Called per keystroke (text) or per choice (select). */
  onInput: (value: string) => void;
  /** Called when the value should be persisted. */
  onCommit: () => void;
}) {
  return (
    <Show
      when={props.field.type === "select"}
      fallback={
        <Show
          when={props.field.type === "textarea"}
          fallback={
            <input
              class="louise-input"
              value={props.value}
              placeholder={props.field.placeholder}
              onInput={(e) => props.onInput(e.currentTarget.value)}
              onChange={() => props.onCommit()}
            />
          }
        >
          <textarea
            class="louise-input louise-dock-textarea"
            rows={2}
            value={props.value}
            placeholder={props.field.placeholder}
            onInput={(e) => props.onInput(e.currentTarget.value)}
            onChange={() => props.onCommit()}
          />
        </Show>
      }
    >
      <SelectField
        field={props.field}
        value={props.value}
        onInput={props.onInput}
        onCommit={props.onCommit}
      />
    </Show>
  );
}

/**
 * The `select` picker, split out because its choices may be **fetched** rather
 * than declared (ADR 0010 A2 / #344) — which gives it a loading and a failure
 * state a plain `<For>` over a literal array never had.
 *
 * The failure state is the one that earns its keep: a picker that renders empty
 * when its fetch failed looks identical to one whose source is genuinely empty,
 * and the editor has no way to tell which happened to them.
 */
function SelectField(props: {
  field: SectionField;
  value: string;
  onInput: (value: string) => void;
  onCommit: () => void;
}) {
  const choices = createFieldOptions(() => props.field.options);
  return (
    <>
      <select
        class="louise-input"
        data-display={props.field.display}
        // Disabled while fetching: the stored value isn't in the list yet, so
        // opening it now would show a picker that appears to have lost it.
        disabled={choices.loading()}
        value={props.value}
        onChange={(e) => {
          props.onInput(e.currentTarget.value);
          props.onCommit();
        }}
      >
        {/* A blank option, deliberately. Without one the first choice appears
            selected the moment the picker renders even though nothing was
            stored, and there'd be no way to clear a setting back to the
            component's own default. The validator treats "" as cleared. */}
        <option value="">{choices.loading() ? "Loading…" : "—"}</option>
        <For each={choices.options()}>
          {(option) => <option value={option.value}>{option.label ?? option.value}</option>}
        </For>
      </select>
      <Show when={choices.error()}>
        <span class="louise-field-error" role="alert">
          {choices.error()}
        </span>
      </Show>
    </>
  );
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

/**
 * The field definition a `data-louise-sfield` path addresses.
 *
 * Three shapes, which is one more than the placeholder lookup used to handle:
 *
 *   <i>.<key>                 a section's own field
 *   <i>.<key>.<j>.<subKey>    an item of one of its arrays
 *   <i>.blocks.<j>.<key>      a field on one of its blocks
 *
 * The block case was missing, so a block field's declared `placeholder` and
 * `label` were silently ignored — `fields["blocks"]` is not a field, so the
 * lookup found nothing and fell back to humanising the key. Nothing failed
 * loudly; the hint was just always the key name.
 */
function fieldAtPath(
  path: string,
  catalog: SectionCatalog,
  items: SectionItem[],
  blocks?: BlockCatalog,
): SectionField | undefined {
  const parts = path.split(".");
  const item = items[Number(parts[0])];
  if (!item) return undefined;

  if (parts[1] === "blocks") {
    const block = (Array.isArray(item.blocks) ? (item.blocks as SectionItem[]) : [])[
      Number(parts[2])
    ];
    const blockDef = block ? blocks?.[String(block._type)] : undefined;
    return parts[3] ? blockDef?.fields[parts[3]] : undefined;
  }

  const field = catalog[String(item._type)]?.fields[parts[1]];
  // Array subfield: the item's shape is the array's `itemFields`.
  if (field?.type === "array" && parts.length >= 4) return field.itemFields?.[parts[3]];
  return field;
}

/** Resolve the placeholder/label text for a marker path, for empty-field hints. */
function placeholderFor(
  catalog: SectionCatalog,
  path: string,
  items: SectionItem[],
  blocks?: BlockCatalog,
): string {
  const field = fieldAtPath(path, catalog, items, blocks);
  const last = path.split(".").at(-1);
  return field?.placeholder ?? field?.label ?? (last ? humanize(last) : "");
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
  richText?: SectionRichTextOptions,
  richTextModes?: Record<string, SectionRichTextOptions>,
  blocks?: BlockCatalog,
): void {
  /** This field's rich-text options, most specific first (ADR 0010 A2 / #345).
   *
   *  The field's own declaration wins. `richTextModes` keyed by a stamped
   *  `data-louise-rt` name is the previous mechanism, kept working: it was a
   *  rendezvous between the render and the mount to establish something the
   *  catalog already knew. Then the site-wide default, then the light inline
   *  bubble (#182).
   *
   *  An unknown mode name still falls back rather than throwing — a render
   *  stamped for a mode the mount doesn't declare should degrade to the site
   *  default, not lose its editor. */
  const richTextFor = (path: string, node: HTMLElement): SectionRichTextOptions =>
    fieldAtPath(path, catalog, items, blocks)?.richText ??
    richTextModes?.[node.dataset.louiseRt ?? ""] ??
    richText ?? { minimal: true };

  const nodes = host.querySelectorAll<HTMLElement>("[data-louise-sfield]");
  for (const node of Array.from(nodes)) {
    const path = node.dataset.louiseSfield;
    if (!path) continue;
    // Rich-text section field (#182): mount the light ProseKit editor (inline
    // formatting bubble only) instead of a plaintext contenteditable, and persist
    // the field's HTML (stega-cleaned) into the shared store. The save path
    // sanitizes it (sanitizeSectionsRichText) and the site renders it via set:html
    // — the same store/marker path, just an HTML value instead of textContent.
    if (node.dataset.louiseType === "richtext") {
      node.classList.add("louise-editable", "louise-sfield");
      let rt: RichTextField;
      rt = mountRichText(
        node,
        () => {
          set("items", ...pathToArgs(node.dataset.louiseSfield ?? path), stegaClean(rt.getHTML()));
          onEdit();
        },
        undefined,
        richTextFor(path, node),
      );
      continue;
    }
    const hint = placeholderFor(catalog, path, items, blocks);
    if (hint) node.dataset.louisePlaceholder = hint;
    node.classList.add("louise-editable", "louise-sfield");
    node.setAttribute("contenteditable", "plaintext-only");
    // Native browser spellcheck on multiline (textarea-backed, prose-y) fields
    // only; single-line headline/label fields stay off, where red squiggles are
    // just noise (#142). Rich-text prose uses ProseKit + Harper (#110) instead.
    const multiline = node.hasAttribute("data-louise-multiline");
    node.setAttribute("spellcheck", multiline ? "true" : "false");
    // Give the region a name for assistive tech — the placeholder hint is the
    // field's human label, and it's otherwise only CSS ::before content.
    nameEditable(node, hint, multiline);
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
/**
 * What the inspector popover is editing — a whole section, a block within one, or
 * a SINGLE field on either (ADR 0010, "Resolved while building A1").
 *
 * The `field` variant is what a value node's wrench opens. Pre-0010 a CTA's wrench
 * opened its owning section's entire inspector, so clicking one of four CTAs
 * surfaced a panel listing all four destinations and left you to guess which was
 * yours. A value node addresses one field, so its inspector shows one field.
 */
type InspectTarget =
  | { kind: "section"; index: number }
  | { kind: "block"; section: number; block: number }
  | { kind: "field"; section: number; block?: number; key: string };

function SectionsRoot(props: SectionsEditorProps & { host: HTMLElement }) {
  const [state, setState] = createStore<{ items: SectionItem[] }>({
    items: structuredClone(props.initial),
  });
  // Loosely-typed setter for dynamic deep paths (the SectionItem index signature
  // makes the strict overloads resolve to `never`).
  const set = setState as unknown as StoreSetter;
  const [status, setStatus] = createSignal<Status>("idle");
  const [dirty, setDirty] = createSignal(false);
  // The add-section type-picker: null when closed, else the insert index (the new
  // section takes it, pushing the clicked one down → "insert above") + the anchor
  // position. Opened from a section toolbar's `+` or the trailing add affordance.
  const [addPicker, setAddPicker] = createSignal<{
    index: number;
    top: number;
    left: number;
  } | null>(null);
  // The add-BLOCK type-picker, the block-level analogue of `addPicker`: null when
  // closed, else the owning section, the insert index within its `blocks`, and the
  // allowed types. Only opened when a section accepts more than one block type —
  // single-type sections insert without a prompt.
  const [blockPicker, setBlockPicker] = createSignal<{
    section: number;
    at: number;
    types: string[];
    top: number;
    left: number;
  } | null>(null);
  // A specific save-failure reason (e.g. a server validation violation), shown
  // in place of the generic "Couldn't save".
  const [errorDetail, setErrorDetail] = createSignal("");

  const [versions, setVersions] = createSignal<VersionRow[]>([]);
  // The id of the version that is currently LIVE (page's `published_version_id`),
  // or null if the page is unpublished. Used to flag the live row in history —
  // status alone can't, since multiple versions read "published" over time.
  const [liveVersionId, setLiveVersionId] = createSignal<number | null>(null);
  const [showHistory, setShowHistory] = createSignal(false);
  // The inspector popover (#182 Phase 4): which section/block is being inspected,
  // and where to anchor the popover (viewport coords near the selected element).
  const [inspecting, setInspecting] = createSignal<
    (InspectTarget & { top: number; left: number }) | null
  >(null);
  const hasDraft = () => versions().some((v) => v.status === "draft");

  // A leading slot injected into the shared edit bar (`.louise-bar`) that hosts
  // the status line, History button and Save-draft / Publish actions, so the page
  // shows ONE action bar. Null until the bar is found (it mounts separately); the
  // controls fall back to a fixed strip while so.
  const [barSlot, setBarSlot] = createSignal<HTMLElement | null>(null);
  // Realtime presence (ADR 0002 / #71): the other editors currently on this page.
  const [peers, setPeers] = createSignal<RealtimePeer[]>([]);

  const autoCfg = resolveAutoSave(props.autoSave);
  const realtimeCfg = resolveRealtime(props.realtime);
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

  // Open (or toggle) the version-history drawer, loading versions on the way in.
  // Shared by the fallback bar button and the Settings top-strip icon.
  const toggleHistory = (force?: boolean) => {
    const next = force ?? !showHistory();
    setShowHistory(next);
    if (next) void loadVersions();
  };

  // Whether Louise Settings is mounted, and so owns the History trigger
  // (coracle.coffee#36). Seeded from the drawer root for the Settings-mounted-first
  // order, then flipped by SETTINGS_READY_EVENT for the other one.
  const [settingsMounted, setSettingsMounted] = createSignal(false);

  onMount(() => {
    // The link picker's choices are module-level (shared by every wrench on the
    // page), so register the site's code routes once here rather than threading
    // the prop down to each field (#38).
    setBuiltInRoutes(props.builtInRoutes);

    // Advertise that there is a history drawer to open, so the Settings strip can
    // show its History icon; cleared on cleanup so the icon can't outlive us.
    document.documentElement.setAttribute(HISTORY_READY_ATTR, "");
    setSettingsMounted(!!document.getElementById("louise-drawer-root"));
    const onSettingsReady = () => setSettingsMounted(true);
    const onOpenHistory = () => toggleHistory(true);
    window.addEventListener(SETTINGS_READY_EVENT, onSettingsReady);
    window.addEventListener(OPEN_HISTORY_EVENT, onOpenHistory);
    onCleanup(() => {
      document.documentElement.removeAttribute(HISTORY_READY_ATTR);
      window.removeEventListener(SETTINGS_READY_EVENT, onSettingsReady);
      window.removeEventListener(OPEN_HISTORY_EVENT, onOpenHistory);
    });

    wireInline(
      props.host,
      props.catalog,
      state.items,
      set,
      touched,
      autoCfg.enabled ? () => auto?.flush() : undefined,
      props.richText,
      props.richTextModes,
      props.blocks,
    );
    void loadVersions();

    // Realtime presence (ADR 0002 / #71): connect to the page's edit-session DO so
    // the shared bar shows who else is editing. Presence only for now — sections
    // persistence stays on the debounced-fetch draft path below (a live canvas sync
    // is a follow-up). Degrades silently: if the socket can't open, `peers` stays
    // empty and nothing else changes. Closed on cleanup so the socket doesn't leak.
    if (realtimeCfg.enabled) {
      let rt: RealtimeSession | null = null;
      rt = connectRealtime({
        slug: props.collection ?? "pages",
        id: props.pageId,
        throttleMs: realtimeCfg.throttleMs,
        onPresence: (all) => setPeers(otherPeers(all, rt?.you()?.id)),
        onStatus: (connected) => {
          if (!connected) setPeers([]);
        },
      });
      onCleanup(() => rt?.close());
    }

    // On-canvas chrome (ADR 0010): ONE ring + toolbar over every `data-louise-node`,
    // drawing whatever the node's capabilities justify. The chrome asks a single
    // question — `resolve(path)` — and `describeNode` is the only thing here that
    // knows a section from a block from a field; every callback below takes a path
    // and dispatches on its shape rather than on a layer the chrome named.
    // Markers are stamped by the render in edit mode; on an unmarked host the
    // chrome simply finds nothing. Disposed with the editor.
    onCleanup(
      mountNodeChrome({
        resolve: (path) =>
          describeNode(path, {
            items: state.items,
            catalog: props.catalog,
            blocks: props.blocks,
          }),
        onMove: (path, delta) => moveNode(path, delta),
        onDelete: (path) => deleteNode(path),
        onAddSibling: (path) => addSibling(path),
        onAddChild: (path) => addChild(path),
        onInspect: (path) => {
          const target = inspectTargetFor(path);
          if (target) openInspector(target);
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
    // the fixed fallback strip (the `!barSlot()` branch) instead of duplicating them.
    void whenElement(".louise-bar").then((bar) => {
      if (!bar) return;
      if (bar.querySelector(".louise-savedraft, .louise-publish, .louise-bar-actions")) return;
      const slot = document.createElement("span");
      slot.className = "louise-bar-actions";
      bar.insertBefore(slot, bar.firstChild);
      setBarSlot(slot);
    });
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

  // The rendered element carrying a given node path, when it's on the page.
  const nodeEl = (path: NodePath): HTMLElement | null =>
    props.host.querySelector<HTMLElement>(`[${NODE_MARKER_ATTR}="${formatNodePath(path)}"]`);

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

  // Re-render section `i` in place through the fragment route — the single seam
  // every in-section structural change routes through (#182 Phase 3 / ADR 0005
  // §4): block add, array item add/remove, and variant swap-type. The store is
  // already mutated; this swaps the section's element for a fresh server render
  // and re-wires it. Falls back to save-and-reload when the section isn't on the
  // live rendered page (e.g. a headless dock) or the fragment can't render, so
  // the change is never lost.
  const rerenderSection = async (i: number): Promise<void> => {
    const item = state.items[i];
    const onPage = !!nodeEl([i]);
    const html = item && onPage ? await renderSectionFragment(unwrap(item) as SectionItem) : null;
    const tmp = html ? document.createElement("div") : null;
    if (tmp) tmp.innerHTML = html as string;
    // The fragment's OUTERMOST marked node is the section itself (its blocks and
    // fields are marked too, and nest inside it), so first-in-document-order is
    // the one to splice in.
    const el = tmp?.querySelector<HTMLElement>(`[${NODE_MARKER_ATTR}]`) ?? null;
    if (!el) {
      auto?.cancel();
      setStatus("saving");
      if ((await saveDraft()) !== null) location.reload();
      else setStatus("error");
      return;
    }
    replaceNodeElement([], i, el);
    wireInline(
      el,
      props.catalog,
      state.items,
      set,
      touched,
      autoCfg.enabled ? () => auto?.flush() : undefined,
      props.richText,
      props.richTextModes,
      props.blocks,
    );
    touched();
  };

  // Apply an in-section structural mutation, then re-render that section in place.
  // Replaces the old `structural()` (save-and-reload) for array/variant/block ops.
  const restructureSection = (i: number, mutate: () => void): void => {
    mutate();
    void rerenderSection(i);
  };

  // Add is INSTANT (#182 Phase 3 / ADR 0005 §4): optimistically splice the item
  // into the store, fetch its server-rendered fragment, insert + re-stamp it in
  // place (no reload), wire its inline fields, then stage a draft via autosave.
  // Falls back to the save-and-reload path if the fragment can't be rendered, so
  // the item is never lost.
  const addSection = async (type: string, atIndex = state.items.length) => {
    const def = props.catalog[type];
    if (!def) return;
    setAddPicker(null);
    const item = { _type: type, ...blankRecord(def.fields) } as SectionItem;
    // Insert at `atIndex` — a section's `+` passes its own index, so the new
    // section takes it and pushes the clicked one down ("insert above"); the
    // trailing add appends.
    const index = Math.max(0, Math.min(atIndex, state.items.length));
    set("items", (a: SectionItem[]) => {
      const next = a.slice();
      next.splice(index, 0, item);
      return next;
    });

    const html = await renderSectionFragment(item);
    const tmp = html ? document.createElement("div") : null;
    if (tmp) tmp.innerHTML = html as string;
    const el = tmp?.querySelector<HTMLElement>(`[${NODE_MARKER_ATTR}]`) ?? null;
    if (!el) {
      // Fragment unavailable → persist the (already-mutated) store and reload so
      // the server re-renders the new shape from the draft.
      auto?.cancel();
      setStatus("saving");
      if ((await saveDraft()) !== null) location.reload();
      else setStatus("error");
      return;
    }
    insertNodeElement(el, [], index, props.host);
    wireInline(
      el,
      props.catalog,
      state.items,
      set,
      touched,
      autoCfg.enabled ? () => auto?.flush() : undefined,
      props.richText,
      props.richTextModes,
      props.blocks,
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
    deleteNodeElement([], i);
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
    moveNodeElement([], i, j);
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
    deleteNodeElement([section, "blocks"], block);
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
    moveNodeElement([section, "blocks"], block, to);
    touched();
  };
  // The block types a section accepts, in catalog order: bounded by the section's
  // `blocks.allow` when declared, otherwise the whole block catalog (ADR 0005 §4 —
  // `allow` omitted means "any block type"). Types with no catalog entry are
  // dropped: without a field shape there is no blank to seed.
  const allowedBlockTypes = (section: number): string[] => {
    const policy = props.catalog[state.items[section]?._type ?? ""]?.blocks;
    if (!policy || !props.blocks) return [];
    const blocks = props.blocks;
    return Object.keys(blocks).filter((t) => !policy.allow || policy.allow.includes(t));
  };

  // Block add (#182 Phase 3 / ADR 0005 §4): insert a blank block of `type` at
  // `at`, re-render the WHOLE section through the fragment route (blocks render
  // inside their section's bespoke component, not standalone), swap the section
  // element in place, re-stamp + re-wire, then autosave.
  const insertBlock = (section: number, at: number, type: string) => {
    const def = props.blocks?.[type];
    if (!def) return; // unknown block type → no-op
    setBlockPicker(null);
    restructureSection(section, () =>
      set("items", section, "blocks", (b: unknown) => {
        const next = (Array.isArray(b) ? b : []).slice();
        next.splice(at, 0, { _type: type, ...blankRecord(def.fields) });
        return next;
      }),
    );
  };

  // Insert a block into `section` at `at`, anchoring the type-picker under
  // `anchor`'s rendered element. One allowed type inserts straight away; several
  // open the picker, mirroring the section add-picker one level down.
  const openBlockPicker = (section: number, at: number, anchor: NodePath) => {
    const types = allowedBlockTypes(section);
    if (types.length === 0) return; // nothing insertable → no-op
    if (types.length === 1) {
      insertBlock(section, at, types[0]);
      return;
    }
    const box = nodeEl(anchor)?.getBoundingClientRect();
    const top = box
      ? Math.min(Math.max(box.bottom + 8, 8), window.innerHeight - 320)
      : Math.max(80, Math.round(window.innerHeight / 2 - 160));
    const left = box
      ? Math.min(Math.max(box.left + 8, 8), window.innerWidth - 240)
      : Math.round(window.innerWidth / 2 - 120);
    setBlockPicker({ section, at, types, top, left });
  };

  // The block toolbar's `+` — insert AFTER the hovered block, since blocks read as
  // a list you extend downward (unlike the section `+`, which inserts above).
  const addBlock = (section: number, block: number) =>
    openBlockPicker(section, block + 1, [section, "blocks", block]);

  // ── Path dispatch (ADR 0010) ───────────────────────────────────────────────
  // The chrome hands back a path and nothing else, so these are the only place
  // that turns one into an operation. Each recognises the two shapes that can be
  // `ordered` today — `[i]` and `[i, "blocks", j]` — and ignores anything else,
  // so a value node's path can reach here harmlessly.
  const asSection = (path: NodePath): number | null =>
    path.length === 1 && typeof path[0] === "number" ? path[0] : null;
  const asBlock = (path: NodePath): [number, number] | null =>
    path.length === 3 &&
    typeof path[0] === "number" &&
    path[1] === "blocks" &&
    typeof path[2] === "number"
      ? [path[0], path[2]]
      : null;

  const moveNode = (path: NodePath, delta: -1 | 1) => {
    const i = asSection(path);
    if (i !== null) return moveSection(i, delta);
    const b = asBlock(path);
    if (b) moveBlock(b[0], b[1], delta);
  };
  const deleteNode = (path: NodePath) => {
    const i = asSection(path);
    if (i !== null) return removeSection(i);
    const b = asBlock(path);
    if (b) removeBlock(b[0], b[1]);
  };
  const addSibling = (path: NodePath) => {
    const i = asSection(path);
    // A section's `+` inserts ABOVE it (the new section takes its index).
    if (i !== null) return openAddPicker(i);
    const b = asBlock(path);
    if (b && props.blocks) addBlock(b[0], b[1]);
  };
  // The "add the first child" affordance (ADR 0010): a container with `children`
  // and none of them. Only sections hold blocks today, so this is the block-layer
  // entry point that did NOT exist pre-0010 — a freshly added block-capable
  // section had no child to hover and so no `+` anywhere on it.
  const addChild = (path: NodePath) => {
    const i = asSection(path);
    if (i !== null && props.blocks) openBlockPicker(i, 0, path);
  };
  /** Which inspector a node's wrench opens. A leaf key scopes to that one field. */
  const inspectTargetFor = (path: NodePath): InspectTarget | null => {
    const i = asSection(path);
    if (i !== null) return { kind: "section", index: i };
    const b = asBlock(path);
    if (b) return { kind: "block", section: b[0], block: b[1] };
    const [head, ...rest] = path;
    if (typeof head !== "number") return null;
    // [i, key] — a field on the section.
    if (rest.length === 1 && typeof rest[0] === "string") {
      return { kind: "field", section: head, key: rest[0] };
    }
    // [i, "blocks", j, key] — a field on one of its blocks.
    if (
      rest.length === 3 &&
      rest[0] === "blocks" &&
      typeof rest[1] === "number" &&
      typeof rest[2] === "string"
    ) {
      return { kind: "field", section: head, block: rest[1], key: rest[2] };
    }
    return null;
  };

  // ── Inspector popover (#182 Phase 4 / ADR 0005 §5) ─────────────────────────
  // Edit a section's `_layout` + `_settings` (or a block's `_settings`) contextually.
  // A layout/settings change alters the render, so it re-renders the section via
  // the fragment route (the same seam as block add / swap-type).
  const inspectSection = (t: InspectTarget) => (t.kind === "section" ? t.index : t.section);
  /** The block index within that section, or `undefined` for a section-level
   *  target. A `field` target inherits its OWNER's position — a CTA's destination
   *  is stored on the block that renders it, not on the link. */
  const inspectBlock = (t: InspectTarget): number | undefined =>
    t.kind === "section" ? undefined : t.block;
  const inspectItem = (t: InspectTarget): (SectionItem & BlockItem) | undefined => {
    const section = state.items[inspectSection(t)];
    const block = inspectBlock(t);
    return (block === undefined ? section : section?.blocks?.[block]) as
      | (SectionItem & BlockItem)
      | undefined;
  };
  const inspectDef = (t: InspectTarget): SectionDef | BlockDef | undefined => {
    const type = inspectItem(t)?._type ?? "";
    return inspectBlock(t) === undefined ? props.catalog[type] : props.blocks?.[type];
  };
  /** The node path a target addresses — what the popover anchors to. A field
   *  target anchors to the FIELD's own element, so a CTA's panel opens beside
   *  that CTA rather than beside the section around it. */
  const inspectPath = (t: InspectTarget): NodePath => {
    const block = inspectBlock(t);
    const owner: NodePath =
      block === undefined ? [inspectSection(t)] : [inspectSection(t), "blocks", block];
    return t.kind === "field" ? [...owner, t.key] : owner;
  };

  const openInspector = (t: InspectTarget) => {
    const box = nodeEl(inspectPath(t))?.getBoundingClientRect();
    const top = box ? Math.min(Math.max(box.top + 8, 8), window.innerHeight - 340) : 80;
    const left = box ? Math.min(Math.max(box.right + 8, 8), window.innerWidth - 300) : 80;
    setInspecting({ ...t, top, left });
  };
  const closeInspector = () => setInspecting(null);

  // Open the add-section type-picker for inserting at `index`. Anchored to the
  // section at that index (its `+`); for the trailing add (index === count) it
  // anchors below the last section, and centres on an empty page.
  const openAddPicker = (index: number) => {
    // The rendered sections are the depth-1 nodes — NOT every marked node, which
    // now includes blocks and fields.
    const sections = siblingsAt([], props.host);
    const count = sections.length;
    const anchorEl = count === 0 ? null : sections[Math.min(index, count - 1)];
    const box = anchorEl?.getBoundingClientRect();
    const atEnd = index >= count;
    const top = box
      ? Math.min(Math.max((atEnd ? box.bottom : box.top) + 8, 8), window.innerHeight - 320)
      : Math.max(80, Math.round(window.innerHeight / 2 - 160));
    const left = box
      ? Math.min(Math.max(box.left + 8, 8), window.innerWidth - 240)
      : Math.round(window.innerWidth / 2 - 120);
    setAddPicker({ index, top, left });
  };

  const setLayout = (index: number, layout: string) => {
    set("items", index, "_layout", layout);
    void rerenderSection(index);
  };
  const setSetting = (t: InspectTarget, key: string, value: unknown) => {
    const merge = (s: unknown) => ({
      ...(s && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, unknown>) : {}),
      [key]: value,
    });
    const block = inspectBlock(t);
    if (block === undefined) set("items", inspectSection(t), "_settings", merge);
    else set("items", inspectSection(t), "blocks", block, "_settings", merge);
    touched();
  };
  // Re-render the section (settings/layout affect the bespoke render) once the
  // value is committed — on `change`/blur, not every keystroke.
  const commitSetting = (t: InspectTarget) => void rerenderSection(inspectSection(t));
  // Write a top-level field value — the non-inline "dock" fields (a link URL, an
  // image, a token), now edited in the inspector (#182) rather than the dock.
  const setField = (t: InspectTarget, key: string, value: unknown) => {
    const block = inspectBlock(t);
    if (block === undefined) set("items", inspectSection(t), key, value);
    else set("items", inspectSection(t), "blocks", block, key, value);
    touched();
  };
  const commitField = (t: InspectTarget) => void rerenderSection(inspectSection(t));
  // Write one field of an array item — for `inline: false` arrays (marquee words,
  // contact-form topics) whose text has no on-page node, so it's typed here in the
  // inspector rather than on the canvas.
  const setItemField = (i: number, key: string, k: number, itemKey: string, value: unknown) => {
    set("items", i, key, k, itemKey, value);
    touched();
  };
  const addItem = (i: number, key: string, itemFields: Record<string, SectionField>) =>
    restructureSection(i, () =>
      set("items", i, key, (arr: unknown) => [
        ...(Array.isArray(arr) ? arr : []),
        blankRecord(itemFields),
      ]),
    );
  const removeItem = (i: number, key: string, k: number) =>
    restructureSection(i, () =>
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
    restructureSection(i, () =>
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
    restructureSection(i, () => {
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

  // The page's primary save actions — Save draft (green) and Publish (yellow) —
  // rendered onto the shared edit bar (or a fixed fallback strip). A component so
  // the same markup mounts in either place.
  // With auto-save on, the manual Save draft button is dropped — edits stage a
  // draft on a debounce (flushed on navigation), so the routine saved/unsaved
  // status is just noise and is omitted; only a *failed* save surfaces (below).
  // Publish is never automated, so it stays.
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

  // Everything the removed dock's header/footer owned, now on the shared edit bar:
  // a History button (opens the version-history drawer) and the Save/Publish
  // actions. Auto-save makes the routine saved/unsaved status redundant, so the
  // only status shown is an error — a failed save must never be silent, and the
  // Publish button doesn't surface it. Mounts into the bar slot, or a fixed strip.
  const BarControls = () => (
    <>
      {/* Realtime presence — the other editors on this page (empty strip hides). */}
      <Show when={peers().length > 0}>
        <span class="louise-presence" aria-live="polite">
          <For each={peers()}>
            {(peer) => (
              <span class="louise-avatar" title={`${peer.name} is editing`}>
                {initials(peer.name)}
              </span>
            )}
          </For>
        </span>
      </Show>
      <Show when={status() === "error"}>
        <span class="louise-sections-status" data-status="error" title={errorDetail()}>
          {errorDetail() || "Couldn’t save"}
        </span>
      </Show>
      {/* History moved into the Settings drawer's top strip (coracle.coffee#36) —
          the drawer itself stays here, only the trigger moved. This button is the
          fallback for hosts that mount sections WITHOUT mountSettings, which would
          otherwise have no way to reach version history at all. */}
      <Show when={!settingsMounted()}>
        <button
          class="louise-bar-history"
          type="button"
          title="Version history"
          onClick={() => toggleHistory()}
        >
          <Icon name="history" /> History
        </button>
      </Show>
      <SaveActions />
    </>
  );

  return (
    <>
      {/* Bar controls: status + History + Save/Publish, relocated onto the shared
          edit bar (#182 — the floating "Page sections" dock is gone). Falls back
          to a fixed strip when the page has no edit bar (e.g. a standalone
          harness / test host). */}
      <Show
        when={barSlot()}
        fallback={
          <div class="louise-sections-barfallback" data-theme="louise">
            <BarControls />
          </div>
        }
      >
        <Portal mount={barSlot()!}>
          <BarControls />
        </Portal>
      </Show>

      {/* Add-section type-picker — a Portal anchored to the section's `+` (insert
          above) or to the trailing add. Dismisses on outside-press / Escape. The
          old floating dock button is gone (drawer-last-resort). */}
      <Show when={addPicker()}>
        <Portal>
          <div
            class="louise-sections-palette"
            role="group"
            aria-label="Add a section"
            style={{
              position: "fixed",
              top: `${addPicker()?.top}px`,
              left: `${addPicker()?.left}px`,
              "z-index": "2147483000",
            }}
            ref={(el) => onCleanup(wirePopoverDismiss(el, { onClose: () => setAddPicker(null) }))}
          >
            <For each={Object.entries(props.catalog)}>
              {([type, def]) => (
                <button
                  class="louise-slash-item"
                  type="button"
                  onClick={() => addSection(type, addPicker()?.index)}
                >
                  {def.label}
                </button>
              )}
            </For>
          </div>
        </Portal>
      </Show>

      {/* Add-BLOCK type-picker — the same palette one level down, anchored under
          the block whose `+` opened it. Only rendered for sections that accept
          more than one block type; single-type sections insert with no prompt. */}
      <Show when={blockPicker()}>
        {(picker) => (
          <Portal>
            <div
              class="louise-sections-palette"
              role="group"
              aria-label="Add a block"
              style={{
                position: "fixed",
                top: `${picker().top}px`,
                left: `${picker().left}px`,
                "z-index": "2147483000",
              }}
              ref={(el) =>
                onCleanup(wirePopoverDismiss(el, { onClose: () => setBlockPicker(null) }))
              }
            >
              <For each={picker().types}>
                {(type) => (
                  <button
                    class="louise-slash-item"
                    type="button"
                    onClick={() => insertBlock(picker().section, picker().at, type)}
                  >
                    {props.blocks?.[type]?.label ?? type}
                  </button>
                )}
              </For>
            </div>
          </Portal>
        )}
      </Show>

      {/* Trailing add: append a section at the end, in-flow (not the old floating
          dock). On an empty page it's the single centred "+" placeholder. */}
      <div
        class="louise-sections-add"
        classList={{ "louise-sections-add--empty": state.items.length === 0 }}
        data-theme="louise"
      >
        <button
          class="louise-btn louise-btn-block"
          type="button"
          aria-haspopup="true"
          onClick={() => openAddPicker(state.items.length)}
        >
          <Icon name="plus" /> {state.items.length === 0 ? "Add your first section" : "Add section"}
        </button>
      </div>

      {/* Version-history drawer — opened from the bar's History button. A right-side
          drawer (the Louise drawer visual family) replaces the removed dock's inline
          list. The sections surface mounts independently of mountLouise's settings
          shell, so this is a dedicated history drawer rather than a tab within it. */}
      <Show when={showHistory()}>
        <Portal>
          <div
            class="louise-drawer-scrim"
            onClick={() => setShowHistory(false)}
            aria-hidden="true"
          />
          <aside
            class="louise-drawer louise-history-drawer"
            data-theme="louise"
            role="dialog"
            aria-modal="true"
            aria-label="Version history"
            ref={(el) => onCleanup(wireDialogA11y(el, { onClose: () => setShowHistory(false) }))}
          >
            <div class="louise-drawer-head">
              <span class="louise-drawer-brand">Version history</span>
              <button
                type="button"
                class="louise-drawer-close"
                aria-label="Close"
                onClick={() => setShowHistory(false)}
              >
                <Icon name="x" />
              </button>
            </div>
            <div class="louise-drawer-body">
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
            </div>
          </aside>
        </Portal>
      </Show>

      {/* Inspector popover (#182 Phase 4 / ADR 0005 §5): layout picker + settings
          for the selected section/block, anchored near it. A scrim behind it
          closes on outside click. Changes re-render the section (fragment route). */}
      <Show when={inspecting()}>
        {(insp) => {
          const target = insp();
          const sectionDef = () => inspectDef(target) as SectionDef | undefined;
          // A field target scopes to the ONE field it addresses (ADR 0010): no
          // layouts, no settings, and none of its owner's other fields — those all
          // belong to the owner's own wrench.
          const settings = () =>
            target.kind === "field" ? {} : (inspectDef(target)?.settings ?? {});
          const layouts = () => (target.kind === "section" ? sectionDef()?.layouts : undefined);
          const hasSettings = () => Object.keys(settings()).length > 0;
          // The non-inline "dock" fields (link URL, image, token) — edited here in
          // the inspector (#182) instead of the floating dock. Inline text/rich-text
          // fields are edited on the page; arrays stay their own membership UI.
          const editFields = (): [string, SectionField][] => {
            const fields = inspectDef(target)?.fields ?? {};
            if (target.kind === "field") {
              const field = fields[target.key];
              return field ? [[target.key, field]] : [];
            }
            return Object.entries(fields).filter(([, f]) => f.type !== "array" && !isInline(f));
          };
          // Array membership (add/remove items, variant switch) — a section-level
          // field, edited here too so the dock isn't needed. `si` is the section
          // index the array handlers take.
          const arrayEditFields = () =>
            target.kind === "section"
              ? Object.entries(inspectDef(target)?.fields ?? {}).filter(
                  ([, f]) => f.type === "array",
                )
              : [];
          const si = () => inspectSection(target);
          // A scoped panel is titled by its field; everything else by its type.
          const title = () =>
            target.kind === "field"
              ? (inspectDef(target)?.fields?.[target.key]?.label ?? humanize(target.key))
              : (inspectDef(target)?.label ?? inspectItem(target)?._type);
          return (
            <Portal>
              <div class="louise-inspector-scrim" onClick={closeInspector} aria-hidden="true" />
              <div
                class="louise-inspector"
                role="dialog"
                aria-modal="true"
                aria-labelledby="louise-inspector-title"
                style={{ top: `${insp().top}px`, left: `${insp().left}px` }}
                ref={(el) => onCleanup(wireDialogA11y(el, { onClose: closeInspector }))}
              >
                <div class="louise-inspector-head">
                  <span class="louise-inspector-title" id="louise-inspector-title">
                    {title()}
                  </span>
                  <button
                    type="button"
                    class="louise-inspector-close"
                    aria-label="Close"
                    onClick={closeInspector}
                  >
                    <Icon name="x" />
                  </button>
                </div>

                {/* Field editing (#182): the section/block's non-inline fields —
                    formerly the floating dock's form — now live in the gear. */}
                <Show when={editFields().length > 0}>
                  <div class="louise-inspector-group">
                    <For each={editFields()}>
                      {([key, field]) => (
                        <Switch
                          fallback={
                            <label class="louise-field">
                              <span class="louise-field-label">{field.label ?? humanize(key)}</span>
                              <ScalarField
                                field={field}
                                value={String(inspectItem(target)?.[key] ?? "")}
                                onInput={(v) => setField(target, key, v)}
                                onCommit={() => commitField(target)}
                              />
                            </label>
                          }
                        >
                          <Match when={field.type === "image"}>
                            <ImageDockField
                              label={field.label ?? humanize(key)}
                              value={String(inspectItem(target)?.[key] ?? "")}
                              onSet={(url) => {
                                setField(target, key, url);
                                commitField(target);
                              }}
                            />
                          </Match>
                          {/* Destination (#38): a page picker + free URL, rather
                              than the bare text input an href used to get. Commits
                              on change (not per keystroke) — commitField re-renders
                              the section through the fragment route. */}
                          <Match when={field.type === "link"}>
                            <div class="louise-field">
                              <span class="louise-field-label">{field.label ?? humanize(key)}</span>
                              <LinkField
                                href={String(inspectItem(target)?.[key] ?? "")}
                                ariaLabel={field.label ?? humanize(key)}
                                onChange={(href) => {
                                  setField(target, key, href);
                                  commitField(target);
                                }}
                              />
                            </div>
                          </Match>
                          {/* Toggle (#38): a real boolean, so "open in new tab"
                              stores true/false rather than a yes/no string that
                              would read truthy either way in the site render. */}
                          <Match when={field.type === "toggle"}>
                            <label class="louise-field louise-field-inline">
                              <input
                                type="checkbox"
                                checked={inspectItem(target)?.[key] === true}
                                onChange={(e) => {
                                  setField(target, key, e.currentTarget.checked);
                                  commitField(target);
                                }}
                              />
                              <span class="louise-field-label">{field.label ?? humanize(key)}</span>
                            </label>
                          </Match>
                        </Switch>
                      )}
                    </For>
                  </div>
                </Show>

                {/* Array membership (add/remove/switch items) — the item text is
                    edited on the page; this manages the list. */}
                <Show when={arrayEditFields().length > 0}>
                  <div class="louise-inspector-group">
                    <For each={arrayEditFields()}>
                      {([key, field]) => (
                        <div class="louise-arr">
                          <span class="louise-field-label">{field.label ?? humanize(key)}</span>
                          <For
                            each={(inspectItem(target)?.[key] as Record<string, unknown>[]) ?? []}
                          >
                            {(arrItem, k) => (
                              <div class="louise-arr-row">
                                <Show
                                  when={field.discriminator}
                                  fallback={
                                    <Show
                                      when={field.inline === false}
                                      fallback={
                                        <span>
                                          {field.itemLabel ?? "Item"} {k() + 1}
                                        </span>
                                      }
                                    >
                                      {/* `inline: false` array (marquee words, topics):
                                          the item text has no on-page node, so type it
                                          here. One input per scalar itemField. */}
                                      <For
                                        each={Object.entries(field.itemFields ?? {}).filter(
                                          ([, f]) =>
                                            f.type === "text" ||
                                            f.type === "textarea" ||
                                            f.type === "select",
                                        )}
                                      >
                                        {([ik, ifield]) => (
                                          <ScalarField
                                            field={ifield}
                                            value={String(
                                              (arrItem as Record<string, unknown>)[ik] ?? "",
                                            )}
                                            onInput={(v) => setItemField(si(), key, k(), ik, v)}
                                            onCommit={() => commitField(target)}
                                          />
                                        )}
                                      </For>
                                    </Show>
                                  }
                                >
                                  <select
                                    class="louise-variant-switch"
                                    title="Block type"
                                    value={variantOf(field, arrItem)}
                                    onChange={(e) =>
                                      switchVariant(si(), key, k(), field, e.currentTarget.value)
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
                                  onClick={() => removeItem(si(), key, k())}
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
                                onClick={() => addItem(si(), key, field.itemFields ?? {})}
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
                                    onClick={() => addVariantItem(si(), key, field, v)}
                                  >
                                    <Show
                                      when={variantIcon(field, v)}
                                      fallback={<Icon name="plus" />}
                                    >
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
                </Show>

                <Show when={layouts()}>
                  <div class="louise-inspector-group">
                    <span class="louise-field-label">Layout</span>
                    <div class="louise-inspector-layouts">
                      <For each={Object.entries(layouts() ?? {})}>
                        {([lk, l]) => (
                          <button
                            type="button"
                            class="louise-btn louise-btn-xs"
                            classList={{
                              "louise-inspector-active": inspectItem(target)?._layout === lk,
                            }}
                            onClick={() => target.kind === "section" && setLayout(target.index, lk)}
                          >
                            {l.label}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                <Show when={hasSettings()}>
                  <div class="louise-inspector-group">
                    <For each={Object.entries(settings())}>
                      {([sk, field]) => (
                        <label class="louise-field">
                          <span class="louise-field-label">{field.label ?? humanize(sk)}</span>
                          <ScalarField
                            field={field}
                            value={String(inspectItem(target)?._settings?.[sk] ?? "")}
                            onInput={(v) => setSetting(target, sk, v)}
                            onCommit={() => commitSetting(target)}
                          />
                        </label>
                      )}
                    </For>
                  </div>
                </Show>

                <Show
                  when={
                    editFields().length === 0 &&
                    arrayEditFields().length === 0 &&
                    !layouts() &&
                    !hasSettings()
                  }
                >
                  <p class="louise-inspector-empty">Nothing to configure here yet.</p>
                </Show>
              </div>
            </Portal>
          );
        }}
      </Show>
    </>
  );
}

/**
 * Vanilla-DOM adapter: enable in-place editing over `el` (the server-rendered
 * bespoke sections) and mount the on-canvas editing chrome, in edit mode. The
 * bespoke render is left in place — only made editable. Returns the disposer.
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
