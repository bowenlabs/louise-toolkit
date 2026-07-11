// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// louisecms/forms — optional TanStack Form adapter (issue #46, Tier 2).
//
// The base <Form> render helper (louisecms/client) covers the flat, generated
// forms in scope with no dependency. For a COMPLEX form — multi-step, field
// arrays, cross-field/async rules — a site may reach for `@tanstack/solid-form`.
// This adapter lets that form still validate with Louise's SHARED `Rule` engine
// instead of a second schema: each helper returns a validator function in
// TanStack Form's shape (`({ value }) => errorMessage | undefined`), so there's
// still one validation definition.
//
// Dependency-free by design: it imports nothing from `@tanstack/solid-form` — it
// just returns functions that slot into TanStack's `validators`. The consumer
// brings the peer. See the forms guide for a worked example.

import type { FormConfig, FormField } from "./types.js";
import { coerceFormValue, validateField } from "./validate.js";

/** A TanStack Form field-validator: returns an error string, or `undefined` when
 *  valid. Async so DB-backed custom rules can be awaited. */
export type TanstackFieldValidator = (args: { value: unknown }) => Promise<string | undefined>;

/**
 * A TanStack Form validator for one field, backed by the shared engine. Coerces
 * like the server, runs {@link validateField}, and returns the first error's
 * message (TanStack shows one error per field) or `undefined`.
 *
 * ```tsx
 * <form.Field name="email" validators={{ onChange: tanstackFieldValidator("email", fields.email) }}>
 * ```
 */
export function tanstackFieldValidator(key: string, field: FormField): TanstackFieldValidator {
  return async ({ value }) => {
    const violations = await validateField(key, field, coerceFormValue(field, value));
    return violations.find((v) => v.severity === "error")?.message;
  };
}

/**
 * Build a `{ [fieldName]: validator }` map for every field in a form, ready to
 * spread onto each `<form.Field validators={{ onChange: map[name] }}>`. Complex
 * forms wire these into `@tanstack/solid-form` and keep Louise's one validation
 * definition.
 */
export function tanstackFormValidators(config: FormConfig): Record<string, TanstackFieldValidator> {
  return Object.fromEntries(
    Object.entries(config.fields).map(([key, field]) => [key, tanstackFieldValidator(key, field)]),
  );
}
