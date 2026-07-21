---
"louise-toolkit": minor
---

**`core/email` `sendEmail` degrades gracefully with no binding, instead of throwing.** The "no binding ⇒ loudly simulate, don't throw" safety lived only in astroid's mailer (`sendTransactional`), so a consumer that called the lower-level `sendEmail(env.EMAIL, …)` directly — a hand-rolled contact route — crashed when `env.EMAIL` was absent: a dead form in local dev, and a 500 on a production misconfig. The guard now lives in the primitive.

`sendEmail(binding, input, options?)` gains a third argument. When `binding` is absent it logs a simulated send and returns `{ simulated: true }` rather than throwing — but only where it's safe: `simulateWhenUnconfigured` defaults to dev-detection (`import.meta.env.DEV` / `NODE_ENV !== "production"`), so a missing binding under `wrangler dev`/`astro dev` keeps the magic-link loop working, while a missing binding in production still throws `LouiseEmailError` unless the caller opts in. The logged body is withheld outside dev (it can carry a single-use sign-in link, and `console.info` is `wrangler tail` + Logpush).

Additive and backwards-compatible: a real binding still returns `{ messageId }` and still throws on a genuine send failure. The return type widens from `{ messageId: string }` to `{ messageId?: string; simulated?: boolean }`. Astroid's richer `MailerStatus` layer is unchanged — this is the floor, not the ceiling.
