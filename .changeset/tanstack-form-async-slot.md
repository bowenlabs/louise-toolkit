---
"louise-toolkit": patch
---

**Fixed docs: the TanStack validator bridge must be wired to `onChangeAsync`, not
`onChange`.**

`tanstackFieldValidator` returns an async function — deliberately, so DB-backed
custom rules can be awaited. TanStack Form keys its validator slots on exactly
that distinction, and the toolkit's own doc comment and both docs pages showed the
**sync** slot.

Verified against `@tanstack/solid-form@1.33.2`: a promise-returning function in
`onChange` is stored **as the promise**, so `meta.errors` holds a pending
`Promise` instead of a string. Nothing throws. The message never renders and the
submit button never disables — which reads exactly like "validation isn't
running", and sends you looking upstream rather than at the wiring.

```diff
- <form.Field name="email" validators={{ onChange: v.email }}>
+ <form.Field name="email" validators={{ onChangeAsync: v.email }}>
```

`onBlurAsync` and `onSubmitAsync` take the same function; pair with
`onChangeAsyncDebounceMs` when a rule hits the network.

Docs-only for the runtime — no behaviour changed — but the previous instructions
produced a form that silently didn't validate.

Also documents that the validator map is **flat**: `defineForm` has no array or
nested field type, because each field is one column. A form with repeating rows
builds its array with TanStack's own API and attaches these validators to the
leaves.

**Removed a doc comment pointing at an export that does not exist.**
`client/forms.tsx` advertised an opt-in solid-form scaffold at
`louise-toolkit/client/tanstack-form`. There is no such subpath, no such module,
and `@tanstack/solid-form` is not a peer dependency — following the comment gets
you a resolution error. It now says what is actually true: build a complex form
yourself with TanStack and keep one validation definition through
`tanstackFormValidators`. No scaffold is planned, and the docs say why.
