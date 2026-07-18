# ADR 0007 — Linting toolchain: keep the oxlint / Biome / eslint-plugin-solid split

- **Status:** Accepted (2026-07-17) — **keep the three-tool split; do not consolidate onto Biome 2.** Revisit only under the triggers below.
- **Deciders:** Baylee (solo maintainer)
- **Issue:** #101 (the "Biome 2 type-aware lint" item; milestone: Platform features push, epic #102)
- **Related:** ADR 0001 (opinionated Astro + Cloudflare)

## Context

The repo lints with three tools, each scoped to what the others can't handle:

- **oxlint + oxfmt** — `.ts/.tsx/.js`, via `vp check` (oxlint is bundled in the Vite+ / `vp` toolchain). oxfmt is the sole formatter.
- **Biome 2** (`biome.json`, currently 2.5.3) — **`.astro` only** (scoped via `files.includes: ["**/*.astro"]`), because oxlint can't parse Astro single-file components. Its **formatter is disabled** — Biome only lints the `.astro` component scripts, so it never competes with oxfmt.
- **oxlint + `eslint-plugin-solid`** — the SolidJS client (`packages/louise/src/client`), via a direct `oxlint@1.73` call (`pnpm lint:solid`). oxlint runs the real ESLint plugin through its `jsPlugins` field; a **direct** invocation is required because `vp`'s bundled oxlint path drops `jsPlugins`.

#101 asked whether **Biome 2** — which now does a subset of **type-aware** rules without a full `tsc` — should let us collapse this split onto one tool. (Biome 2 itself is already adopted: the repo is on 2.5.3.)

## Decision

**Keep the split.** Biome 2 cannot absorb the other two roles, so consolidating onto it would *not* reduce the tool count — it would only add an overlapping linter over `.ts`.

The blocker is the Solid client:

- **Biome cannot run `eslint-plugin-solid`.** Biome's plugin system is **GritQL** (AST pattern-matching), not an ESLint-plugin runtime — it cannot execute third-party ESLint plugins, and it ships **no built-in SolidJS rules**. Solid's reactivity lints (stale-closure / signal-in-effect / prop-destructuring hazards) have no Biome equivalent, so the client must stay on **oxlint + `eslint-plugin-solid`** regardless of what happens to `.ts` linting.

Given oxlint stays for the client anyway, the rest follows:

- **oxlint is the native `vp` path** for `.ts` — fast (Rust), already wired into `vp check` and CI with zero extra config. Moving `.ts` linting to Biome would add a second linter over the same files for no net reduction.
- **Biome's job is minimal and non-overlapping** — it exists solely because oxlint can't parse `.astro`. With its formatter disabled, there's no oxfmt/Biome formatting conflict.
- **Biome 2's type-aware rules are a nice-to-have, not a reason to migrate.** The rules oxlint enforces on `.ts` are already covered in the `vp` pipeline, and the type-checking gate is `tsgo` (TS7 native) — a separate, authoritative pass. Biome's typed rules would duplicate, not replace, that.

Net: the split is already the *minimum* — three tools because three file/rule domains (`.ts`, `.astro`, Solid reactivity) are each unparseable or unsupported by the others. It is not accidental complexity.

## Consequences

- Three lint entrypoints stay: `vp check` (`.ts`), `pnpm lint:astro` (Biome, `.astro`), `pnpm lint:solid` (oxlint + `eslint-plugin-solid`, client). Each is its own CI step.
- No formatter contention (oxfmt formats; Biome's formatter is off).
- This decision is recorded so the "just use one linter" question isn't re-litigated each dep refresh.

## Revisit triggers

- **oxlint gains `.astro` parsing** → Biome could be dropped entirely (oxlint would cover `.ts` + `.astro`, with the Solid client still via `jsPlugins`).
- **Biome ships an `eslint-plugin-solid` equivalent** (native Solid rules, or a GritQL port with parity) → the client could move to Biome, opening a real consolidation path.
- **`vp`'s bundled oxlint stops dropping `jsPlugins`** → `lint:solid` could fold back into `vp check`, removing the separate direct-oxlint step (a smaller simplification, independent of Biome).
