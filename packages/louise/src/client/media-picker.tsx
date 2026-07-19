// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// A query-free media-library picker for surfaces mounted OUTSIDE the Settings'
// TanStack Query provider — chiefly the sections dock (`mountSections` renders
// its own Solid root with no QueryClient, so the Settings' `MediaUrlPicker`,
// which uses `useQuery`, can't be reused there). Lazily fetches the same
// `/api/louise/media` list the Media panel uses and calls `onPick` with the
// chosen asset's public URL, so every image control offers the library, not
// just an upload.

import { createSignal, For, Show } from "solid-js";
import { Icon } from "./icons.jsx";

interface MediaListItem {
  key: string;
  url: string;
}

export function MediaPicker(props: { onPick: (url: string) => void; label?: string }) {
  const [open, setOpen] = createSignal(false);
  const [items, setItems] = createSignal<MediaListItem[] | null>(null);
  const [loading, setLoading] = createSignal(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/louise/media");
      const data = (await res.json().catch(() => ({}))) as { media?: MediaListItem[] };
      setItems(data.media ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open();
    setOpen(next);
    // Fetch once, on first open — the dock is often opened without ever browsing.
    if (next && items() === null) void load();
  };

  return (
    <div>
      <button class="louise-btn louise-btn-xs" type="button" onClick={toggle}>
        <Icon name="image" /> {open() ? "Close media" : (props.label ?? "Choose from media")}
      </button>
      <Show when={open()}>
        <Show when={!loading()} fallback={<p class="louise-muted">Loading…</p>}>
          <Show
            when={(items() ?? []).length > 0}
            fallback={<p class="louise-muted">No uploads yet — add images in the Media panel.</p>}
          >
            <div class="louise-media-pick-grid">
              <For each={items() ?? []}>
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
