# ADR 0014: A test-coverage floor in every repository

- **Status:** Accepted (2026-09-24)
- **Deciders:** Baylee (solo maintainer)
- **Related:** ADR 0013 (the ratchet pattern, applied to prose), ADR 0009 (the Local API is the MCP server's substrate), epic #481 (burning site code down into the kit)

## Context

No repository in the stack measured test coverage. The suites pass, and the counts look healthy (1,440 tests in `louise-toolkit`, 506 in `astroidjs`), but a count says nothing about what the tests reach. Measuring on 2026-09-24 showed why that matters:

| Repository              | Lines               | Statements | What's untested                                                                                                                             |
| ----------------------- | ------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `@louise-toolkit/astro` | 95%                 | 93%        | Little                                                                                                                                      |
| `astroidjs`             | about 91% (ceiling) |            | `portal/scaffold`, `commerce/loader`, `auth`                                                                                                |
| `louise-toolkit`        | 73%                 | 70%        | `content/localApi` at 17%, `editor/versions` at 26%, `content/visual-editing` at 15%, `client/blocks.tsx` at 8%, `content/schema-gen` at 0% |
| Client site A           | about 33% (ceiling) |            | Studio screens, islands, 32 of 34 API routes                                                                                                |
| Client site B           | about 34% (ceiling) |            | 26 islands, 11 API routes                                                                                                                   |
| Client site C           | about 6% (ceiling)  |            | Everything outside `src/lib`; no CI at all                                                                                                  |

The site ceilings count which source files a test imports, so the real numbers are lower.

Two things stand out. The Local API, which every editor route and the planned MCP server (ADR 0009) run through, is the least-tested core module. And the sites' untested code is the code that epic #481 is burning down: islands and routes that the kit will absorb or delete.

## Decision

### 1. The floor is 80% of lines and statements

Every repository gates its test job on coverage. The bar is 80% of lines and 80% of statements. Branches and functions are reported, not gated: branch coverage runs lower on defensive code, and a branch floor would be the first to fail for reasons that have nothing to do with test quality.

The provider is `@vitest/coverage-v8`, pinned to the repository's vitest version. Coverage includes `src/**/*.{ts,tsx}` and excludes `.d.ts` files, `.astro` components (vitest can't cover them; the scaffold smoke test does), and files a tool generates. Nothing is excluded because it's untested.

### 2. A repository below the floor ratchets toward it

A repository that measures under 80% doesn't get a red CI and a scramble. Its thresholds start at the measured numbers, rounded down, with vitest's `thresholds.autoUpdate` on. That rewrites the config file when coverage rises, so a PR that raises coverage also commits the new floor, and a PR that lowers coverage fails. The same shape as the Vale ratchet in ADR 0013.

When lines and statements reach 80, `autoUpdate` comes off and both pin at 80.

Where each repository starts:

- **Fixed at 80 now:** `@louise-toolkit/astro`, `astroidjs`.
- **Ratchet:** `louise-toolkit` (from 72 and 70), and the three sites from their measured numbers. Client site C gets CI at the same time, because a floor with no CI is a comment.

### 3. The kit closes its gap deliberately, not by the ratchet alone

`louise-toolkit`'s gap is in modules that matter: the Local API, versions, visual editing, and block rendering. Those get tests as tracked work in milestone 4, because the Local API is what the MCP server exposes and its tests are the MCP server's tests too. The ratchet stops the number falling in the meantime; it isn't the plan for raising it.

### 4. The sites' numbers rise as the burn-down lands

Writing tests for site code that epic #481 is about to pull into the kit or delete is wasted work. The sites hold their measured floor, and the number climbs as untested islands and routes leave the site. A site that crosses 80 pins there like the kit.

## Consequences

- **`test` scripts run with coverage** in every repository, so the local command and the CI step measure the same thing. Coverage adds a few seconds to each run.
- **`coverage/` is gitignored**, and `json-summary` is written alongside the terminal summary for tooling.
- **A PR that raises coverage carries a config change.** `autoUpdate` edits the thresholds in `vitest.config.ts`. That's the point: the new floor is reviewed with the tests that earned it.
- **Two-config sites measure the unit config only.** Client sites A and B run a second vitest config to render `.astro` components. Its numbers aren't merged; the floor is the unit suite's.

## Alternatives considered

- **80% everywhere, today.** Rejected: three sites and the kit would go red at once, and the sites' gap is code the plan of record is removing.
- **80% scoped to `src/lib/**` on the sites.** Rejected: a scoped floor hides the shape of the gap, and the ratchet shows it while still preventing regressions.
- **All four metrics at 80.** Rejected: branch coverage fails first, on code whose branches are error handling, and the fix would be tests that exist to satisfy the metric.
