---
"louise-toolkit": patch
---

**Markers outside the sections host now resolve everywhere the editor looks.**

The chrome has always hovered every `data-louise-node` in the document, but the
editor's own lookups were host-scoped: the wireInline scan and `nodeEl` — the
inspector popover's anchor — both queried under `props.host`. A marker rendered
outside the host was silently inert for in-place editing, and its inspector
popover fell back to the viewport-origin default position instead of anchoring
to the element.

No site stamps such a marker today, which is why nothing ever failed loudly —
but ADR 0010 Phase B stamps `settings.*` paths in the Nav and Footer, which
render outside the host by construction (#374). Both lookups now query the
host's document; host-owned operations (inserting sections, sibling order) stay
host-scoped, since sections really do live there.
