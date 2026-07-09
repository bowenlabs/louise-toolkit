// louisecms/client — structured "sections" editor: the visual block builder for
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

import { createSignal, For, onMount, Show } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { render } from "solid-js/web";
import { Icon } from "./icons.jsx";
import { injectStyles } from "./styles.js";

// The section schema types live in core (server-safe) so the same catalog object
// drives both this on-page editor and the write-time validator (louisecms/cms's
// validateSections). Type-only import — no server/validation code enters the
// client bundle.
import type {
  SectionCatalog,
  SectionDef,
  SectionField,
  SectionFieldType,
  SectionItem,
} from "../core/cms/sections.js";
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
}

function humanize(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
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
type Status = "idle" | "saving" | "saved" | "error";

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
): void {
  const nodes = host.querySelectorAll<HTMLElement>("[data-louise-sfield]");
  for (const node of Array.from(nodes)) {
    const path = node.dataset.louiseSfield;
    if (!path) continue;
    const hint = placeholderFor(catalog, path, items);
    if (hint) node.dataset.louisePlaceholder = hint;
    node.classList.add("louise-editable", "louise-sfield");
    node.setAttribute("contenteditable", "plaintext-only");
    node.setAttribute("spellcheck", "false");
    // Single-line fields swallow Enter; multiline (textarea-backed) keeps it.
    if (!node.hasAttribute("data-louise-multiline")) {
      node.addEventListener("keydown", (e) => {
        if (e.key === "Enter") e.preventDefault();
      });
    }
    node.addEventListener("input", () => {
      set("items", ...pathToArgs(path), node.textContent ?? "");
      onEdit();
    });
  }
}

/**
 * Dock control for an `image` section field (e.g. a hero logo): a preview plus
 * upload / clear. Uploads POST to the site's media route (`/api/louise/media`)
 * and set the field to the returned URL. `onSet` routes through the persist +
 * reload path, so the new image shows on the bespoke render immediately.
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

  const touched = () => {
    setDirty(true);
    if (status() !== "idle") setStatus("idle");
  };

  onMount(() => wireInline(props.host, props.catalog, state.items, set, touched));

  const persist = async (): Promise<boolean> => {
    setErrorDetail("");
    try {
      const res = await fetch(`/api/louise/pages/${props.pageId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sections: unwrap(state.items) }),
      });
      if (!res.ok) {
        // A 422 from the pages route carries per-field validation violations.
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          violations?: { message: string }[];
        } | null;
        const detail = body?.violations?.[0]?.message ?? body?.error;
        if (detail) setErrorDetail(detail);
        throw new Error(`save failed: ${res.status}`);
      }
      return true;
    } catch (err) {
      console.error("[louise] sections save failed", err);
      return false;
    }
  };

  // Text/field save: persist in place, no reload (the DOM already shows it).
  const save = async () => {
    setStatus("saving");
    if (await persist()) {
      setDirty(false);
      setStatus("saved");
    } else {
      setStatus("error");
    }
  };

  // Structural change: mutate, persist (also flushing any pending text edits),
  // then reload so the server re-renders the new shape as bespoke, inline-ready.
  const structural = async (mutate: () => void) => {
    mutate();
    setStatus("saving");
    if (await persist()) location.reload();
    else setStatus("error");
  };

  const addSection = (type: string) => {
    const def = props.catalog[type];
    if (!def) return;
    setAdding(false);
    void structural(() =>
      set("items", (a: SectionItem[]) => [...a, { _type: type, ...blankRecord(def.fields) }]),
    );
  };
  const removeSection = (i: number) =>
    void structural(() => set("items", (a: SectionItem[]) => a.filter((_, idx) => idx !== i)));
  const moveSection = (i: number, delta: number) =>
    void structural(() =>
      set("items", (a: SectionItem[]) => {
        const j = i + delta;
        if (j < 0 || j >= a.length) return a;
        const next = a.slice();
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      }),
    );
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

  /** Fields edited in the dock (not visible text you can point at). */
  const dockFields = (item: SectionItem): [string, SectionField][] =>
    Object.entries(props.catalog[item._type]?.fields ?? {}).filter(
      ([, f]) => f.type !== "array" && !isInline(f),
    );
  const arrayFields = (item: SectionItem): [string, SectionField][] =>
    Object.entries(props.catalog[item._type]?.fields ?? {}).filter(([, f]) => f.type === "array");

  return (
    <div
      class="louise-sections-dock"
      data-theme="louise"
      data-collapsed={collapsed() ? "1" : undefined}
    >
      <div class="louise-sections-head">
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
              ? "Saved"
              : status() === "error"
                ? errorDetail() || "Couldn’t save"
                : dirty()
                  ? "Unsaved"
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
                          <input
                            class="louise-input"
                            value={String(item[key] ?? "")}
                            placeholder={field.placeholder}
                            onInput={(e) => {
                              set("items", i(), key, e.currentTarget.value);
                              touched();
                            }}
                          />
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

                {/* Array membership — the text of each item is edited in place. */}
                <For each={arrayFields(item)}>
                  {([key, field]) => (
                    <div class="louise-arr">
                      <span class="louise-field-label">{field.label ?? humanize(key)}</span>
                      <For each={(item[key] as unknown[]) ?? []}>
                        {(_, k) => (
                          <div class="louise-arr-row">
                            <span>
                              {field.itemLabel ?? "Item"} {k() + 1}
                            </span>
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
                      <button
                        class="louise-btn louise-btn-xs"
                        type="button"
                        onClick={() => addItem(i(), key, field.itemFields ?? {})}
                      >
                        <Icon name="plus" /> {field.itemLabel ?? "item"}
                      </button>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>

          <div class="louise-form-actions">
            <button
              class="louise-btn louise-btn-primary"
              type="button"
              disabled={status() === "saving" || !dirty()}
              onClick={() => void save()}
            >
              {status() === "saving" ? "Saving…" : "Save"}
            </button>
            <div class="louise-sections-add">
              <button class="louise-btn" type="button" onClick={() => setAdding((v) => !v)}>
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
          </div>
        </div>
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
