---
"louise-toolkit": minor
"astroidjs": patch
---

**A field's choices can now be fetched.** `SectionField.options` accepts an async
resolver — `() => Promise<FieldOption[]>` — as well as a literal array, so a
picker whose values come from an API can be declared in a section catalog:

```ts
colorway: { type: "select", options: [{ value: "blue" }] },        // as before
location: { type: "select", options: () => listSquareLocations() }, // new
```

This is what the settings drawer's `render` escape hatch was doing by hand, and
the section inspector had no equivalent of. It is the piece coracle.coffee#37's
Square pickers were blocked on.

The picker draws three states, not one: the choices, the wait, and the failure. A
picker that renders empty when its fetch failed is indistinguishable from one
whose source genuinely has nothing, so a failure now says so and the select is
disabled rather than appearing to have lost the stored value while loading.

One fetch per resolver is shared by every field using it — the promise is cached,
not just the result, so an inspector opening ten fields at once makes one request
rather than ten. A failed fetch is not cached, so the next attempt is fresh.

**The trade, stated plainly:** a RESOLVED option set is not checked on write. A
literal set still is. Validating a fetched set would put a network call on the
save path, and a page failing to save because an external API is down is a worse
failure than an unrecognised token — it also hands that service the ability to
block publishing. A field wanting the closed-set guarantee back declares it with
its own `validation` chain. ADR 0010's Phase B is where this gets a real answer:
an `external` source is mirrored by definition, and a local mirror is something
the write path can check without leaving the Worker.

**Type-level breaking change:** code that reads `field.options` as an array must
narrow first (`Array.isArray(field.options)`). Catalogs that only *declare*
options are unaffected.
