---
title: The drawer
description: The package-provided, registry-driven back-office drawer for structured editing.
sidebar:
  order: 7
---

Inline editing covers text on the page. For structured, back-office work — lists
you reorder, records you create, media you manage — Louise gives you a **drawer**:
a SolidJS overlay summoned in edit mode and rendered over the live site under the
editor theme.

As of `louisecms@0.3.0` the drawer is a **package-provided shell**, not a pattern
you hand-assemble. You call [`mountDrawer`](/reference/client/#louisecmsclientdrawer)
with a config, and the shell renders the chrome, the fixed framework panels, and
your registered collection tabs. It pairs with the [`louisecms/editor`](/reference/editor/)
handlers on the server, which back the framework panels.

## Mounting

The drawer opens from the edit bar's **Settings** button, which dispatches the
`louise:open-drawer` event `mountLouise` fires. Mount both in your edit-mode
entry point:

```tsx
import { mountLouise } from "louisecms/client";
import { mountDrawer, OPEN_DRAWER_EVENT } from "louisecms/client/drawer";
import { ProductsPanel } from "./products-panel";
import { InquiriesPanel } from "louisecms/client/drawer";

export function mountEditMode(userName: string) {
  mountDrawer({
    userName,
    // Bottom group — your own collections, registered as tabs.
    tabs: [
      { id: "products", label: "Products", panel: () => <ProductsPanel /> },
      { id: "inquiries", label: "Inquiries", panel: () => <InquiriesPanel /> },
    ],
  });
  mountLouise({
    onOpenDrawer: () => window.dispatchEvent(new CustomEvent(OPEN_DRAWER_EVENT)),
  });
}
```

`mountDrawer` injects the shared stylesheet, creates one `QueryClient` for every
panel, applies `data-theme="louise"` to its root (so the chrome never inherits
the site's theme), and is idempotent under Astro view-transition re-runs.

## Two groups

The layout has a **first-class split**, encoded in the config type so a site
can't collapse it:

- **Top strip — fixed framework panels.** **Pages**, **Media**, and **Settings**,
  rendered as icon buttons. These are near-identical on every Louise site, so the
  shell owns them; you don't register or reorder them. They talk to the generic
  [`louisecms/editor`](/reference/editor/) endpoints (`/api/louise/pages`,
  `/api/louise/media`, `/api/louise/settings`).
- **Bottom tabs — your collections.** Everything whose shape and display vary per
  site: your bespoke record types, registered as `CollectionTab`s via `tabs`.

**Inquiries** is a Louise base table, but _how_ a submission is shown varies too
much to fix in the shell — so it ships as a registerable tab (the default
`InquiriesPanel`, customizable via `renderRow`), not a fixed framework panel. Add
it to `tabs` like any other collection.

## Extending Settings

The Settings panel is framework-owned, but its _contents_ are the common base
(mapped 1:1 to [`siteSettingsColumns`](/reference/db/) — identity,
appearance, navigation, contact, SEO) **plus your additions**. Declare extra
fields with `settingsExtension`; they render in the same panel and persist to the
`site_settings.custom` JSON via the [`settings` handler](/reference/editor/)'s
site-declared keys:

```tsx
mountDrawer({
  userName,
  settingsExtension: [
    {
      title: "Coffee",
      fields: [
        { key: "roastNote", label: "Default roast note" },
        { key: "showClub", label: "Show the club banner", type: "toggle" },
      ],
    },
  ],
  // Escape hatch for bespoke sections that self-persist (e.g. passkey enrollment).
  settingsExtras: () => <PasskeySection />,
});
```

Field `type` is one of `text` (default), `textarea`, `color`, `toggle`, `image`
(with a media-library picker), or `links` (a label/href list editor); for
anything else, give a field a `render` function. A key you didn't declare is
ignored server-side — never written — because the handler's allowlist is
authoritative.

A site whose settings don't map to `siteSettingsColumns` (and keeps its own
storage + `settings` route) can replace the framework base groups entirely with
`settingsBaseGroups` — pass `[]` to show none, so only your `settingsExtension`
fields render:

```tsx
mountDrawer({
  userName,
  settingsBaseGroups: [], // hide the framework base fields this site doesn't use
  settingsExtension: [
    /* the site's own settings groups */
  ],
});
```

## Building a collection panel

A `CollectionTab`'s `panel` is any Solid component. Reuse the drawer's
[data layer](/reference/client/#louisecmsclientdrawer) and the shared field
primitives so your panels match the framework ones:

```tsx
import { useQuery } from "@tanstack/solid-query";
import { apiGet, louiseQueryKey, Section } from "louisecms/client/drawer";
import { Icon, RichText } from "louisecms/client";

function ProductsPanel() {
  const query = useQuery(() => ({
    queryKey: louiseQueryKey("products"),
    queryFn: () => apiGet<{ products: Product[] }>("/api/louise/products"),
  }));
  // …render your list, reusing Icon / RichText / Section / the louise-* classes.
}
```

`Icon` renders the same Phosphor set as the toolbar, and `RichText` is the exact
editor inline fields use — so a drawer form and an inline field edit prose
identically. See the [client reference](/reference/client/) for the full
export list.

## Built-in pages

If your site has code-defined routes (Home, About…) that aren't `pages` rows but
belong in the Pages panel list, pass them as `builtInPages` — each gets an
"Edit on page" deep link into inline edit mode:

```ts
mountDrawer({
  userName,
  builtInPages: [
    { key: "home", title: "Home", path: "/" },
    { key: "about", title: "About", path: "/about" },
  ],
});
```
