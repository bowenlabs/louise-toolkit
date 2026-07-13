// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/forms — derive the submission table from a form's fields, so the
// columns can never drift from the form definition. The mapping is deliberately
// small: text-like inputs → text, checkbox → boolean integer, number → real,
// plus the framework `id` primary key and a `created_at` timestamp.

import { integer, real, text, type SQLiteColumnBuilderBase } from "drizzle-orm/sqlite-core";
import type { FormField } from "./types.js";

/** camelCase field key → snake_case column name (matches the framework tables:
 *  `firstName` → `first_name`). */
export function columnName(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** The Drizzle column builder for one field. `required` → `NOT NULL`. */
function fieldColumn(key: string, field: FormField) {
  const name = columnName(key);
  let column: ReturnType<typeof text> | ReturnType<typeof real> | ReturnType<typeof integer>;
  switch (field.type) {
    case "checkbox":
      column = integer(name, { mode: "boolean" });
      break;
    case "number":
      column = real(name);
      break;
    default:
      // text/email/tel/url/textarea/select/date are all stored as text.
      column = text(name);
      break;
  }
  return field.required ? column.notNull() : column;
}

/**
 * Derive the full Drizzle column set for a form: an autoincrement `id`, one
 * column per field, and a `created_at` timestamp defaulting to now. The result
 * is spread into `sqliteTable(name, columns)` — identical in shape to the
 * hand-authored framework tables, so drizzle-kit generates a normal migration.
 */
export function deriveFormColumns(
  fields: Record<string, FormField>,
): Record<string, SQLiteColumnBuilderBase> {
  const columns: Record<string, SQLiteColumnBuilderBase> = {
    id: integer("id").primaryKey({ autoIncrement: true }),
  };
  for (const [key, field] of Object.entries(fields)) {
    columns[key] = fieldColumn(key, field);
  }
  columns.createdAt = integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date());
  return columns;
}
