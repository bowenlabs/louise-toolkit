---
title: client
description: "louise-toolkit/client—the inline-edit client, ProseKit editor, icons, and blocks."
sidebar:
  order: 3
---

```ts
import {
  mountLouise,
  RichText,
  mountRichText,
  Icon,
  icons,
  BLOCKS,
  BlockInserter,
  defineBlock,
  mountSections,
  injectStyles,
} from "louise-toolkit/client";
```

The browser-side editor. This is the only subpath that touches the DOM and Solid;
peer dependencies: `solid-js`, `prosekit`, `@prosekit/pm`.

## `mountLouise()`

```ts
function mountLouise(opts?: {
  onOpenSettings?: () => void;
  versionedPageId?: number;
  autoSave?: boolean | { debounceMs?: number };
}): void;
```

Finds every `[data-louise-field]` marker on the page, makes each editable in
place (plain text via `contenteditable`, rich text via the ProseKit editor), and
mounts the edit bar. **Self-gating**—if no markers are present it does nothing,
so it's safe to lazy-import and call on any page. See
[Inline editing](/guide/inline-editing/).

- `versionedPageId`—opt this page's inline edits into the draft workflow: saves
  stage a draft on this page id and a **Publish** button promotes it, instead of
  writing each field live.
- `autoSave`—persist edits automatically on an idle debounce (default `800ms`),
  reusing the same save (a live field write, or a draft when versioned). **On by
  default**; the manual Save / Save draft button is then dropped in favour of a
  live status line (**Publish** stays). Pass `false` to opt out, or
  `{ debounceMs }` to tune the delay. Auto-save **never publishes**.

## `louiseNavigation` · `onLouiseNavigate(phase, handler)`

```ts
const louiseNavigation: { beforeSwap(): void; afterSwap(): void };
function onLouiseNavigate(phase: "before-swap" | "after-swap", handler: () => void): () => void; // returns an unsubscribe
```

The page-lifecycle seam. If your site uses **soft navigation**—a router that
swaps the DOM without a page load—wire these two calls, or pending edits are
silently dropped on every navigation.

```ts
// Astro, with view transitions:
import { louiseNavigation } from "louise-toolkit/client";

document.addEventListener("astro:before-swap", louiseNavigation.beforeSwap);
document.addEventListener("astro:after-swap", louiseNavigation.afterSwap);
```

:::caution[Nothing errors if you forget]
A soft navigation fires none of `pagehide`, `beforeunload` or
`visibilitychange`, so without `beforeSwap` the last edit before a navigation is
lost. There is no warning—the editor simply stops saving on soft navs. Hard
navigations are unaffected; Louise wires those browser events itself.
:::

`beforeSwap` flushes pending auto-saved edits from the page editor and the
section dock, and disposes the settings drawer before its DOM is replaced.
`afterSwap` drops the now-defunct editor, clears the mount guard so the next page
mounts cleanly, and closes the realtime socket so it cannot leak across the
navigation.

Both are safe to call when nothing is mounted and safe to call repeatedly, so
wire them once for the document's lifetime. A site with no soft navigation calls
neither and loses nothing.

**Why you wire it rather than Louise.** The client used to listen for
`astro:before-swap` directly, which put one framework's event names inside a
library that is meant to work anywhere—and meant the editor could only ever
integrate with that framework's router. `onLouiseNavigate` is the same seam from
the inside, for code that needs the signal without knowing what produced it.

## `RichText` / `mountRichText`

The ProseKit (Solid) editor used identically by inline fields and by any
Settings form you build.

```tsx
import { RichText, type RichTextProps } from "louise-toolkit/client";

<RichText
  value={html}
  onChange={(next) => save(next)}
  // `blocks` turns on the builder slash menu; omit for plain prose.
/>;
```

`mountRichText` is the imperative mount used internally by `mountLouise`;
`RichText` is the Solid component for your own forms. Storage is **HTML**, not
JSON (see [Rich text](/guide/rich-text/)). Exported types: `RichTextProps`,
`RichTextField`.

## `Icon` / `icons`

The Phosphor icon set the toolbar and panels share, inlined as raw SVG (CSP-safe—no external requests).

```tsx
import { Icon, type IconName } from "louise-toolkit/client";

<Icon name="pencil" />;
```

