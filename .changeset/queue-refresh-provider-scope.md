---
"astroidjs": minor
---

**Fixed: one provider's webhook could storm another provider's API.**

`astroidQueueHandler` ran the site's `refreshCatalog` seam for any webhook whose
event type matched the sending provider's catalog prefixes. But the seam is
provider-blind by construction — it re-syncs whichever catalog *that site* uses,
which is not necessarily the provider that sent the event.

Two commerce providers is now a supported configuration, and that is where it
bites. A site running Fourthwall as its storefront and Square as its POS means
`refreshCatalog` re-pulls Fourthwall — while Square emits `inventory.count.updated`
on **every single sale**. Each in-person transaction therefore triggered a full
Fourthwall re-sync against an unrelated provider's rate limit. The periodic refresh
is unaffected, so the site looks healthy right up until the day it's busy.

Two additive changes, no break:

- **`refreshCatalog` now receives the message that triggered it** —
  `(message: AstroidQueueMessage) => void | Promise<void>`. A zero-argument seam
  stays valid, so existing consumers compile and behave identically.
- **`catalogProvider`** scopes the dispatch. Set it and only that provider's
  webhooks trigger a refresh; leave it unset and any catalog-affecting webhook
  does, which is what every single-provider project already gets.

The periodic `catalog_refresh` is deliberately never scoped — it is the safety net,
and a safety net with an exception is not one.

The scaffolded `src/queue.ts` now emits `catalogProvider` for projects configured
with more than one commerce provider, set to the storefront's, so the two-provider
case is wired correctly on the way in rather than discovered on a busy Saturday.
