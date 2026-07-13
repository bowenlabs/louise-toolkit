// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Framework-owned `inquiries` — contact-form submissions. `inquiries` is now the
// **built-in default form** (issue #46): its table is derived from a
// `defineForm` definition, so the same definition drives the columns, the public
// capture route (`formRoute`), validation, and the review columns — no
// hand-authored DDL. Compose your own by extending `inquiriesForm.fields`, or add
// site columns (e.g. a `clientId` soft link) by spreading `inquiriesColumns`.

import { defineForm } from "../forms/index.js";

/**
 * The built-in inquiries form. Its derived table matches the framework's
 * long-standing `inquiries` shape (first/last name, required email, subject,
 * required message, `created_at`). Extend `fields` for a site's contact form, or
 * define a wholly separate form with `defineForm`.
 */
export const inquiriesForm = defineForm({
  name: "inquiries",
  fields: {
    firstName: { type: "text", label: "First name" },
    lastName: { type: "text", label: "Last name" },
    email: { type: "email", label: "Email", required: true },
    regarding: { type: "text", label: "Regarding" },
    message: { type: "textarea", label: "Message", required: true },
  },
});

/**
 * The framework-generic `inquiries` columns, derived from {@link inquiriesForm}.
 * Spread into your own `sqliteTable("inquiries", { ...inquiriesColumns, /* extras *​/ })`
 * to extend, or use the ready-made {@link inquiries} table.
 */
export const inquiriesColumns = inquiriesForm.columns;

/**
 * The ready-made `inquiries` table (from {@link inquiriesForm}). Use directly
 * when the generic column set is enough; otherwise compose from
 * {@link inquiriesColumns}.
 */
export const inquiries = inquiriesForm.table;

export type Inquiry = typeof inquiries.$inferSelect;
export type NewInquiry = typeof inquiries.$inferInsert;
