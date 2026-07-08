// louisecms/client — structured "sections" editor: the visual block builder for
// bespoke, component-rendered pages (the Sanity-style preconfigured-blocks model).
//
// A *section* is one item of a page's `sections` JSON array — `{ _type, ...fields }`.
// The SITE owns rendering (bespoke Astro components, any design); this owns
// EDITING only — a per-section field form plus add/reorder/remove — and saves the
// array back to the page's `sections` column (PATCH /api/louise/pages/:id). No
// HTML/markup is ever authored here, so the design stays 100% site-owned.
//
// State is a `createStore` (not a signal of a new array): field edits are
// fine-grained path writes (`setState("items", i, key, value)`), so a keystroke
// updates only that leaf. Using a signal + object-replacement would give each
// row a new reference and make `<For>` tear down and rebuild the card's DOM on
// every keystroke — dropping focus and shifting the page. The store avoids that.
//
// Fields are a deliberately small subset for the first slice (text/textarea +
// a repeatable `array`); this converges onto the full cms `FieldConfig` later.

import { createSignal, For, Show } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { render } from "solid-js/web";
import { injectStyles } from "./styles.js";

export type SectionFieldType = "text" | "textarea" | "array";

export interface SectionField {
  type: SectionFieldType;
  label?: string;
  placeholder?: string;
  /** `array` only — label for each repeated item (e.g. "Feature"). */
  itemLabel?: string;
  /** `array` only — the fields of each repeated item. */
  itemFields?: Record<string, SectionField>;
}

export interface SectionDef {
  /** Palette label. */
  label: string;
  /** Optional palette icon (opaque string passed through). */
  icon?: string;
  /** The section's editable fields, keyed by prop name. */
  fields: Record<string, SectionField>;
}

/** The site's catalog of preconfigured section types (schema only — the bespoke
 *  render components live on the site). */
export type SectionCatalog = Record<string, SectionDef>;

