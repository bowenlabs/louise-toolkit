// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// `louise-toolkit/security` — the security-critical primitives shared by every
// Louise site: an editor-HTML sanitizer, a KV rate limiter, a Secrets-Store
// session-secret helper, and baseline security headers. A fix here protects
// every site at once (the reason these live in the package, not copy-pasted).

export { ALLOWED_TAGS, ATTR_ALLOW, sanitizeRichHtml, type SanitizeOptions } from "./sanitize";
// The same-origin (CSRF) check for cookie-authenticated or money-moving POSTs.
// It lives in `auth/guard` (where the editor gates use it) but belongs to the
// security surface too — a public POST that charges a card needs it without
// pulling in the whole auth barrel. `guard` has no runtime imports, so this adds
// nothing but the function.
export { isSameOrigin } from "../auth/guard";
export { matchRateRule, rateLimit, type RateLimitResult, type RateRule } from "./rate-limit";
export { getSessionSecret, readSecret, type ReadSecretOptions, type SecretSource } from "./secrets";
export {
  allowCspDataFonts,
  louiseSecurityHeaders,
  rewriteCspStyleSrc,
  type SecurityHeaderOptions,
} from "./headers";
export type {
  KVLike,
  LouiseEnv,
  RateLimitBackend,
  RateLimiterBinding,
  SecretBinding,
} from "./types";
