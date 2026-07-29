---
"louise-toolkit": minor
---

**One field-type system.** `SectionFieldType` (8 types) and `SettingsFieldType`
(6) were parallel, overlapping on four and disagreeing on the rest, so a type
added to one surface was silently missing from the other. Both are now aliases of
one `FieldTypeName`, backed by the `defineFieldType` registry.

That asymmetry was not only duplication. Settings had a `links` type and no `link`
type, so there was nowhere for a scheme check to live — which is why stored nav
destinations went unvalidated until the XSS fix. `links` now validates each row's
`href` against the same allowlist as a section's `link`.

`color` and `links` were settings-only and are now registered types a section
catalog can declare. `richText`, `array`, `select` and `link` were sections-only
and are now available to settings.

**Field types are extensible.** `SectionFieldType` was a closed union, so a type
registered via `defineFieldType` widened the runtime but not the type a catalog
could write. It now admits any string alongside the built-ins, keeping editor
completion for the ten known names while letting a site's own registered type be
authored.

The trade is that a typo — `"txet"` — is no longer a compile error; it validates
as nothing rather than failing. `unknownFieldTypes(fields)` is the check that gets
back, opt-in and covering site-registered types, which the closed union never
could.
