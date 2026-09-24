---
"louise-toolkit": minor
---

Provider errors are safe to show, and every provider call has a timeout and follows no redirects (ADR 0012, slice 4).

**What changed.** Square, Fourthwall (Storefront and Platform), Stripe and Turnstile now all call out through the new `upstreamFetch` in `louise-toolkit/security`, which adds three things:

- **A timeout.** The default is 10 seconds. `SquareConfig` and `FourthwallPlatformConfig` take `timeoutMs`.
- **`redirect: "manual"`.** A provider API doesn't redirect, so a redirect now comes back as a failed response instead of being followed.
- **A new error type, `UpstreamError`.** Its `message` is safe to show a user, for example `Square request failed (404 NOT_FOUND)`. What the provider actually wrote is on `detail`, which `JSON.stringify(err)` and `{ ...err }` leave out.

Before this, the provider's own text went into `Error.message`, and routes that returned `err.message` sent it to the browser. That text can include a customer's card details, an HTML error page (the `SyntaxError` from `res.json()` quotes it), or a Fourthwall response echoing the storefront token.

`SquareApiError` now extends `UpstreamError` and adds `category`. `PAYMENT_METHOD_ERROR` means a decline, which is the buyer's to fix. Stripe errors carry `decline_code` (or `code`) as `code`. `retrievePaymentIntent` now URL-encodes the id it's given.

**What you have to do:**

- **Messages changed.** If you log `err.message` for a provider failure, you now get the short, safe version. Log with `upstreamLogLine(err)` to keep the provider's detail: `console.error("checkout failed:", upstreamLogLine(err))`. If you parsed messages (for example matching `/ 404: /`), switch to `err instanceof UpstreamError && err.status === 404`. The toolkit's own two message matches are converted.
- **A timeout is a new way to fail.** A timed-out request may still have gone through. That's harmless for Square (every write takes an idempotency key), but a Fourthwall `createExternalOrder` has no idempotency key, so check before you retry one.
- **A slow bulk call** (a large Square catalog upsert, an image upload) may need `timeoutMs` raised.
