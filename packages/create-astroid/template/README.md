# __BRAND_NAME__

An editable, multi-editor site on Cloudflare Workers — scaffolded with
[Astroid](https://github.com/bowenlabs/louise-toolkit) (Astro + Louise Toolkit).

The whole shape of this site lives in one typed config, [`astroid.config.ts`](./astroid.config.ts).
`src/schema.ts`, `src/worker.ts`, and `src/middleware.ts` are **generated** from it
(they carry a "do not hand-edit" banner) — run `pnpm generate` after any config
change, or just use `pnpm dev`/`pnpm build`, which regenerate first.

## Develop

```sh
pnpm install
cp .env.example .dev.vars   # local secrets for `astro dev`; fill SESSION_SECRET + OWNER_EMAIL
pnpm dev                    # astroid dev: regenerate, then astro dev
```

> **Previewing the built worker?** `pnpm dev` (astro dev) serves on localhost, so
> an empty `SESSION_SECRET` is fine there. A local `wrangler dev` against the
> built `dist/` output routes the request through your `hosts` domain instead of
> localhost, so the editor routes need a real `SESSION_SECRET` in `.dev.vars` —
> otherwise sign-in 500s with "SESSION_SECRET is not configured".

## Deploy

Astroid wrote `wrangler.jsonc` with placeholder binding ids. Pick a path to
provision them and ship — then seed content + your first editor (below).

### Zero-CLI — Deploy to Cloudflare

Push this repo to GitHub and drop this button in place (swap in your repo URL).
Cloudflare clones the repo, provisions the D1/R2/KV bindings declared in
`wrangler.jsonc`, and deploys — no local tooling:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=<YOUR_GITHUB_REPO_URL>)

### One command — `astroid deploy`

Provisions the still-placeholder bindings, applies migrations, prompts for
secrets, and deploys — through your local `wrangler`:

```sh
pnpm astroid deploy --dry-run   # preview the exact commands it will run
pnpm astroid deploy             # provision + migrate + secrets + deploy (asks first)
```

### By hand

```sh
wrangler d1 create __KEY__
wrangler r2 bucket create __KEY__-media
wrangler kv namespace create RL && wrangler kv namespace create DRAFTS
# paste the printed ids into wrangler.jsonc, then:
wrangler secret put SESSION_SECRET          # openssl rand -base64 32
wrangler d1 migrations apply DB --remote
wrangler deploy
```

### Seed content + your first editor

```sh
wrangler d1 execute DB --file seed/home.seed.sql --remote
OWNER_EMAIL=you@example.com pnpm seed:editors
```

The seeded page renders immediately. In-editor **search** indexes on publish, so
a raw-SQL-seeded row isn't searchable until you publish an edit or backfill once
with `POST /api/louise/pages/reindex` (signed in).

## Editors & auth

Editors sign in with a magic link (passkeys supported). The allowlist is
**DB-managed**: an admin `user` row *is* an editor. Seed the first one above; add
or remove the rest from the Users panel (backed by the generated `editorsRoute`).
There are no passwords and no editor list in env to keep in sync.

### Editing your site

1. Go to **`/login`** and enter a seeded editor's email. In local dev there's no
   email binding, so the magic link is printed to the `wrangler`/`astro dev`
   console — open it from there. In production it's emailed.
2. The link signs you in and drops you at **`/?louise`** — edit mode. The **edit
   bar** appears with **Settings** and **Done**.
3. The home page's **title and body are editable in place** — click into them and
   type. Edits stage a **draft**; **Publish** (in the edit bar) promotes it live.
   **Settings** opens the drawer: **Pages** (create/edit other pages), **Media**,
   **Settings** (brand, nav, contact, SEO), and **Users** (invite/remove editors).
   **Done** leaves edit mode.

Inline editing uses Astroid's [`<Editable>`](https://github.com/bowenlabs/louise-toolkit)
primitive (`src/pages/index.astro`): it stamps the `data-louise-*` markers only in
edit mode, so the public HTML stays clean. Wrap any page field in `<Editable
collection="pages" key={page.id} field="…">` and pass `versionedPageId` to make it
editable. Body HTML is sanitized on every save.

## Redeploy

Once provisioned, shipping changes is just:

```sh
pnpm doctor         # validate config, bindings, and generated-file freshness
wrangler deploy     # or: pnpm astroid deploy
```

## Layout

| Path | What |
| --- | --- |
| `astroid.config.ts` | The one typed config — brand, archetype, sections. |
| `src/schema.ts` · `src/worker.ts` · `src/middleware.ts` | **Generated** — don't hand-edit. |
| `wrangler.jsonc` | Yours to edit — real binding ids, routes, secrets. |
| `src/auth.ts` | The editor auth seam (Better Auth, DB-managed editors). |
| `src/pages/` · `src/components/` · `src/layouts/` | Your Astro app. |
| `migrations/` | `0000_content.sql` (content + FTS) · `0001_auth.sql` (Better Auth). |
| `scripts/seed-editors.mjs` | Bootstrap the first editor. |
