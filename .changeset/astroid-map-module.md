---
"astroidjs": minor
"create-astroid": minor
---

Add the map module (#258): a self-hosted PMTiles basemap served from R2, a brand-recoloured MapLibre style, and a scaffolded `<MapEmbed>` — no API key, no external tile host.

**Range serving is the reusable part**, and it's more than a passthrough. A PMTiles archive is one immutable blob, often hundreds of megabytes, that the client reads a few kilobytes at a time. `servePmtiles` implements the range contract properly: bounded windows, open-ended ranges, **suffix ranges**, 416 with the real length for unsatisfiable ones, and HEAD.

That suffix case is not hypothetical. The implementation this generalizes matched only `bytes=<start>-<end?>`, so `bytes=-20000` — "the last 20 KB", how a client reads a footer without knowing the length — fell through to serving the **entire archive**. A correct-looking response and a catastrophic one. It's handled here, with tests.

It also trusts what R2 says it returned over what was asked for, because R2 clamps, and a `Content-Range` that disagrees with the body corrupts the client's view of the archive.

**`servePmtiles` takes a reader function, not a bucket.** `R2Bucket.get` is overloaded and its first overload *requires* an options argument, so no structural interface with an optional second parameter can accept a real `R2Bucket` — verified the hard way, by watching `astro check` reject it in a scaffolded project. Taking `read: (range?) => Promise<…>` lets the call site use R2's own types, and incidentally makes the handler work over any storage.

**`astroidMapStyle` is dependency-free.** A MapLibre style is JSON, so it's a plain object rather than an import of `maplibre-gl` (a megabyte) or `protomaps-themes-base` for types — astroidjs stays installable by projects that never draw a map. Road casings are ordered beneath road fills (the thing that makes a road read as a stroked ribbon), labels are opt-in because they need self-hosted SDF glyphs, and OpenStreetMap attribution defaults to present because the licence requires it.

**`<MapEmbed>` is generated, not shipped.** A component living in astroid's own `src/components/` would make `maplibre-gl` + `pmtiles` hard requirements of the package — including for the CI probe that type-checks the component library — for a feature most sites never enable. Generating it into the projects that turn the module on keeps the dependency where the decision was made, and puts the pin, gestures, and placeholder in the project's hands, which is right: those are brand.

CSP contributes exactly `worker-src blob:`, gated on the module. MapLibre builds its tile-decoding workers from blob URLs, and without it the canvas renders empty. Nothing else is needed — which is the whole argument for the self-hosted archive: same-origin means `connect-src` stays `'self'` with no tile host to allow.

`create-astroid --map` scaffolds the route and component and injects the two dependencies. The config it writes now emits `modules`, which matters: `astroid generate` rebuilds the CSP from that file, so a config that dropped it would regenerate a policy without `worker-src blob:` and the map would fail with no obvious cause.