/** One stored section: a `_type` discriminant plus its field values. */
export interface SectionItem {
  _type: string;
  [key: string]: unknown;
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

export function SectionsEditor(props: SectionsEditorProps) {
  // Deep-clone the initial data into a store so edits are fine-grained.
  const [state, setState] = createStore<{ items: SectionItem[] }>({
    items: structuredClone(props.initial),
  });
  // Loosely-typed setter for dynamic deep paths (the SectionItem index signature
  // makes the strict overloads resolve to `never`).
  const set = setState as unknown as (...args: unknown[]) => void;
  const [status, setStatus] = createSignal<"idle" | "saving" | "saved" | "error">("idle");
  const [adding, setAdding] = createSignal(false);

  const touched = () => {
    if (status() !== "idle") setStatus("idle");
  };

  const addSection = (type: string) => {
    const def = props.catalog[type];
    if (!def) return;
    set("items", (a: SectionItem[]) => [...a, { _type: type, ...blankRecord(def.fields) }]);
    setAdding(false);
    touched();
  };
  const removeSection = (i: number) => {
    set("items", (a: SectionItem[]) => a.filter((_, idx) => idx !== i));
    touched();
  };
  const moveSection = (i: number, delta: number) => {
    set("items", (a: SectionItem[]) => {
      const j = i + delta;
      if (j < 0 || j >= a.length) return a;
      const next = a.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    touched();
  };

  const save = async () => {
    setStatus("saving");
    try {
      const res = await fetch(`/api/louise/pages/${props.pageId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sections: unwrap(state.items) }),
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      setStatus("saved");
    } catch (err) {
      console.error("[louise] sections save failed", err);
      setStatus("error");
    }
  };

  return (
    <div class="louise-sections" data-theme="louise">
      <div class="louise-sections-head">
        <span class="louise-sections-title">Page sections</span>
        <span class="louise-sections-status" data-status={status()}>
          {status() === "saving"
            ? "Saving…"
            : status() === "saved"
              ? "Saved · leave edit mode to preview"
              : status() === "error"
                ? "Couldn’t save"
                : ""}
        </span>
      </div>

      <For
        each={state.items}
        fallback={<p class="louise-muted">No sections yet — add one below.</p>}
      >
        {(item, i) => (
          <div class="louise-section-card">
            <div class="louise-section-card-head">
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
                  ↑
                </button>
                <button
                  class="louise-btn louise-btn-xs"
                  type="button"
                  title="Move down"
                  disabled={i() === state.items.length - 1}
                  onClick={() => moveSection(i(), 1)}
                >
                  ↓
                </button>
                <button
                  class="louise-btn louise-btn-xs louise-btn-danger"
                  type="button"
                  title="Remove"
                  onClick={() => removeSection(i())}
                >
                  ✕
                </button>
              </div>
            </div>
            <div class="louise-section-fields">
              <For each={Object.entries(props.catalog[item._type]?.fields ?? {})}>
                {([key, field]) => (
                  <div class="louise-field">
                    <span class="louise-field-label">{field.label ?? humanize(key)}</span>
                    <Show
                      when={field.type === "array"}
                      fallback={
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
                          <textarea
                            class="louise-input"
                            rows={2}
                            value={String(item[key] ?? "")}
                            placeholder={field.placeholder}
                            onInput={(e) => {
                              set("items", i(), key, e.currentTarget.value);
                              touched();
                            }}
                          />
                        </Show>
                      }
                    >
                      <div class="louise-arr">
                        <For each={(item[key] as Record<string, unknown>[]) ?? []}>
                          {(sub, k) => (
                            <div class="louise-arr-item">
                              <div class="louise-arr-item-head">
                                <span>
                                  {field.itemLabel ?? "Item"} {k() + 1}
                                </span>
                                <button
                                  class="louise-btn louise-btn-xs louise-btn-danger"
                                  type="button"
                                  onClick={() => {
                                    set("items", i(), key, (arr: Record<string, unknown>[]) =>
                                      arr.filter((_, z) => z !== k()),
                                    );
                                    touched();
                                  }}
                                >
                                  ✕
                                </button>
                              </div>
                              <For each={Object.entries(field.itemFields ?? {})}>
                                {([subKey, subField]) => (
                                  <div class="louise-field">
                                    <span class="louise-field-label">
                                      {subField.label ?? humanize(subKey)}
                                    </span>
                                    <Show
                                      when={subField.type === "textarea"}
                                      fallback={
                                        <input
                                          class="louise-input"
                                          value={String(sub[subKey] ?? "")}
                                          placeholder={subField.placeholder}
                                          onInput={(e) => {
                                            set(
                                              "items",
                                              i(),
                                              key,
                                              k(),
                                              subKey,
                                              e.currentTarget.value,
                                            );
                                            touched();
                                          }}
                                        />
                                      }
                                    >
                                      <textarea
                                        class="louise-input"
                                        rows={2}
                                        value={String(sub[subKey] ?? "")}
                                        placeholder={subField.placeholder}
                                        onInput={(e) => {
                                          set(
                                            "items",
                                            i(),
                                            key,
                                            k(),
                                            subKey,
                                            e.currentTarget.value,
                                          );
                                          touched();
                                        }}
                                      />
                                    </Show>
                                  </div>
                                )}
                              </For>
                            </div>
                          )}
                        </For>
                        <button
                          class="louise-btn louise-btn-xs"
                          type="button"
                          onClick={() => {
                            set("items", i(), key, (arr: unknown) => [
                              ...(Array.isArray(arr) ? arr : []),
                              blankRecord(field.itemFields ?? {}),
                            ]);
                            touched();
                          }}
                        >
                          + {field.itemLabel ?? "item"}
                        </button>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        )}
      </For>

      <div class="louise-sections-add">
        <button class="louise-btn" type="button" onClick={() => setAdding((v) => !v)}>
          + Add section
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

      <div class="louise-form-actions">
        <button
          class="louise-btn louise-btn-primary"
          type="button"
          disabled={status() === "saving"}
          onClick={() => void save()}
        >
          {status() === "saving" ? "Saving…" : "Save layout"}
        </button>
      </div>
    </div>
  );
}

/**
 * Vanilla-DOM adapter: take over `el` (which server-rendered the bespoke
 * sections) with the editor, in edit mode. Returns the disposer.
 */
export function mountSections(el: HTMLElement, opts: SectionsEditorProps): () => void {
  injectStyles();
  el.innerHTML = "";
  return render(() => <SectionsEditor {...opts} />, el);
}
