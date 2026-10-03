---
"louise-toolkit": patch
---

`safeNextPath` no longer returns a path that a browser reads as another host. It resolved `raw` with the URL parser and accepted any result that stayed on its placeholder origin, but the parser also resolves `.` and `..` segments and reads `\` as `/`. So `/.//evil.example`, `/a/..\\evil.example`, and `/%2e%2e//evil.example` stayed on the origin and came back as `//evil.example`, a protocol-relative URL. A site that passed `?next=` or a route parameter through `safeNextPath` into a redirect sent the browser off-site. A normalized pathname that starts with `//` now gets `fallback`.

**What to do:** nothing. Every call site gets the fix on upgrade. A path with a double slash after its first segment, such as `/a//b`, still comes back unchanged.
