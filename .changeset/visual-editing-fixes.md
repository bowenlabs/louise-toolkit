---
"louise-toolkit": patch
---

Visual editing fixes (#698):

- **Hover leaves no styles behind:** clearing the highlight restores `outline-offset` and `cursor`, not just `outline`.
- **An odd field key can't throw:** `applyPreviewValues` matches tagged regions by comparing the attribute, so a key containing `"` or `]` no longer breaks the selector.
- **Only object values are applied:** `applyPreviewValues` ignores a `values` payload that isn't an object.
- **An unguarded preview warns:** `mountPreviewSync` logs a warning when it has no `allowedOrigin`, since it then accepts preview values from any window.
- **Ids parse strictly:** `decodeEditRef` accepts only digits, so `pages:7abc:title` and a negative id are rejected.
