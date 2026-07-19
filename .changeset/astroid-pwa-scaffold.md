---
"astroidjs": minor
"create-astroid": minor
---

Add the PWA scaffold (#259): a scoped service worker, a derived manifest, and `<RegisterSW>` — opt-in via `modules: ["pwa"]`.

**The scoping is the design, not a detail.** A Louise site is CMS-edited: someone signs in, flips edit mode on, and edits the live page in place. A service worker caching HTML across the whole origin would serve that editor a stale copy of the page they're trying to change — and the bug would present as *"my edits don't save"*, about as far from the cause as a report can get.

So the generated worker refuses to touch anything dynamic, even inside its own scope:

- `/api/*` — checkout, auth, and every Louise write. A cached POST response or a stale session is a correctness bug, not a speedup.
- editor and auth routes — the studio must always be live.
- **any URL carrying `?louise`** — that marks an edit-mode request, and caching one poisons it.

Outside the scope it doesn't intercept at all, which is why a narrower scope (`"/order"`) is usually the right answer: it keeps the worker off the marketing pages entirely.

Everything else is the ordinary split — navigations network-first with the cached page as the offline fallback, hashed `/_astro/*` assets cache-first since their names change when their content does. The precache is `allSettled`, so one 404 in the shell can't fail the install and leave the app with no worker at all; the cache name carries the project key, so two Astroid apps on one origin can't read each other's entries.

The manifest derives from the brand — name, theme colour, scope — and declares `any` and `maskable` icons as separate assets, because the platform crops a maskable icon to its own shape and the artwork needs padding the plain one shouldn't have. Icons are declared but not generated: a scaffold can't invent a brand's icon, and emitting placeholders would produce an installable app with a grey square for a face.

`<RegisterSW>` is a bundled `<script>`, never inline, so Astro hashes it into `script-src` and it works under the strict CSP. The scope rides on a `data-` attribute rather than being interpolated, since `define:vars` forces `is:inline` and per-render content can't be hashed. Registration failures are logged rather than swallowed — the app works without a worker, but a scope or MIME misconfiguration should be findable.

One deliberate difference from the reference: **`Service-Worker-Allowed` is not emitted.** That header is only needed for a scope *broader* than the script's own location, and `sw.js` sits at the root, so every scope is narrower. The reference sets it anyway (its own code comment explains why it's unnecessary) — harmless, but it implies a requirement that isn't there and will mislead whoever later moves the script.
