// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Framework Media panel — browses the site's media library (GET
// /api/louise/media), uploads new images, copies public URLs, and deletes
// objects with the delete-safety reference scan (a 409 lists what still uses
// the file). Opened from the image icon in the Settings' top framework strip.
// Talks to the generic louise-toolkit/editor `media` route.

import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Icon } from "../icons.jsx";
import { thumb } from "../thumb.js";
import { usePanelActions } from "./panel-actions.jsx";
import { apiGet, louiseQueryKeys } from "./query.js";

/** A tracked media asset (a `media` table row + its resolved public `url`). */
export interface MediaItem {
  key: string;
  content_type?: string;
  size?: number;
  url: string;
  /** Asset-level accessibility description (the default reused wherever the
   *  asset appears). Editable in the panel; NULL until set. */
  alt?: string | null;
  caption?: string | null;
  width?: number | null;
  height?: number | null;
}

/** A content record still referencing an asset (from the DELETE 409 body). */
interface MediaReference {
  collection?: string;
  label?: string;
}

const fmtSize = (bytes?: number) => {
  if (!bytes && bytes !== 0) return "";
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export function MediaPanel() {
  const qc = useQueryClient();
  const [uploading, setUploading] = createSignal(false);
  const [copied, setCopied] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  // Only one asset's alt/caption editor is open at a time — its Save/Cancel own
  // the drawer footer, so the footer stack always has a single, unambiguous top.
  const [editingKey, setEditingKey] = createSignal<string | null>(null);

  const query = useQuery(() => ({
    queryKey: louiseQueryKeys.media,
    queryFn: () => apiGet<{ media: MediaItem[] }>("/api/louise/media").then((d) => d.media),
  }));
  const items = () => query.data ?? [];

  const onPick = async (e: Event & { currentTarget: HTMLInputElement }) => {
    const input = e.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    setError(null);
    setUploading(true);
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/louise/media", { method: "POST", body: fd });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error || `Upload failed (${res.status})`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      }
    }
    setUploading(false);
    input.value = "";
    await qc.invalidateQueries({ queryKey: louiseQueryKeys.media });
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied((c) => (c === url ? null : c)), 1500);
    } catch {
      setError("Couldn’t copy the URL.");
    }
  };

  const deleteMutation = useMutation(() => ({
    mutationFn: async (key: string) => {
      const url = `/api/louise/media?key=${encodeURIComponent(key)}`;
      let res = await fetch(url, { method: "DELETE" });
      // 409 = still referenced by content. Show exactly what would break, and
      // only force the delete if the editor confirms.
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { references?: MediaReference[] };
        const used = body.references ?? [];
        const list = used
          .map((u) => [u.collection, u.label].filter(Boolean).join(": "))
          .filter(Boolean)
          .join(", ");
        const ok = confirm(
          `This file is still used by ${used.length} item${used.length === 1 ? "" : "s"}` +
            (list ? ` — ${list}` : "") +
            ". Deleting it will show a broken image there. Delete anyway?",
        );
        if (!ok) return { canceled: true };
        res = await fetch(`${url}&force=1`, { method: "DELETE" });
      }
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: louiseQueryKeys.media }),
    onError: (err) => setError(err instanceof Error ? err.message : "Couldn’t delete."),
  }));
  const del = (key: string) => {
    if (!confirm("Delete this file from storage? This can’t be undone.")) return;
    setError(null);
    deleteMutation.mutate(key);
  };

  return (
    <>
      <Show when={error()}>
        <div class="louise-alert" role="alert">
          {error()}
        </div>
      </Show>
      <label class="louise-btn louise-btn-primary louise-btn-block louise-media-upload">
        <Icon name="plus" /> {uploading() ? "Uploading…" : "Upload images"}
        <input
          type="file"
          accept="image/*"
          multiple
          class="louise-hidden-file"
          onChange={onPick}
          disabled={uploading()}
        />
      </label>
      <div style={{ height: "14px" }} />
      <Show when={!query.isLoading} fallback={<p class="louise-muted">Loading…</p>}>
        <Show
          when={items().length > 0}
          fallback={<p class="louise-muted">No media in storage yet.</p>}
        >
          <div class="louise-media-grid">
            <For each={items()}>
              {(m) => (
                <MediaCard
                  item={m}
                  copied={copied() === m.url}
                  deleting={deleteMutation.isPending}
                  editing={editingKey() === m.key}
                  onEdit={() => setEditingKey(m.key)}
                  onCloseEdit={() => setEditingKey((k) => (k === m.key ? null : k))}
                  onCopy={() => void copy(m.url)}
                  onDelete={() => del(m.key)}
                  onSaved={() => qc.invalidateQueries({ queryKey: louiseQueryKeys.media })}
                  onError={setError}
                />
              )}
            </For>
          </div>
        </Show>
      </Show>
    </>
  );
}

