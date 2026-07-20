---
"astroidjs": minor
"create-astroid": minor
---

Close the last three dead-UI gaps: the typed Actions surface, real-visitor Core Web Vitals, and the dashboard's inbox card.

**Astro Actions (`src/actions/index.ts`).** Astroid generated only the raw `/api/louise/*` route half, leaving the Astro-native layer of ADR 0001 unbuilt. That is not a missing convenience — the two entrypoints write the *same rows*, and the whole point of `louise-toolkit/astro`'s factories is that each shares its route's store path (`applyFieldSave`, `applySettingsPatch`, `applySaveDraft`). A project wiring its own Actions gets a second write path, which is where validation, sanitization, and draft-merge semantics drift apart silently. `save`, `saveDraft`, and `settings` now ship pre-wired against the same tables and the same collection config the worker uses; the file is scaffold-once and meant to be added to. `ASTROID_SETTINGS_COLUMNS` / `ASTROID_SETTINGS_IMAGE_KEYS` are now exported so the Actions import the identical allowlist the routes enforce rather than carrying a second literal that could drift.

**Core Web Vitals.** `HealthSummary` has carried an optional `cwv` field since the health module landed, and the Health panel rendered a "not measured yet" badge for it — permanently accurate and permanently useless, because nothing collected the data. The full loop now ships: a beacon (`public/vitals.js`) posts LCP/CLS/INP, `vitalsRoute` writes them to an Analytics Engine dataset, and the daily health scan reads the p75 back and folds it into the summary. Collection is free and needs no credentials; only the read-back does, because the Analytics Engine SQL API is account-scoped and has no binding — so `CF_ACCOUNT_ID` + `CF_API_TOKEN` follow the dormant-until-provisioned convention and an unprovisioned site simply keeps the "not measured yet" badge rather than erroring. The dataset name is derived from the project key so two Astroid sites on one account don't blend their p75s.

The beacon is a **static file, not an inline script**: Astro hashes processed scripts into `script-src`, and an inline script carrying generated content can't be hashed and would be CSP-blocked. From `public/` it is same-origin and already covered by `script-src 'self'`. It is skipped in edit mode — an editor's session isn't representative field data.

**The inbox card.** Previously omitted on the reasoning that an "unread" count with no read-state column could only be the total, "a number that never goes down". That was wrong about the model: `inquiriesRoute` is GET-and-DELETE, and the Inquiries tab *reviews and clears* submissions — deletion **is** the acknowledgement. So a surviving row is a message still waiting, the count falls as you work through them, and `COUNT(*)` is exactly right. Wired, gated on the project actually capturing inquiries.

`vitalsRoute` is imported from `louise-toolkit/analytics`, not `/editor` — the same non-editor-route trap `realtimeRoute` hit.
