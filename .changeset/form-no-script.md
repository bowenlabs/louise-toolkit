---
"louise-toolkit": minor
---

`formRoute` answers a no-script form post with a redirect instead of raw JSON (#589).

- **Post, redirect, get:** a form-encoded post from a browser that wants HTML, which is what a plain `<form method="post">` sends when its script is slow, blocked, or broken, now gets a `303` back to the page it came from, with `?form=<name>&status=sent|invalid|limited|refused`. For `invalid`, `&invalid=` lists the failing field keys, never the messages. Before, the visitor saw `{"ok":true}` or a JSON list of violations with no way back. A missing or cross-origin `Referer` redirects to the site root.
- **`respond(outcome, request)`** on `FormRouteConfig` answers with your own page instead; `FormOutcome` carries `form`, `status`, `invalid`, and `violations`.
- **A file in a multipart post is refused** with a violation on that field, instead of storing the file's name as its value.
- **JSON requests are unchanged:** a `fetch` with a JSON body gets exactly the responses it got before.

**Upgrading:** a page with a plain form can read `form`, `status`, and `invalid` from its query string and show the result. A site whose script posted `FormData` with an `Accept: text/html` header now gets a redirect; send `Accept: application/json`, or post JSON.
