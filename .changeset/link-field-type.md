---
"louise-toolkit": minor
---

`link` and `toggle` section field types — a real destination editor, and a URL allowlist.

## `link`

A destination has no visible text node to click, so it has always been wrench-edited
— but as `{ type: "text", inline: false }`, which renders a bare text box. `link`
gives it a proper editor: a page picker plus a free URL field, lifted out of the
rich-text builder (where it already existed) so both hosts share one control.

The value stays a **plain string href**, so adopting it is a pure schema change —
`{ type: "text", inline: false }` → `{ type: "link" }` with no data migration.

```ts
ctaHref: { type: "link", label: "Button link" },
```

### 🔒 It closes a real hole

`validateSectionField` had no branch for these fields, so they fell through to
"must be a string" — and a site component renders the value straight into
`href={…}`, which never passes through the HTML sanitizer (that only ever sees
rich-text markup). A `ctaHref` of `javascript:alert(1)` would validate, persist,
and render as a working XSS vector for every visitor of the published page.

`link` fields are now checked against the **same scheme allowlist the sanitizer
applies to markup hrefs** — `http(s):`, `mailto:`, `/`, `#`, `.` — with a test that
pins the two together by outcome, so they can't drift.

**This can reject writes that previously succeeded.** If a site stored a
destination with an unusual scheme (`tel:` is the likely one — neither allowlist
permits it), switching that field to `link` will 422 until the value changes.
Audit stored hrefs before adopting the type on an existing field.

### `builtInRoutes`

`SectionsEditorProps.builtInRoutes` feeds code-defined routes into the picker.
Its page list comes from `/api/louise/pages`, which only knows DB-backed pages —
a site's hand-authored routes (`/shop`, `/contact`) have no row, so without this
the picker is missing exactly the destinations most CTAs point at.

```ts
mountSections(el, {
  builtInRoutes: [{ path: "/shop", title: "Shop" }],
});
```

A failed page fetch degrades to the URL field alone rather than breaking the wrench.

## `toggle`

A real boolean field, so "open in new tab" stores `true`/`false` rather than a
yes/no `select` whose `"false"` would read truthy in a site render. Validation is
deliberately strict about this — coercing a stringly value would turn a bad write
into a wrong page instead of an error.

Both types are additive; existing catalogs are unaffected.
