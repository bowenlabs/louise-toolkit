---
"louise-toolkit": patch
---

`safeNextPath` no longer returns a path that a browser reads as another host. It resolved `raw` with the URL parser and accepted any result that stayed on its placeholder origin, but the parser also resolves `.` and `..` segments and reads `\` as `/`. So `/.//evil.example`, `/a/..\\evil.example`, and `/%2e%2e//evil.example` stayed on the origin and came back as `//evil.example`, a protocol-relative URL. A site that passed `?next=` or a route parameter through `safeNextPath` into a redirect sent the browser off-site. A normalized pathname that starts with `//` now gets `fallback`.

**What to do:** raise your `louise-toolkit` range to include this release, and treat it as urgent if you redirect to a `?next=` parameter or a route parameter: until then, that redirect is an open redirect. A range below `^0.42.0`, such as `^0.40.0`, doesn't receive the fix, because a caret range on a 0.x version allows only patches of its own minor. No call site changes. A path with a double slash after its first segment, such as `/a//b`, still comes back unchanged.
