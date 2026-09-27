// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Framework-owned `page_redirects`: a page's old URL, remembered when its slug
// changes (#574). A slug is a public URL, and an owner renames a page from the
// Pages panel as the normal way to give it its address, so every inbound link,
// bookmark, and search result for the old one turned into a 404.
//
// A rename records `/old → /new` in the same batch as the write, points any
// earlier redirect at the new path so a chain stays one hop, and drops a
// redirect whose old path is a live slug again, so a redirect never shadows a
// page. The resolver answers a path with its current target; serve it only for a
// request that would otherwise 404.

import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** The `page_redirects` columns, to compose into your own schema. */
export const pageRedirectsColumns = {
  /** The old path, such as `/about-us`. */
  fromPath: text("from_path").primaryKey(),
  /** Where it moved, such as `/about`. */
  toPath: text("to_path").notNull(),
  /** The status to answer with. Default 301, a permanent move. */
  code: integer("code").notNull().default(301),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
};

/** The ready-made `page_redirects` table. Add it to the schema drizzle-kit reads,
 *  so the migration creates it. */
export const pageRedirects = sqliteTable("page_redirects", pageRedirectsColumns);

export type PageRedirect = typeof pageRedirects.$inferSelect;

/** A page slug as the path a visitor requests: `about` is `/about`. */
export function slugPath(slug: string): string {
  return `/${slug.replace(/^\/+/, "")}`;
}

/** A request path without a trailing slash, except the root. */
function normalizePath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * The statements that record a slug change, to run in the same `batch` as the
 * write that changes it. Returns none when the slug didn't change.
 */
export function slugChangeStatements<TSchema extends Record<string, unknown>>(
  database: DrizzleD1Database<TSchema>,
  table: typeof pageRedirects,
  oldSlug: string,
  newSlug: string,
): BatchItem<"sqlite">[] {
  const from = slugPath(oldSlug);
  const to = slugPath(newSlug);
  if (from === to) return [];
  return [
    // The new path is a live page now, so nothing may redirect away from it.
    database.delete(table).where(eq(table.fromPath, to)),
    // An earlier rename that pointed at the old path now points at the new one,
    // so a chain of renames stays one hop.
    database.update(table).set({ toPath: to }).where(eq(table.toPath, from)),
    database
      .insert(table)
      .values({ fromPath: from, toPath: to, code: 301 })
      .onConflictDoUpdate({ target: table.fromPath, set: { toPath: to, code: 301 } }),
  ];
}

/**
 * The statement that clears any redirect away from `slug`'s path, for a write
 * that makes it a live page (a new page, or a rename onto an old path).
 */
export function clearRedirectStatement<TSchema extends Record<string, unknown>>(
  database: DrizzleD1Database<TSchema>,
  table: typeof pageRedirects,
  slug: string,
): BatchItem<"sqlite"> {
  return database.delete(table).where(eq(table.fromPath, slugPath(slug)));
}

/** How many redirects the resolver follows before it stops, in case a chain
 *  loops. Writes keep chains to one hop, so this is a guard, not a budget. */
const MAX_HOPS = 5;

/**
 * Where a path moved, following a chain of renames to the current path, or
 * `null` when it didn't move. Serve it only for a request that would otherwise
 * be a 404, so a live page always wins:
 *
 *   createLouiseMiddleware({
 *     redirectFor: (path) => resolvePageRedirect(db(env.DB), pageRedirects, path),
 *   });
 */
export async function resolvePageRedirect<TSchema extends Record<string, unknown>>(
  database: DrizzleD1Database<TSchema>,
  table: typeof pageRedirects,
  path: string,
): Promise<{ location: string; status: number } | null> {
  const start = normalizePath(path);
  let current = start;
  let status = 301;
  const seen = new Set([current]);
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const [row] = await database
      .select({ toPath: table.toPath, code: table.code })
      .from(table)
      .where(eq(table.fromPath, current))
      .limit(1);
    if (!row || seen.has(row.toPath)) break;
    if (hop === 0) status = row.code;
    current = row.toPath;
    seen.add(current);
  }
  return current === start ? null : { location: current, status };
}
