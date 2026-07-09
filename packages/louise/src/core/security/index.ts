// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.

// `louisecms/security` — the security-critical primitives shared by every
// Louise site: an editor-HTML sanitizer, a KV rate limiter, a Secrets-Store
// session-secret helper, and baseline security headers. A fix here protects
// every site at once (the reason these live in the package, not copy-pasted).

export { ALLOWED_TAGS, ATTR_ALLOW, sanitizeRichHtml, type SanitizeOptions } from "./sanitize";
export { matchRateRule, rateLimit, type RateLimitResult, type RateRule } from "./rate-limit";
export { getSessionSecret } from "./secrets";
export { louiseSecurityHeaders, rewriteCspStyleSrc, type SecurityHeaderOptions } from "./headers";
export type { KVLike, LouiseEnv, SecretBinding } from "./types";
