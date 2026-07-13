// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Framework-owned `submissions` — a SHARED, generic store for ad-hoc forms
// (issue #46, Tier 3). A first-class form like `inquiries` gets its own typed
// table; a one-off form (RSVP, waitlist, booking) can instead write here as
// `{ form, data }` so a new form needs NO new table/migration. `formRoute`'s
// `genericTable` option targets this; `submissionsRoute` reviews it per form.

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** The generic `submissions` columns. Spread to extend, or use {@link submissions}. */
export const submissionsColumns = {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** The form's `name` — scopes a review tab and lets one table hold many forms. */
  form: text("form").notNull(),
  /** The submission values, JSON-encoded. */
  data: text("data").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
};

/** The ready-made shared `submissions` table. */
export const submissions = sqliteTable("submissions", submissionsColumns);

export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
