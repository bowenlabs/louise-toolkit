// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Framework Media panel — browses the site's media library (GET
// /api/louise/media), uploads new images, copies public URLs, and deletes
// objects with the delete-safety reference scan (a 409 lists what still uses
// the file). Opened from the image icon in the Settings' top framework strip.
// Talks to the generic louise/editor `media` route.

import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import { Icon } from "../icons.jsx";
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
 * One asset card: thumbnail (with its real alt), filename/size/dimensions, and
 * an inline editor for the asset-level `alt`/`caption` — the accessibility
 * description reused wherever the asset is placed. Saving PATCHes the `media`
 * route and refreshes the list.
 */
function MediaCard(props: {
  item: MediaItem;
  copied: boolean;
  deleting: boolean;
  onCopy: () => void;
  onDelete: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [editing, setEditing] = createSignal(false);
  const [alt, setAlt] = createSignal(props.item.alt ?? "");
  const [caption, setCaption] = createSignal(props.item.caption ?? "");
  const [saving, setSaving] = createSignal(false);

  const dims = () =>
    props.item.width && props.item.height ? `${props.item.width}×${props.item.height}` : "";

  const startEdit = () => {
    setAlt(props.item.alt ?? "");
    setCaption(props.item.caption ?? "");
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
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
      setEditing(false);
      props.onSaved();
    } catch (err) {
      props.onError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="louise-media-card">
      <div class="louise-media-thumb">
        <img src={props.item.url} alt={props.item.alt || props.item.key} loading="lazy" />
      </div>
      <div class="louise-media-meta">
        <div class="louise-item-title">{props.item.key.split("/").pop()}</div>
        <div class="louise-item-sub">
          {[fmtSize(props.item.size), dims()].filter(Boolean).join(" · ")}
        </div>
        <Show when={!editing() && props.item.alt}>
          <div class="louise-item-sub louise-media-alt" title={props.item.alt ?? ""}>
            {props.item.alt}
          </div>
        </Show>
      </div>
      <Show when={editing()}>
        <div class="louise-media-edit">
          <input
            class="louise-input"
            type="text"
            placeholder="Alt text (describe the image)"
            value={alt()}
            onInput={(e) => setAlt(e.currentTarget.value)}
          />
          <input
            class="louise-input"
            type="text"
            placeholder="Caption (optional)"
            value={caption()}
            onInput={(e) => setCaption(e.currentTarget.value)}
          />
          <div class="louise-media-actions">
            <button
              class="louise-btn louise-btn-primary"
              type="button"
              disabled={saving()}
              onClick={() => void save()}
            >
              {saving() ? "Saving…" : "Save"}
            </button>
            <button
              class="louise-btn"
              type="button"
              disabled={saving()}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      </Show>
      <Show when={!editing()}>
        <div class="louise-media-actions">
          <button class="louise-btn" type="button" onClick={props.onCopy}>
            {props.copied ? "Copied" : "Copy URL"}
          </button>
          <button class="louise-btn" type="button" aria-label="Edit alt text" onClick={startEdit}>
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
      </Show>
    </div>
  );
}
