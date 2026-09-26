---
"louise-toolkit": minor
---

Studio document titles now use a pipe between the screen and the site, and each `mountStudio` panel titles the document. The house style keeps dashes for sentences and uses a pipe in page titles.

- **`screenTitle` defaults `separator` to `" | "`**, not a spaced em dash, so a routed studio's titles change from `Orders — Acme Studio` to `Orders | Acme Studio`. `StudioShell` uses `screenTitle`, so its titles change too.
- **`mountStudio` titles the document after the open panel or tab,** such as `Media | Acme Studio`, with `title` as the suffix (`Media | Studio` without one). The disposer puts the page's own title back.
- **The drawer's dialog is named `Settings`**, after the button that opens it, rather than `Louise explorer`. A test that finds the drawer by its accessible name needs the new one.
- **Status and error messages lose their spaced dashes.** For example, `Couldn’t save — this change hasn’t taken effect` is now `Couldn’t save. This change hasn’t taken effect.`, and the contact form's default success message is `Thanks—we'll be in touch.` A test that asserts the old wording needs the new one.

**What to do:** nothing, unless you want the old titles back. To keep `Orders — Acme Studio`, pass the separator yourself: `screenTitle(nav, pathname, { suffix, separator: " — " })`, or `title={{ suffix, separator: " — " }}` on `StudioShell`.
