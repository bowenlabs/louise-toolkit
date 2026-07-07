---
"louisecms": minor
---

Add the `louisecms/media` module: verified R2 uploads (`putMedia` with magic-byte
sniffing that never trusts the client MIME), `listMedia`/`deleteMedia`, a
parameterized delete-safety reference scan (`findMediaReferences`), and pure
Cloudflare Image-Resizing URL transforms (`cfImage`/`circleImage`) plus a
per-usage `Crop` + `cropStyle` helper. Ships the `media` asset-registry table
(`mediaColumns` / `media`) in `louisecms/db` and a `LouiseMediaEnv` bindings
contract (`MEDIA` R2 bucket + `MEDIA_URL`).
