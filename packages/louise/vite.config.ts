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
  pack: {
    entry: [
      "src/core/auth/index.ts",
      "src/astro/index.ts",
      "src/client/index.ts",
      "src/client/settings/index.ts",
      "src/core/content/index.ts",
      "src/core/content/stega.ts",
      "src/core/db/index.ts",
      "src/core/commerce/index.ts",
      "src/core/commerce/fourthwall.ts",
      "src/core/commerce/square.ts",
      "src/core/commerce/stripe.ts",
      "src/core/browser/index.ts",
      "src/core/email/index.ts",
      "src/core/forms/index.ts",
      "src/core/media/index.ts",
      "src/core/queues/index.ts",
      "src/core/schema/index.ts",
      "src/core/security/index.ts",
      "src/core/worker/index.ts",
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
