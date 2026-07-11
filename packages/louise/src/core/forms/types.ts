// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// louisecms/forms — declarative form definitions (issue #46). Define a form's
// fields once; the same definition derives the submission table, the public
// capture route (`formRoute`), server + client validation, and the review
// columns. `inquiries` is just the built-in default form (see `louisecms/db`).
//
// Field validation reuses the shared `Rule`/`validateValue` engine
// (`louisecms/cms`) — there is one validation definition, run on both sides.

import type { SQLiteColumn, SQLiteTableWithColumns } from "drizzle-orm/sqlite-core";
import type { ValidationBuilder } from "../cms/validation.js";

/**
 * Input semantics a public form needs, on top of the CMS field vocabulary. Each
 * maps to a stored column type and a rendered input; `email`/`url`/`select`/
 * `number` also carry a built-in format/coercion check.
 */
export type FormFieldType =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "textarea"
  | "number"
  | "select"
  | "checkbox"
  | "date"
  // A file upload — stored as the uploaded media asset's URL (text). The render
  // helper uploads through the `media` route; the column is a plain text URL.
  | "file";

/** One declared form field. */
export interface FormField {
  type: FormFieldType;
  /** Human label for the rendered input and the review column header. */
  label: string;
  /**
   * Required → a `NOT NULL` column and a required check at submit. (Kept as an
   * explicit flag, not buried in `validation`, so column derivation can read it.)
   */
  required?: boolean;
  /** `select` options (also the allowlist the server validates against). */
  options?: readonly string[];
  /** Placeholder text for the rendered input. */
  placeholder?: string;
  /** Help/hint text rendered under the input. */
  help?: string;
  /**
   * Extra validation, reusing the shared `Rule` builder — e.g.
   * `(r) => r.max(5000)`. Composed after the type's built-in check.
   */
  validation?: ValidationBuilder;
}

/** Anti-spam options for a form's public capture route. */
export interface FormSpamConfig {
  /** Require a Cloudflare Turnstile token (`cf-turnstile-response`). Verified
   *  server-side when `formRoute` is given a `turnstileSecret`. */
  turnstile?: boolean;
  /** Fixed-window rate limit, keyed by client (typically IP). Enforced when
   *  `formRoute` is given a KV binding. */
  rateLimit?: { max: number; windowSec: number };
}

/** Where a successful submission is announced (Tier 3). */
export interface FormNotifyConfig {
  /** POST the submission JSON to this webhook URL. */
  webhook?: string;
}

/** A declared form: fields + optional spam/notify policy. */
export interface FormConfig {
  /** Form + table name. A bare SQL identifier (`^[A-Za-z_][A-Za-z0-9_]*$`). */
  name: string;
  fields: Record<string, FormField>;
  spam?: FormSpamConfig;
  notify?: FormNotifyConfig;
  /** Submit button label for the render helper. Default `"Send"`. */
  submitLabel?: string;
}

/** A review column derived from a form field — key + label for the panel. */
export interface FormReviewColumn {
  key: string;
  label: string;
  type: FormFieldType;
}

// The derived Drizzle table shape is intentionally loose (its columns depend on
// the fields), mirroring how the rest of the codebase types generic tables.
// oxlint-disable-next-line typescript/no-explicit-any -- matches drizzle-orm's own default table generic
export type AnyFormTable = SQLiteTableWithColumns<any>;
export type FormColumns = Record<string, SQLiteColumn>;

/**
 * The product of {@link defineForm}: the original config plus everything derived
 * from it — the Drizzle `columns`/`table`, and the `reviewColumns` the drawer
 * uses to render the submissions list.
 */
export interface FormDefinition extends FormConfig {
  /** Derived Drizzle columns (spread into a table, or use {@link table}). */
  columns: Record<string, unknown>;
  /** The ready-made Drizzle table for this form. */
  table: AnyFormTable;
  /** Field key → review column (label + type) for the submissions panel. */
  reviewColumns: FormReviewColumn[];
}
