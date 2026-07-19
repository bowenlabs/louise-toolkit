---
"astroidjs": minor
---

Add the `editors` route to the generated Worker's editor-route plan. The scaffold
floor ships DB-managed Better Auth editors (a `user` row *is* an editor, and that
table is the magic-link allowlist), so the generated `worker.ts` now composes
`editorsRoute({ table: "user", resolveEditor })` — the backend for the Users panel
that invites and removes editors. Slotted after `mediaRoute`; no ordering
constraint (it doesn't share the `/pages/:id` matcher).
