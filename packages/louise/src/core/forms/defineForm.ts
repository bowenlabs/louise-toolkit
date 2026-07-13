// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/forms — the `defineForm` entry point. One definition is the single
// source of truth: it derives the submission table, the review columns, and
// (via `formRoute` in louise/editor) the public capture route + validation.

import { sqliteTable } from "drizzle-orm/sqlite-core";
import { deriveFormColumns } from "./columns.js";
import type { FormConfig, FormDefinition, FormReviewColumn } from "./types.js";

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Define a form. Returns the config plus everything derived from it — the
 * Drizzle `columns`/`table` and the `reviewColumns` the Settings renders. Pass the
 * result's `table` to `formRoute` (capture) and to the submissions review route.
 *
 * ```ts
 * const contact = defineForm({
 *   name: "inquiries",
 *   fields: {
 *     email:   { type: "email",    label: "Email",   required: true },
 *     message: { type: "textarea", label: "Message", required: true, validation: (r) => r.max(5000) },
 *   },
 * });
 * ```
 */
export function defineForm(config: FormConfig): FormDefinition {
  if (!IDENT_RE.test(config.name)) {
    throw new Error(
      `Invalid form name ${JSON.stringify(config.name)} (must be a bare SQL identifier)`,
    );
  }
  const columns = deriveFormColumns(config.fields);
  const table = sqliteTable(config.name, columns);
  const reviewColumns: FormReviewColumn[] = Object.entries(config.fields).map(([key, field]) => ({
    key,
    label: field.label,
    type: field.type,
  }));
  return { ...config, columns, table, reviewColumns };
}
