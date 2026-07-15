// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/schema — Standard Schema (https://standardschema.dev) support:
// the vendored interface, a runner that folds any Standard Schema's result into
// Louise's {@link ValidationViolation} shape, and a tiny zero-dep `s.*` builder.
//
// Consumers bring their own validator (Zod/Valibot/ArkType) at the "accept a
// schema" seams (form fields, collection fields — #98); the `s.*` builder is
// the built-in fallback and what the editor route boundaries parse with (#96).

export type { StandardSchemaV1 } from "./standard.js";
export {
  issuesToViolations,
  parseOrThrow,
  standardValidate,
  type StandardParseResult,
} from "./validate.js";
export { type NumberOptions, s, type StringOptions } from "./builders.js";
