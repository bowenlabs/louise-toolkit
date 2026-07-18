# ADR 0008 — Enable Vite+ type-aware linting + type-check (TS7) in `vp check`

- **Status:** Accepted (2026-07-18) — **turn on `lint.options.typeAware` + `typeCheck` for `packages/louise`; keep the standalone `tsgo` gate.**
- **Deciders:** Baylee (solo maintainer)
- **Related:** ADR 0007 (lint toolchain split) — this refines, not reverses, that decision.

## Context

ADR 0007 kept the three-tool lint split and noted that type-aware lint was, at
the time, "a nice-to-have, not a reason to migrate," with "the type-checking gate
… `tsgo` (TS7 native) — a separate, authoritative pass."

Vite+ **0.2.5** makes type-aware checking available in the tool the repo already
uses. `vp check` / `vp lint` can now run:

- **`typeAware`** — Oxlint rules that need type information, and
- **`typeCheck`** — a full type check,

both **powered by [tsgolint](https://github.com/oxc-project/tsgolint) on the
TypeScript-Go toolchain** — the same native TS7 engine as the `tsgo`
(`@typescript/native-preview`) script the repo already runs. That removes the old
reason to defer: type-aware lint no longer means adding a second, slower toolchain
(`tsc`); it reuses the TS7 engine already in the pipeline.

## Decision

**Enable `typeAware` + `typeCheck` in `packages/louise/vite.config.ts`** so
`vp check` type-checks and runs type-aware rules over `src` + `test`.

Two scoping/curation choices keep the gate green and honest:

1. **`vite.config.ts` is excluded from lint** (`ignorePatterns`). It is authored as
   an untyped plain object — Vite+'s config helper and tsdown ship *inside* the
   `vp` binary, so there are no Vite/Rollup plugin typings to import — and it is
   deliberately outside the `src`/`test` tsconfig scope. Linting it would surface
   `implicit-any` on the local plugin, which the standalone `tsgo` gate never sees.

2. **Two type-aware rules are off** (`no-base-to-string`,
   `restrict-template-expressions`) and a **`test/**` override** relaxes rules that
   assume production intent (`unbound-method`, `no-misused-spread`,
   `no-unused-expressions`, `no-unsafe-optional-chaining`). Rationale:
   - Louise's content layer **intentionally** coerces `unknown` values — CMS field
     and setting values, form submissions, error causes, FTS index text — into
     display/serialized strings. Several sites are already `typeof`-guarded (e.g.
     `core/content/codegen.ts`), yet the rule still fires. Type *correctness* is
     enforced by the `tsgo` gate; these two rules only add noise over a deliberate
     design pattern.
   - Tests reference Vitest spy methods unbound (`expect(spy)`), spread strings,
     keep compile-only type-assertion expressions, and optional-chain on values a
     passing assertion already guarantees. Full type-checking still runs on tests;
     only the lint rules relax there.

   Real findings the type-aware pass surfaced were **fixed in code**, not
   suppressed: `unbound-method` on the chrome toolbar callbacks (method-shorthand →
   strict property signatures) and the Astro loader (call bound methods on the
   context instead of destructuring them), and three
   `no-redundant-type-constituents` (`Promise<unknown | null>` → `Promise<unknown>`,
   a `text | real | integer` union that collapsed to `any`, and a `string`-swallowed
   constraint literal union kept visible with `& {}`).

**Keep the standalone `tsgo --noEmit` step.** It remains the authoritative gate:
it type-checks the whole `src` + `test` tsconfig program in one pass and is not
subject to any lint scoping. `vp check`'s `typeCheck` is complementary (fast,
inline with lint), not a replacement — the two agree (a real error caught during
this change was reported identically by both).

## Consequences

- `vp check` now fails on type errors and enabled type-aware rules, catching more
  before the separate typecheck/CI steps — same TS7 engine, no extra toolchain.
- The enabled rule set is curated in one place (`vite.config.ts` `lint` block),
  with the rationale above; Vite+ reads its Oxlint config there (not
  `.oxlintrc.json`).
- `vp` is unpinned (curl-installed latest in CI); these options require **≥ 0.2.5**.
  A `vp` older than that would silently ignore the `lint` block — a non-issue while
  CI installs latest, noted here in case the install is ever pinned.
- ADR 0007's split is unchanged: `.astro` (Biome) and the Solid client (oxlint +
  `eslint-plugin-solid`) still run as their own steps.
