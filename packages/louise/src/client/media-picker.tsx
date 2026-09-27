// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// A query-free media-library picker for surfaces mounted OUTSIDE the Settings'
// TanStack Query provider—chiefly the sections dock (`mountSections` renders
// its own Solid root with no QueryClient, so the Settings' `MediaUrlPicker`,
// which uses `useQuery`, can't be reused there). Lazily fetches the same
// `/api/louise/media` list the Media panel uses and calls `onPick` with the
// chosen asset's public URL, so every image control offers the library, not
// just an upload.

import { createSignal, For, Match, Switch } from "solid-js";
import { Icon } from "./icons.jsx";
import { EmptyState, ErrorState, Skeleton } from "./states.jsx";
import { thumb } from "./thumb.js";

interface MediaListItem {
  key: string;
  url: string;
}

export function MediaPicker(props: { onPick: (url: string) => void; label?: string }) {
  const [open, setOpen] = createSignal(false);
  const [items, setItems] = createSignal<MediaListItem[] | null>(null);
  const [loading, setLoading] = createSignal(false);
  // A failed load is its own state: it used to read as an empty library.
  const [failed, setFailed] = createSignal(false);

  const load = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch("/api/louise/media");
      if (!res.ok) throw new Error(`media list failed: ${res.status}`);
      const data = (await res.json().catch(() => ({}))) as { media?: MediaListItem[] };
      setItems(data.media ?? []);
    } catch (err) {
      console.error("[louise] media list failed", err);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open();
    setOpen(next);
    // Fetch once, on first open—the dock is often opened without ever browsing.
    if (next && (items() === null || failed())) void load();
  };

  return (
    <div>
      <button class="louise-btn louise-btn-xs" type="button" onClick={toggle}>
        <Icon name="image" /> {open() ? "Close media" : (props.label ?? "Choose from media")}
      </button>
      <Switch>
        <Match when={!open()}>{null}</Match>
        <Match when={loading()}>
          <Skeleton label="Loading your media" shape="grid" count={6} />
        </Match>
        <Match when={failed()}>
          <ErrorState message="Couldn’t load your media." onRetry={() => void load()} />
        </Match>
        <Match when={(items() ?? []).length === 0}>
          <EmptyState message="No uploads yet. Add images in the Media panel." />
        </Match>
        <Match when={true}>
          <div class="louise-media-pick-grid">
            <For each={items() ?? []}>
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
        </Match>
      </Switch>
    </div>
  );
}
