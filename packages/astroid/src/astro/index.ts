// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// `astroidjs/astro` — the BUILD-TIME surface, imported from `astro.config.mjs`.
// Kept off the main entry on purpose: it reaches for `node:crypto` and
// `solid-js/web`, neither of which belongs in the Worker bundle the generated
// `worker.ts` produces.

export {
  ASTROID_VITE_BUILD,
  astroidCspOrigins,
  astroidSecurity,
  type AstroidSecurityConfig,
  type CspHash,
  solidHydrationHash,
} from "./csp.js";
