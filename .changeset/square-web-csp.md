---
"louise-toolkit": patch
---

commerce/square-web: `squareWebPaymentsCsp()` — the CSP origins Square's Web Payments SDK needs, as data (#453)

Three sites hand-maintained different subsets of the same host list, and each gap
surfaced as a live bug: a blocked `card-wrapper.css` stops `card.attach()` from
mounting the form at all, and a blocked Cash Sans font host shipped to production
before anyone noticed. The list is a fact about Square's SDK, so it now ships beside
the SDK wrapper.

```ts
import { squareWebPaymentsCsp } from "louise-toolkit/commerce/square-web";

squareWebPaymentsCsp();                 // card form, sandbox + production
squareWebPaymentsCsp({ wallets: true }); // + Google Pay, for mountWallets
squareWebPaymentsCsp({ environments: ["production"] });
```

Returns `{ script, style, frame, connect, font }` — merge each into the matching
`*-src` directive. Both environments by default, because the environment is a runtime
secret while a CSP is usually built once. Apple Pay needs no origins. Every host
carries a comment saying what breaks without it.

If you hand-listed these, you can replace the list — and check `style-src`
specifically: middleware that owns `style-src` separately from the rest of the policy
is where the stylesheet host has been missed before.
