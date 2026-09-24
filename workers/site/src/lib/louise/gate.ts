// The one place that couples the editor gate to Astro. Reads the gate config
// from the astro:env schema (astro.config.mjs) and packages it as the
// framework-agnostic `EditorGateEnv` that session.ts consumes—so session.ts
// itself imports nothing from astro:env and stays runnable in any host.
//
// Call this PER REQUEST, never capture it in a module-level constant: on
// Cloudflare the astro:env secret bindings are resolved from the Worker's
// runtime env (the adapter wires this up via setGetEnv), and reading them inside
// the request path is what guarantees the real values rather than whatever was
// (or wasn't) available at module-init.
import { LOUISE_EDITOR_PASSWORD, LOUISE_SESSION_SECRET, OWNER_EMAIL } from "astro:env/server";
import type { EditorGateEnv } from "./session.js";

export function getEditorGate(): EditorGateEnv {
  return { LOUISE_SESSION_SECRET, LOUISE_EDITOR_PASSWORD, OWNER_EMAIL };
}
