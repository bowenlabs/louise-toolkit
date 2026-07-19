---
"astroidjs": minor
"create-astroid": minor
"louise-toolkit": minor
---

Generate the composed worker entrypoint and the verify→enqueue→consume webhook pipeline (#251).

All three consuming sites hand-write the same `worker.ts`: Astro's SSR `fetch` composed with a queue consumer and a cron re-sync. ghostfire's even documents where the `queue`/`scheduled` handlers "would" go. Configure `commerce` (or set `queues.enabled`) and Astroid emits it — plus, in the scaffold, a provider webhook receiver and a consumer seam. `npm create astroid --commerce square|stripe|fourthwall` wires the whole thing.

**Ordering, in `handleWebhook`.** The HMAC is verified over the **raw body before anything parses it**. Not style: parsing first lets an unauthenticated caller reach the JSON parser and everything downstream of it, and re-serializing a parsed body to check the signature is how signature checks quietly stop checking anything.

**Status codes as backpressure.** Every provider retries on non-2xx, which makes the response the only signal available — return the wrong one and you either lose the event permanently or pin the provider in a retry loop. Unprovisioned secret → **503** (dormant is temporary; events delivered before you set the secret still land). Bad signature → **401**, terminal, because it won't verify on retry and retrying turns a misconfiguration into a self-inflicted flood. Unparseable body → **400**, same reasoning. Enqueue failure → **503**, since the signature checked out and the event is worth keeping. Success → **202**, not 200: accepted, not done.

**Consumer dispatch.** `astroidQueueHandler` covers what every site wrote: a periodic refresh re-syncs, a webhook re-syncs only if it touched the catalog, everything else acks as a no-op. That last case is the load-bearing one — order and payment events arrive in volume and have nothing local to update, so treating them as actionable turns a busy sales day into a refresh storm. Catalog matching is by event-type prefix per provider, since the cost of one redundant refresh is far below that of a storefront serving a price that no longer exists.

The cron **enqueues** rather than running inline, so the safety net takes the same retry + DLQ path as everything else. `wrangler.jsonc` gains the producer, consumer, DLQ, and cron trigger — in the scaffold-once path, so provisioned ids are never clobbered — and `astroid deploy` now creates the queues.

`composeWorker` in `louise-toolkit` gains a queue-message type parameter (`composeWorker<Env, QMessage>`), so a consumer receives a typed `MessageBatch` instead of casting every body. Purely additive — the parameter defaults to `unknown`.

### Fixes found by type-checking and building a real scaffold

- `QueueProducer.send` was typed `Promise<void>`; Cloudflare's `Queue.send` resolves to a `QueueSendResponse`, so the real binding **wasn't assignable**.
- `astroidSecurity` returned `directives: string[]`, but Astro's `security.csp.directives` is a union of template-literal types — so every scaffold running `astro check` saw an error. Astroid now mirrors that union, which additionally makes a typo like `"img-srcs 'self'"` a compile error inside astroid.
- The generated `onSubmit` returned delivery results into a `void | Promise<void>` slot.
- The scaffold typed `EMAIL` as workers-types' `SendEmail` — the **legacy** `cloudflare:email` binding, which routes through Email Routing and only delivers to *verified* addresses — rather than the toolkit's `EmailSender` object-form API.
- The scaffold never declared `prosekit`, `@prosekit/pm`, or `@tanstack/solid-query`, all of which `louise-toolkit/client` imports. In-workspace they resolve from the hoisted tree, so this only surfaces where it matters: a real `npm create astroid` install, where `astro build` failed on `defineBasicExtension is not exported`.

Verified in a true clean room (packed tarballs, installed outside the workspace): `astro check` reports 0 errors, `astro build` completes, and against a live `wrangler dev` the receiver answers 503 while dormant, 202 for a correctly-signed event, and 401 for a tampered or absent signature.
