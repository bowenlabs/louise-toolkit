---
"@louise-toolkit/astro": patch
---

**Rate rules for an Astro Action cover its form action too.** Astro runs an action by RPC, with a POST to `/_actions/<name>`, and as a form action, with a POST to any on-demand route that carries `?_action=<name>`. `createLouiseMiddleware` matched rate rules against the request's path alone, so a rule such as `(p) => p === "/_actions/subscribe"` didn't see `POST /?_action=subscribe` or `POST /shop?_action=subscribe`, and the action ran with no limit.

The middleware now also matches a POST that carries a nonempty `_action` as the RPC path `/_actions/<name>`, so every rule you wrote for an action's RPC path covers both ways to call it, in one budget. The name is decoded as Astro decodes it before it looks the action up: each dot-separated key with `decodeURIComponent`, which also applies on the RPC route, so a reserved character such as `%24` can't skip a rule there either. A GET with `_action` doesn't count, because Astro runs actions only for a POST. The RPC route keeps its own path, since Astro ignores `_action` there. Rules and `matchRateRule` don't change.

Two things can change on upgrade:

- **A form action can now get a 429.** It used to skip its action's rule, and now spends that rule's budget. Check that the budget fits the traffic from both routes.
- **A form action on a route with its own rule spends two budgets,** its action's and its route's, because Astro runs the action and then the route. A request that matches the same rule both ways spends it once.

With a `base` in `astro.config`, the form action's path carries no base, because middleware can't read it. Write the action's rule to match both spellings, such as `(p) => p === "/_actions/subscribe" || p === "/docs/_actions/subscribe"`.

**To upgrade:** update `@louise-toolkit/astro` within your current range. This release pins the same `louise-toolkit` as the one before it, so the lockfile keeps one toolkit version.
