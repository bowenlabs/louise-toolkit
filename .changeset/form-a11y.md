---
"louise-toolkit": minor
---

`<Form>` is easier to use with assistive technology, and `FormField` takes `autocomplete` and `inputmode` (#548).

- **Hints are announced:** `aria-describedby` points at a field's `help` text as well as its error.
- **Required fields say so:** they get `required` and `aria-required`. The form stays `novalidate`, so no browser bubble appears.
- **A failed check moves focus** to the first invalid field, and the status region says how many need attention. A server violation that matches no field now shows in the status region instead of nowhere.
- **The fallback names a next step:** "Couldn't send your message. Try again in a minute." replaces "Something went wrong."
- **IDs include the form name:** `louise-f-<form>-<field>`, so two forms with an `email` field don't collide.
- **Autofill and keyboards:** `FormField.autocomplete` and `FormField.inputmode` pass straight through to the control.

**Upgrading:** a stylesheet or script that selected `#louise-f-<field>` needs `#louise-f-<form>-<field>`, or the `louise-form*` classes. The status paragraph is now always in the DOM, empty until there's a message, so hide `.louise-form-status:empty` if your styles give it space.