`icons` is the registry; `IconName` is the union of available names.

:::note[Credit]
The icons are [Phosphor Icons](https://phosphoricons.com) (MIT © Phosphor Icons),
inlined at build time. See the package's `THIRD_PARTY_NOTICES.md`.
:::

## Blocks

The builder framework (see [Louise Builder](/guide/builder/)):

```ts
import {
  BLOCKS,
  BlockInserter,
  BlockInserterButton,
  defineBlock,
  defineBlocksExtension,
  type BlockDef,
  type BlockEntry,
} from "louise-toolkit/client";
```

- `BLOCKS`—the registry that drives the `/` slash menu.
- `defineBlock` / `defineBlocksExtension`—author blocks outside the core set.
- `BlockInserter` / `BlockInserterButton`—the inserter UI.

## `mountSections()`

```ts
function mountSections(
  el: HTMLElement,
  opts: {
    catalog: SectionCatalog;
    pageId: number;
    initial: SectionItem[];
    autoSave?: boolean | { debounceMs?: number };
  },
): () => void;
```

The editor for [Louise Sections](/guide/sections/)—component-rendered pages
whose content is stored as typed JSON, not HTML. Takes over `el` (the wrapper
around the server-rendered sections): visible text nodes marked with
`data-louise-node="<path>"` become editable in place when the catalog says the
field is inline, and the rest get on-canvas chrome—a ring plus a toolbar that
moves, deletes, and adds, with a wrench for the fields you can't click (arrays,
images, `inline: false`). Text saves `PATCH` the whole `sections` array to the
pages route; structural changes persist and reload. Returns a disposer.

The toolbar is derived, not hardcoded: the editor resolves each marker's path
against the catalog, and the chrome draws move/delete for a node with a position,
an add for one that holds children, and a wrench for one with configurable
fields. `"0"` is a section, `"0.blocks.1"` a block, `"0.ctaHref"` a single field
whose wrench opens a field-scoped inspector.

`autoSave` (default **on**) stages a **draft** on an idle debounce as you edit in
place, dropping the manual Save draft button (Publish stays, and is never
automated). Structural changes keep their own save+reload. Pass `false` to opt
out, or `{ debounceMs }` to tune the delay. Exported types: `SectionCatalog`,
`SectionDef`, `SectionField`, `SectionItem`, `SectionsEditorProps`, `AutoSaveOption`.

## `injectStyles()`

```ts
function injectStyles(): void;
```

Ensures the shared Louise stylesheet (and edit-mode fonts) is present, even on a
page that has no inline fields—call it before opening Louise Settings on a bare page.

## `louise-toolkit/client/settings`

The **Louise Settings**—a registry-driven SolidJS shell with a fixed top strip of
framework panels (Pages/Media/Settings) and a bottom group of site-registered
collection tabs. Optional peer: `@tanstack/solid-query`. See
[Louise Settings](/guide/settings/) for the full walkthrough; it pairs with the
[`louise-toolkit/editor`](/reference/editor/) handlers on the server.

### Shell

```ts
import { mountSettings, OPEN_SETTINGS_EVENT } from "louise-toolkit/client/settings";
import type { SettingsConfig, CollectionTab } from "louise-toolkit/client/settings";
```

- `mountSettings(config)`—inject the stylesheet, create the shared `QueryClient`,
  and render Louise Settings into a body-appended root. Idempotent. Opens on
  `OPEN_SETTINGS_EVENT` (`"louise:open-settings"`).
- `SettingsConfig`—`{ userName, tabs?, builtInPages?, settingsBaseGroups?, settingsExtension?, settingsExtras? }`.
  `tabs` is the bottom group (site collections); the top strip is fixed and can't
  be registered into. `settingsBaseGroups` overrides which framework Settings
  groups render (pass `[]` for a site that keeps its own settings shape).
- `CollectionTab`—`{ id, label, panel: () => JSX.Element }`.
- `Settings`—the underlying component, if you provide your own `QueryClientProvider`.

### Panels

```ts
import {
  PagesPanel,
  MediaPanel,
  SettingsPanel,
  InquiriesPanel,
} from "louise-toolkit/client/settings";
```

