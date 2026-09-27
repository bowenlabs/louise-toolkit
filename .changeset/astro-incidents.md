---
"louise-toolkit": minor
"@louise-toolkit/astro": minor
---

An Astro site's page errors are incidents too (ADR 0022):

- **`reportIncident(input)`** (`louise-toolkit/worker`) reports a failure caught in code that has no `env` or `ctx`, such as framework middleware. It reaches `composeWorker`'s `onIncident` sinks when the handler finishes, and does nothing without `onIncident`. A cause reported this way isn't counted again if it's re-thrown to `composeWorker`.
- **`createLouiseMiddleware`** (`@louise-toolkit/astro`) reports an error a page, an endpoint, or the middleware throws, then re-throws it, so Astro still renders its error page. Before, Astro caught those errors outside every middleware and `composeWorker` never saw them. Set `reportErrors: false` to turn it off. An error a streamed page throws after its first bytes are sent is still out of reach of any middleware.

Nothing changes for a site without `onIncident` on `composeWorker`.
