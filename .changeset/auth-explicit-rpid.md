---
"louise-toolkit": minor
---

**`getLouiseAuth` takes an explicit `rpID`, so one passkey can cover an apex and
its admin subdomain.**

The passkey relying-party ID was derived from the request origin. That is right
for a single-origin site and wrong the moment an admin app lives on its own
subdomain: `example.com` and `studio.example.com` become two relying parties, so
the same person enrols **two separate passkeys** and then picks the right one from
a list on every sign-in.

```ts
getLouiseAuth(env, baseURL, {
  rpName: "My Studio",
  rpID: "example.com",           // both origins, one credential
  cookiePrefix: "louise-studio", // …but its own session
});
```

Additive — omit it and behaviour is byte-for-byte what it was.

**The sessions stay separate, and that is the desirable half.** A shared
credential is not a shared login. Pair `rpID` with **host-only cookies** (no
`Domain` attribute, `crossSubDomainCookies` off — the default) and a distinct
`cookiePrefix` per instance. Widening the cookie to the parent domain would
broadcast the admin session to every sibling subdomain, including untrusted tenant
storefronts — the failure this option exists to avoid rather than cause.

`rpID` must be the origin's own domain or a parent of it; a browser rejects a
registration whose rpID is neither, so a typo fails at enrolment rather than
silently. It is a bare domain — no scheme, no port.
