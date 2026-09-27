// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Shared Settings form primitives—the collapsible <details> Section, the
// label/href LinkListEditor, the media-library picker, and a declarative
// SettingsField renderer. The framework Settings panel and site extension
// groups render through the same field renderer, so a site's extra settings
// look and behave exactly like the built-in ones.

import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, createUniqueId, For, Index, type JSX, Match, Show, Switch } from "solid-js";
import type { FieldTypeName } from "../../core/content/field-types.js";
import { Icon } from "../icons.jsx";
import { EmptyState, ErrorState, Skeleton } from "../states.jsx";
import { thumb } from "../thumb.js";
import { apiErrorMessage, apiGet, louiseQueryKeys } from "./query.js";

/** A label/href row—the shape stored in the `navLinks`/`socialLinks` JSON. */
export interface LinkRow {
  label: string;
  href: string;
}

/**
 * Field types the declarative Settings renderer understands.
 *
 * An alias for the shared {@link FieldTypeName} since ADR 0010 A2—this was its
 * own six-name union, overlapping the section catalog's eight on four and
 * disagreeing on the rest, so a type added to one surface was silently absent
 * from the other. That asymmetry is what left settings without a `link` type and
 * therefore without a scheme check on stored nav destinations.
 *
 * The renderer below still only draws the six it always drew; a name it doesn't
 * recognise falls through to the text input, exactly as an unknown value did
 * before. What changed is that both surfaces now agree on what the names ARE, and
 * a type registered once validates on both.
 */
export type SettingsFieldType = FieldTypeName;

/**
 * One declarative settings field. `key` is the settings object key it reads and
 * writes—a framework base column (for example, `siteName`) for the built-in groups, or
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
   * Escape hatch for a field whose UI none of the built-in `type`s cover—a
   * label/value row list, a microcopy grid, a per-page SEO editor, etc. Given
   * the loaded value (once, at mount) and an `onChange`, it renders arbitrary
   * markup that persists to `key` through the same save flow as any field.
   * Overrides `type` when present. Manage local state internally—it's called
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

/** Collapsible settings section—native <details>/<summary> (keyboard and a11y
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

/**
 * Add `https://` to a link typed the way people type them, `example.com/shop`:
 * no scheme, and it starts with a host. Anything else comes back unchanged, so
 * this can't let a new scheme through; the server's scheme check still decides.
 */
export function normalizeLinkHref(href: string): string {
  const value = href.trim();
  if (/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(value)) {
    return `https://${value}`;
  }
  return href;
}

