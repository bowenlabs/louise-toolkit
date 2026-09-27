---
"louise-toolkit": minor
---

`<Form>` posts without its script, sends a Turnstile token, and no longer uploads to the editor-only media route (#591).

- **No-script fallback:** the `<form>` renders `method="post"` and the `formRoute` action. Before, a copy submitted before the script ran, or after it failed, sent every answer to the current page in a GET's query string.
- **Turnstile:** pass `turnstile: { siteKey, appearance?, action?, theme? }` and `<Form>` renders the widget above the submit button, sends its token as `cf-turnstile-response`, and resets it after any failed submit. A `403` now says the spam check failed rather than "Couldn't send your message." Take `siteKey` from `activeCaptcha`.
- **Uploads:** `mediaAction` has no default. The toolkit's media route needs an editor session, so a visitor's upload was always refused. A form with a `file` field and no `mediaAction` logs an error at mount and refuses the upload, with a message on the field. An uploaded file has a **Remove** button.

**Upgrading:** a form that declares `spam.turnstile` and is served with a `turnstileSecret` needs `turnstile={{ siteKey }}`, or every submit is refused, as it already was. A form with a `file` field needs `mediaAction` pointing at a public upload route of your own, wrapped in `publicRoute` with its own size, type, and rate limits. What `formRoute` answers to a no-script post is #589.
