/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

// Bindings this Worker exposes (wrangler.jsonc). BROWSER comes from
// louisecms/browser's LouiseBrowserEnv, so it's intentionally omitted here to
// avoid a duplicate/conflicting declaration.
type CloudflareEnv = {
  DB: D1Database;
  MEDIA: R2Bucket;
  MEDIA_URL: string;
  RL: KVNamespace;
  ASSETS: Fetcher;
  LOUISE_SESSION_SECRET: string;
  LOUISE_EDITOR_PASSWORD?: string;
  OWNER_EMAIL?: string;
};

// Bindings are read via `import { env } from "cloudflare:workers"` (Astro v6+
// removed Astro.locals.runtime.env), so Locals only carries what middleware sets.
declare namespace App {
  interface Locals {
    /** Resolved editor session (authorizes writes). Null when not signed in. */
    editor: import("louisecms/auth").EditorSession | null;
    /** Whether the page should render edit affordances. */
    editMode: boolean;
  }
}
