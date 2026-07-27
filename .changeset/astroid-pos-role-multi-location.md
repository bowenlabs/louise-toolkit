---
"astroidjs": minor
---

A `pos` commerce role, and `square.locations: "multi"` for multi-merchant projects.

**`pos` — in-person selling as its own role.** Physical stock held at real places
and sold at a counter, rather than through the site's own cart. It is separate
from `storefront` because a site commonly runs both, and the two need different
things: only `pos` needs locations, per-location pricing, and inventory.

themidwestartist.com is the case in point — print-on-demand merch through
Fourthwall (`storefront`), originals and self-stocked prints through Square
(`pos`) across several shops and galleries. Neither provider can do the other's
job, which is the same reason `invoicing` already exists.

Only Square can serve `pos`, and that is a fact about the clients rather than a
preference: the role needs `listLocations`, `location_overrides` and
`batchChangeInventory`, none of which the Stripe or Fourthwall clients expose.
Fourthwall's Platform API is create-only for products, so it cannot model stock
held at a place at all. `assertCommerceRoles` rejects the assignment at config
load with a message naming the alternatives, rather than at runtime as a missing
function.

**`commerce.square.locations`.** `"single"` (the default) is the ordinary case:
one location, its id supplied once as `SQUARE_LOCATION_ID`. `"multi"` is the
multi-merchant model, where each merchant is a Square Location and the location
id comes from the *request* — which merchant's storefront is this? — rather than
from the environment.

Setting `"multi"` **drops `SQUARE_LOCATION_ID` from the provider's credential
gate entirely.** Not because it is merely unnecessary, but because it is
hazardous: any code path that defaulted to an ambient location id would ring one
merchant's sale against another merchant's books, and would look perfectly
successful doing it. Leaving the name present-but-ignored is the kind of thing
someone later "fixes" by using it, so it is removed rather than made optional.
The access token and webhook secret are unchanged, and other providers are
untouched.

A `commerce.square` block with no role assigned to Square is now a config error —
otherwise a typo'd config looks like it opted into multi-location while nothing
reads the setting.

**New exports:** `hasPos(commerce)`, `hasMultiLocation(commerce)`, and
`commerceProviderCredentials(provider, commerce)` — the config-aware replacement
for reading `COMMERCE_PROVIDER_SECRETS[provider].credentials` directly.
`CommerceRole` gains `"pos"`, and `ResolvedCommerceRoles` gains an optional
`pos`. All additive; existing configs and role resolution are unchanged.
