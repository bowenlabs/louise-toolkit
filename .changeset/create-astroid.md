---
"create-astroid": minor
---

New package: `create-astroid` — the one-command scaffold for a new Astroid site
(#104). `npm create astroid@latest my-site` writes the floor: the typed
`defineAstroid` config, the generated schema/worker/middleware trio +
`wrangler.jsonc` (via `astroidjs`), the Better Auth migration (via
`louise-toolkit`), a content migration + FTS, DB-managed editor auth (`src/auth.ts`
+ the `/api/auth` catch-all + a `seed-editors` bootstrap), and a baseline Astro app
(Cloudflare adapter, Solid, Tailwind + daisyUI). Interactive prompts or flags
(`--key`, `--name`, `--archetype`, `--color`, `--host`); binding ids are
placeholders that `astroid doctor` flags until provisioned.

The floor is **editable in the browser**: a `/login` magic-link page and a
`LouiseEdit` component that boots the edit bar + the Settings drawer
(Pages/Media/Settings/Users) in edit mode. The home page's **title and body are
inline-editable in place** via Astroid's `<Editable>` primitive — edits stage a
draft, Publish promotes it. A seeded `home` page row (`seed/home.seed.sql`) makes
it work out of the box.
