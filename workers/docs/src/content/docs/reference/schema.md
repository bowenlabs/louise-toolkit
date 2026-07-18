---
title: schema
description: "louise-toolkit/schema — a zero-dep Standard Schema builder and one runner that folds any validator into Louise's violation shape."
sidebar:
  order: 2.5
---

```ts
import { s, standardValidate, type StandardSchemaV1 } from "louise-toolkit/schema";
```

The validation seam. Consumers bring their own validator (Zod / Valibot /
ArkType) wherever a schema is accepted; the built-in `s.*` builder is the
zero-dependency fallback, and both run through one runner. Anything that
implements [Standard Schema](https://standardschema.dev) works — the core stays
`dependencies: {}`. No peers.

## `s` — the built-in builder

```ts
const s: {
  object, string, number, boolean, enumOf, unknown, record, array, optional
};
```

A tiny, synchronous schema builder whose every output **is** a Standard Schema —
hand the result to [`standardValidate`](#standardvalidateschema-input-basepath)
or set it as a field's `schema`. `object` drops unknown keys (a forged request
can't smuggle extra fields), and `array`/`object`/`record` re-path child issues
under their index/key (`items.2.qty`).

```ts
const OrderInput = s.object({
  email: s.string({ min: 3, pattern: /@/ }),
  qty: s.number({ int: true, min: 1 }),
  gift: s.optional(s.boolean()),
  items: s.array(s.string(), { min: 1 }),
});
```

The builders are sync, so composing an **async** schema inside `object` /
`record` / `optional` isn't supported — run those at the top level with
`standardValidate`, which awaits.

## `standardValidate(schema, input, basePath?)`

```ts
function standardValidate<Schema extends StandardSchemaV1>(
  schema: Schema,
  input: unknown,
  basePath?: string,
): Promise<{ ok: true; value: Output } | { ok: false; violations: ValidationViolation[] }>;
```

Validate `input` against any Standard Schema, awaiting an async validator.
Returns the typed value or the violations — it never throws for a validation
failure. Each violation is `{ path, message, severity: "error" }`; `basePath`
prefixes every path, so a caller validating one field's value anchors the issues
at that field's key.

```ts
const result = await standardValidate(OrderInput, await request.json());
if (!result.ok) {
  return Response.json({ violations: result.violations }, { status: 422 });
}
result.value; // fully typed
```

## `parseOrThrow(schema, input)`

```ts
function parseOrThrow<Schema extends StandardSchemaV1>(
  schema: Schema,
  input: unknown,
): Promise<Output>;
```

Same validation, but returns the value directly and throws
[`LouiseValidationError`](/reference/errors/) (carrying the structured
`violations`) on failure — for call sites that want the exception, sharing the
same `instanceof → 422` mapping the rest of the toolkit uses.

## `parseJson` / `parseModelJson`

```ts
function parseJson<Schema>(schema: Schema, raw: string): Promise<StandardParseResult<Output>>;
function parseModelJson<Schema>(schema: Schema, modelText: string): Promise<StandardParseResult<Output>>;
```

Parse **then** validate, so "not JSON" and "wrong shape" come back through the
same result branch instead of a thrown `SyntaxError`. `parseJson` is for a raw
body (e.g. a signature-verified webhook, where the HMAC proves the sender but not
the payload shape). `parseModelJson` is the untrusted-LLM case: it extracts the
first balanced object/array (`extractJson`, tolerating prose and ` ```json `
fences) before validating, so a chatty model reply still parses. Neither throws.

## `StandardSchemaV1`

The vendored [Standard Schema](https://standardschema.dev) interface — a `spec`,
not a runtime: a single `~standard` property any validator exposes. It's
vendored (~40 lines) rather than depended on, keeping the core dependency-free;
the `s.*` builder implements the same interface, so consumer validators and
Louise's own run through one runner. `StandardSchemaV1.InferInput` /
`InferOutput` recover a schema's input/output types.

## Types

`StandardSchemaV1`, `StandardParseResult<T>`, `StringOptions`, `NumberOptions`,
`ArrayOptions`. `issuesToViolations` and `extractJson` are exported for callers
mapping issues or salvaging JSON by hand.
