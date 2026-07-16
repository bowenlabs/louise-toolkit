// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/db
//
// Thin wrapper around Drizzle's D1 driver. Raw binding in, Drizzle
// instance out — the schema is the caller's, never Louise's. Louise has
// no opinion on what tables exist; that's app-specific.

import { drizzle } from "drizzle-orm/d1";
import type { D1Client } from "./session.js";

export function db<TSchema extends Record<string, unknown> = Record<string, never>>(
  // A raw D1 binding, or a Sessions-API session (`env.DB.withSession(...)`) for
  // read-your-writes across read replicas (#69). Drizzle only calls
  // `prepare`/`batch`, both of which a session implements, so either works — the
  // cast just satisfies drizzle's stricter `D1Database` parameter type.
  d1: D1Client,
  schema?: TSchema,
) {
  return drizzle(d1 as D1Database, { schema });
}

// D1 Sessions API seam (openD1Session / d1Bookmark / bookmark cookie helpers).
export * from "./session.js";

// Framework-generic tables offered for composition — import the `*Columns` to
// extend, or the ready-made table when the generic set is enough. The `db()`
// wrapper above stays schema-agnostic; these are opt-in building blocks (so the
// core content tables don't drift between client sites), not a schema Louise imposes.
export * from "./site-settings.js";
export * from "./pages.js";
export * from "./inquiries.js";
export * from "./media.js";
export * from "./submissions.js";