- `PagesPanel` / `MediaPanel` / `SettingsPanel`—the fixed framework panels the
  shell renders in the top strip. `SettingsPanel` takes `baseGroups` (override
  which framework groups show—omit for all of `SETTINGS_BASE_GROUPS`),
  `extension` (declarative `SettingsFieldGroup[]`), and `extras` (a render slot).
- `InquiriesPanel`—the default panel for an Inquiries **tab** (register it in
  `tabs`), customizable via `renderRow`.

### Field primitives + settings extension

```ts
import {
  Section,
  LinkListEditor,
  ImageField,
  MediaUrlPicker,
  SettingsField,
} from "louise-toolkit/client/settings";
import type {
  SettingsFieldGroup,
  SettingsFieldDef,
  SettingsFieldType,
} from "louise-toolkit/client/settings";
```

The primitives the framework panels are built from—reuse them so your own tabs
and Settings extension groups match. A `SettingsFieldDef` is
`{ key, label, type?, hint?, placeholder?, render? }`; `SettingsFieldType` is
`text | textarea | color | toggle | image | links`. For a field none of the
built-in types cover (a label/value row list, a microcopy grid, a per-page SEO
editor…), give it a `render: ({ value, onChange }) => JSX.Element`—it persists
to `key` through the same save flow. `SETTINGS_BASE_GROUPS` exports the default
framework groups so a site can cherry-pick them into a custom `baseGroups`.

