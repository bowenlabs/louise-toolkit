---
"louise-toolkit": minor
---

New subpath `louise-toolkit/client/sign-in`, with `SignInLinkForm`: the sign-in-by-link form that sites wrote by hand, for an editor sign-in and for customers on `customers.signIn: "magic-link"`. It takes the instance's `basePath`, the callback URLs, a `turnstile` site key, and every label and message as props, and it's unstyled, with a `louise-signin-<part>` class on each part and a `classes` prop for a site's own.

It handles what the hand-written copies kept getting wrong:

- **It reads the response.** A 429, a refused captcha, or a dropped connection shows an error and keeps the form, instead of a "check your inbox" for a link that was never sent.
- **It resets the Turnstile widget after every request**, so a retry doesn't post a spent token, and it says so when the widget can't load or hasn't issued a token yet.
- **It's accessible:** the status region is in the page before the confirmation arrives, focus moves to the confirmation, an error is tied to the field, and the button is `aria-busy` while the request runs.

`requestSignInLink(options)` is the same request without the markup, for a sign-in screen that draws its own. It resolves with `{ ok: true }` or `{ ok: false, reason }` and never throws.

**Adopting it:** replace a hand-written form with `<SignInLinkForm client:only="solid-js" … />`, passing `turnstile` from `activeCaptcha(env)` so the widget and the server check stay one decision. The package ships the client compiled for the browser, so it needs `client:only` rather than `client:load`. Nothing changes for a site that doesn't import it.
