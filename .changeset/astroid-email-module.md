---
"astroidjs": minor
"create-astroid": minor
---

Add the transactional email module (#254): the four templates every consuming site rewrote, a mail theme derived from the project's brand, and a delivery path that is safe to call from a request handler.

**Templates.** Sign-in link, password reset, and the inquiry pair — notify the owner, confirm to the sender. All three sites wrote these four with the same structure and near-identical copy, differing only in the brand name, which is what makes them first-party rather than site-side. The brand-agnostic frame already lived in `louise-toolkit/email`; this owns the wording and the layout inside it. Every template renders HTML **and** plaintext from one definition: a message with no text/plain part scores worse with spam filters, and for a sign-in link the plaintext body is what a terminal client shows and what the dev log prints. Visitor-supplied values are HTML-escaped, and the inquiry subject goes through `subjectSafe` — a newline in a name field is a header-injection primitive.

**`astroidMailTheme(config)`** derives the ten palette slots, the colour band, and the font stacks from `theme.colors`. Two choices are load-bearing: neutrals stay fixed (page background, ink, rules are typography decisions, not brand ones) while the accent and band come from the brand; and the accent is **contrast-corrected against the card background**, because a brand yellow used verbatim as 11px uppercase text is unreadable and mail clients have no dark-mode escape hatch. The band is always five cells — a ramp through however many brand colours exist — so the masthead reads as designed rather than as "whatever was configured". A malformed hex falls back instead of throwing; a bad colour in settings should not take out password reset.

**`sendTransactional`** never rejects. Mail in this stack is always store-and-forward — the inquiry row is inserted, the account exists — so it is the notification of something that already happened and must not fail the request that caused it, nor throw into a `waitUntil` where it becomes an unhandled rejection. Messages send concurrently and independently, so the owner's copy still arrives when the visitor typo'd their address. With no `EMAIL` binding (or no `MAIL_FROM`) the mailer is dormant per the #252 convention: it **logs** the rendered message, plaintext body included, which is what makes "click the magic link" work under `wrangler dev`.

The scaffold wires it: the generated worker hangs `sendInquiryMail` off the form route's `onSubmit` (which fires after the insert, off the response path), and `auth.ts` now renders the real magic-link template instead of a three-line HTML string.

Verified end to end on a scaffolded project with no bindings provisioned: a contact POST returns 201, the row lands in D1, and both messages are logged with their recipients, subjects, and bodies.
