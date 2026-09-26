# ADR 0018: The editor's design principles

- **Status:** Proposed (2026-09-26)
- **Deciders:** Baylee (solo maintainer)
- **Issue:** #608
- **Related:** ADR 0005 (inline section and block editing), ADR 0010 (the editable-node model), ADR 0019 (one owner interface), ADR 0016 (privacy-first)

## Context

The editor grew one surface at a time. Today an owner meets a bottom edit bar, a right-hand Settings drawer, a full-page studio with the same panels, a floating node toolbar, an inspector popover, add palettes, a version-history drawer, and a rich-text toolbar. Editable nodes ring in five colors: orange for a section, blue for a block, violet for a value, green for a shared value, and a dark yellow for an external source. The color model came from one client's editor vision doc, which reasoned that "ring color equals what it is." It's accurate and it's too much to learn.

Two things make the noise worse. The chrome's colors are fixed light values that read no theme token, so it can't go dark or follow a site. And site settings are edited in a form panel, separate from the page, while a section's fields are edited on the page: the same owner learns two places for two halves of the same site.

The principles below exist so the redesign in ADR 0019, and every editor change after it, can be checked against something written down. Each principle names what it settles and what it rejects.

## Decision

### 1. The live page is the editor

What you see in edit mode is what publishes. Text, images, buttons, links, and any setting with an on-page presence are edited where they appear, on the canvas. A form panel is for what has no on-page anchor: a page's metadata, a new page, who can sign in, and settings the page never shows. The inspector popover shrinks to the same rule: it opens from the node toolbar only for fields the section's render doesn't mark.

Rejected: a separate administration app, and a form-first editor with a preview pane.

### 2. One ring, and the label says what it is

Every editable node gets the same ring color. The node toolbar carries a short tag that names the node and, when it comes from somewhere else, where from: "Hero · section," "Button · block," "Footer · shared," "Products · from Square." Color no longer encodes kind or source; the tag does, in words an owner reads.

Rejected: the five-tone model, and a two-color model (content versus external) that still asks an owner to remember a legend.

### 3. One bar, one shell

After sign-in, one persistent bar at the top of the page holds everything an owner does: the edit toggle, Pages, Media, Settings, what needs attention, Publish, Help, and the account. Screens and site settings open in one shell with two presentations (over the live page, or as a full page at `/louise`) and the same screens in both. There's no bottom bar, no separate studio, and no drawer-versus-page distinction for the owner to notice.

Rejected: a bar per surface, and a routed studio app that duplicates the overlay.

### 4. Nothing is live until the owner publishes

Publish is the bar's one primary action, and it publishes everything staged: page drafts, section drafts, and settings. Settings get a draft like pages have. Theme and settings changes show on the page before Publish, so an owner sees a new brand color or a new banner in place, then decides.

Rejected: settings that save live while pages stage, which the drawer does today.

### 5. Chrome colors are role tokens, and the chrome goes dark

The editor's stylesheet defines its colors as roles (surface, text, border, accent, ring, focus, success, warning, danger) with light and dark values, and every rule reads a role. The tokens are self-contained rather than derived from a site's theme, because a site theme can reuse the package's theme names and a derived token would then pick up the wrong values. A site can force a scheme; by default the chrome follows the reader's preference.

Rejected: fixed light values, and deriving from daisyUI's `--color-*` variables.

### 6. Every control is reachable and named

Every editor control has a 44 px target on a coarse pointer, a visible focus ring including under forced colors, an accessible name that says what it acts on ("Delete Hero"), and a keyboard path. The chrome declares its language and sizes from the reader's default text size.

Rejected: mouse-only affordances and icon-only buttons without names.

### 7. Owner vocabulary

The editor speaks the owner's language: "page," "section," "photo," "button," "publish," "who can sign in," "ask for help." It never says "collection," "node," "schema," "slug," or "draft version." A glossary (#537) gives each term one meaning, and the strings check (ADR 0013) lints every string an owner reads.

Rejected: content-management vocabulary in the interface.

### 8. No third-party scripts, and nothing an owner didn't send

The editor, the owner bar, and the sign-in page load nothing from a third party. Turnstile is the one exception, opt-in and on the sign-in page only. The Help panel sends exactly what it shows the owner it's sending. This is ADR 0016 applied to the editor.

## Consequences

- **ADR 0010's tone model stays as a semantic** (tests and the tag read it) and stops choosing a color. That ADR is amended when this one is accepted.
- **The editor vision doc in the client site** that introduced the color model is superseded here; a note there points to this ADR.
- **The redesign has an acceptance test.** Each principle is checked in the browser on the reference site before ADR 0019's PRs merge: one ring color and the right tags, one bar, a settings change previewed before Publish, 44 px targets at the mobile preset, dark mode following the pane, no third-party request in the network log.
- **Some changes are visible to owners on day one:** the ring colors, the bar's position, and where settings are edited. The upgrade note says so plainly.

## Alternatives considered

- **Keep the color model and document it.** Rejected: a legend is something to learn, and the tag says the same thing in words.
- **Redesign the drawer alone.** Rejected: the drawer is one of three shells, and the noise is the count.
- **A separate owner app instead of the live page.** Rejected by principle 1, and it would contradict the toolkit's headline.
