---
"louise-toolkit": patch
---

`imageDimensions` (`louise-toolkit/media`) now reads intrinsic size from **AVIF/HEIF** (the `ispe` box, walking meta → iprp → ipco and picking the largest when a thumbnail sits alongside the primary image) and **TIFF** (the first IFD's `ImageWidth`/`ImageLength`, both byte orders, SHORT or LONG) — the two formats the header parser previously returned `null` for. Pure-TS, **no new dependency**, so the binding-free upload path records dimensions for these formats too; the `.info()` Images-binding path stays the authoritative decoder. Closes the AVIF/TIFF gap noted in #84 and supersedes the Rust/WASM sniff idea in #101.
