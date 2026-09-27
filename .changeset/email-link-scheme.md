---
"louise-toolkit": patch
---

Email links accept only `https:`, `http:`, and `mailto:` (#703).

- **`mailButton` and `mailFallbackLink`** used to escape any URL and link to it, so a `javascript:` or `data:` URL reached the email's markup. A link with another scheme now renders its text with no `href`.
- **`escapeHtml` also escapes `'`** as `&#39;`, so a value is safe in a single-quoted attribute too.

**Upgrading:** nothing to change for a site that links to its own `https` pages. A relative URL, which a mail client can't follow anyway, now renders as plain text; pass an absolute one.
