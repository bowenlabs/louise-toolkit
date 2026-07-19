// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/forms — declarative form definitions (issue #46). Define a form's
// fields once; the same definition derives the submission table, the public
// capture route (`formRoute`), server + client validation, and the review
// columns. `inquiries` is just the built-in default form (see `louise-toolkit/db`).
//
// Field validation reuses the shared `Rule`/`validateValue` engine
// (`louise-toolkit/content`) — there is one validation definition, run on both sides.

import type {
  SQLiteColumn,
  SQLiteColumnBuilderBase,
  SQLiteTableWithColumns,
} from "drizzle-orm/sqlite-core";
import type { ValidationBuilder } from "../content/rule.js";
import type { StandardSchemaV1 } from "../schema/index.js";

/**
 * Input semantics a public form needs, on top of the content field vocabulary. Each
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
  /**
   * Bring-your-own validation (#98): any Standard Schema
   * (https://standardschema.dev) — Zod, Valibot, ArkType, or the built-in
   * `louise-toolkit/schema` `s.*` builder. Run in the same shared client+server
   * pass as `validation`, on the coerced value, and skipped for empty values so
   * an optional field stays optional. `validation` (the zero-dep `Rule` engine)
   * remains the default; this is for consumers who'd rather reuse a validator
   * they already have.
   */
  schema?: StandardSchemaV1;
}

/** Anti-spam options for a form's public capture route. */
export interface FormSpamConfig {
  /** Require a Cloudflare Turnstile token (`cf-turnstile-response`). Verified
   *  server-side when `formRoute` is given a `turnstileSecret`. */
  turnstile?: boolean;
  /** Fixed-window rate limit, keyed by client (typically IP). Enforced when
   *  `formRoute` is given a KV binding. */
  rateLimit?: { max: number; windowSec: number };
  /**
   * Honeypot: a decoy field name a bot fills but a human never sees. Any
   * non-empty value silently rejects the submission. The render helper emits it
   * hidden + `autocomplete="off"`. Default off.
   */
  honeypot?: string;
  /**
   * Minimum seconds between the form rendering and its submit — a bot posts
   * near-instantly. Enforced against a `louise_ts` timestamp the render helper
   * stamps at mount. Default off.
   */
  minSeconds?: number;
}

/** A minimal mailer the site provides so `formRoute` can send an email
 *  notification without coupling to any one email binding. Wrap your `EMAIL`
 *  binding + `louise-toolkit/email` templates here. */
export type FormMailer = (message: {
  to: string;
  subject: string;
  text: string;
}) => void | Promise<void>;

/** Where a successful submission is announced (Tier 3). */
export interface FormNotifyConfig {
  /** POST `{ form, values }` to this webhook URL (fire-and-forget). */
  webhook?: string;
  /** Email a notification. Requires a `mailer` on the route config. */
  email?: { to: string; subject?: string };
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
 * from it — the Drizzle `columns`/`table`, and the `reviewColumns` the Settings
 * uses to render the submissions list.
 */
export interface FormDefinition extends FormConfig {
  /** Derived Drizzle column builders — spread into your own
   *  `sqliteTable(name, { ...columns, /* extras *​/ })`, or use {@link table}. */
  columns: Record<string, SQLiteColumnBuilderBase>;
  /** The ready-made Drizzle table for this form. */
  table: AnyFormTable;
  /** Field key → review column (label + type) for the submissions panel. */
  reviewColumns: FormReviewColumn[];
}
