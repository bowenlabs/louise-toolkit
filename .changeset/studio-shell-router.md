---
"louise-toolkit": minor
---

**New subpath: `louise-toolkit/client/studio-shell`, a routed studio's frame on TanStack Router.** `StudioShell` renders a skip link, a header with a labelled nav, and the matched screen. It sets a document title per screen, and after each navigation (not on first load) it moves focus to the new screen's heading, so a screen-reader user hears where they landed. The route tree, screens and router stay the site's. Every routed studio had rebuilt this frame by hand, and an accessibility audit found the title, focus and skip link missing each time.

`@tanstack/solid-router` (`^1.170.0`) is a new **optional** peer dependency. Install it only if you import `client/studio-shell`; nothing else in the toolkit needs it (ADR 0011, amended).

The behaviour is also available with no router, from `louise-toolkit/client/studio`: `screenTitle`, `focusScreenHeading`, `revealActiveNavLink` and `activeNavItem`. So are `studioBasepath(prefix)` and `studioHref(prefix, path)`, for a studio served under a path on one host and at the root of a subdomain on another. `studioBasepath` reads the loaded URL, so one build serves both. `studioHref` links to a server-rendered page beside the studio, such as a printable document, without the `/studio/studio/…` 404 a hard-coded path produces through the host rewrite.
