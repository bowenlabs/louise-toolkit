# ADR 0019: One owner interface: the owner bar, `/louise`, and support

- **Status:** Proposed (2026-09-26)
- **Deciders:** Baylee (solo maintainer)
- **Related:** ADR 0018 (design principles), ADR 0010 (the editable-node model), ADR 0011 (TanStack on Solid), ADR 0004 (edge caching), ADR 0012 (API boundary), ADR 0016 (privacy-first), issues #468, #480, #542, #543, #597, #598, #603

## Context

ADR 0018 sets the principles. This ADR records the design that meets them and the order it ships in. Everything below is grounded in the code on `main` at the time of writing.

The seams the design hangs on:

- `mountLouise` builds the bottom bar in plain DOM and owns Save, Publish, Settings, and Sign out. `mountSections` finds that bar by a DOM selector and injects its own buttons into a slot, falling back to a fixed strip when the bar isn't there. Three window events tie the surfaces together.
- The Settings drawer and the full-page studio already share one panel set (`client/settings/surface.tsx`); only the frame differs. A third frame, on TanStack Router, exists for routed studio apps.
- Ring color is a function of the node's tone, with five box-shadow rules and five toolbar backgrounds. The chrome's stylesheet declares color-named tokens and hard-codes `data-theme="louise"`; the package theme's `--louise-ring` and `--louise-accent` are defined and unread.
- Edit mode is a sticky cookie set by `?louise`, and the edge cache bypasses only on that cookie. A signed-in owner with edit mode off is a public GET to the cache.
- The kit middleware renders the public page when `?louise` arrives without a session; the reference site's own middleware redirects to its sign-in page instead.
- The reference site signs in with one shared password and an HMAC cookie, outside the kit's auth. No sign-in page ships in the kit; every site hand-writes one.
- Site settings write live on PATCH. There's no settings draft and no versions table for the singleton.
- The adapter package ships only JavaScript, and its export map already tolerates a `./components/*.astro` wildcard.

## Decision

Seven design decisions, then the sequence that ships them.

### 1. An editing-session registry replaces DOM negotiation

A small registry in the client (`registerEditingSurface`, `subscribeEditingSession`) lets each surface (inline fields, sections, and later settings) announce whether it has changes, its status, and how to publish. The owner bar's single Publish publishes every registered surface ("Publish 2 changes"). The DOM selector, the fallback strip, and the three cross-mount events go.

### 2. One shell, two presentations, one screen model

`OwnerShell` renders the existing panel set plus two new panels, Attention and Help, under an `OwnerBar`. Its presentation is `overlay` (over the live page, with a scrim and dialog semantics) or `page` (at `/louise`). Screens are a pure model (`ownerScreenFromPath`, `ownerHref`) with two stores: the URL hash in the overlay, so Back works over the live page, and the path on `/louise/<screen>`. No TanStack Router. The routed studio frame stays for sites that build custom routed apps, and ADR 0011 is amended to say so.

### 3. Chrome tokens are self-contained

Role tokens live in the injected stylesheet, light under `:root` and dark under `prefers-color-scheme: dark` and `[data-louise-scheme="dark"]`. They don't derive from daisyUI variables, because the reference site defines its own themes named `louise` and `louise-dark`, so the chrome's `data-theme="louise"` root resolves to the site's theme there. The package theme keeps its block as an optional override, and its scope note is amended. Renaming the package themes to `louise-editor` is left as an option for PR 1 if the collision bites.

### 4. One ring and a toolbar tag

`NodeDescriptor` gains `source`, the external system's label. A pure `nodeTagText(desc)` yields "Hero · section," "Button · block," "Footer · shared," "Products · from Square." Tone stays as a semantic that tests and the tag read, and stops selecting a color. ADR 0010 is amended.

### 5. Settings get a draft

A `site_settings_versions` table through the existing versions helper, a `settingsRoute({ versions })` option that stages a PATCH through the draft path, a publish endpoint, and `resumeSettings()` so server-side rendering in edit mode shows the staged values. This is what makes "nothing is live until you publish" true for settings, lets one Publish cover pages and settings, and makes a settings preview survive navigation and a second editor.

### 6. Support is a small D1 module behind an editor-gated route

`louise-toolkit/support`: `support_tickets` (subject, status `open`, `answered`, or `closed`, who opened it, the page they were on, a context object holding only the toolkit version and site name) and `support_messages` (ticket, author `owner` or `support`, plain-text body with a cap). `supportRoute` mounts at `/api/louise/support` with the editor guard and the same-origin check on mutations, and exposes an `onOpened` hook so louise-ops can be told a ticket exists without the kit knowing about louise-ops. The overview route gains a `support` slice for the Attention panel. The operator side is in louise-ops, per ADR 0016.

