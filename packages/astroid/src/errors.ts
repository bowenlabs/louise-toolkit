// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// Typed errors for the Astroid config surface, mirroring Louise's own error
// classes (louise-toolkit/errors) so a bad config throws something recognizable
// rather than a bare Error.

/** Thrown when a `defineAstroid` config violates an invariant (no brands, a
 *  duplicate brand key, …). */
export class AstroidConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AstroidConfigError";
  }
}

/**
 * Thrown when an Astroid runtime helper is called with arguments that would
 * produce a silently wrong result.
 *
 * Distinct from {@link AstroidConfigError}, which is a build-time contract: this
 * one fires on a live request, so it must be something a handler can catch and
 * turn into a 5xx rather than something that reads like a misconfigured project.
 * Reserved for cases where carrying on would be worse than failing — a checkout
 * whose idempotency key collides with another customer's, say, where the damage
 * (a buyer who is never charged) is invisible at the call site.
 */
export class AstroidUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AstroidUsageError";
  }
}
