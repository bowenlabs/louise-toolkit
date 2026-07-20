---
"create-astroid": minor
---

Fix `pnpm install` failing on a fresh scaffold, and clear two dependency advisories.

**A scaffolded project could not be installed.** `pnpm install` — step 2 of the README's own Next Steps — exited 1 with `ERR_PNPM_IGNORED_BUILDS`: pnpm refuses to run a dependency's build script until told to, and both `esbuild` and `workerd` need theirs. The template shipped no build approvals, so the first command a new user runs errored.

It survived because **every test compensated for it**. CI's clean-room smoke step overwrote the scaffold's config and appended its own `allowBuilds`, and the local clean-room scripts copied that same pattern — so the suite proved the scaffold installs *for CI*, and never once for a user. The scaffold now ships its own `pnpm-workspace.yaml` (pnpm 10+ reads settings from that file even for a single package), and CI installs with it instead of replacing it, appending only the tarball pins it genuinely needs.

**Two dependency advisories** are fixed in the same file, both reaching us only through `better-auth`'s dev-tooling transitives:

- **esbuild** — SNYK-JS-ESBUILD-17750822, "resources downloaded over insecure protocol", CVSS 9.2, fixed in 0.28.1.
- **ws** — CVE-2026-62389, unbounded resource allocation, CVSS 8.7, fixed in 8.21.1.

Worth noting that **`pnpm audit` reports neither**. It reads GitHub's advisory database; Snyk carries its own, and in this case Snyk was right and a clean local audit was not evidence of anything. The first attempt at this fix trusted `pnpm audit`, pinned esbuild to `^0.25.4`, and left a CVSS 9.2 finding in place.

The esbuild override is deliberately **blanket rather than parent-scoped**. Two paths reach a vulnerable copy — drizzle-kit's own `esbuild ^0.25.4`, and the deprecated `@esbuild-kit/esm-loader` it still ships, whose `core-utils` pins 0.18.20 — so scoping to one parent fixes only half. Blanket is also the cheaper option here: Astro and Vite had already resolved 0.28.1, so this collapses the tree to a single esbuild rather than forcing an unusual version anywhere. The real risk was `@esbuild-kit/core-utils` being written against the 0.18 API, so that was verified rather than assumed: drizzle-kit still reads and transpiles a TypeScript `drizzle.config.ts`, `drizzle-kit generate` still loads the full schema, and the site build still passes.
