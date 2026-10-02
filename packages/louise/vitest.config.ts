import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

// Two projects: the pure-logic core primitives run under Node; the SolidJS
// inline-edit client runs under happy-dom with the Solid JSX transform.
export default defineConfig({
  test: {
    // Coverage has a fixed floor of 90% of lines and statements (ADR 0014, as
    // amended 2026-09-27). The package ratcheted up from 72 and 70 with
    // `autoUpdate` and pinned here once #508 and #695 took it past 90. A PR
    // that drops either below 90 fails. Branches and functions are reported,
    // not gated.
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
      thresholds: {
        lines: 90,
        statements: 90,
      },
    },
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          // Core primitives plus the framework-agnostic `louise/astro` helpers
          // (build-time loaders—pure Node, no DOM).
          include: ["test/core/**/*.test.ts", "test/astro/**/*.test.ts"],
        },
      },
      {
        plugins: [solid()],
        resolve: {
          // Ensure a single Solid runtime under test (Solid's SSR/DOM split).
          conditions: ["development", "browser"],
        },
        test: {
          name: "client",
          // A path-named custom environment, not the "happy-dom" builtin: the
          // vp-bundled vitest lives outside the workspace and can't resolve the
          // happy-dom package from its own location. See test/happy-dom-env.ts.
          environment: "./test/happy-dom-env.ts",
          include: ["test/client/**/*.test.{ts,tsx}"],
          // DOM APIs happy-dom lacks that the client needs (see the file).
          setupFiles: ["./test/client/setup-dom.ts"],
        },
      },
    ],
  },
});
