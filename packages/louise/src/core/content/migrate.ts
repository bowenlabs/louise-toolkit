// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

import type { LocalApi } from "./localApi.js";
import { computePatch, type Patch } from "./patch.js";
import type { JsonValue } from "./types.js";

/**
 * Content-migration runner (issue #18) — adopts Sanity's `sanity/migrate`
 * idea (pattern, not code): a versioned, repeatable transform over a
 * collection's stored documents, for reshaping content when a block/field
 * type changes (distinct from Drizzle *schema* migrations, which only touch
 * columns — this reshapes the JSON content inside them).
 *
 * A migration declares a per-document `document(doc)` transform; the runner
 * streams every document, computes the {@link Patch} from old→new (reusing
 * #14's patch model), and either reports it (`dryRun`) or applies it via the
 * collection's Local API. Idempotent by construction: a transform that's
 * already been applied produces an empty patch, so re-running changes
 * nothing.
 */

type Doc = Record<string, JsonValue>;

export interface Migration<TDoc extends Doc = Doc> {
  /** Stable identifier — name the checked-in migration file after this. */
  name: string;
  /**
   * Transform one document. Return the reshaped document, or `undefined`
   * (or the unchanged doc) to leave it as-is. Must be pure and idempotent —
   * applying it twice yields the same result as once.
   */
  document: (doc: TDoc) => TDoc | undefined | Promise<TDoc | undefined>;
}

/** Identity helper — gives a migration definition its type + a greppable call site. */
export function defineMigration<TDoc extends Doc = Doc>(
  migration: Migration<TDoc>,
): Migration<TDoc> {
  return migration;
}

export interface MigrationChange {
  id: number;
  patch: Patch;
}

export interface MigrationResult {
  migration: string;
  dryRun: boolean;
  scanned: number;
  changed: number;
  /** Per-document patches (always populated — the dry-run report). */
  changes: MigrationChange[];
  errors: string[];
}

export interface RunMigrationOptions<TContext> {
  // oxlint-disable-next-line typescript/no-explicit-any -- the runner is generic across any collection's table type
  api: LocalApi<any, TContext>;
  /** Context passed to the Local API's read/update (access + hooks). */
  context: TContext;
  /** When true, compute + report patches but write nothing. Default false. */
  dryRun?: boolean;
}

// A patch's net effect as a Local API update payload: `set` → the value,
// `unset` → null (the DB-level "cleared" representation). Only changed
// fields are sent, so hooks/validation see a minimal partial update.
function patchToUpdate(patch: Patch): Record<string, JsonValue | null> {
  const values: Record<string, JsonValue | null> = {};
  for (const op of patch) {
    values[op.path] = op.op === "set" ? op.value : null;
  }
  return values;
}

/**
 * Run a migration over every document in a collection. Reads all documents
 * through `api.find`, applies `migration.document`, and (unless `dryRun`)
 * writes the resulting patch through `api.update`. Returns a report of what
 * changed — run it `dryRun` first, then apply.
 */
export async function runMigration<TContext>(
  migration: Migration,
  options: RunMigrationOptions<TContext>,
): Promise<MigrationResult> {
  const { api, context, dryRun = false } = options;
  const rows = (await api.find(context)) as Array<Doc & { id: number }>;

  const changes: MigrationChange[] = [];
  const errors: string[] = [];
  let changed = 0;

  for (const before of rows) {
    try {
      const after = (await migration.document(before)) ?? before;
      const patch = computePatch(before, after);
      if (patch.length === 0) continue;
      changes.push({ id: before.id, patch });
      changed++;
      if (!dryRun) {
        await api.update(context, before.id, patchToUpdate(patch));
      }
    } catch (err) {
      errors.push(`document ${before.id}: ${String(err)}`);
    }
  }

  return {
    migration: migration.name,
    dryRun,
    scanned: rows.length,
    changed,
    changes,
    errors,
  };
}
