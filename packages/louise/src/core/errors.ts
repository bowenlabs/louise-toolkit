// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// `Error.captureStackTrace` is a real V8 engine feature available in
// workerd's V8 isolates — it's just not part of any spec, so it isn't in
// TypeScript's standard lib types without pulling in @types/node, which
// Louise deliberately doesn't (V8-first, no Node assumptions). Declared
// non-optional so it merges cleanly with @cloudflare/workers-types' own
// (required) declaration where that's in scope; the runtime still feature-
// detects it before calling.
declare global {
  interface ErrorConstructor {
    // oxlint-disable-next-line typescript/no-unsafe-function-type -- matches the real V8 signature — this.constructor is typed as Function by TS itself
    captureStackTrace(targetObject: object, constructorOpt?: Function): void;
  }
}

/**
 * Base class for all Louise errors.
 * All primitives throw LouiseError or a typed subclass — never a raw Error.
 *
 * @example
 * try {
 *   await createMagicLink({ kv, email, to })
 * } catch (e) {
 *   if (e instanceof LouiseAuthError) {
 *     // auth-specific handling
 *   } else if (e instanceof LouiseError) {
 *     // any Louise error — e.code tells you which primitive threw
 *   } else {
 *     throw e // re-throw unknown errors
 *   }
 * }
 */
export class LouiseError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LouiseError";
    // Maintains proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/** For authentication / sign-in failures. */
export class LouiseAuthError extends LouiseError {
  constructor(message: string, cause?: unknown) {
    super(message, "AUTH_ERROR", cause);
    this.name = "LouiseAuthError";
  }
}

/** For database (D1) failures. */
export class LouiseDbError extends LouiseError {
  constructor(message: string, cause?: unknown) {
    super(message, "DB_ERROR", cause);
    this.name = "LouiseDbError";
  }
}

/** For object-storage (R2) failures. */
export class LouiseStorageError extends LouiseError {
  constructor(message: string, cause?: unknown) {
    super(message, "STORAGE_ERROR", cause);
    this.name = "LouiseStorageError";
  }
}

/** For cache (KV) failures. */
export class LouiseCacheError extends LouiseError {
  constructor(message: string, cause?: unknown) {
    super(message, "CACHE_ERROR", cause);
    this.name = "LouiseCacheError";
  }
}

/** For email-sending failures. */
export class LouiseEmailError extends LouiseError {
  constructor(message: string, cause?: unknown) {
    super(message, "EMAIL_ERROR", cause);
    this.name = "LouiseEmailError";
  }
}

/** For session failures. */
export class LouiseSessionError extends LouiseError {
  constructor(message: string, cause?: unknown) {
    super(message, "SESSION_ERROR", cause);
    this.name = "LouiseSessionError";
  }
}

/** For queue failures. */
export class LouiseQueueError extends LouiseError {
  constructor(message: string, cause?: unknown) {
    super(message, "QUEUE_ERROR", cause);
    this.name = "LouiseQueueError";
  }
}

/** For workflow failures (starting an instance; a step's own throw surfaces
 *  as-is so Cloudflare Workflows can retry it per the step's config). */
export class LouiseWorkflowError extends LouiseError {
  constructor(message: string, cause?: unknown) {
    super(message, "WORKFLOW_ERROR", cause);
    this.name = "LouiseWorkflowError";
  }
}

/** For content (collection / Local API) failures. */
export class LouiseContentError extends LouiseError {
  constructor(message: string, cause?: unknown) {
    super(message, "CONTENT_ERROR", cause);
    this.name = "LouiseContentError";
  }
}

/**
 * Thrown by the content `createLocalApi` when a collection's `access` function
 * rejects an operation. A distinct subclass (rather than a plain
 * LouiseContentError) so a routing layer can map it to **403** by `instanceof`,
 * not by matching on message text.
 */
export class LouiseAccessDeniedError extends LouiseContentError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "LouiseAccessDeniedError";
  }
}

/**
 * One failed field-validation rule (issue #16). `path` is the field's key
 * (flattened, e.g. `shippingAddress_city` for a group subfield). `severity`
 * lets a rule warn without blocking the write — only `"error"` violations
 * cause createLocalApi to throw; `"warning"` ones are carried through for
 * the editor to surface non-blockingly.
 */
export interface ValidationViolation {
  path: string;
  message: string;
  severity: "error" | "warning";
}

/**
 * Thrown by `createLocalApi` when a collection's field-validation rules
 * (Sanity-style chainable `Rule` API — see content/validation.ts) reject a
 * create/update. Carries the structured `violations` so a UI can surface
 * per-field messages and a routing layer can map it to **422** by `instanceof`
 * rather than message matching. A subclass of LouiseContentError, so existing
 * `instanceof LouiseContentError` handling still catches it. Only `"error"`-severity
 * violations are ever thrown.
 */
export class LouiseValidationError extends LouiseContentError {
  constructor(
    message: string,
    public readonly violations: ValidationViolation[],
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "LouiseValidationError";
  }
}

/**
 * Carries an HTTP `status` and parsed `body` for a failed request against a
 * Louise-backed API surface, so callers can branch on `status` (e.g. 403 →
 * access denied, 404 → not found) instead of re-parsing `{ error: string }`
 * response bodies by hand.
 */
export class LouiseApiError extends LouiseError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message, "API_ERROR");
    this.name = "LouiseApiError";
  }
}
