---
"louise-toolkit": minor
---

`mountLouise` can route the inline auto-save through typed Astro Actions, with a keepalive escape hatch for the unload path (#138, completing #72). Pass `actions: { save, saveDraft }` — the site injects `actions.louise.save` / `actions.louise.saveDraft` (which it can import from `astro:actions`; this framework-agnostic client can't). The **normal debounced** save then calls the Action; the **unload** flush (tab-hide / page-hide / `beforeunload`) still uses the raw `keepalive` fetch, since Astro's action client can't set `keepalive` and a save fired mid-navigation would be dropped.

Fully backward compatible: omit `actions` and every save stays on the raw `/api/louise/*` routes exactly as before. Each injected callable must resolve on success and reject on failure (the site wraps the action's `{ data, error }`).

Scoped to the inline field + inline versioned-draft surfaces. The sections dock and the reference-site wiring follow separately (the dock surfaces per-field validation detail the Action adapter doesn't carry yet).
