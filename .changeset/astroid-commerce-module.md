---
"astroidjs": minor
"create-astroid": minor
---

Add the commerce module (#250): provider **roles**, a catalog mirror with a pulled/owned split, one shared loader, and a server-authoritative checkout.

**Roles are forced by capability, not chosen.** The obvious model — one commerce provider per site — is wrong, and the toolkit's own clients prove it: `commerce/stripe` has no catalog API at all (invoices, customers, payment intents), while `commerce/fourthwall` has a catalog and cart but no invoicing. Square does both. So a single provider abstraction would have a permanent hole wherever Stripe sits. `commerce` now takes `storefront` and `invoicing` independently — the topology themidwestartist.com already runs — and `defineAstroid` rejects a provider assigned to a role its client can't serve, naming the ones that can. The `provider` shorthand assigns to the provider's natural role, so `{ provider: "stripe" }` is invoicing rather than a storefront with nothing behind it.

**One mirror primitive, two modes.** Every site kept a set of fields *pulled* from the provider and a disjoint set the owner edits and must survive every sync. What they didn't agree on was how much to store — and that turns out to be a setting, not a second design. `mirror` keeps the catalog fields in D1 (tma's `products`: fast local reads, briefly stale); `overlay` keeps only the owner's columns keyed by the provider's id (coracle's `product_display_meta`: never stale, one provider round-trip per read). `overlay` is just `mirror` with an empty pulled set, so one generator emits both.

The invariant the split exists for is enforced in the sync: **an owned column never appears in an UPDATE.** Not usually — never. A sync that writes one silently reverts the owner's work, and they find out days later. Owned columns appear only in the INSERT, as defaults for a row that didn't exist. `slug` is owned for the same reason: it's the public URL, so a provider rename must not break links and SEO. Writes are keyed on the provider's id (unique), so the cron and a webhook racing on one product collide into one row, and slug collisions are allocated around rather than failing the sync over two products sharing a name.

**One loader, both providers.** tma's loader says it outright — coracle runs the same helper over Square, "only the `content/repo` reads differ — issue: repo drift." Two sites, one intent, two translations that drifted. `astroidCatalogLoaderConfig` reads the mirror, and the adapters (`squareToCatalogItem`, `fourthwallToCatalogItem`) normalize before the row is written — so the loader never learns which provider it is.

**Server-authoritative checkout.** `verifyCheckout` treats the client's price as a staleness check and never as an input to the charge: re-price server-side, refuse on mismatch. It also rejects non-integer, negative, and absurd quantities — a quantity of `-1` turns a charge into a refund on some providers. `checkoutIdempotencyKey` derives a key from the verified lines and total plus a required `identity` (order-insensitive, scope-separated), so a double-clicked Pay button charges once while two customers with identical carts stay two charges.

The generated worker, CSP, env types, and webhook receivers all became plural: a two-provider site gets a receiver and signing secret per provider, and a CSP allowing both SDKs.

Fixed while verifying: the generated `schema.ts` used `real()` for `price`/`sortOrder` but never imported it, so **every commerce scaffold failed `astro check`**. The drizzle import is now computed from what the emitted source actually uses, with a test asserting the two stay in sync.

Verified in a clean room (packed tarballs, installed outside the workspace): a `--commerce square` scaffold type-checks with 0 errors and builds.
