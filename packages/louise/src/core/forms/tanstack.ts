// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/forms — optional TanStack Form adapter (issue #46, Tier 2).
//
// The base <Form> render helper (louise-toolkit/client) covers the flat, generated
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
 *  valid.
 *
 *  Async so DB-backed custom rules can be awaited — which is also why these
 *  belong in TanStack's `onChangeAsync` / `onBlurAsync` / `onSubmitAsync` slots
 *  rather than the sync ones. See {@link tanstackFieldValidator}. */
export type TanstackFieldValidator = (args: { value: unknown }) => Promise<string | undefined>;

/**
 * A TanStack Form validator for one field, backed by the shared engine. Coerces
 * like the server, runs {@link validateField}, and returns the first error's
 * message (TanStack shows one error per field) or `undefined`.
 *
 * **Wire it to an `*Async` slot.** These validators are async by contract (below),
 * and TanStack keys its slots on that: a promise-returning function in `onChange`
 * is stored *as the promise*, so `meta.errors` holds a pending Promise instead of
 * a string. Nothing throws — the message simply never renders and the submit
 * button never disables, which reads exactly like "validation isn't running".
 *
 * ```tsx
 * <form.Field
 *   name="email"
 *   validators={{ onChangeAsync: tanstackFieldValidator("email", fields.email) }}
 * >
 * ```
 *
 * `onBlurAsync` and `onSubmitAsync` take the same function; pair with
 * `onChangeAsyncDebounceMs` if a rule hits the network.
 */
export function tanstackFieldValidator(key: string, field: FormField): TanstackFieldValidator {
  return async ({ value }) => {
    const violations = await validateField(key, field, coerceFormValue(field, value));
    return violations.find((v) => v.severity === "error")?.message;
  };
}

/**
 * Build a `{ [fieldName]: validator }` map for every field in a form, ready to
 * spread onto each `<form.Field validators={{ onChangeAsync: map[name] }}>`.
 * Complex forms wire these into `@tanstack/solid-form` and keep Louise's one
 * validation definition.
 *
 * The map is FLAT, mirroring `FormConfig.fields` — `defineForm` has no array or
 * nested field type, since each field is one column. A form with repeating rows
 * builds its array with TanStack's own API and attaches these validators to the
 * leaves.
 */
export function tanstackFormValidators(config: FormConfig): Record<string, TanstackFieldValidator> {
  return Object.fromEntries(
    Object.entries(config.fields).map(([key, field]) => [key, tanstackFieldValidator(key, field)]),
  );
}
