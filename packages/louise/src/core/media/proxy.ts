// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/media — a resize proxy for images on someone else's host.
//
// `cfImage` rewrites a same-zone URL through `/cdn-cgi/image`, and
// `transformImage` resizes bytes you already hold. Neither helps with a
// third-party image whose URL you can't change — the case that bit a client
// site: Fourthwall's image URLs are signed (imgproxy), the width is part of the
// signature, and every one arrives at 1920px. Asking for another width is a 400,
// so a grid of ~300px cards downloaded ~3.4 MB of full-size photos.
//
// This route fetches the original through Cloudflare with `cf.image`, so the
// resize happens at the edge on the way through. It is deliberately narrow:
// only the hosts you list, only the widths you list (so the cached variants
// are the handful your `srcset` asks for, not one per request), only raster
// types, and no following a redirect off the host. If the resize fails for any
// reason it redirects to the original — the worst case is the page exactly as
// it was without the proxy.
//
// Image Resizing must be enabled on the zone; locally (and on a zone without
// it) every request takes the redirect fallback.

export interface ImageProxyConfig {
  /** Where the route is mounted, e.g. `"/api/img"`. Used to build URLs. */
  path: string;
  /** Exact hostnames the proxy will fetch from. Anything else is a 400. */
  allowHosts: readonly string[];
  /**
   * The only widths the proxy will produce. A layout decision — match your
   * `sizes`. Anything else is a 400, so the edge caches a bounded set.
   */
  widths: readonly number[];
  /** `cf.image.fit`. Default `"scale-down"` — never upscales. */
  fit?: "scale-down" | "contain" | "cover" | "crop" | "pad";
  /** `cf.image.quality`, 1–100. Omitted, Cloudflare's default applies. */
  quality?: number;
  /** Formats to negotiate from `Accept`, in preference order. Default avif, then webp. */
  formats?: readonly ("avif" | "webp")[];
  /**
   * `Cache-Control` on a resized response. Default `public, max-age=86400`.
   * If the source URLs are content-addressed (a new image gets a new URL, as
   * signed URLs do), `public, max-age=31536000, immutable` is safe.
   */
  cacheControl?: string;
  /** Edge cache lifetime for the fetched original, seconds. Omitted, Cloudflare's default. */
  edgeCacheTtl?: number;
  /** What a failed resize does. Default `"redirect"` to the original. */
  onFailure?: "redirect" | "error";
  /** Query parameter names. Default `src` and `w`. */
  params?: { src?: string; width?: string };
}

export interface ImageProxy {
  /** The route handler. Mount it at `path` for GET. */
  handle(request: Request): Promise<Response>;
  /** The proxied URL for `src` at `width`, or `src` unchanged when its host isn't allowed. */
  url(src: string, width: number): string;
  /** A `srcset` over every configured width, or `undefined` when `src`'s host isn't allowed. */
  srcset(src: string): string | undefined;
}

const bad = (message: string) => new Response(message, { status: 400 });

/**
 * The only types the proxy will serve. An allowlist of raster formats, not
 * `image/*`: this response goes out from the site's own origin, and
 * `image/svg+xml` is a document that runs script when opened directly — a
 * stored XSS on the site's origin. Cloudflare sanitizes SVG when the resize
 * runs, but where it doesn't (locally, a zone without Image Resizing) the
 * upstream bytes come back untouched. Same reasoning as `sniffImageType`
 * refusing SVG on upload.
 */
const RASTER = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);

/**
 * Build a resize proxy for third-party images. One config drives both the
 * route and the URLs your markup emits, so the two cannot disagree on which
 * widths exist.
 *
 * ```ts
 * const fwImages = defineImageProxy({
 *   path: "/api/img/fw",
 *   allowHosts: [FW_IMAGE_HOST],
 *   widths: [320, 640, 960, 1280],
 * });
 * // route:  export const GET = ({ request }) => fwImages.handle(request);
 * // markup: <img src={fwImages.url(src, 640)} srcset={fwImages.srcset(src)} sizes="…">
 * ```
 */
export function defineImageProxy(config: ImageProxyConfig): ImageProxy {
  const srcParam = config.params?.src ?? "src";
  const widthParam = config.params?.width ?? "w";
  const hosts = new Set(config.allowHosts.map((h) => h.toLowerCase()));
  const widths = new Set(config.widths);
  const formats = config.formats ?? ["avif", "webp"];

  /** The source as a URL, if the proxy may fetch it: https, an allowed host,
   *  default port. `https://allowed@evil.example` parses to host evil.example
   *  and is refused like any other host. */
  const allowed = (src: string): URL | null => {
    try {
      const u = new URL(src);
      return u.protocol === "https:" && u.port === "" && hosts.has(u.hostname) ? u : null;
    } catch {
      return null;
    }
  };

  const url = (src: string, width: number): string => {
    if (!allowed(src)) return src;
    const q = new URLSearchParams({ [widthParam]: String(width), [srcParam]: src });
    return `${config.path}?${q}`;
  };

  return {
    url,
    srcset(src) {
      if (!allowed(src)) return undefined;
      return [...config.widths]
        .sort((a, b) => a - b)
        .map((w) => `${url(src, w)} ${w}w`)
        .join(", ");
    },
    async handle(request) {
      const params = new URL(request.url).searchParams;
      const origin = allowed(params.get(srcParam) ?? "");
      if (!origin) return bad("Bad image source");
      const width = Number(params.get(widthParam));
      if (!widths.has(width)) return bad("Bad width");

      const accept = request.headers.get("accept") ?? "";
      const format = formats.find((f) => accept.includes(`image/${f}`));

      try {
        const res = await fetch(origin.toString(), {
          // The host allowlist only means something if the fetch stays on the
          // host: followed, a redirect from an allowed host (an open redirect,
          // a compromised bucket) lands the fetch anywhere. A 3xx is not ok,
          // so it takes the failure path below.
          redirect: "manual",
          cf: {
            image: {
              width,
              fit: config.fit ?? "scale-down",
              ...(config.quality !== undefined ? { quality: config.quality } : {}),
              ...(format ? { format } : {}),
            },
            ...(config.edgeCacheTtl !== undefined
              ? { cacheEverything: true, cacheTtl: config.edgeCacheTtl }
              : {}),
          },
        });
        const type = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
        if (!res.ok || !type || !RASTER.has(type)) throw new Error(`resize ${res.status}`);
        return new Response(res.body, {
          headers: {
            "content-type": type,
            "cache-control": config.cacheControl ?? "public, max-age=86400",
            // The format depends on Accept, so caches must key on it.
            vary: "Accept",
            // Belt and braces for bytes that are not what the type claims:
            // never sniff, and opened directly, run nothing.
            "x-content-type-options": "nosniff",
            "content-security-policy": "default-src 'none'; sandbox",
          },
        });
      } catch {
        return config.onFailure === "error"
          ? new Response("Image unavailable", { status: 502 })
          : Response.redirect(origin.toString(), 302);
      }
    },
  };
}
