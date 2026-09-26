---
"louise-toolkit": minor
---

A fallback can now say it fired. `reportDegraded(name, cause, details?)` (`louise-toolkit/errors`) logs one line at error level in a fixed shape, `[louise] degraded <name>: <cause> <details as JSON>`, and never throws, whatever the `cause`. Degrading instead of crashing is the house rule, but a page that falls back to seed or stale content still answers 200, and until now nothing noticed until a person looked. `onDegraded(listener)` hears every report in the isolate, so you can forward them to an error tracker today. Louise's own incident capture is meant to hook in the same way, so your calls don't change when it does.

The kit's own fallbacks report themselves now. Each one logs a `[louise] degraded` line where it used to be silent:

- **Fail-open and fail-closed checks:** the KV, native, and Durable Object rate limiters (`security.rateLimit`), an unreadable secret binding (`security.readSecret`), and a Turnstile check that can't reach siteverify (`forms.turnstile`).
- **Best-effort side effects:** form webhook and email notifications (`forms.notify.webhook`, `forms.notify.email`), the pages route's `afterWrite` hook (`editor.pages.afterWrite`), Vectorize upserts, deletes, and queries (`ai.vectors.*`), Core Web Vitals writes (`analytics.vitals`), and `kvCached` and `kvBust` (`worker.kvCache.*`).
- **Fallbacks that serve something lesser:** a `withHealing` rule's `fallback` (`worker.healing`), the image proxy's redirect to the original (`media.imageProxy`), a realtime session whose `persist` keeps failing (`realtime.persist`), and Fourthwall's `getProduct` and Square's `retrievePaymentLink` when they return `null` for a reason other than a 404.
- **Corrupt stored state:** a health summary, a draft buffer, or a form submission that no longer parses (`health.summary`, `editor.draftBuffer`, `editor.submissions`).

**What to do:** nothing is required. Four existing log lines changed shape, so update any log search or alert that matches them: `runAi`'s `[louise-toolkit/ai] model run failed (<model>)` is now `[louise] degraded ai.run: … {"model":"<model>"}`, and the gate's `resolveEditor failed`, the overview's `overview slice failed`, and the search route's `search failed` lines are now `worker.resolveEditor`, `editor.overview` (with the slice name), and `editor.search`. Expect more error-level lines than before, since each one is a fallback that used to be silent. In development the image proxy logs one per image, because a zone without Image Resizing always takes the fallback. To report your own site's fallbacks, call `reportDegraded` in each `catch` that serves seed or stale content or swallows a best-effort call.
