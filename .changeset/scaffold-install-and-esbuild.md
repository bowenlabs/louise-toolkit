---
"create-astroid": minor
---

Fix `pnpm install` failing on a fresh scaffold, and clear the esbuild advisory.

**A scaffolded project could not be installed.** `pnpm install` — step 2 of the README's own Next Steps — exited 1 with `ERR_PNPM_IGNORED_BUILDS`: pnpm refuses to run a dependency's build script until told to, and both `esbuild` and `workerd` need theirs. The template shipped no build approvals, so the first command a new user runs errored.

It survived because **every test compensated for it**. CI's clean-room smoke step overwrote the scaffold's config and appended its own `allowBuilds`, and the local clean-room scripts copied that same pattern — so the suite proved the scaffold installs *for CI*, and never once for a user. The scaffold now ships its own `pnpm-workspace.yaml` (pnpm 10+ reads settings from that file even for a single package), and CI installs with it instead of replacing it, appending only the tarball pins it genuinely needs.

**GHSA-67mh-4wv8-2f99 (esbuild ≤0.24.2)** is fixed in the same file. It reached both the monorepo and every scaffolded project through one legacy path: drizzle-kit still ships `@esbuild-kit/esm-loader` — deprecated, "merged into tsx" — whose `core-utils` pins esbuild 0.18.20. drizzle-kit's own direct dependency is already a safe `^0.25.4`, and no release drops the old path; 0.31.10 is current.

The override is **scoped to that one parent** rather than a blanket `esbuild` pin, so Vite, Astro, and everything else keep what they resolved. The risk was that `@esbuild-kit/core-utils` was written against the 0.18 API, so this was verified rather than assumed: after the bump, drizzle-kit still reads and transpiles a TypeScript `drizzle.config.ts` and `drizzle-kit generate` still loads the full schema. `pnpm audit` is clean in the monorepo and in a freshly scaffolded project.

Note the advisory is about esbuild's dev **server** accepting cross-origin requests; nothing here runs `esbuild --serve`. It is fixed because a scoped override is cheap, not because it was urgent.
