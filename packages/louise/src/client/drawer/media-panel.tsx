// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// Framework Media panel — browses the site's media library (GET
// /api/louise/media), uploads new images, copies public URLs, and deletes
// objects with the delete-safety reference scan (a 409 lists what still uses
// the file). Opened from the image icon in the drawer's top framework strip.
// Talks to the generic louisecms/editor `media` route.

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
                <div class="louise-media-card">
                  <div class="louise-media-thumb">
                    <img src={m.url} alt={m.key} loading="lazy" />
                  </div>
                  <div class="louise-media-meta">
                    <div class="louise-item-title">{m.key.split("/").pop()}</div>
                    <div class="louise-item-sub">{fmtSize(m.size)}</div>
                  </div>
                  <div class="louise-media-actions">
                    <button class="louise-btn" type="button" onClick={() => void copy(m.url)}>
                      {copied() === m.url ? "Copied" : "Copy URL"}
                    </button>
                    <button
                      class="louise-icon-btn"
                      type="button"
                      aria-label="Delete"
                      disabled={deleteMutation.isPending}
                      onClick={() => del(m.key)}
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </>
  );
}
