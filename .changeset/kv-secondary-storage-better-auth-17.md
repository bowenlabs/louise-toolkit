---
"louise-toolkit": patch
---

auth: implement Better Auth 1.7's `getAndDelete` and `increment` on the KV secondary storage

Better Auth 1.7 added two required methods to `SecondaryStorage`, both specified
as atomic. Cloudflare KV has no atomic primitives, so `kvSecondaryStorage` now
implements each as closely as KV allows and documents what that costs — the same
constraint `security/rate-limit` already spells out for its own KV counters.

`increment` is a fixed-window counter bucketed by `floor(now / ttl)`, matching
the approach in `security/rate-limit`, rather than one long-lived key. The clock
bucket is what makes the window actually reset: KV cannot write a value without
also writing a TTL, so a single key would have its expiry pushed forward on every
increment and a busy client would never be unblocked. The read→write gap can
undercount under a burst — a few extra requests get through, none are wrongly
blocked — and a client can reach up to ~2x the budget across a bucket boundary.
Both fail safe. KV's 60s TTL floor does not widen the window: the bucket key
still rotates on Better Auth's interval, so only the spent bucket lingers.

`getAndDelete` is a read followed by a delete, and skips the write on a miss.

One thing this does **not** fix, called out because it is easy to miss: Better
Auth requires `getAndDelete` to be atomic so a single-use verification value (a
magic link, a password reset) cannot be consumed twice. Over KV it cannot be, and
KV's cross-colo convergence widens that replay window past a simple race. This is
not a regression — 1.6 consumed the same values through separate `get` and
`delete` calls on this same storage — but sites that set `sessionCacheKv` and
rely on magic links should set `verification: { storeInDatabase: true }` so those
values are consumed from D1, which is strongly consistent and deletes atomically,
leaving KV as the session read cache it is meant to be.
