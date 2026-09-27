// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Framework Media panel—browses the site's media library (GET
// /api/louise/media), uploads new images, copies public URLs, and deletes
// objects with the delete-safety reference scan (a 409 lists what still uses
// the file). Opened from the image icon in the Settings' top framework strip.
// Talks to the generic louise-toolkit/editor `media` route.

import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Icon } from "../icons.jsx";
import { thumb } from "../thumb.js";
import { EmptyState, ErrorState, Skeleton } from "../states.jsx";
import { usePanelActions } from "./panel-actions.jsx";
import { apiErrorMessage, apiGet, louiseQueryKeys } from "./query.js";
import { describeUploadFailures, uploadMediaFiles } from "./upload.js";

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
  // Only one asset's alt/caption editor is open at a time—its Save/Cancel own
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
    // Every failure is reported, not just the last one to overwrite the alert.
    setError(describeUploadFailures(await uploadMediaFiles(files)));
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

  // One prompt per delete (#541): read what uses the file first, then ask once,
  // naming those uses. A reference that appears between the prompt and the
  // delete still comes back as a 409, and only then does a second prompt ask.
  const referencesPrompt = (used: MediaReference[]) => {
    const list = used
      .map((u) => [u.collection, u.label].filter(Boolean).join(": "))
      .filter(Boolean)
      .join(", ");
    return (
      `This file is still used by ${used.length} item${used.length === 1 ? "" : "s"}` +
      (list ? ` (${list})` : "") +
      ". Deleting it shows a broken image there, and it can’t be undone. Delete anyway?"
    );
  };
  const deleteMutation = useMutation(() => ({
    mutationFn: async ({ key, force }: { key: string; force: boolean }) => {
      const url = `/api/louise/media?key=${encodeURIComponent(key)}`;
      let res = await fetch(force ? `${url}&force=1` : url, { method: "DELETE" });
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { references?: MediaReference[] };
        if (!confirm(referencesPrompt(body.references ?? []))) return { canceled: true };
        res = await fetch(`${url}&force=1`, { method: "DELETE" });
      }
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: louiseQueryKeys.media }),
    onError: (err) => setError(err instanceof Error ? err.message : "Couldn’t delete."),
  }));
  const del = async (key: string) => {
    setError(null);
    // A server without the references read answers with the list instead, which
    // has no `references`: ask the plain question, and let a 409 ask the second.
    const used = await fetch(`/api/louise/media?references=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ references?: MediaReference[] }>) : null))
      .then((b) => b?.references ?? [])
      .catch(() => [] as MediaReference[]);
    const prompt =
      used.length > 0
        ? referencesPrompt(used)
        : "Delete this file from storage? This can’t be undone.";
    if (!confirm(prompt)) return;
    deleteMutation.mutate({ key, force: used.length > 0 });
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
            when={items().length > 0}
            fallback={<EmptyState message="No media yet. Upload images to add them." />}
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
                    onDelete={() => void del(m.key)}
                    onSaved={() => qc.invalidateQueries({ queryKey: louiseQueryKeys.media })}
                    onError={setError}
                  />
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Show>
    </>
  );
}

/**
 * One asset card: thumbnail (with its real alt), filename/size/dimensions, and—when
 * it's the single open editor—the asset-level `alt`/`caption` inputs. Its
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
        <Show when={!props.editing && (props.item.alt || props.item.alt === "")}>
          <div class="louise-item-sub louise-media-alt" title={props.item.alt ?? ""}>
            {props.item.alt === "" ? "Decorative" : props.item.alt}
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
  // An empty alt, as opposed to none, is an image the owner marked decorative
  // (#599): HTML's "skip this image", not "not written yet".
  const [decorative, setDecorative] = createSignal(props.item.alt === "");
  const [caption, setCaption] = createSignal(props.item.caption ?? "");
  const [dirty, setDirty] = createSignal(false);

  const save = async () => {
    // Save stays enabled; with nothing changed there's nothing to write.
    if (!dirty()) {
      props.onClose();
      return;
    }
    try {
      const res = await fetch("/api/louise/media", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: props.item.key,
          // Decorative sends "", a description sends its text, and an empty
          // field sends null: not written yet.
          alt: decorative() ? "" : alt().trim() ? alt() : null,
          caption: caption(),
        }),
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
        { id: "save", label: "Save", kind: "primary", busyLabel: "Saving…", onClick: save },
        { id: "cancel", label: "Cancel", kind: "ghost", onClick: props.onClose },
      ]),
    ),
  );

  return (
    <div class="louise-media-edit">
      <input
        class="louise-input"
        type="text"
        aria-label="Alt text"
        placeholder="Alt text (describe the image)"
        value={alt()}
        disabled={decorative()}
        onInput={(e) => {
          setAlt(e.currentTarget.value);
          setDirty(true);
        }}
      />
      <label class="louise-check">
        <input
          type="checkbox"
          checked={decorative()}
          onChange={(e) => {
            setDecorative(e.currentTarget.checked);
            setDirty(true);
          }}
        />
        Decorative image (screen readers skip it)
      </label>
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
