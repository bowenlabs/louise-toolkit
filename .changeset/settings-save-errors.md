---
"louise-toolkit": minor
---

The settings drawer now says why a save failed, and keeps its buttons usable (#592).

- **Settings:** a refused save marks each field the server named, shows the message under it (linked with `aria-describedby`), opens its section, focuses the first one, and counts them in the footer: "1 field needs attention." A link list marks the row, so `navLinks[1].href` lands on row 2.
- **Pages:** a refused save shows the route's reason, such as "“admin” is a reserved path.", never the request line `PATCH /api/louise/pages/3 422`.
- **Save and Revert stay enabled** in Settings, Pages, and the Media editor, so they stay in the tab order and Cmd+S always answers. With nothing changed, Settings and Pages say "No changes to save", and the Media editor closes.
- **Link rows** name each control by its row ("Remove link 2, Shop"), label both inputs visibly, focus the new row's label after **Add link**, and focus the next row's **Remove** (or **Add link**) after a removal.
- **Links typed as `example.com/shop`** get `https://` when the field loses focus and before a save, and the field shows the corrected value. The server's scheme check is unchanged.
- **Users:** the invite form asks for one optional **Name** and an **Email**, with visible labels. **Add editor** stays enabled and answers a missing email in words, and a refused invite shows the route's reason.
- The **Upload** button shows a focus ring.

What to know when you upgrade:

- `LouiseApiError` from `louise-toolkit/client/settings` now carries the parsed `body`, and the new `apiErrorMessage(error, fallback)` turns any thrown error into owner-facing text: a 4xx route's own `error`, else your fallback. A site panel that showed `error.message` showed the request line; switch it to `apiErrorMessage`.
- `settingsRoute`'s 422 messages are rewritten for owners: a link says "Enter a link that starts with https://, mailto:, or /.", an image says "Choose an image from the media library.", and the top-level `error` counts the fields. A test that matched the old wording needs updating.
- `editorsRoute` accepts `name` on an invite, alongside `firstName` and `lastName`, and its missing-email message reads "Enter the editor’s email address."
- A test that expected the footer's Save to be disabled until an edit now finds it enabled.
