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
