// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// louisecms/db
//
// Thin wrapper around Drizzle's D1 driver. Raw binding in, Drizzle
// instance out — the schema is the caller's, never Louise's. Louise has
// no opinion on what tables exist; that's app-specific.

import { drizzle } from "drizzle-orm/d1";

export function db<TSchema extends Record<string, unknown> = Record<string, never>>(
  d1: D1Database,
  schema?: TSchema,
) {
  return drizzle(d1, { schema });
}

// Framework-owned `site_settings` (pt#83) — the generic singleton config table
// sites compose or use as-is, so it doesn't drift between clients.
export * from "./site-settings.js";