/**
 * One asset card: thumbnail (with its real alt), filename/size/dimensions, and —
 * when it's the single open editor — the asset-level `alt`/`caption` inputs. Its
 * Save/Cancel live in the drawer footer (via {@link MediaEditor}); the card's own
 * Copy / Alt / Delete stay inline in the grid.
 */
function MediaCard(props: {
  item: MediaItem;
  copied: boolean;
  deleting: boolean;
  /** This card is the one open editor (only one across the grid at a time). */
  editing: boolean;
  onEdit: () => void;
  onCloseEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const dims = () =>
    props.item.width && props.item.height ? `${props.item.width}×${props.item.height}` : "";

  return (
    <div class="louise-media-card">
      <div class="louise-media-thumb">
        {/* 140px library tile (.louise-media-grid). */}
        <img
          src={thumb(props.item.url, 140)}
          alt={props.item.alt || props.item.key}
          loading="lazy"
          decoding="async"
        />
      </div>
      <div class="louise-media-meta">
        <div class="louise-item-title">{props.item.key.split("/").pop()}</div>
        <div class="louise-item-sub">
          {[fmtSize(props.item.size), dims()].filter(Boolean).join(" · ")}
        </div>
        <Show when={!props.editing && props.item.alt}>
          <div class="louise-item-sub louise-media-alt" title={props.item.alt ?? ""}>
            {props.item.alt}
          </div>
        </Show>
      </div>
      <Show
        when={props.editing}
        fallback={
          <div class="louise-media-actions">
            <button class="louise-btn" type="button" onClick={props.onCopy}>
              {props.copied ? "Copied" : "Copy URL"}
            </button>
            <button
              class="louise-btn"
              type="button"
              aria-label="Edit alt text"
              onClick={props.onEdit}
            >
              <Icon name="pencil" /> Alt
            </button>
            <button
              class="louise-icon-btn"
              type="button"
              aria-label="Delete"
              disabled={props.deleting}
              onClick={props.onDelete}
            >
              <Icon name="trash" />
            </button>
          </div>
        }
      >
        <MediaEditor
          item={props.item}
          onSaved={props.onSaved}
          onError={props.onError}
          onClose={props.onCloseEdit}
        />
      </Show>
    </div>
  );
}

/**
 * The single open alt/caption editor: mounts when a card enters edit mode and
 * pushes its Save/Cancel onto the drawer footer (deepest-wins), popping them when
 * it closes. Save PATCHes the `media` route + refreshes the list; Cancel discards.
 */
function MediaEditor(props: {
  item: MediaItem;
  onSaved: () => void;
  onError: (msg: string) => void;
  onClose: () => void;
}) {
  const actions = usePanelActions();
  const [alt, setAlt] = createSignal(props.item.alt ?? "");
  const [caption, setCaption] = createSignal(props.item.caption ?? "");
  const [dirty, setDirty] = createSignal(false);

  const save = async () => {
    try {
      const res = await fetch("/api/louise/media", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: props.item.key, alt: alt(), caption: caption() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        props.onError(body.error || `Save failed (${res.status})`);
        return;
      }
      props.onSaved();
      props.onClose();
    } catch (err) {
      props.onError(err instanceof Error ? err.message : "Save failed");
    }
  };

  onMount(() =>
    onCleanup(
      actions.push([
        {
          id: "save",
          label: "Save",
          kind: "primary",
          busyLabel: "Saving…",
          disabled: () => !dirty(),
          onClick: save,
        },
        { id: "cancel", label: "Cancel", kind: "ghost", onClick: props.onClose },
      ]),
    ),
  );

  return (
    <div class="louise-media-edit">
      <input
        class="louise-input"
        type="text"
        placeholder="Alt text (describe the image)"
        value={alt()}
        onInput={(e) => {
          setAlt(e.currentTarget.value);
          setDirty(true);
        }}
      />
      <input
        class="louise-input"
        type="text"
        placeholder="Caption (optional)"
        value={caption()}
        onInput={(e) => {
          setCaption(e.currentTarget.value);
          setDirty(true);
        }}
      />
    </div>
  );
}
