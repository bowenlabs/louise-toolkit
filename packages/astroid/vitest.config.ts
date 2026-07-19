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
      "louise-toolkit/security": new URL("../louise/src/core/security/index.ts", import.meta.url)
        .pathname,
      "louise-toolkit/email": new URL("../louise/src/core/email/index.ts", import.meta.url)
        .pathname,
    },
  },
  test: {
    name: "astroid",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