/** A reusable label+href list editor with add / remove / reorder. */
export function LinkListEditor(props: {
  rows: LinkRow[];
  setRows: (rows: LinkRow[]) => void;
  /** A message per row index, from the server's violations, shown under the row. */
  rowErrors?: Readonly<Record<number, string>>;
}) {
  const uid = createUniqueId();
  let list: HTMLDivElement | undefined;
  let addButton: HTMLButtonElement | undefined;
  // Focus after the rows re-render, so an added row's input exists and a
  // removed row's button is gone.
  const focusLater = (find: () => HTMLElement | null | undefined) =>
    queueMicrotask(() => find()?.focus());
  const rowEl = (i: number) => list?.querySelector<HTMLElement>(`[data-row="${i}"]`);

  const update = (i: number, patch: Partial<LinkRow>) =>
    props.setRows(props.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => {
    const next = props.rows.filter((_, j) => j !== i);
    props.setRows(next);
    // The next row's Remove, which now sits at this index, or the new last
    // row's, or Add link when the list is empty.
    focusLater(() =>
      next.length === 0
        ? addButton
        : rowEl(Math.min(i, next.length - 1))?.querySelector<HTMLElement>("[data-remove]"),
    );
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= props.rows.length) return;
    const next = [...props.rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    props.setRows(next);
  };
  const add = () => {
    props.setRows([...props.rows, { label: "", href: "" }]);
    focusLater(() => rowEl(props.rows.length - 1)?.querySelector<HTMLElement>("input"));
  };
  // Each control names its row, so a screen reader hears which link it acts on.
  const rowName = (i: number, label: string) =>
    label.trim() ? `link ${i + 1}, ${label.trim()}` : `link ${i + 1}`;

  return (
    <div>
      <div class="louise-list" ref={list}>
        {/* Index, NOT For. `update` replaces the edited row with a new object, and
            <For> is keyed by REFERENCE, so every keystroke made that row a new
            item, tearing its DOM down and rebuilding it. The <input> being typed
            into was destroyed mid-edit and focus fell to <body>, which reads as
            "the drawer loses focus after every letter."

            <Index> keys by POSITION: the row's elements are created once and only
            the values update, so the focused input survives. The rows here are
            positional anyway: reorder moves values between fixed slots. */}
        <Index each={props.rows} fallback={<p class="louise-muted">None yet.</p>}>
          {(row, i) => {
            const labelId = `${uid}-${i}-label`;
            const hrefId = `${uid}-${i}-href`;
            const errorId = `${uid}-${i}-error`;
            const error = () => props.rowErrors?.[i];
            return (
              <div class="louise-list-item louise-settings-row" data-row={i}>
                <div class="louise-reorder">
                  <button
                    class="louise-icon-btn"
                    type="button"
                    disabled={i === 0}
                    aria-label={`Move ${rowName(i, row().label)} up`}
                    onClick={() => move(i, -1)}
                  >
                    <Icon name="caretUp" />
                  </button>
                  <button
                    class="louise-icon-btn"
                    type="button"
                    disabled={i === props.rows.length - 1}
                    aria-label={`Move ${rowName(i, row().label)} down`}
                    onClick={() => move(i, 1)}
                  >
                    <Icon name="caretDown" />
                  </button>
                </div>
                <div class="louise-settings-fields">
                  <label class="louise-row-label" for={labelId}>
                    Label
                  </label>
                  <input
                    id={labelId}
                    class="louise-input"
                    value={row().label}
                    onInput={(e) => update(i, { label: e.currentTarget.value })}
                  />
                  <label class="louise-row-label" for={hrefId}>
                    Link
                  </label>
                  <input
                    id={hrefId}
                    class="louise-input"
                    placeholder="/path or https://…"
                    value={row().href}
                    aria-invalid={error() ? "true" : undefined}
                    aria-describedby={error() ? errorId : undefined}
                    onInput={(e) => update(i, { href: e.currentTarget.value })}
                    onBlur={(e) => {
                      const fixed = normalizeLinkHref(e.currentTarget.value);
                      if (fixed !== e.currentTarget.value) update(i, { href: fixed });
                    }}
                  />
                  <Show when={error()}>
                    <p id={errorId} class="louise-field-error">
                      {error()}
                    </p>
                  </Show>
                </div>
                <button
                  class="louise-icon-btn"
                  type="button"
                  data-remove
                  aria-label={`Remove ${rowName(i, row().label)}`}
                  onClick={() => remove(i)}
                >
                  <Icon name="trash" />
                </button>
              </div>
            );
          }}
        </Index>
      </div>
      <button class="louise-btn" type="button" ref={addButton} onClick={add}>
        <Icon name="plus" /> Add link
      </button>
    </div>
  );
}

/** Inline media picker: a small library grid (the same `/api/louise/media` list
 *  the Media panel uses) for URL fields that should point at an uploaded image.
 *  Clicking a thumbnail fills the field instead of hand-pasting a URL. */
export function MediaUrlPicker(props: {
  onPick: (url: string) => void;
  /** The ID of an error message about the field, linked to the picker's button. */
  errorId?: string;
}) {
  const [open, setOpen] = createSignal(false);
  const query = useQuery(() => ({
    queryKey: ["louise", "media"],
    queryFn: () =>
      apiGet<{ media: { key: string; url: string }[] }>("/api/louise/media").then((d) => d.media),
    enabled: open(),
  }));
  return (
    <div>
      <button
        class="louise-btn"
        type="button"
        aria-describedby={props.errorId}
        onClick={() => setOpen(!open())}
      >
        <Icon name="image" /> {open() ? "Close media" : "Choose from media"}
      </button>
      <Show when={open()}>
        <Show
          when={!query.isLoading}
          fallback={<Skeleton label="Loading your media" shape="grid" count={6} />}
        >
          <Show
            when={!query.isError}
            fallback={
              <ErrorState
                message={apiErrorMessage(query.error, "Couldn’t load your media.")}
                onRetry={() => void query.refetch()}
              />
            }
          >
            <Show
              when={(query.data ?? []).length > 0}
              fallback={<EmptyState message="No uploads yet. Add images in the Media panel." />}
            >
              <div class="louise-media-pick-grid">
                <For each={query.data ?? []}>
                  {(item) => (
                    <button
                      class="louise-media-pick"
                      type="button"
                      title={item.key}
                      // The thumbnail is decorative inside this button (alt=""), so
                      // the button itself has to carry the name—`title` alone is
                      // not a reliable accessible name (WCAG 4.1.2).
                      aria-label={`Use ${item.key}`}
                      onClick={() => {
                        props.onPick(item.url);
                        setOpen(false);
                      }}
                    >
                      {/* 72px grid tile (.louise-media-pick-grid). */}
                      <img src={thumb(item.url, 72)} alt="" loading="lazy" decoding="async" />
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

/** An image field: live thumbnail, an upload button, a media-library picker, and
 *  a clear button. Empty = the site shows its placeholder. By default the value
 *  can only come from an upload or the library (a media-hosted URL)—there is
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
   *  URL. Off by default—images should come from the media library so they
   *  can't break or hotlink. An escape hatch for sites that knowingly want it. */
  allowUrl?: boolean;
  /** Override the preview thumbnail URL. Defaults to a CDN derivative sized for
   *  the 160 px preview box—pass this only to do something else. Never affects
   *  the stored value. */
  transform?: (url: string) => string;
  /** A message from the server about this field, shown under it. */
  invalid?: string;
}) {
  const qc = useQueryClient();
  const invalidId = createUniqueId();
  const [uploading, setUploading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // The preview box is max-height 160px, so that is what gets requested—not
  // the master. Defaulting rather than requiring the prop: this seam existed and
  // named `cfImage` in its own doc comment, and no caller ever passed one.
  const preview = () => (props.transform ?? ((url: string) => thumb(url, 160)))(props.value);

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
        <MediaUrlPicker onPick={props.onChange} errorId={props.invalid ? invalidId : undefined} />
        <Show when={props.value}>
          <button class="louise-btn" type="button" onClick={() => props.onChange("")}>
            <Icon name="trash" /> Clear
          </button>
        </Show>
      </div>
      <Show when={props.invalid}>
        <p id={invalidId} class="louise-field-error">
          {props.invalid}
        </p>
      </Show>
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
  /** A message from the server about this field, shown under it and linked
   *  with `aria-describedby`. */
  error?: string;
  /** For a `links` field: a message per row index. */
  rowErrors?: Readonly<Record<number, string>>;
}) {
  // A custom-render field bypasses the built-in type switch: it owns its markup
  // and local state, persisting to `key` via the same onChange. Called once with
  // the loaded value, so its internal state survives keystrokes.
  if (props.def.render) return props.def.render({ value: props.value, onChange: props.onChange });

  const id = () => `louise-set-${props.def.key}`;
  const errorId = () => `louise-set-${props.def.key}-error`;
  // The attributes that tie a control to its error message.
  const invalid = () =>
    props.error
      ? { "aria-invalid": "true" as const, "aria-describedby": errorId() }
      : { "aria-invalid": undefined, "aria-describedby": undefined };
  const errorText = () => (
    <Show when={props.error}>
      <p id={errorId()} class="louise-field-error">
        {props.error}
      </p>
    </Show>
  );
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
            {...invalid()}
            onInput={(e) => props.onChange(e.currentTarget.value)}
          />
          {errorText()}
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
            {...invalid()}
            onInput={(e) => props.onChange(e.currentTarget.value)}
          />
          {errorText()}
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
              {...invalid()}
              onInput={(e) => props.onChange(e.currentTarget.value)}
            />
          </div>
          {errorText()}
        </div>
      </Match>
      <Match when={props.def.type === "toggle"}>
        <div class="louise-field">
          <label class="louise-toggle">
            <input
              id={id()}
              type="checkbox"
              checked={Boolean(props.value)}
              {...invalid()}
              onChange={(e) => props.onChange(e.currentTarget.checked)}
            />
            {props.def.label}
          </label>
          <Show when={props.def.hint}>
            <p class="louise-muted louise-settings-hint">{props.def.hint}</p>
          </Show>
          {errorText()}
        </div>
      </Match>
      <Match when={props.def.type === "image"}>
        {/* Upload + media-library picker, no free-form URL—settings images
            (logo, favicon, share image) come from the media collection. */}
        <ImageField
          label={props.def.label}
          hint={props.def.hint}
          value={String(props.value ?? "")}
          onChange={props.onChange}
          invalid={props.error}
          upload
        />
      </Match>
      <Match when={props.def.type === "links"}>
        <div class="louise-field">
          <span class="louise-field-label">{props.def.label}</span>
          <Show when={props.def.hint}>
            <p class="louise-muted louise-settings-hint">{props.def.hint}</p>
          </Show>
          <LinkListEditor
            rows={asLinks(props.value)}
            setRows={(rows) => props.onChange(rows)}
            rowErrors={props.rowErrors}
          />
          {errorText()}
        </div>
      </Match>
    </Switch>
  );
}
