---
"create-astroid": patch
---

**Every scaffolded site now ships a CI workflow.** The template carried a
`_gitignore` and `_env.example` but no `.github/`, so whether a generated site
had CI came down to whether someone remembered to add it — and sibling sites
drifted (one had a full pnpm → lint → check → test → build pipeline, another had
no `.github` directory at all and nothing gating its pushes).

The template now includes `_github/workflows/ci.yml`, renamed to
`.github/workflows/ci.yml` on scaffold via the same `_`-prefix convention as
`_gitignore`. It runs on push + PR (concurrency-cancel), installs pnpm through
corepack against a frozen lockfile, and runs `doctor → check → build`, with
`lint` and `test` steps that no-op on a fresh scaffold (`--if-present`) and light
up automatically once the site adds those scripts. The template also pins
`packageManager: pnpm@11.13.0` so local installs and the frozen-lockfile CI use
the identical pnpm. The clean-room scaffold smoke test asserts the workflow is
written.
