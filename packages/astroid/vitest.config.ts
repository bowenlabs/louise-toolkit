import { defineConfig } from "vitest/config";

// Astroid's own suite. Everything under test here is pure Node — the config
// validator, the string generators, and the secret-convention helpers — so
// there's no DOM project (unlike louise, whose Solid client needs happy-dom).
// The `.astro` section library ships as source and is exercised by the
// scaffold smoke test in CI, not here.
export default defineConfig({
  resolve: {
    alias: {
      // Resolve the toolkit to SOURCE, not `packages/louise/dist`. The package
      // `exports` map only points at dist/, so without this the suite would
      // silently test whatever was last built — and would fail outright on a
      // fresh clone that hasn't packed louise yet.
      // Every `louise-toolkit/*` subpath astroid imports at RUNTIME (as opposed
      // to type-only) needs an entry here. Miss one and the suite passes on any
      // machine that happens to have `packages/louise/dist` lying around from an
      // earlier build, and fails in CI — where the astroid tests run BEFORE the
      // library is packed. That is exactly how this list last went stale.
      "louise-toolkit/security": new URL("../louise/src/core/security/index.ts", import.meta.url)
        .pathname,
      "louise-toolkit/email": new URL("../louise/src/core/email/index.ts", import.meta.url)
        .pathname,
      "louise-toolkit/analytics": new URL("../louise/src/core/analytics/index.ts", import.meta.url)
        .pathname,
      // Reached from `schema/collections.ts`. Unaliased until now only because
      // no test happened to import that module — a trap armed for whoever wrote
      // the next one.
      "louise-toolkit/content/define": new URL(
        "../louise/src/core/content/define.ts",
        import.meta.url,
      ).pathname,
      "louise-toolkit/content/sections": new URL(
        "../louise/src/core/content/sections.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    name: "astroid",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
