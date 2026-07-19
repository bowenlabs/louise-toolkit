# create-astroid

## 0.1.1

### Patch Changes

- Fix `npm create astroid` failing with `ERR_MODULE_NOT_FOUND: Cannot find package 'drizzle-orm'` in a clean environment.

  `astroidjs` calls `defineCollection` from `louise-toolkit/content` at runtime, and that entry pulls in the content validation module, which imports `drizzle-orm` for its uniqueness queries. `drizzle-orm` is an _optional_ peer of `louise-toolkit`, so npm never installed it — meaning anyone running `npm create astroid` (or importing `astroidjs` outside this workspace) crashed before the scaffold produced anything. It went unnoticed because the CI scaffold test runs inside the workspace, where `drizzle-orm` is already present as a dev dependency.

  `astroidjs` now declares `drizzle-orm` as a real dependency, which is what its import graph actually requires; `create-astroid` picks it up transitively. The underlying sharpness — that importing `defineCollection` from the `louise-toolkit/content` barrel drags the drizzle-dependent validation chunk with it — is worth splitting up separately.

- Updated dependencies
  - astroidjs@0.1.1

## 0.1.0

### Minor Changes

- af0cb91: Scaffolded sites now ship a real Content-Security-Policy. `astro.config.mjs`
  enables Astro's `security.csp`, so every on-demand (SSR) page — all of ours —
  gets a hash-based `content-security-policy` response header. The generated
  `src/middleware.ts` (`createLouiseMiddleware`, `cspStyleSrc: "'self' 'unsafe-inline'"`)
  then rewrites `style-src` to permit Louise's data-driven `style=""` carriers and
  the editor's runtime-injected `<style>`, and auto-allows the inlined `data:` brand
  font — leaving Astro's script hashes verbatim. Previously the CSP machinery
  shipped dormant (the middleware only rewrote a CSP header, and nothing emitted one).

  To keep that policy strict-by-default, the template's two inline scripts are now
  CSP-hashable (Astro hashes processed scripts but **not** `is:inline` / `define:vars`,
  whose per-request content can't be hashed):

  - **`login.astro`** — the magic-link submit handler drops `is:inline`, so Astro
    processes and hashes it into `script-src` (rewritten to stay type-safe under
    `astro check`).
  - **`LouiseEdit.astro`** — the editor boot no longer uses `define:vars`. The
    per-render `userName` / `versionedPageId` ride as `data-*` on a marker element
    that the now-static (hashable) boot script reads; edit-mode gating and the
    `astro:page-load` re-boot are preserved.

  A site that loads **Square Web Payments** must allow its SDK host in `script-src`
  — `security: { csp: { scriptDirective: { resources: ["'self'", "https://web.squarecdn.com"] } } }`
  — documented in the scaffolded `astro.config.mjs` rather than allowed by default.

- 561775e: Scaffold the deploy paths (#104). The generated README now leads with two
  low-friction options — a **Deploy to Cloudflare** button (zero-CLI: Cloudflare
  clones the repo, provisions the bindings declared in `wrangler.jsonc`, and deploys)
  and **`astroid deploy`** (one command: provision + migrate + secrets + deploy) —
  with the by-hand `wrangler` steps kept as the fallback.
- 910a5dc: New package: `create-astroid` — the one-command scaffold for a new Astroid site
  (#104). `npm create astroid@latest my-site` writes the floor: the typed
  `defineAstroid` config, the generated schema/worker/middleware trio +
  `wrangler.jsonc` (via `astroidjs`), the Better Auth migration (via
  `louise-toolkit`), a content migration + FTS, DB-managed editor auth (`src/auth.ts`
  - the `/api/auth` catch-all + a `seed-editors` bootstrap), and a baseline Astro app
    (Cloudflare adapter, Solid, Tailwind + daisyUI). Interactive prompts or flags
    (`--key`, `--name`, `--archetype`, `--color`, `--host`); binding ids are
    placeholders that `astroid doctor` flags until provisioned.

  The floor is **editable in the browser**: a `/login` magic-link page and a
  `LouiseEdit` component that boots the edit bar + the Settings drawer
  (Pages/Media/Settings/Users) in edit mode. The home page's **title and body are
  inline-editable in place** via Astroid's `<Editable>` primitive — edits stage a
  draft, Publish promotes it. A seeded `home` page row (`seed/home.seed.sql`) makes
  it work out of the box.

### Patch Changes

- Updated dependencies [c182412]
- Updated dependencies [56821bc]
- Updated dependencies [6fa4f98]
- Updated dependencies [78dd012]
- Updated dependencies [0039440]
- Updated dependencies [3146ec8]
- Updated dependencies [afe5ba1]
- Updated dependencies [c39466b]
- Updated dependencies [f623ccb]
- Updated dependencies [4c18d45]
- Updated dependencies [38b8b81]
- Updated dependencies [561775e]
- Updated dependencies [47df5c4]
- Updated dependencies [43a31f0]
- Updated dependencies [1711a45]
- Updated dependencies [9b5b9c3]
- Updated dependencies [af0cb91]
- Updated dependencies [5383051]
- Updated dependencies [50cee46]
- Updated dependencies [0e9acbd]
- Updated dependencies [9e07377]
- Updated dependencies [40b8e0e]
- Updated dependencies [7224956]
- Updated dependencies [c6052d3]
- Updated dependencies [9f5ac5d]
- Updated dependencies [698e230]
- Updated dependencies [e7e81ec]
- Updated dependencies [077b323]
- Updated dependencies [aa020ca]
- Updated dependencies [47df5c4]
- Updated dependencies [15ed27c]
- Updated dependencies [4d2de4c]
- Updated dependencies [aa0f70d]
- Updated dependencies [a89ad95]
- Updated dependencies [10519f3]
- Updated dependencies [8509d15]
- Updated dependencies [a6a9a2c]
- Updated dependencies [ab52389]
- Updated dependencies [a929ac1]
- Updated dependencies [9cd8395]
- Updated dependencies [355915d]
- Updated dependencies [f4e6b73]
- Updated dependencies [ce8f8a6]
- Updated dependencies [037054f]
- Updated dependencies [baf6b62]
- Updated dependencies [42bd2b9]
- Updated dependencies [b29f520]
- Updated dependencies [1faa88a]
- Updated dependencies [8497b55]
- Updated dependencies [60e690f]
- Updated dependencies [60e033f]
- Updated dependencies [b950812]
- Updated dependencies [1c4a8f9]
- Updated dependencies [dd2187a]
- Updated dependencies [38b8b81]
- Updated dependencies [de43f53]
- Updated dependencies [d351abf]
- Updated dependencies [e668e37]
- Updated dependencies [8f0e4ba]
- Updated dependencies [a9d61c6]
- Updated dependencies [14a62c4]
- Updated dependencies [7be2413]
- Updated dependencies [8355f96]
- Updated dependencies [d944ca5]
- Updated dependencies [0d0db1f]
- Updated dependencies [8474f38]
- Updated dependencies [1110318]
- Updated dependencies [7326bb6]
- Updated dependencies [4c41ec7]
- Updated dependencies [530aacc]
- Updated dependencies [46e9af5]
- Updated dependencies [050440f]
- Updated dependencies [2824490]
- Updated dependencies [98ba35a]
- Updated dependencies [17231d2]
- Updated dependencies [21796fb]
- Updated dependencies [9c4d0a4]
- Updated dependencies [7019d09]
- Updated dependencies [6c72267]
- Updated dependencies [252d119]
- Updated dependencies [ae8e661]
  - louise-toolkit@0.14.0
  - astroidjs@0.1.0
