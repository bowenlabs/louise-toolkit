// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The OG-image byte store, shared by the on-demand `/og.png` route (worker.ts)
// and the publish Workflow's cache-warm step (workflows/publish.ts). Extracted
// here so both use it without a circular import through the worker entry.

import type { OgImageCache } from "louise-toolkit/browser";

/** OG-image byte store backed by the Workers Cache API — no extra binding, and
 *  the content-hashed key means a hit is always the right card. */
export function ogCacheStore(): OgImageCache {
  const req = (key: string) => new Request(`https://og.cache/${key}`);
  return {
    async get(key) {
      const res = await caches.default.match(req(key));
      return res ? new Uint8Array(await res.arrayBuffer()) : null;
    },
    async put(key, bytes, contentType) {
      await caches.default.put(
        req(key),
        // bytes is Uint8Array<ArrayBufferLike>; lib.dom's BodyInit (TS 5.7+) wants
        // an ArrayBuffer-backed view — fine at the Workers runtime.
        new Response(bytes as BodyInit, {
          headers: {
            "content-type": contentType ?? "image/png",
            "cache-control": "public, max-age=31536000, immutable",
          },
        }),
      );
    },
  };
}