### 7. `/louise` is kit-provided through an Astro integration

`@louise-toolkit/astro` gains `louiseOwner()`, which injects `/louise/[...screen]` and a virtual module for the site's owner config, a `pages/owner.astro` that renders the sign-in island when signed out and mounts the shell in page presentation when signed in, `components/SignIn.astro` for sites that want their own layout, and `louiseAuthRoute()` for the auth catch-all. The middleware gains `ownerPath`: `?louise` without a session redirects to `/louise?next=`, and every response under `/louise` is `noindex` and `no-store`. The sign-in island (`louise-toolkit/client/sign-in`) does magic link plus passkey, is enumeration-safe, and lives on its own subpath so auth client code stays out of every other bundle.

### The sequence

Ten pull requests, each passing the full check suite alone. Every behavior change ships as a `minor` changeset, pre-1.0.

| PR  | Ships                                                                                                                                                                                                                      | Closes                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 0   | This ADR and ADR 0018; amendments to 0004 (bypass on the session cookie, `/louise` never cached), 0010, and 0011                                                                                                           | #608                   |
| 1   | Role tokens, one ring rule, the toolbar tag, 44 px targets, forced-colors outline; section add inserts below like blocks                                                                                                   | #542, #543, #603       |
| 2   | `rem` type scale, `lang` on every chrome root, "opens in a new tab"                                                                                                                                                        | #598                   |
| 3   | The support module, `supportRoute`, the overview slice                                                                                                                                                                     | support, kit half      |
| 4   | Loading, empty, and error primitives; migrate the panels                                                                                                                                                                   | #468                   |
| 5   | The registry, the owner bar and shell (additive), the Attention and Help panels                                                                                                                                            | #597, #480 first slice |
| 6   | The sign-in island, the session-cookie cache bypass, `ownerPath`, `louiseOwner()`, `louiseAuthRoute()`                                                                                                                     | the owner entry        |
| 7   | The reference site onto kit auth and the kit `/louise` (provision Email Sending and the session secret first)                                                                                                              | the shared password    |
| 8   | The settings draft                                                                                                                                                                                                         | settings preview       |
| 9   | On-canvas editors for image, link, toggle, select, and color fields; the inspector keeps only anchorless fields; live settings preview through CSS variables, marker sync, and fragment re-render with a settings override | the canvas             |
| 10  | Retire the bottom bar, the drawer-versus-studio split, and the events; `mountSettings` and `mountStudio` become deprecated aliases over `mountOwner` for one minor                                                         | the old shells         |

## Consequences

- **Sites that call `mountSettings` or `mountStudio` today** (astroidjs's bootstrap and the client sites) move to `mountOwner` during the one-minor overlap. `OPEN_SETTINGS_EVENT` keeps working, so a site's own Settings button doesn't break first.
- **The edge cache bypasses on the session cookie**, not only the edit cookie, because the owner bar makes "signed in, edit mode off" a common state. A settings publish touches every page and the cache has no wildcard purge, so publish iterates the site's slugs, or accepts the 60-second floor and says so.
- **The reference-site cutover deploys production on merge.** Email Sending is onboarded for the domain first, or nobody can sign in. It's verified on a preview deploy, and the shared-password page can stay one deploy longer behind a flag.
- **The settings draft buffer is a singleton key** shared by every editor, last write wins per key. Acceptable for an owner plus an engineer. Settings validation hooks live on the collection, not only in the route, so a buffered value doesn't skip them.
- **Field types change their default.** `image`, `link`, `toggle`, `select`, and `color` become inline by default. A section whose render marks none of them still reaches those fields through the inspector, which is the load-bearing case PR 9 tests.
- **Every new core module** needs `exports`, a build entry, and a knip entry, or the export-map check fails the build.

## Alternatives considered

- **Keep the drawer and add an owner home page.** Rejected: it leaves three shells and adds a fourth.
- **TanStack Router for the owner shell.** Rejected: the screen model is small, and a hash-backed overlay over the live page is simpler than a router in a dialog.
- **Derive chrome tokens from the site's daisyUI theme.** Rejected for the collision in decision 3.
- **Tickets in louise-ops with a widget in the site.** Rejected by ADR 0016; the site keeps the rows.
- **A sign-in page per site, as today.** Rejected: three hand-written pages already differ, and the owner app needs one contract.
