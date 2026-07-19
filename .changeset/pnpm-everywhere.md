---
"louise-toolkit": patch
"astroidjs": patch
"create-astroid": patch
---

Use pnpm consistently in every documented command. The repo pins pnpm via `packageManager` and its own scripts already used it, but the published READMEs, the `create-astroid` help text, and the `astroid` CLI banner still told users to run `npm` — including `npm run doctor` in `create-astroid`'s README while the template README it scaffolds said `pnpm doctor`.

Install lines become `pnpm add`, one-off binaries become `pnpm exec`, and `npm create astroid` becomes `pnpm create astroid` (which also drops npm's `--` argument separator, since pnpm forwards flags directly).

References to npm *the registry* are left alone — "shipped to npm", "the npm package", "not an npm dependency" are all still accurate, and rewriting them would make them wrong.
