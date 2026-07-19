---
"astroidjs": minor
"create-astroid": minor
---

Add the media primitives (#257): `<MediaSlot>` and `<JustifiedGallery>`, plus a `work.astro` gallery page for the `portfolio` archetype.

**`<MediaSlot>`** is the responsive-image component the consuming sites each rebuilt. The srcset math wasn't the missing piece — `louise-toolkit/media` already ships `cfImageSrcset` and `circleImage` — the *component* around it was: a `sizes` hint (without one the browser assumes `100vw` and over-fetches on every multi-column layout, which is how a "responsive" image ends up slower than a fixed one), a reserved `aspect-ratio` box so images can't shift the page as they load, and `focal`/`zoom` framing applied at render rather than as a second CDN derivative of the same source. `alt` is required, with `""` documented as the correct value for a decorative image — the failure mode being a missing attribute, which makes assistive tech read the filename aloud.

**`<JustifiedGallery>`** is Flickr-style row balancing: images keep their aspect ratios, rows fill the container exactly, row heights land near a target. CSS can't express it — `grid` wants uniform tracks and `columns` produces a masonry *column* flow where reading order runs down the page instead of across it, which is wrong for a portfolio and wrong for keyboard order.

It works in two layers so it never depends on JavaScript to be usable. SSR emits a flex-wrap floor using the media library's recorded dimensions, already justified and gap-correct with no layout shift; on the client, once images decode and their true dimensions are known, `justifyRows` recomputes exact rows. That second pass is what fixes the common case of dimensions being absent, stale, or transposed.

The layout arithmetic lives in `astroidjs/components/justify` as a pure function, so it's the same code on the server and the client and can be tested without a browser. It carries two rules worth naming: the last box in a row absorbs the rounding remainder (rounding each box independently leaves a 1–2px seam that reads as a ragged right edge), and a sparse trailing row is left un-stretched past a slack multiple — otherwise a gallery ending on one landscape photo blows it up to full width and four times every other row's height.

`create-astroid --archetype portfolio` now scaffolds `src/pages/work.astro`, wiring the gallery to the media registry: images only, alt/caption carried from the asset row (so an editor fixes alt text once and every gallery picks it up), and intrinsic dimensions passed through so first paint isn't a guess.

CSP-wise both components stay inside the strict policy from #253 — the layout script is a normal bundled `<script>` that Astro hashes into `script-src` (verified: it builds to a hashed `_astro/*.js`, not inline), and per-tile sizing uses the data-driven inline `style` attribute the middleware's `style-src` rewrite already covers.

CI now scaffolds and `astro check`s a **portfolio** project alongside the storefront one. That isn't redundant: the storefront scaffold never emits `work.astro`, so it never compiles these components — and `.astro` files are invisible to both `tsgo` and vitest, so without it they would ship with nothing having type-checked them at all.
