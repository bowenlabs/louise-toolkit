---
"louise-toolkit": minor
---

The sections editor now renders **on-canvas section chrome** (#182 Phase 1). In edit mode, hovering a section (over the `data-louise-section` markers the render stamps) rings it and floats a toolbar to **move it up/down or delete it** — wired to the same structural ops the floating dock uses. New `client/chrome.ts` provides the vanilla, framework-free chrome (`mountSectionChrome`) plus the marker readers (`readSectionMarkers`, `sectionIndexOf`) with deepest-boundary hit-testing. Move/delete still save-and-reload for now; instant DOM ops and retiring the dock follow in later slices.
