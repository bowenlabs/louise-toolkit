---
"louise-toolkit": patch
---

forms/auth: the browser half of Turnstile (`renderTurnstile`), and one decision for whether captcha is on (`activeCaptcha`) (#459)

The toolkit verified Turnstile tokens but left rendering the widget to each site, and
all three rendered it by hand. Each hit some of the same three bugs:

1. **The load race.** Turnstile's automatic mode scans the page once. A widget from a
   component that hydrates later is never rendered, on a form the server demands a
   token for.
2. **The spent token.** A failed submit, for any reason, has used up the single-use
   token. A retry without a reset can never succeed.
3. **Appearance per site key.** The dashboard's invisible mode applies to every form on
   the key, sign-in included.

- **`renderTurnstile(el, { siteKey, appearance?, size?, theme?, action?, … })`** in
  `louise-toolkit/forms` loads the script once and renders explicitly, whichever lands
  first. It rejects after `timeoutMs` if the script never arrives. It returns
  `{ token, reset, remove }`, and you call `reset()` after any failed submit. Only the
  options you pass are sent. Also `loadTurnstile`, `TURNSTILE_SCRIPT_SRC`, and
  `turnstileCsp()` (the origins as data).
- **`activeCaptcha(env)`** in `louise-toolkit/auth` returns `{ siteKey, secret }` or
  `null`, one decision for the widget and the check. Deciding them apart is how a site
  key that stopped resolving (after moving Cloudflare accounts) left the server demanding
  a token no visitor could produce, and took sign-in down.