`ImageField` (an image field with a live preview + the media-library picker) is
**strict by default**: the value comes from an upload or the library, so there's
no free-form URL box to hotlink an external image
([strict media](/guide/media/#strict-media-every-image-from-the-library)). Opt-ins:
`upload` adds an upload-into-slot button (POSTs to the media route, refreshes the
media list, sets the field to the returned URL); `transform(url)` resizes the
preview thumbnail only (for example, a CDN resizer like `cfImage`); and `allowUrl` brings
back the raw-URL text input for a site that knowingly wants it. All default off.

`MediaPicker` is the query-free variant of `MediaUrlPicker` for surfaces mounted
outside the Settings' TanStack Query provider (for example, the sections inspector)—it
powers **Choose from media** on section `image` fields.

### Data layer

```ts
import {
  createSettingsQueryClient,
  apiGet,
  apiSend,
  louiseQueryKey,
  louiseQueryKeys,
} from "louise-toolkit/client/settings";
```

- `createSettingsQueryClient()`—a `QueryClient` tuned for the editor-only Settings
  (no window-focus refetch, 30 s stale, one retry).
- `apiGet<T>(url)` / `apiSend<T>(method, url, body?)`—typed JSON fetch that
  throws on a non-2xx status.
- `louiseQueryKey(collection, …rest)`—namespaced query key; `louiseQueryKeys`
  holds the framework-generic ones (`pages`, `media`, `settings`, `inquiries`).

### Building your own panel: which TanStack packages to use

`@tanstack/solid-query` is an optional peer and the panels above run on it. The
rest of TanStack's Solid adapters vary enormously in maturity, so the short
version—the reasoning is in
[ADR 0011](https://github.com/bowenlabs/louise-toolkit/blob/main/docs/adr/0011-tanstack-on-solid.md):

|           |                                                                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Query** | Adopted, already load-bearing. Its Solid adapter takes accessor functions, so options stay reactive.                                                |
| **Form**  | Fine, with a caveat—build your most nested, array-heavy form **first**, not last. Several open upstream issues land on exactly that shape on Solid. |
| **Table** | **Read-only tables only.** See below.                                                                                                               |
| **Pacer** | Not adopted. Use `createSignal` + `setTimeout` + `onCleanup`, or `@solid-primitives/debounce`.                                                      |

**`@tanstack/solid-table` is wrong for editable grids**, and this is a standing
constraint rather than a bug awaiting a fix—both upstream issues have been open
over two years:

- [table#4702](https://github.com/TanStack/table/issues/4702)—with a Solid
  store, cell values don't propagate; only replacing the whole `data[]` works.
- [table#5019](https://github.com/TanStack/table/issues/5019)—following the
  official Solid examples, **every row and cell** re-renders on any data change.

So an inline-edit inventory or pricing grid re-renders wholesale on every
keystroke, which is the opposite of why you'd pick Solid. The known workaround—replacing `flexRender` with manual rendering—breaks row selection and column
ordering.

`flexRender` is genuinely fine for **read-only** tables: reports, sortable or
groupable lists, column visibility. That's Table's real strength.

**For server-paginated CRUD lists, prefer neither.** When filter, sort and
pagination happen in SQL, a plain `<For>` plus a sort signal is less code, less
bundle, and keeps granular reactivity. Table's value is _client-side_ row
modelling—if D1 is already doing that work, Table is paying for nothing.

## `louise-toolkit/client/studio`

```ts
import { mountStudio } from "louise-toolkit/client/studio";

mountStudio({ title: "Acme Studio", users: true, signInPath: "/studio/login" });
```

The same editor as a **full-page admin app** rather than a drawer over a live
page. Both presentations render the same panels—Home, Media, Pages, Settings,
Users, and your registered tabs—so they cannot drift about which panels exist;
only the chrome differs. The drawer adds a scrim, a dialog role, a focus trap and
a close button. The studio adds none of those, because it is simply always open.

Its **own subpath**, so a marketing page that only opens the drawer doesn't pull
the studio into its bundle, and a studio route doesn't pull the drawer's scrim and
focus trap into its.

Config is `SettingsConfig` minus the drawer-only bits, plus:

|              |                                                                              |
| ------------ | ---------------------------------------------------------------------------- |
| `title`      | Header text. **Static config—a site name, never an editor name.** See below. |
| `signInPath` | Where to send the browser on a 401. Default `/signin`.                       |
| `target`     | Element or selector to render into. Omit for a body-appended root.           |

`mountStudio` is idempotent on the default root and returns a disposer, so a
router can unmount the island cleanly.

### Two constraints worth understanding

**The shell renders no data and no session-specific markup.** Every panel fetches
through `/api/*` on mount, so the HTML is identical for every editor and for a
signed-out visitor—which is what makes it precacheable by a service worker
(pair with [`PwaConfig.offlineFallback`](/reference/astroid/#pwa)). Baking a name
or a row count into the shell either stops it being cacheable or, worse, gets it
cached and served to the next person. That's why `title` is a site name.

**A 401 is a navigation, not an empty state.** A full-page studio can't degrade to
"render the public page" the way the drawer can—there is no page underneath it.
So a 401 from any panel query sends the browser to `signInPath`, handled centrally
rather than per panel: the panel that forgot would render an empty list that reads
as "no data" instead of "signed out". 401 responses are also never retried, so the redirect
isn't delayed by a backoff.

### A routed app inside an Astro island

`@tanstack/solid-router` works inside a `client:only="solid-js"` island—verified
against `astro@7.1.6` + `@tanstack/solid-router@1.170.18`. It is undocumented
upstream, so the shape is worth stating.

Two pieces. An Astro **catch-all** that serves every sub-path to the same island,
so a deep link or a refresh reaches the router at all:

```astro
---
// src/pages/app/[...path].astro
import App from "../../components/App.tsx";
export const prerender = false; // or getStaticPaths() for a static build
---

<html><body><App client:only="solid-js" /></body></html>
```

And the router itself, either with literal prefixed paths (`/app/orders`) or with
`basepath: "/app"` and root-relative ones. **Both work**; router
[#4888](https://github.com/TanStack/router/issues/4888) is filed against
`@tanstack/solid-start` and doesn't apply here.

`client:only`, not `client:load`—there is no SSR pass, so there is no hydration
mismatch to reason about.

:::caution[Check trailing slashes before you ship]
Astro's static build emits directory-style URLs (`/app/orders/` → `index.html`),
while the router writes history entries **without** a trailing slash
(`/app/orders`). So the URL a user copies after navigating isn't the one Astro
emitted. `astro preview` serves both—that's the preview server being lenient—so confirm the behaviour on your actual deploy. This is the class of thing that
works in dev and returns 404 in production.

Serving the app from its own subdomain sidesteps it: with a host rewrite the
browser only sees root paths, and `basepath` is just `/`.
:::

**Not TanStack Start.** It owns its own Vite build graph on Cloudflare and so
wants its own Worker, which is incompatible with the single-Worker composition
here—`composeWorker` composes handlers, not builds. A standalone router in an
island keeps one Worker, one build, one auth surface.
