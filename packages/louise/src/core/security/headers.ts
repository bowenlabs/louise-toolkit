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

/** Does a CSP source list already permit the `data:` scheme? */
function allowsDataScheme(directive: string): boolean {
  return /(?:^|\s)data:(?:\s|$)/.test(directive);
}

/**
 * Ensure the response CSP allows `data:` fonts, so Louise's bundled brand font —
 * an inlined `data:` `@font-face` (see `theme/fonts.css`), loaded on every edit
 * surface — isn't blocked by a strict `font-src`. `createLouiseMiddleware` calls
 * this for you, so consuming sites need no `font-src` change.
 *
 * Adds `data:` to an existing `font-src`; if the policy has no `font-src` but a
 * `default-src` (which fonts fall back to), it appends a `font-src` derived from
 * `default-src` + `data:` so nothing else is loosened. No-op when there is no CSP
 * header (e.g. `astro dev`) or when fonts are already unrestricted (neither
 * directive present). Idempotent.
 */
export function allowCspDataFonts(response: Response): Response {
  const csp = response.headers.get("content-security-policy");
  if (!csp) return response;
  const directives = csp
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean);

  let sawFontSrc = false;
  const out = directives.map((d) => {
    if (d === "font-src" || d.startsWith("font-src ")) {
      sawFontSrc = true;
      return allowsDataScheme(d) ? d : `${d} data:`;
    }
    return d;
  });

  if (!sawFontSrc) {
    const defaultSrc = directives.find((d) => d === "default-src" || d.startsWith("default-src "));
    // No font-src and no default-src ⇒ fonts are unrestricted; leave it alone.
    if (!defaultSrc) return response;
    const sources = defaultSrc.replace(/^default-src\s*/, "").trim();
    // `'none'` can't combine with other tokens; a data: font means "not none".
    const base = sources && sources !== "'none'" ? `${sources} ` : "";
    out.push(`font-src ${base}data:`);
  }

  response.headers.set("content-security-policy", out.join("; "));
  return response;
}
