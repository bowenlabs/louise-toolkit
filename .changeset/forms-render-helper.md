---
"louisecms": minor
---

Forms Tier 2 (#46) — a headless `<Form>` render helper, a `file` field type, and
an optional TanStack Form adapter.

- **`<Form>` / `mountForm`** (`louisecms/client`) — renders accessible inputs from
  a `defineForm` catalog and **mirrors the server validation client-side** (reuses
  `validateSubmission` → the shared `Rule` engine, no second definition), then
  POSTs to the form's `formRoute`. Unstyled by default (`louise-form*` class
  hooks); maps a server `422` back onto the fields.
- **`file` field type** — renders a file input that uploads through the `media`
  route and stores the returned URL.
- **Optional TanStack Form adapter** — `tanstackFormValidators(config)` /
  `tanstackFieldValidator(key, field)` (`louisecms/forms`) return validators in
  `@tanstack/solid-form`'s shape, backed by the same `Rule` engine, so a complex
  hand-built form keeps one validation definition. Dependency-free (the consumer
  brings the peer). `validateField` is now exported for reuse.
