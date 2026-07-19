import { readFileSync } from "node:fs";
import solid from "vite-plugin-solid";

// Library packaging for `louise`, read by `vp pack` — Vite+'s library
// build, which forwards the `pack` block to tsdown (Rolldown) internally.
//
// Authored as a plain object rather than `defineConfig(...)`: Vite+'s config
// helper (`vite-plus`) and tsdown both ship *inside* the `vp` binary, not as
// workspace modules, so there's nothing to import for typing. `vite-plugin-solid`
// provides the Solid JSX transform for the client entry.

const RAW = "?raw";

// Rolldown (unlike Vite) has no built-in `?raw` loader, and the icon set is
// imported as raw SVG strings (`…svg?raw`) so they inline at build time and the
// `@phosphor-icons/core` runtime dependency disappears. This tiny plugin
// resolves the bare specifier, then loads the file as a default-exported string.
const rawLoader = {
  name: "louise:raw",
  async resolveId(source, importer) {
    if (!source.endsWith(RAW)) return null;
    const resolved = await this.resolve(source.slice(0, -RAW.length), importer, {
      skipSelf: true,
    });
    return resolved ? `${resolved.id}${RAW}` : null;
  },
  load(id) {
    if (!id.endsWith(RAW)) return null;
    const code = readFileSync(id.slice(0, -RAW.length), "utf8");
    return { code: `export default ${JSON.stringify(code)};`, moduleSideEffects: false };
  },
};

// One entry per public subpath export → one bundle per subpath. Tree-shaking is
// per-subpath (import `/errors` and none of the client/Solid code comes along),
// which is exactly what the subpath `exports` give consumers. The peer
// dependencies stay external via `deps.neverBundle`; `@phosphor-icons/core`
// (a devDep, not listed) is bundled — its raw SVGs inline via `rawLoader`.
//
// NOTE: not `unbundle` — that mode externalizes everything under node_modules,
// which both breaks the raw-SVG inlining and rewrites the peer imports into
// non-portable `../node_modules/.pnpm/...` relative paths.
export default {
  // Vite+'s lint pipeline (`vp check` / `vp lint`). `typeAware` turns on the
  // Oxlint rules that need type information and `typeCheck` runs a full type
  // check — both via tsgolint on the TypeScript-Go toolchain (TS7 native), the
  // same engine as the `tsgo` typecheck script. `vite.config.ts` is excluded:
  // it is authored as an untyped plain object (no Vite/Rollup typings to import,
  // see below) and isn't part of the `src`/`test` tsconfig scope.
  lint: {
    ignorePatterns: ["vite.config.ts"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      // Louise's content layer coerces intentionally-`unknown` values — CMS field
      // and setting values, form submissions, error causes, FTS index text — into
      // display/serialized strings (`String(value)`, `` `${value}` ``). That is the
      // design, and several sites are already `typeof`-guarded (see codegen.ts).
      // Type *correctness* is enforced by the authoritative `tsgo` typecheck; these
      // two stylistic guards only add noise over that deliberate pattern.
      "typescript/no-base-to-string": "off",
      "typescript/restrict-template-expressions": "off",
    },
    overrides: [
      {
        // Tests reference Vitest spy methods unbound (`expect(spy)`), spread
        // strings, keep compile-only type-assertion expressions, and optional-chain
        // on values a passing assertion already guarantees. These type-aware rules
        // assume production intent and are noise in tests — full type-checking
        // still runs; only the lint rules relax.
        files: ["test/**"],
        rules: {
          "typescript/unbound-method": "off",
          "typescript/no-misused-spread": "off",
          "no-unused-expressions": "off",
          "no-unsafe-optional-chaining": "off",
        },
      },
    ],
  },
  pack: {
    entry: [
      "src/core/ai/index.ts",
      "src/core/analytics/index.ts",
      "src/core/auth/index.ts",
      "src/astro/index.ts",
      "src/client/index.ts",
      "src/client/settings/index.ts",
      "src/core/content/index.ts",
      // Drizzle-free "describe content" entry — see the note in define.ts.
      "src/core/content/define.ts",
      // Drizzle-free structured-sections validator — reuses the pure Rule engine
      // (content/rule.ts), so consumers can validate `sections` without pulling
      // in the optional drizzle-orm peer. See sections.ts's import note.
      "src/core/content/sections.ts",
      "src/core/content/stega.ts",
      "src/core/db/index.ts",
      "src/core/commerce/index.ts",
      "src/core/commerce/fourthwall.ts",
      "src/core/commerce/square.ts",
      "src/core/commerce/square-web.ts",
      "src/core/commerce/stripe.ts",
      "src/core/browser/index.ts",
      "src/core/email/index.ts",
      "src/core/forms/index.ts",
      "src/core/health/index.ts",
      "src/core/media/index.ts",
      "src/core/queues/index.ts",
      "src/core/realtime/index.ts",
      "src/core/schema/index.ts",
      "src/core/security/index.ts",
      "src/core/worker/index.ts",
      "src/core/workflows/index.ts",
      "src/core/editor/index.ts",
      "src/core/errors.ts",
    ],
    format: ["esm"],
    dts: true,
    // No sourcemaps in the published tarball — they roughly double its size and
    // just re-ship the (already public, MIT) source. The repo is the reference.
    sourcemap: false,
    platform: "neutral",
    // The `pack` block IS the tsdown config, so plugins live here (not at the
    // top level, which `vp pack` ignores). `rawLoader` inlines the `?raw` SVGs;
    // `solid()` supplies Solid's JSX transform for the client entry.
    plugins: [rawLoader, solid()],
    deps: {
      neverBundle: [
        /^solid-js(\/|$)/,
        /^prosekit(\/|$)/,
        /^@prosekit\/pm(\/|$)/,
        /^drizzle-orm(\/|$)/,
        /^better-auth(\/|$)/,
        /^@better-auth\/(passkey|core)(\/|$)/,
        /^@tanstack\/solid-query(\/|$)/,
        /^@vercel\/stega(\/|$)/,
        /^@cloudflare\/puppeteer(\/|$)/,
        /^@resvg\/resvg-wasm(\/|$)/,
        /^astro(\/|$)/,
      ],
    },
  },
};
