---
"louise-toolkit": minor
"@louise-toolkit/astro": minor
---

Form fields accept a web address without a scheme and, under the form's locale, a number with grouping separators (#594).

- **`url`:** `example.com` or `www.example.com/menu` gains `https://` before the check, and the normalized value is what's stored.
- **`number`:** `FormConfig.locale` (new, no default) makes a number read that locale's grouping and decimal separators, so `1,200` is 1200 in `en-US` and `1.200,5` is 1200.5 in `de-DE`. Without a locale, nothing changes: a comma is a decimal point in some locales, so it isn't guessed.
- **Messages say what works:** "Enter a web address, like example.com." and "Enter a number, like 1200." replace "`<key>` must be a valid URL" and "`<label>` must be a number".
- **`<Form>` renders a number as a text input** with `inputmode="decimal"`, since `type="number"` drops `1,200`, adds spinners, and changes on a scroll.
- **`coerceFormValue(field, raw, { locale })`** and `tanstackFieldValidator(key, field, { locale })` take the locale; `tanstackFormValidators` passes the form's.
- **`formToAstroSchema`** (`@louise-toolkit/astro`) runs the same coercion first, so an Astro Action accepts what `formRoute` accepts, with the same two messages.

**Upgrading:** set `locale` on a form whose `number` fields should accept separators. A test that matched the old messages needs the new ones, and a stylesheet that targeted `input[type="number"]` in a `<Form>` needs `input[inputmode="decimal"]`.
