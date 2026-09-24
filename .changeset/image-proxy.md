---
"louise-toolkit": patch
---

media: `defineImageProxy` — resize images on a third-party host at the edge (#462)

`cfImage` rewrites only same-zone URLs, and `transformImage` needs the bytes. So a
third-party image whose URL you can't change had no answer. The common case is a
signed URL, where the size is part of the signature. Fourthwall's product images are
all 1920 px, and a grid of small cards was downloading megabytes of full-size photos.
One site built its own proxy route for this.

```ts
const productImages = defineImageProxy({
  path: "/api/img/products",
  allowHosts: [FW_IMAGE_HOST],
  widths: [320, 640, 960, 1280],
});
export const GET = ({ request }) => productImages.handle(request);
// markup: productImages.url(src, 640), productImages.srcset(src)
```

It fetches the original with `cf.image` and resizes it at the edge. One config drives
the route and the URLs, so they can't disagree about which widths exist.

- It serves **only the listed hosts** (https, default port) and **only the listed
  widths**. Anything else gets a 400 before any fetch, so it can't be used as an open
  proxy, and the edge caches a bounded set of variants.
- It **redirects to the original** if resizing fails, which includes local dev and a
  zone without Image Resizing. `onFailure: "error"` answers 502 instead.
- `url` / `srcset` leave other hosts' images untouched.
- The format is negotiated from `Accept`, and the response varies on it.
- `quality`, `fit`, `cacheControl` and `edgeCacheTtl` are options. The defaults don't
  guess a site's caching or quality.
