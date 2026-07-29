---
"astroidjs": patch
---

The scaffolded `MapEmbed.astro` now logs when its map fails to load. Its
IntersectionObserver called an `async init()` that nothing awaited and nothing
caught, so a failed `maplibre-gl` / `pmtiles` chunk fetch — a page load racing a
deploy is enough — was a silent unhandled rejection: the container stayed an
empty tinted box with nothing in the console to explain it. The call site now
catches and logs `[astroid:map] map failed to load`, matching the convention the
commerce card scaffold already follows.
