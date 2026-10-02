---
"louise-toolkit": minor
---

`better-auth` and `@better-auth/passkey` now need 1.7.7 or later, the release that fixes three Better Auth advisories published on 2026-09-30.

- **[GHSA-965c-763c-88jm](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm) (critical):** Better Auth accepted an OAuth state value as a magic-link token, so anyone who knew an email address could sign in as it. Every instance `getLouiseAuth` builds runs the magic-link plugin. The attack also needs a social or Generic OAuth provider, which the toolkit doesn't configure, so an instance is exposed only if a site adds one through `extraPlugins` or its own Better Auth setup.
- **[GHSA-r4xp-prcw-77qf](https://github.com/better-auth/better-auth/security/advisories/GHSA-r4xp-prcw-77qf) (high):** sign-in as another user through the OAuth Proxy plugin, which the toolkit doesn't use.
- **[GHSA-44jh-23m7-hpcf](https://github.com/better-auth/better-auth/security/advisories/GHSA-44jh-23m7-hpcf) (low):** concurrent requests could exceed rate limits on PostgreSQL. Louise sites run D1.

The peer ranges move from `^1.6.23` to `^1.7.7`, and the toolkit's own development copies from `^1.7.2`.

**Upgrading:** a site that resolves Better Auth below 1.7.7 gets a peer-dependency warning, or an install error under strict peers. Bump both packages in the site, `corepack pnpm add better-auth@^1.7.7 @better-auth/passkey@^1.7.7`, and check that the lockfile holds one copy of each.
