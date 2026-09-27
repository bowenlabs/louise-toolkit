---
"louise-toolkit": minor
---

A honeypot hit no longer drops a real visitor's message without a trace (#590).

- **`spamVerdict(config, body)`** returns `"honeypot"`, `"too-fast"`, or `null`. `looksLikeSpam` is now a wrapper over it and behaves as before.
- **`formRoute` records each held submission.** By default it logs one line with the form's name and the verdict, never the field values. Pass `onSpam(verdict, env, { form, body })` to count, alert on, or store them.
- **`defineForm` warns about an autofill-prone honeypot name.** Browsers and password managers fill fields by name and don't always honor `autocomplete="off"`, so a decoy called `website`, `company`, or `email` catches real visitors. `autofillProneName(name)` is the check. The forms guide's example decoy is now `louise_trap`.

**Upgrading:** if `defineForm` warns about your form, rename its honeypot to a name no autofill matches, such as `louise_trap`. The decoy's name is yours, so nothing renames it for you. A plain HTML form that hard-codes the decoy's `name` needs the same rename.
