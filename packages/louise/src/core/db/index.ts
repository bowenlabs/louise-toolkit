// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/db
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

// Framework-generic tables offered for composition — import the `*Columns` to
// extend, or the ready-made table when the generic set is enough. The `db()`
// wrapper above stays schema-agnostic; these are opt-in building blocks (so the
// core CMS tables don't drift between client sites), not a schema Louise imposes.
export * from "./site-settings.js";
export * from "./pages.js";
export * from "./inquiries.js";
export * from "./media.js";
export * from "./submissions.js";
