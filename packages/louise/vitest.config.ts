import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

// Two projects: the pure-logic core primitives run under Node; the SolidJS
// inline-edit client runs under happy-dom with the Solid JSX transform.
export default defineConfig({
  test: {
    // Coverage is a ratchet on the way to a fixed 80% floor (ADR 0014). The
    // thresholds below are the measured numbers on 2026-09-24, rounded down;
    // `autoUpdate` rewrites them here as coverage rises, so a PR that raises
    // coverage also commits the new floor, and a PR that lowers it fails. Once
    // lines and statements reach 80, drop `autoUpdate` and pin both at 80. The
    // gap sits in `core/content` (localApi, visual-editing, schema-gen, codegen),
    // `editor/versions`, and `client/blocks.tsx`; see the tracking issue.
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
      thresholds: {
        lines: 73.53,
        statements: 70.99,
        autoUpdate: true,
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
        },
      },
    ],
  },
});
