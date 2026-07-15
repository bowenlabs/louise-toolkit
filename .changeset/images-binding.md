---
"louise-toolkit": minor
---

Adopt the Cloudflare **Images binding** in `louise-toolkit/media` for server-side transforms and `.info()`-based dimensions, and retire the `sharp` dependency from the sites. (#84)

- `LouiseMediaEnv` / `MediaRouteEnv` gain an **optional** `IMAGES` binding. When present, uploads read intrinsic dimensions via `IMAGES.info()` — which sizes AVIF and TIFF, the two formats the header parser (`imageDimensions`) can only sniff, not measure. Absent → the header parser is used, so nothing regresses.
- `imageInfo(images, bytes)` — read dimensions through the binding (returns `null` for SVG or on any Images error, so callers can fall back).
- `transformImage(images, input, opts)` — server-side re-encode/resize/crop that returns a `Response` of the encoded bytes. This cashes the long-standing "future Images-binding backend" seam in `transform.ts`. For public on-the-fly derivatives, prefer the zero-cost URL rewrite (`cfImage`) — reach for this when you need the transformed *bytes*.
- `putMedia` accepts an optional `images` binding and the editor `mediaRoute` passes `env.IMAGES` through automatically.

Site/docs: declare `"images": { "binding": "IMAGES" }`, drop the direct `sharp` dependency (the Cloudflare adapter externalizes sharp and uses its workerd image service; docs use `passthroughImageService`), and disallow sharp's native postinstall in the pnpm workspace (`sharp: false`) since it now only arrives as an inert optional dep of `astro`.
