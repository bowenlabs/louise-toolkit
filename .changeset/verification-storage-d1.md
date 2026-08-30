---
"louise-toolkit": minor
---

auth: single-use verification values stay on D1 by default

Sites that set `sessionCacheKv` now consume magic links and password resets from
D1 rather than from KV. New `verificationStorage` option, defaulting to
`"database"`; pass `"secondary"` to restore the previous behaviour.

**Why this is a security default and not a preference.** Better Auth 1.7 made
`SecondaryStorage.getAndDelete` required, and specified it as atomic, precisely
so a single-use verification value cannot be consumed twice — its own comment
says the point is that these are "not read and deleted as separate operations."
Cloudflare KV has no atomic primitive, so `kvSecondaryStorage` cannot honour
that; worse, KV is eventually consistent across colos, so a value deleted in one
location can still read as live in another for some window. Two requests racing
the same magic link could therefore both succeed.

This was not introduced by the 1.7 upgrade — 1.6 consumed the same values
through separate `get` and `delete` calls on the same storage, so the race
predates it. 1.7 is simply what named it. D1 is strongly consistent and deletes
atomically, so consuming from there closes the window, and KV goes back to being
what it is actually good at here: a global session read cache. That division is
what `sessionCacheKv` was always described as doing — "D1 stays the source of
truth, KV is the global read cache" — this just stops single-use tokens being
the exception.

**Upgrading.** Marked minor rather than patch because it is a behaviour change,
and one with a deploy-time edge: verification values already pending in KV when
the new code ships are not read from D1, so a magic link issued in the seconds
before a deploy and clicked after it will ask for a fresh one. Nothing is
corrupted and no session is lost — the user requests another link. Sites that
would rather avoid even that can deploy with `verificationStorage: "secondary"`,
let the in-flight values expire, and drop the option.

Sites without `sessionCacheKv` are unaffected: with no secondary storage
configured, these values were always consumed from D1.
