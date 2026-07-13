---
title: client
description: "louise/client — the inline-edit client, ProseKit editor, icons, and blocks."
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
} from "louise/client";
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
mounts the edit bar. **Self-gating** — if no markers are present it does nothing,
so it's safe to lazy-import and call on any page. See
[Inline editing](/guide/inline-editing/).

- `versionedPageId` — opt this page's inline edits into the draft workflow: saves
  stage a draft on this page id and a **Publish** button promotes it, instead of
  writing each field live.
- `autoSave` — persist edits automatically on an idle debounce (default `800ms`),
  reusing the same save (a live field write, or a draft when versioned). **On by
  default**; the manual Save / Save draft button is then dropped in favour of a
  live status line (**Publish** stays). Pass `false` to opt out, or
  `{ debounceMs }` to tune the delay. Auto-save **never publishes**.

## `RichText` / `mountRichText`

The ProseKit (Solid) editor used identically by inline fields and by any
Settings form you build.

```tsx
import { RichText, type RichTextProps } from "louise/client";

<RichText
  value={html}
  onChange={(next) => save(next)}
  // `blocks` turns on the page-builder slash menu; omit for plain prose.
/>;
```

`mountRichText` is the imperative mount used internally by `mountLouise`;
`RichText` is the Solid component for your own forms. Storage is **HTML**, not
JSON (see [Rich text](/guide/rich-text/)). Exported types: `RichTextProps`,
`RichTextField`.

## `Icon` / `icons`

The Phosphor icon set the toolbar and panels share, inlined as raw SVG (CSP-safe
— no external requests).

```tsx
import { Icon, type IconName } from "louise/client";

<Icon name="pencil" />;
```

`icons` is the registry; `IconName` is the union of available names.

:::note[Credit]
The icons are [Phosphor Icons](https://phosphoricons.com) (MIT © Phosphor Icons),
inlined at build time. See the package's `THIRD_PARTY_NOTICES.md`.
:::

## Blocks

The page-builder framework (see [Page builder](/guide/page-builder/)):

```ts
import {
  BLOCKS,
  BlockInserter,
  BlockInserterButton,
  defineBlock,
  defineBlocksExtension,
  type BlockDef,
  type BlockEntry,
} from "louise/client";
```

- `BLOCKS` — the registry that drives the `/` slash menu.
- `defineBlock` / `defineBlocksExtension` — author blocks outside the core set.
- `BlockInserter` / `BlockInserterButton` — the inserter UI.

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

The editor for [structured sections](/guide/sections/) — component-rendered pages
whose content is stored as typed JSON, not HTML. Takes over `el` (the wrapper
around the server-rendered sections): visible text nodes marked with
`data-louise-sfield` become editable in place, and a floating control dock adds /
reorders / removes sections and edits non-visible fields. Text saves `PATCH` the
whole `sections` array to the pages route; structural changes persist and reload.
Returns a disposer.

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
page that has no inline fields — call it before opening Louise Settings on a bare page.

## `louise/client/settings`

The **Louise Settings** — a registry-driven SolidJS shell with a fixed top strip of
framework panels (Pages/Media/Settings) and a bottom group of site-registered
collection tabs. Optional peer: `@tanstack/solid-query`. See
[Louise Settings](/guide/settings/) for the full walkthrough; it pairs with the
[`louise/editor`](/reference/editor/) handlers on the server.

### Shell

```ts
import { mountSettings, OPEN_SETTINGS_EVENT } from "louise/client/settings";
import type { SettingsConfig, CollectionTab } from "louise/client/settings";
```

- `mountSettings(config)` — inject the stylesheet, create the shared `QueryClient`,
  and render Louise Settings into a body-appended root. Idempotent. Opens on
  `OPEN_SETTINGS_EVENT` (`"louise:open-settings"`).
- `SettingsConfig` — `{ userName, tabs?, builtInPages?, settingsBaseGroups?, settingsExtension?, settingsExtras? }`.
  `tabs` is the bottom group (site collections); the top strip is fixed and can't
  be registered into. `settingsBaseGroups` overrides which framework Settings
  groups render (pass `[]` for a site that keeps its own settings shape).
- `CollectionTab` — `{ id, label, panel: () => JSX.Element }`.
- `Settings` — the underlying component, if you provide your own `QueryClientProvider`.

### Panels

```ts
import { PagesPanel, MediaPanel, SettingsPanel, InquiriesPanel } from "louise/client/settings";
```

- `PagesPanel` / `MediaPanel` / `SettingsPanel` — the fixed framework panels the
  shell renders in the top strip. `SettingsPanel` takes `baseGroups` (override
  which framework groups show — omit for all of `SETTINGS_BASE_GROUPS`),
  `extension` (declarative `SettingsFieldGroup[]`), and `extras` (a render slot).
- `InquiriesPanel` — the default panel for an Inquiries **tab** (register it in
  `tabs`), customizable via `renderRow`.

### Field primitives + settings extension

```ts
import {
  Section,
  LinkListEditor,
  ImageField,
  MediaUrlPicker,
  SettingsField,
} from "louise/client/settings";
import type {
  SettingsFieldGroup,
  SettingsFieldDef,
  SettingsFieldType,
} from "louise/client/settings";
```

The primitives the framework panels are built from — reuse them so your own tabs
and Settings extension groups match. A `SettingsFieldDef` is
`{ key, label, type?, hint?, placeholder?, render? }`; `SettingsFieldType` is
`text | textarea | color | toggle | image | links`. For a field none of the
built-in types cover (a label/value row list, a microcopy grid, a per-page SEO
editor…), give it a `render: ({ value, onChange }) => JSX.Element` — it persists
to `key` through the same save flow. `SETTINGS_BASE_GROUPS` exports the default
framework groups so a site can cherry-pick them into a custom `baseGroups`.

`ImageField` (an image field with a live preview + the media-library picker) is
**strict by default**: the value comes from an upload or the library, so there's
no free-form URL box to hotlink an external image
([strict media](/guide/media/#strict-media-every-image-from-the-library)). Opt-ins:
`upload` adds an upload-into-slot button (POSTs to the media route, refreshes the
media list, sets the field to the returned URL); `transform(url)` resizes the
preview thumbnail only (e.g. a CDN resizer like `cfImage`); and `allowUrl` brings
back the raw-URL text input for a site that knowingly wants it. All default off.

`MediaPicker` is the query-free variant of `MediaUrlPicker` for surfaces mounted
outside the Settings' TanStack Query provider (e.g. the sections dock) — it powers
**Choose from media** on section `image` fields.

### Data layer

```ts
import {
  createSettingsQueryClient,
  apiGet,
  apiSend,
  louiseQueryKey,
  louiseQueryKeys,
} from "louise/client/settings";
```

- `createSettingsQueryClient()` — a `QueryClient` tuned for the editor-only Settings
  (no window-focus refetch, 30s stale, one retry).
- `apiGet<T>(url)` / `apiSend<T>(method, url, body?)` — typed JSON fetch that
  throws on a non-2xx status.
- `louiseQueryKey(collection, …rest)` — namespaced query key; `louiseQueryKeys`
  holds the framework-generic ones (`pages`, `media`, `settings`, `inquiries`).
