---
"louisecms": patch
---

Pre-publish security hardening (audit follow-ups).

- **`getSessionSecret`** now treats an empty stored secret as a failure — a
  misprovisioned Secrets Store returning `""` would silently weaken session
  signing. Dev still falls back to the dev secret; any deployed host fails closed.
- **`verifyStripeSignature`** accepts a header carrying multiple `v1=`
  signatures (Stripe dual-signs during an endpoint-secret rotation) and passes if
  any match — the previous last-wins parse could reject a validly-signed event.
- **`generateAuthSchemaSql`** validates `tablePrefix` against the same
  identifier shape the runtime SQL guards enforce (`/^[A-Za-z_][A-Za-z0-9_]*$/`),
  so a stray character can't produce broken/injected DDL.
- **Search route** clamps `?limit=` to a sane ceiling (100) so a client can't
  request an unbounded result set.
- **Publish safety:** a `prepublishOnly` build hook ensures `dist/` is rebuilt
  before the package is published, so a stale build can't ship.
- **Smaller tarball:** the published package no longer ships `.js.map`
  sourcemaps (they roughly doubled its size and only re-shipped the already-public
  source) — the tarball drops from ~386 kB to ~164 kB.
