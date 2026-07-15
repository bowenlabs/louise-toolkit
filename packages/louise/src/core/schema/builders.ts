// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/schema — a tiny, zero-dependency schema builder whose every
// output IS a Standard Schema (standard.ts). It exists so Louise's own code —
// the editor route bodies (#96) — can declare a request shape without pulling
// Zod/Valibot into the Worker, and so consumers who don't want a validator dep
// still have one. It is deliberately minimal: just the primitives the route
// boundaries need. For anything richer, bring your own Standard Schema —
// {@link standardValidate} runs it the same way.
//
// The builders are synchronous. Composing an *async* schema inside `object`,
// `record`, or `optional` isn't supported (there is nothing to await inside a
// sync `validate`); run those at the top level with {@link standardValidate}.

import type { StandardSchemaV1 } from "./standard.js";

const VENDOR = "louise";

/** Wrap a synchronous validate fn as a Standard Schema. */
function build<Output>(
  validate: (value: unknown) => StandardSchemaV1.Result<Output>,
): StandardSchemaV1<unknown, Output> {
  return { "~standard": { version: 1, vendor: VENDOR, validate } };
}

/** A single-issue failure result. */
function fail(message: string): StandardSchemaV1.FailureResult {
  return { issues: [{ message }] };
}

/**
 * Run a child schema synchronously. Our builders are all sync; if a composed
 * schema validates asynchronously it can't be awaited here, so report that as
 * an issue rather than silently treating the pending Promise as valid.
 */
function runSync(schema: StandardSchemaV1, value: unknown): StandardSchemaV1.Result<unknown> {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) {
    return fail("Asynchronous schema is not supported here");
  }
  return result;
}

export interface StringOptions {
  /** Minimum length (inclusive). */
  min?: number;
  /** Maximum length (inclusive). */
  max?: number;
  /** A pattern the string must match. */
  pattern?: RegExp;
  /** Override the failure message for every check. */
  message?: string;
}

function string(options: StringOptions = {}): StandardSchemaV1<unknown, string> {
  return build<string>((value) => {
    if (typeof value !== "string") return fail(options.message ?? "Expected a string");
    if (options.min !== undefined && value.length < options.min) {
      return fail(options.message ?? `Expected at least ${options.min} character(s)`);
    }
    if (options.max !== undefined && value.length > options.max) {
      return fail(options.message ?? `Expected at most ${options.max} character(s)`);
    }
    if (options.pattern && !options.pattern.test(value)) {
      return fail(options.message ?? "Invalid format");
    }
    return { value };
  });
}

export interface NumberOptions {
  /** Require an integer. */
  int?: boolean;
  /** Minimum value (inclusive). */
  min?: number;
  /** Maximum value (inclusive). */
  max?: number;
  /** Override the failure message for every check. */
  message?: string;
}

function number(options: NumberOptions = {}): StandardSchemaV1<unknown, number> {
  return build<number>((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fail(options.message ?? "Expected a number");
    }
    if (options.int && !Number.isInteger(value)) {
      return fail(options.message ?? "Expected an integer");
    }
    if (options.min !== undefined && value < options.min) {
      return fail(options.message ?? `Expected a number >= ${options.min}`);
    }
    if (options.max !== undefined && value > options.max) {
      return fail(options.message ?? `Expected a number <= ${options.max}`);
    }
    return { value };
  });
}

function boolean(): StandardSchemaV1<unknown, boolean> {
  return build<boolean>((value) =>
    typeof value === "boolean" ? { value } : fail("Expected a boolean"),
  );
}

/** One of a fixed set of string literals (mirrors `select` allowlists). */
function enumOf<const Values extends readonly [string, ...string[]]>(
  ...values: Values
): StandardSchemaV1<unknown, Values[number]> {
  return build<Values[number]>((value) =>
    typeof value === "string" && (values as readonly string[]).includes(value)
      ? { value: value as Values[number] }
      : fail(`Expected one of: ${values.join(", ")}`),
  );
}

/** Accept any value, passing it through untouched (e.g. a rich field `value`). */
function unknown(): StandardSchemaV1<unknown, unknown> {
  return build<unknown>((value) => ({ value }));
}

/** Allow `undefined`, otherwise validate with `inner`. */
function optional<Schema extends StandardSchemaV1>(
  inner: Schema,
): StandardSchemaV1<
  StandardSchemaV1.InferInput<Schema> | undefined,
  StandardSchemaV1.InferOutput<Schema> | undefined
> {
  return build<StandardSchemaV1.InferOutput<Schema> | undefined>((value) => {
    if (value === undefined) return { value: undefined };
    return runSync(inner, value) as StandardSchemaV1.Result<
      StandardSchemaV1.InferOutput<Schema> | undefined
    >;
  });
}

type Shape = Record<string, StandardSchemaV1>;
type InferShape<S extends Shape> = { [K in keyof S]: StandardSchemaV1.InferOutput<S[K]> };

/**
 * An object with the declared keys. Unknown keys are dropped from the output
 * (not an error) — safer than the `as T` casts it replaces, since a forged
 * request can't smuggle extra fields through. Each key's issues are re-pathed
 * under that key.
 */
function object<S extends Shape>(shape: S): StandardSchemaV1<unknown, InferShape<S>> {
  const keys = Object.keys(shape) as (keyof S & string)[];
  return build<InferShape<S>>((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return fail("Expected an object");
    }
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    const issues: StandardSchemaV1.Issue[] = [];
    for (const key of keys) {
      const result = runSync(shape[key], input[key]);
      if (result.issues) {
        for (const issue of result.issues) {
          issues.push({ message: issue.message, path: [key, ...(issue.path ?? [])] });
        }
      } else {
        output[key] = result.value;
      }
    }
    return issues.length > 0 ? { issues } : { value: output as InferShape<S> };
  });
}

/** An object of arbitrary string keys, each value validated by `valueSchema`
 *  (defaults to {@link unknown}) — for the patch bodies that carry a
 *  `Record<string, unknown>`. */
function record<Value extends StandardSchemaV1 = StandardSchemaV1<unknown, unknown>>(
  valueSchema?: Value,
): StandardSchemaV1<unknown, Record<string, StandardSchemaV1.InferOutput<Value>>> {
  const vs: StandardSchemaV1 = valueSchema ?? unknown();
  return build<Record<string, StandardSchemaV1.InferOutput<Value>>>((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return fail("Expected an object");
    }
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    const issues: StandardSchemaV1.Issue[] = [];
    for (const key of Object.keys(input)) {
      const result = runSync(vs, input[key]);
      if (result.issues) {
        for (const issue of result.issues) {
          issues.push({ message: issue.message, path: [key, ...(issue.path ?? [])] });
        }
      } else {
        output[key] = result.value;
      }
    }
    return issues.length > 0
      ? { issues }
      : { value: output as Record<string, StandardSchemaV1.InferOutput<Value>> };
  });
}

/**
 * The built-in zero-dep schema builder, namespaced so call sites read
 * `s.object({ collection: s.string(), value: s.unknown() })` without shadowing
 * the `string`/`number`/`object` globals. Every result is a Standard Schema —
 * hand it to {@link standardValidate} or set it as a field's `schema`.
 */
export const s = {
  object,
  string,
  number,
  boolean,
  enumOf,
  unknown,
  record,
  optional,
} as const;
