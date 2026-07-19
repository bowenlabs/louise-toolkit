// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Shared Settings form primitives — the collapsible <details> Section, the
// label/href LinkListEditor, the media-library picker, and a declarative
// SettingsField renderer. The framework Settings panel and site extension
// groups render through the same field renderer, so a site's extra settings
// look and behave exactly like the built-in ones.

import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, type JSX, Match, Show, Switch } from "solid-js";
import { Icon } from "../icons.jsx";
import { apiGet, louiseQueryKeys } from "./query.js";

/** A label/href row — the shape stored in the `navLinks`/`socialLinks` JSON. */
export interface LinkRow {
  label: string;
  href: string;
}

/** Field types the declarative Settings renderer understands. */
export type SettingsFieldType = "text" | "textarea" | "color" | "toggle" | "image" | "links";

/**
 * One declarative settings field. `key` is the settings object key it reads and
 * writes — a framework base column (e.g. `siteName`) for the built-in groups, or
 * a site-declared `custom` key for an extension group.
 */
export interface SettingsFieldDef {
  key: string;
  label: string;
  /** Renders as a single-line text input when omitted. */
  type?: SettingsFieldType;
  hint?: string;
  placeholder?: string;
  /**
   * Escape hatch for a field whose UI none of the built-in `type`s cover — a
   * label/value row list, a microcopy grid, a per-page SEO editor, etc. Given
   * the loaded value (once, at mount) and an `onChange`, it renders arbitrary
   * markup that persists to `key` through the same save flow as any field.
   * Overrides `type` when present. Manage local state internally — it's called
   * once, so keystrokes won't reset it.
   */
  render?: (args: { value: unknown; onChange: (value: unknown) => void }) => JSX.Element;
}

/** A titled, collapsible group of settings fields. */
export interface SettingsFieldGroup {
  title: string;
  hint?: string;
  /** Expanded on first render (the first built-in group opens by default). */
  open?: boolean;
  fields: SettingsFieldDef[];
}

/** Collapsible settings section — native <details>/<summary> (keyboard and a11y
 *  for free) under the Louise theme. */
export function Section(props: {
  title: string;
  hint?: string;
  open?: boolean;
  children: JSX.Element;
}) {
  return (
    <details class="louise-accordion" open={props.open}>
      <summary class="louise-accordion-summary">
        <span>{props.title}</span>
        <Icon name="caretDown" class="louise-accordion-caret" />
      </summary>
      <div class="louise-accordion-body">
        <Show when={props.hint}>
          <p class="louise-muted louise-settings-hint">{props.hint}</p>
        </Show>
        {props.children}
      </div>
    </details>
  );
}

