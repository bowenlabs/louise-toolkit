// The shared destination editor (coracle.coffee#38).
//
// A link has no visible text node to click, so its target is always edited in a
// panel rather than on the canvas — the rich-text builder's link node and the
// sections inspector's `link` field both need the same control, so it lives here
// rather than in either one.
//
// Two ways to name a destination:
//   • pick a page — DB pages from `/api/louise/pages`, plus any code-defined
//     routes the host supplies (see `setBuiltInRoutes`);
//   • type a URL — anything else, internal path or external.
//
// The value is a plain **string** href. Open-in-new deliberately isn't part of it:
// it's a separate field a catalog declares alongside (`type: "toggle"`), which
// keeps this migration-free over the `text`-typed href fields it replaces.

import { createSignal, For, onMount, Show } from "solid-js";

/** One selectable destination in the picker. */
export interface PageChoice {
  /** The href this option writes, e.g. `/about`. */
  path: string;
  /** What the editor sees. */
  title: string;
}

// Fetched once per session and shared by every link editor on the page — a
// wrench opened on ten different buttons shouldn't be ten requests.
let pagesCache: PageChoice[] | null = null;

// Code-defined routes (`/shop`, `/contact`) that no `pages` row backs. Without
// these the picker looks broken on exactly the destinations a site links to most,
// so a host registers them once at mount.
let builtInRoutes: PageChoice[] = [];

/** Register code-defined routes for the picker. Called by `mountSections`; safe to
 *  call repeatedly (last write wins). */
export function setBuiltInRoutes(routes: PageChoice[] | undefined): void {
  builtInRoutes = routes ?? [];
}

/** Reset the module-level caches. Tests only — a stale page list would leak
 *  across cases. */
export function resetLinkFieldCache(): void {
  pagesCache = null;
  builtInRoutes = [];
}

/**
 * Destination editor: a page picker plus a free URL field.
 *
 * Commits on change/blur rather than per keystroke — the sections inspector
 * re-renders the section through the fragment route on commit, and doing that
 * mid-word would yank the input out from under the cursor.
 */
export function LinkField(props: {
  href: string;
  onChange: (href: string) => void;
  /** Labels the URL input for assistive tech; defaults to "Link URL". */
  ariaLabel?: string;
}) {
  const [pages, setPages] = createSignal<PageChoice[]>(pagesCache ?? []);
  const [url, setUrl] = createSignal(props.href);

  // Built-ins lead: they're the hand-authored routes a site links to most, and
  // they can't be confused with content the editor might rename.
  const choices = (): PageChoice[] => [...builtInRoutes, ...pages()];

  onMount(() => {
    if (pagesCache) return;
    void fetch("/api/louise/pages", { headers: { accept: "application/json" } })
      .then((r) =>
        r.ok ? (r.json() as Promise<{ pages?: { slug: string; title: string }[] }>) : { pages: [] },
      )
      .then((d) => {
        pagesCache = (d.pages ?? []).map((p) => ({ path: `/${p.slug}`, title: p.title }));
        setPages(pagesCache);
      })
      .catch(() => {
        // A failed page list degrades to the URL field alone — an editor can
        // still type a destination, which is the important half.
      });
  });

  return (
    <>
      <Show when={choices().length > 0}>
        <select
          class="louise-select"
          aria-label="Link to a page"
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (!v) return; // the "Link to a page…" prompt itself clears nothing
            setUrl(v);
            props.onChange(v);
          }}
        >
          <option value="">Link to a page…</option>
          <For each={choices()}>
            {(p) => (
              <option value={p.path} selected={url() === p.path}>
                {p.title}
              </option>
            )}
          </For>
        </select>
      </Show>
      <input
        class="louise-input"
        value={url()}
        placeholder="https://… or /path"
        aria-label={props.ariaLabel ?? "Link URL"}
        onInput={(e) => setUrl(e.currentTarget.value)}
        onChange={() => props.onChange(url())}
      />
    </>
  );
}
