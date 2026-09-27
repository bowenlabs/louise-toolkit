---
"@louise-toolkit/astro": minor
---

`createLouiseMiddleware` takes an optional `redirectFor(path, context)` (#574). When a GET or HEAD answers 404, the middleware asks it where the path moved and answers with that redirect instead, keeping the visitor's query string. A live page always wins, since it's only asked after a 404, and a lookup that throws keeps the 404. Pair it with `resolvePageRedirect` and the `pageRedirects` table from `louise-toolkit/db`.
