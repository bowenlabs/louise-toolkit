---
"louise-toolkit": minor
"@louise-toolkit/astro": minor
---

You can now give an outside probe a URL that says whether your site works. Until now nothing could check a site from outside Cloudflare: the Health panel's route needs an editor session, and no route checked D1, KV, or a provider.

- **`statusRoute({ checks })`** (`louise-toolkit/editor`) answers `GET` and `HEAD` at `/api/louise/status` with 200 when every check passes and 503 when any fails, throws, or times out. It's public under ADR 0012, so the API gate lets an anonymous probe through. The body is `{ ok, checks: { [name]: { ok, ageMs? } } }`: booleans and ages, never an error's text. A check that throws is logged on the server instead. Every response has `Cache-Control: no-store`.
- **You supply the checks,** because only your site knows what "working" means. A check is `(env, signal) => boolean | { ok, ageMs? }`. Two builders cover the generic cases: `d1Check((env) => env.DB)` passes when D1 answers `SELECT 1`, and `ageCheck(read, maxAgeMs)` passes when a timestamp, such as your last health scan's `checkedAt`, is no older than the limit, and reports its age. It uses the same rule as `isStale` (`louise-toolkit/health`), so the status route and the Health panel agree about what counts as out of date.
- **Each check has a timeout,** `timeoutMs` (default 2 seconds), so a hung dependency makes a 503 instead of a hung probe. `reuseMs` reuses a finished result within an isolate, so a burst of anonymous requests can't multiply your database queries.
- `runStatusChecks(env, checks)` is the same run without the route, and `LOUISE_STATUS_PATH` (`louise-toolkit/worker`) is its default path.

**What changed without it:** `isLouisePublicPath` now includes `/api/louise/status`, so `createLouiseMiddleware({ apiGate })` lets anonymous requests to that path through to whatever answers there. If your site has its own editor-only route at `/api/louise/status`, move it or check the editor session in the route itself before you upgrade.

**What to do:** nothing is required. To use it, mount `statusRoute` with cheap checks, since anyone can make them run, and point your uptime probe at `/api/louise/status`.
