// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// `louise-toolkit/astro` — `formToAstroSchema`: the forms counterpart to
// `collectionToAstroSchema`. It maps a `defineForm` definition to a Zod schema
// so a form can drop straight into an Astro Action's `input`:
//
//   export const server = {
//     inquiry: defineAction({
//       input: formToAstroSchema(inquiryForm),
//       handler: async (input) => { /* input is typed + validated */ },
//     }),
//   };
//
// This closes the gap where form actions took raw `FormData` + a hand-written
// interface + manual coercion: the field set is the single source of truth, and
// the client gets the inferred input type for free.
//
// Like the collection bridge, this lives in `louise-toolkit/astro` and pulls the
// Zod builder from `astro/zod` (an optional peer), so the framework-agnostic
// core never takes a Zod dependency.

import { z } from "astro/zod";
import type { FormConfig, FormField } from "louise-toolkit/forms";

/** Map one form field to its Zod type, including the type's built-in format
 *  check (email/url) and coercion (number/date/checkbox). */
function formFieldToZod(field: FormField): z.ZodType {
  const required = field.required ?? false;

  switch (field.type) {
    case "email":
      return required ? z.email() : z.email().optional();
    case "url":
      return required ? z.url() : z.url().optional();
    case "number":
      // Form values arrive as strings; `coerce` turns "5" into 5.
      return required ? z.coerce.number() : z.coerce.number().optional();
    case "date":
      // Accepts an ISO string, an epoch number, or a Date.
      return required ? z.coerce.date() : z.coerce.date().optional();
    case "checkbox": {
      // A checkbox may arrive as a real boolean (JSON action), or "on"/"true"/
      // "1"/1 (form-encoded) — normalize any of them to a boolean.
      const bool = z
        .union([z.boolean(), z.number(), z.string()])
        .transform((v) => v === true || v === 1 || v === "1" || v === "true" || v === "on");
      return required ? bool : bool.optional();
    }
    case "select": {
      // Options double as the allowlist — a value outside them is rejected.
      const select =
        field.options && field.options.length > 0
          ? z.enum([...field.options] as [string, ...string[]])
          : z.string();
      return required ? select : select.optional();
    }
    default: {
      // text / textarea / tel / file → a plain string (file holds the uploaded
      // asset URL). Required string-likes must be non-empty.
      return required ? z.string().min(1, `${field.label} is required`) : z.string().optional();
    }
  }
}

/**
 * Build a Zod schema from a `defineForm` definition's fields — the form is the
 * single source of truth for its Astro Action `input`, so the handler receives a
 * typed, validated value and the client infers the same shape. Field-level
 * `validation`/`schema` extras still run in the shared `validateSubmission` pass;
 * this describes the field set's structural shape and its built-in type checks.
 *
 * Targets JSON actions (an absent optional field is `undefined`), matching how a
 * typed island calls an action.
 */
export function formToAstroSchema(form: FormConfig): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(form.fields)) {
    shape[key] = formFieldToZod(field);
  }
  return z.object(shape);
}
