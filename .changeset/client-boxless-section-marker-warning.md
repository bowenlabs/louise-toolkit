---
"louise-toolkit": patch
---

client: warn when a section marker has `display: contents`. The on-canvas chrome
attaches the ring (a box-shadow on the marker) and its toolbar (measured from the
marker's `getBoundingClientRect`) to the real `[data-louise-section]` element — so
a site that wraps sections in `display: contents` (to keep the wrapper out of
layout) gives the marker no box: the ring can't paint and the toolbar mis-places
to the viewport origin. This was a silent, hard-to-diagnose failure; the chrome now
emits a one-time `console.warn` naming the cause and the fix (give the marker a real
box). Behavior is otherwise unchanged.
