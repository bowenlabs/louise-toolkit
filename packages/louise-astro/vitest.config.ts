import { defineConfig } from "vitest/config";

// The adapter's own suite. Everything here is pure Node — schema bridges, a
// content-layer loader, Action wrappers — so there is no DOM project.
export default defineConfig({
  resolve: {
    alias: {
      // Resolve the toolkit to SOURCE, not `packages/louise/dist`. The `exports`
      // map points only at dist/, so without this the suite would silently test
      // whatever was last built, and would fail outright on a fresh clone that
      // has not packed louise yet.
      //
      // Every `louise-toolkit/*` subpath this package imports at RUNTIME (as
      // opposed to type-only) needs an entry. Miss one and the suite passes on a
      // machine with a stale `packages/louise/dist` lying around and fails in CI.
      // `scripts/ci/checks/export-map.mjs` is the counterpart that verifies these
      // same subpaths actually exist in the PUBLISHED map — the alias makes tests
      // fast, the check makes them honest.
      "louise-toolkit/content": new URL("../louise/src/core/content/index.ts", import.meta.url)
        .pathname,
      "louise-toolkit/editor": new URL("../louise/src/core/editor/index.ts", import.meta.url)
        .pathname,
      "louise-toolkit/security": new URL("../louise/src/core/security/index.ts", import.meta.url)
        .pathname,
      "louise-toolkit/db": new URL("../louise/src/core/db/index.ts", import.meta.url).pathname,
      "louise-toolkit/worker": new URL("../louise/src/core/worker/index.ts", import.meta.url)
        .pathname,
      "louise-toolkit/auth": new URL("../louise/src/core/auth/index.ts", import.meta.url).pathname,
      "louise-toolkit/forms": new URL("../louise/src/core/forms/index.ts", import.meta.url)
        .pathname,
    },
  },
  test: {
    name: "louise-astro",
    include: ["test/**/*.test.ts"],
  },
});
