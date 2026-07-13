// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// Transport/scope security headers + an optional CSP style-src rewrite, shared
// by every Louise site's middleware. Composed as small functions the site's
// Astro middleware calls on the outgoing `Response`, so a site keeps ownership
// of the rest of its policy (img-src, connect-src, script hashes, …).

export interface SecurityHeaderOptions {
  /** Request hostname. Headers are skipped on localhost/127.0.0.1 so dev works. */
  hostname: string;
  /** Override `Permissions-Policy`; default denies camera/microphone/geolocation. */
  permissionsPolicy?: string;
  /** Override `Strict-Transport-Security`; default is 1y + includeSubDomains. */
  hsts?: string;
}

/**
 * Apply Louise's baseline transport/scope headers to `response` in place and
 * return it. No-op on localhost so Vite's dev scripts keep working.
 */
export function louiseSecurityHeaders(response: Response, opts: SecurityHeaderOptions): Response {
  if (opts.hostname === "localhost" || opts.hostname === "127.0.0.1") return response;
  const h = response.headers;
  h.set("Strict-Transport-Security", opts.hsts ?? "max-age=31536000; includeSubDomains");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("Permissions-Policy", opts.permissionsPolicy ?? "camera=(), microphone=(), geolocation=()");
  // The site never frames itself; deny outright. COOP isolates the auth flow.
  h.set("X-Frame-Options", "DENY");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  return response;
}

/**
 * Rewrite only the `style-src` directive of an existing `Content-Security-Policy`
 * header, leaving every other directive (script hashes, etc.) verbatim. Astro's
 * `security.csp` hashes its own inline island `<style>`, and a hash in style-src
 * voids `'unsafe-inline'` — which data-driven `style=""` attributes need. Call
 * this with the site's desired style-src to restore inline styles. No-op when no
 * CSP header is present (e.g. `astro dev`).
 */
export function rewriteCspStyleSrc(response: Response, styleSrc: string): Response {
  const csp = response.headers.get("content-security-policy");
  if (!csp) return response;
  const rewritten = csp
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => (d.startsWith("style-src") ? `style-src ${styleSrc}` : d))
    .join("; ");
  response.headers.set("content-security-policy", rewritten);
  return response;
}
