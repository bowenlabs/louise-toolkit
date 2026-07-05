---
title: The drawer pattern
description: Structured, back-office editing rendered over the live site.
sidebar:
  order: 6
---

Inline editing covers text on the page. For structured, back-office work — lists
you reorder, records you create, media you manage — Louise apps use a **drawer**:
a SolidJS overlay summoned in edit mode and rendered over the live site under the
editor theme.

:::note[This is a pattern, not a prebuilt component]
Louise gives you the building blocks — the client's `Icon`/`RichText` exports,
[`injectStyles`](/docs/reference/client/), the editor [theme](/docs/guide/theme/),
and the [CMS](/docs/reference/cms/) primitives. The drawer itself is assembled by
the host app, because its tabs and panels are inherently app-specific (a
portfolio site and a docs site want different back offices). This guide describes
the shape the reference app uses so you can build your own.
:::

## Shape

The drawer opens from the edit bar's **Settings** button (which dispatches a
`louise:open-drawer` event that `mountLouise` fires). It renders over the live
site with the editor theme applied to its root — `data-theme="louise"` — so the
chrome never inherits the site's own theme.

Inside, purpose-built managers beat generic schema-driven forms. The reference
app organises them as tabs and header-icon overlays:

- **Tabs** — the primary record types (portfolio, shop, clients, invoices,
  orders).
- **Header overlays** — cross-cutting tools: Media, Pages, and Settings
  (navigation, socials, SEO defaults, microcopy, sign-out).

Each panel talks to the host app's own API routes, which in turn use the Louise
primitives ([`db`](/docs/reference/db/), [`cms`](/docs/reference/cms/),
[`commerce`](/docs/reference/commerce/)).

## Reusing the editor chrome

To keep the drawer visually consistent with inline editing, render the same
pieces:

```tsx
import { Icon, RichText, injectStyles } from "@louisecms/core/client";

// Ensure the shared Louise stylesheet is present even on pages with no inline
// fields (so a drawer opened on a bare page still styles correctly).
injectStyles();
```

`Icon` renders the same Phosphor set as the rich-text toolbar, and `RichText` is
the exact editor inline fields use — so a drawer form and an inline field edit
prose identically.
