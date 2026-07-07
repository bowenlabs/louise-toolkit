// Worker entrypoint. @astrojs/cloudflare v14 dropped `workerEntryPoint`, so
// `wrangler.jsonc`'s `main` points here. Every request falls through to Astro's
// SSR handler; this seam adds two Browser Run features (louisecms/browser, #5):
//
//   - GET /og.png?slug=&title=  — a per-page Open Graph card, rendered on
//     Cloudflare Browser Run and cached (content-hashed) so the second request
//     for unchanged content is served from cache with no browser session.
//   - scheduled()               — a daily link-checker crawling the docs, run
//     from the Cron Trigger in wrangler.jsonc; broken links are logged.
import { handle } from "@astrojs/cloudflare/handler";
import {
  checkLinks,
  createPuppeteerRenderer,
  type LouiseBrowserEnv,
  type OgImageCache,
  ogCacheKey,
  ogImage,
} from "louisecms/browser";

type WorkerEnv = Env & LouiseBrowserEnv;

const SITE_ORIGIN = "https://louisecms.com";

/** The OG card markup screenshotted into a share image. Self-contained (inline
 *  styles, system fonts) so no network fetch is needed during rendering. */
function ogCardHtml(title: string): string {
  const safe = title.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;box-sizing:border-box}
    body{width:1200px;height:630px;display:flex;flex-direction:column;justify-content:center;
      padding:80px;background:#0f172a;color:#f8fafc;
      font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
    .brand{font-size:28px;font-weight:600;color:#56c6be;letter-spacing:.02em}
    h1{font-size:76px;font-weight:800;line-height:1.05;margin-top:24px;max-width:1000px}
    .u{margin-top:auto;font-size:24px;color:#94a3b8}
  </style></head><body>
    <div class="brand">louisecms</div><h1>${safe}</h1><div class="u">louisecms.com</div>
  </body></html>`;
}

/** OG-image byte store backed by the Workers Cache API — no extra binding, and
 *  the content-hashed key means a hit is always the right card. */
function ogCacheStore(): OgImageCache {
  const req = (key: string) => new Request(`https://og.cache/${key}`);
  return {
    async get(key) {
      const res = await caches.default.match(req(key));
      return res ? new Uint8Array(await res.arrayBuffer()) : null;
    },
    async put(key, bytes, contentType) {
      await caches.default.put(
        req(key),
        new Response(bytes, {
          headers: {
            "content-type": contentType ?? "image/png",
            "cache-control": "public, max-age=31536000, immutable",
          },
        }),
      );
    },
  };
}

async function handleOgImage(url: URL, env: WorkerEnv): Promise<Response> {
  const slug = url.searchParams.get("slug") ?? "/";
  const title = url.searchParams.get("title") ?? "The V8-native CMS for Cloudflare Workers";
  const cacheKey = await ogCacheKey(slug, title);
  const { bytes, cached } = await ogImage({
    cacheKey,
    html: ogCardHtml(title),
    render: createPuppeteerRenderer(env.BROWSER),
    cache: ogCacheStore(),
  });
  return new Response(bytes, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=3600",
      "x-og-cache": cached ? "hit" : "miss",
    },
  });
}

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/og.png") return handleOgImage(url, env as WorkerEnv);
    return handle(request, env, ctx);
  },
  // Cron Trigger (wrangler.jsonc): crawl the docs and log any broken links.
  async scheduled(_event, _env, ctx) {
    ctx.waitUntil(
      (async () => {
        const broken = await checkLinks({ base: SITE_ORIGIN, paths: ["/", "/docs/"] });
        if (broken.length > 0)
          console.warn(`[link-check] ${broken.length} broken link(s):`, broken);
        else console.log("[link-check] all links OK");
      })(),
    );
  },
} satisfies ExportedHandler<WorkerEnv>;
