import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

// Two projects: the pure-logic core primitives run under Node; the SolidJS
// inline-edit client runs under happy-dom with the Solid JSX transform.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["test/core/**/*.test.ts"],
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
          environment: "happy-dom",
          include: ["test/client/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
