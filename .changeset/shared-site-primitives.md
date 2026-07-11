---
"louisecms": minor
---

Extract logic that Louise sites were duplicating into the package, and add
generic multi-role auth primitives so sites converge on maintained code.

**New**

- `louisecms/email` — themed transactional template shell: `renderEmailShell`,
  `mailButton`, `mailFallbackLink`, and a `MailTheme` (palette + fonts + layout
  tokens). Sites keep only their palette and copy.
- `louisecms/client/drawer` + `louisecms/editor` — a first-class **Users** panel
  (opt-in top strip, `user` icon) for managing CMS editors, paired with the new
  `editorsRoute` factory.
- `louisecms/auth` — `requireEditorFromContext` (framework-agnostic
  Astro-context guard); and generic dynamic-role primitives `hasRole` /
  `requireRole` (arbitrary, site-defined role strings) + `resolveSession`
  (returns the role for any signed-in user, no gating), so a site can build its
  own multi-role auth layer. Louise's own CMS auth stays binary and no role
  names are baked in.
- `louisecms/editor` — `pagesRoute` gains `transform`, `reservedSlugs`, and
  `afterWrite` hooks so sites can drop their hand-rolled pages CRUD.
- `louisecms/commerce/fourthwall` — `mapFourthwallOrder` plus
  `fourthwallMoneyToCents` / `mapFourthwallOrderStatus` for mapping order
  webhooks to a normalized, storage-ready shape.
- `louisecms/astro` — a new **optional** subpath (`astro` is an optional peer)
  with `createLouiseMiddleware`, the shared site middleware (rate-limit →
  editor session + sticky `?louise` edit mode → CMS-freshness cache/CSP/security
  headers) as a config-driven factory.

**Migration (required on upgrade)**

`getLouiseAuth` now declares standard `firstName` / `lastName` fields on the user
table (used by the Users panel). Because Better Auth references declared fields,
you **must** add the columns when upgrading: regenerate the auth schema
(`generateAuthSchemaSql`) and apply the migration. Both columns are nullable and
additive — no data loss, no `NOT NULL` — but they are not optional to apply.
