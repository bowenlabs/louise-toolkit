---
"louise-toolkit": patch
---

The transactional-mail shell fits a phone, and can carry a logo.

- **The card is fluid.** `renderEmailShell` drew a fixed 600px table, so a phone showed the left two-thirds of every email, or a zoomed-out page with 16px text. The card is now `width:100%;max-width:600px`, with a conditional comment that keeps a fixed table for Outlook's Word engine.
- **A `"logo"` masthead.** `MailTheme.masthead: "logo"` draws one solid band in `mastheadBg` (default the palette's `ink`) with the new `MailTheme.logo` image centred, falling back to the wordmark in `onDark`, and centres the footer to match. The default `"band"` masthead is unchanged, but note that a wordmark over a pale band cell seldom clears WCAG contrast; a logo image or a dark band does.
- **New theme tokens.** `shadow` (a card with a shadow has no border), `headlineSize` and `headlineWeight` (default 32 and 400), `contentPadding` (default 40), and `buttonAlign` (default `"left"`). `mailButton` takes a per-button `align`, and the shell omits an empty `eyebrow`.
- **`mailRows`** renders a soft box of label and value lines, such as an order's number and total, as a table so Outlook keeps the two columns.

Nothing to do when upgrading: every default reproduces the previous output, apart from the card's width and an `x-apple-disable-message-reformatting` meta tag.
