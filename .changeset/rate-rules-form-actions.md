---
"@louise-toolkit/astro": patch
---

**Rate rules for an Astro Action cover its form action too.** Astro runs an action by remote procedure call (RPC), with a POST to `/_actions/<name>`, and as a form action, with a POST to any on-demand route that carries `?_action=<name>`. `createLouiseMiddleware` matched rate rules against the request's path alone, so a rule such as `(p) => p === "/_actions/subscribe"` didn't see `POST /?_action=subscribe` or `POST /shop?_action=subscribe`, and the action ran with no limit.

The middleware now also matches a POST that carries a nonempty `_action` as the RPC path `/_actions/<name>`, so every rule you wrote for an action's RPC path covers both ways to call it, in one budget. The middleware decodes the name the way Astro does before Astro looks the action up: it decodes each dot-separated key with `decodeURIComponent`. It does the same on the RPC route, so a reserved character such as `%24` can't skip a rule there either. A GET with `_action` doesn't count, because Astro runs actions only for a POST. The RPC route keeps its own path, since Astro ignores `_action` there. Rules and `matchRateRule` don't change. ADR 0012's amendment of 2026-10-04 records the decision.

Three things can change on upgrade:

- **A form action can now get a 429.** It used to skip its action's rule, and now spends that rule's budget. Check that the budget fits the traffic from both routes.
- **A form action on a route with its own rule spends two budgets,** its action's and its route's, because Astro runs the action and then the route. Rules that share a name share a budget, so a request that matches one name both ways spends it once.
- **A 429 from the route's rule still counts against the action's rule.** The middleware checks the action's rule first, and the limiter counts a check when it passes, so a request the route's rule refuses has already spent one unit of the action's budget.

With a `base` in `astro.config`, the form action's path carries no base, because middleware can't read it. Write the action's rule to match both spellings, such as `(p) => p === "/_actions/subscribe" || p === "/docs/_actions/subscribe"`.

**To upgrade:** on a `^0.9.0` range, update `@louise-toolkit/astro` within that range. This release pins the same `louise-toolkit` as the one before it, so the lockfile keeps one toolkit version. A range below `^0.9.0`, or an exact pin, doesn't receive this fix. Move to this release, together with `louise-toolkit` 0.43 and the `astroidjs` release that accepts it, then check that the lockfile holds one `louise-toolkit` version.
