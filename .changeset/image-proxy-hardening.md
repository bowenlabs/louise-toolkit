---
"louise-toolkit": patch
---

`defineImageProxy` no longer serves SVG, and no longer follows redirects.

**What changed.** The proxy accepted any `image/*` response and served it from your site's origin. An SVG is a document: opened directly, its scripts run on your origin, the same risk that makes media uploads refuse SVG. Cloudflare sanitizes SVG when the resize runs, but locally and on a zone without Image Resizing the upstream bytes came back untouched. The proxy now serves only JPEG, PNG, GIF, WebP and AVIF, and adds `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox` to every response. The upstream fetch also no longer follows redirects, so an allowed host that redirects (an open redirect, a moved bucket) can't send the fetch to a host you never listed.

**What you have to do.** Nothing for raster sources such as Fourthwall's. A source that now fails either check (an SVG, or a URL that redirects) takes the existing failure path: a 302 to the original URL, or a 502 with `onFailure: "error"`. The image still displays, from its own host instead of yours. If your allowed host serves images through a redirect, list the final host in `allowHosts` and pass the final URL.