/** A reusable label+href list editor with add / remove / reorder. */
export function LinkListEditor(props: { rows: LinkRow[]; setRows: (rows: LinkRow[]) => void }) {
  const update = (i: number, patch: Partial<LinkRow>) =>
    props.setRows(props.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => props.setRows(props.rows.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= props.rows.length) return;
    const next = [...props.rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    props.setRows(next);
  };
  const add = () => props.setRows([...props.rows, { label: "", href: "" }]);

  return (
    <div>
      <div class="louise-list">
        <For each={props.rows} fallback={<p class="louise-muted">None yet.</p>}>
          {(row, i) => (
            <div class="louise-list-item louise-settings-row">
              <div class="louise-reorder">
                <button
                  class="louise-icon-btn"
                  type="button"
                  disabled={i() === 0}
                  aria-label="Move up"
                  onClick={() => move(i(), -1)}
                >
                  <Icon name="caretUp" />
                </button>
                <button
                  class="louise-icon-btn"
                  type="button"
                  disabled={i() === props.rows.length - 1}
                  aria-label="Move down"
                  onClick={() => move(i(), 1)}
                >
                  <Icon name="caretDown" />
                </button>
              </div>
              <div class="louise-settings-fields">
                <input
                  class="louise-input"
                  aria-label={`Link ${i() + 1} label`}
                  placeholder="Label"
                  value={row.label}
                  onInput={(e) => update(i(), { label: e.currentTarget.value })}
                />
                <input
                  class="louise-input"
                  aria-label={`Link ${i() + 1} URL`}
                  placeholder="/path or https://…"
                  value={row.href}
                  onInput={(e) => update(i(), { href: e.currentTarget.value })}
                />
              </div>
              <button
                class="louise-icon-btn"
                type="button"
                aria-label="Remove"
                onClick={() => remove(i())}
              >
                <Icon name="trash" />
              </button>
            </div>
          )}
        </For>
      </div>
      <button class="louise-btn" type="button" onClick={add}>
        <Icon name="plus" /> Add link
      </button>
    </div>
  );
}

/** Inline media picker: a small library grid (the same `/api/louise/media` list
 *  the Media panel uses) for URL fields that should point at an uploaded image —
 *  clicking a thumbnail fills the field instead of hand-pasting a URL. */
export function MediaUrlPicker(props: { onPick: (url: string) => void }) {
  const [open, setOpen] = createSignal(false);
  const query = useQuery(() => ({
    queryKey: ["louise", "media"],
    queryFn: () =>
      apiGet<{ media: { key: string; url: string }[] }>("/api/louise/media").then((d) => d.media),
    enabled: open(),
  }));
  return (
    <div>
      <button class="louise-btn" type="button" onClick={() => setOpen(!open())}>
        <Icon name="image" /> {open() ? "Close media" : "Choose from media"}
      </button>
      <Show when={open()}>
        <Show when={!query.isLoading} fallback={<p class="louise-muted">Loading…</p>}>
          <Show
            when={(query.data ?? []).length > 0}
            fallback={<p class="louise-muted">No uploads yet — add images in the Media panel.</p>}
          >
            <div class="louise-media-pick-grid">
              <For each={query.data ?? []}>
                {(item) => (
                  <button
                    class="louise-media-pick"
                    type="button"
                    title={item.key}
                    // The thumbnail is decorative inside this button (alt=""), so
                    // the button itself has to carry the name — `title` alone is
                    // not a reliable accessible name (WCAG 4.1.2).
                    aria-label={`Use ${item.key}`}
                    onClick={() => {
                      props.onPick(item.url);
                      setOpen(false);
                    }}
                  >
                    <img src={item.url} alt="" loading="lazy" />
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

/** An image field: live thumbnail, an upload button, a media-library picker, and
 *  a clear button. Empty = the site shows its placeholder. By default the value
 *  can only come from an upload or the library (a media-hosted URL) — there is
 *  no free-form URL input, so editors can't hotlink an external image. Opt into
 *  upload-into-slot with `upload`, a resized preview with `transform`, and the
 *  legacy raw-URL text input with `allowUrl`. */
export function ImageField(props: {
  label: string;
  hint?: string;
  value: string;
  onChange: (url: string) => void;
  /** Show an upload-into-slot button: POST the file to the media route, set the
   *  field to the returned URL, and refresh the media list. Off by default (the
   *  media-library picker covers the base case). */
  upload?: boolean;
  /** Scope (R2 key prefix) sent with the upload. Default `"web"`. */
  uploadScope?: string;
  /** Show a free-form URL text input, letting an editor paste any (external)
   *  URL. Off by default — images should come from the media library so they
   *  can't break or hotlink. An escape hatch for sites that knowingly want it. */
  allowUrl?: boolean;
  /** Transform the preview thumbnail URL — e.g. a CDN resizer like `cfImage`.
   *  Defaults to the raw URL. Does not affect the stored value. */
  transform?: (url: string) => string;
}) {
  const qc = useQueryClient();
  const [uploading, setUploading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const preview = () => (props.transform ? props.transform(props.value) : props.value);

  const onUpload = async (e: Event & { currentTarget: HTMLInputElement }) => {
    const input = e.currentTarget;
    const file = (input.files ?? [])[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("scope", props.uploadScope ?? "web");
      const res = await fetch("/api/louise/media", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && data.url) {
        props.onChange(data.url);
        await qc.invalidateQueries({ queryKey: louiseQueryKeys.media });
      } else {
        setError(data.error || `Upload failed (${res.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      input.value = "";
    }
  };

  return (
    <div class="louise-field">
      <label>{props.label}</label>
      <Show when={props.hint}>
        <p class="louise-muted louise-settings-hint">{props.hint}</p>
      </Show>
      <Show when={props.value}>
        <img
          src={preview()}
          alt=""
          loading="lazy"
          style="display:block; width:auto; max-width:100%; max-height:160px; border-radius:8px; margin-bottom:8px;"
        />
      </Show>
      <Show when={props.allowUrl}>
        <input
          class="louise-input"
          aria-label={`${props.label} image URL`}
          placeholder="https://… paste a URL"
          value={props.value}
          onInput={(e) => props.onChange(e.currentTarget.value)}
        />
      </Show>
      <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:8px;">
        <Show when={props.upload}>
          <label class="louise-btn louise-media-upload">
            <Icon name="plus" /> {uploading() ? "Uploading…" : "Upload"}
            <input
              type="file"
              accept="image/*"
              class="louise-hidden-file"
              onChange={onUpload}
              disabled={uploading()}
            />
          </label>
        </Show>
        <MediaUrlPicker onPick={props.onChange} />
        <Show when={props.value}>
          <button class="louise-btn" type="button" onClick={() => props.onChange("")}>
            <Icon name="trash" /> Clear
          </button>
        </Show>
      </div>
      <Show when={error()}>
        <div class="louise-alert" role="alert" style="margin-top:8px;">
          {error()}
        </div>
      </Show>
    </div>
  );
}

const asLinks = (v: unknown): LinkRow[] =>
  Array.isArray(v)
    ? v.map((r) => ({
        label: String((r as LinkRow)?.label ?? ""),
        href: String((r as LinkRow)?.href ?? ""),
      }))
    : [];

/**
 * Render one declarative settings field, dispatching on `def.type`. `value` is
 * the current value from the settings store; `onChange` writes the new value
 * back. Used for both the framework base groups and site extension groups.
 */
export function SettingsField(props: {
  def: SettingsFieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  // A custom-render field bypasses the built-in type switch: it owns its markup
  // and local state, persisting to `key` via the same onChange. Called once with
  // the loaded value, so its internal state survives keystrokes.
  if (props.def.render) return props.def.render({ value: props.value, onChange: props.onChange });

  const id = () => `louise-set-${props.def.key}`;
  return (
    <Switch
      fallback={
        <div class="louise-field">
          <label for={id()}>{props.def.label}</label>
          <Show when={props.def.hint}>
            <p class="louise-muted louise-settings-hint">{props.def.hint}</p>
          </Show>
          <input
            id={id()}
            class="louise-input"
            placeholder={props.def.placeholder}
            value={String(props.value ?? "")}
            onInput={(e) => props.onChange(e.currentTarget.value)}
          />
        </div>
      }
    >
      <Match when={props.def.type === "textarea"}>
        <div class="louise-field">
          <label for={id()}>{props.def.label}</label>
          <Show when={props.def.hint}>
            <p class="louise-muted louise-settings-hint">{props.def.hint}</p>
          </Show>
          <textarea
            id={id()}
            class="louise-input louise-textarea"
            rows={3}
            placeholder={props.def.placeholder}
            value={String(props.value ?? "")}
            onInput={(e) => props.onChange(e.currentTarget.value)}
          />
        </div>
      </Match>
      <Match when={props.def.type === "color"}>
        <div class="louise-field">
          <label for={id()}>{props.def.label}</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input
              type="color"
              value={String(props.value ?? "#000000") || "#000000"}
              aria-label={`${props.def.label} color`}
              onInput={(e) => props.onChange(e.currentTarget.value)}
            />
            <input
              id={id()}
              class="louise-input"
              placeholder="#1481ef"
              value={String(props.value ?? "")}
              onInput={(e) => props.onChange(e.currentTarget.value)}
            />
          </div>
        </div>
      </Match>
      <Match when={props.def.type === "toggle"}>
        <div class="louise-field">
          <label class="louise-toggle">
            <input
              id={id()}
              type="checkbox"
              checked={Boolean(props.value)}
              onChange={(e) => props.onChange(e.currentTarget.checked)}
            />
            {props.def.label}
          </label>
          <Show when={props.def.hint}>
            <p class="louise-muted louise-settings-hint">{props.def.hint}</p>
          </Show>
        </div>
      </Match>
      <Match when={props.def.type === "image"}>
        {/* Upload + media-library picker, no free-form URL — settings images
            (logo, favicon, share image) come from the media collection. */}
        <ImageField
          label={props.def.label}
          hint={props.def.hint}
          value={String(props.value ?? "")}
          onChange={props.onChange}
          upload
        />
      </Match>
      <Match when={props.def.type === "links"}>
        <div class="louise-field">
          <span class="louise-field-label">{props.def.label}</span>
          <Show when={props.def.hint}>
            <p class="louise-muted louise-settings-hint">{props.def.hint}</p>
          </Show>
          <LinkListEditor rows={asLinks(props.value)} setRows={(rows) => props.onChange(rows)} />
        </div>
      </Match>
    </Switch>
  );
}
