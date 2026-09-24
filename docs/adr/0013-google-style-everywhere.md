# ADR 0013: Google developer style for every doc and all prose in code

- **Status:** Accepted (2026-09-24). **Amended 2026-09-24** (see the amendment at the end): the house style became a Vale package that every repository, this one included, consumes.
- **Deciders:** Baylee (solo maintainer)
- **Related:** ADR 0007 (lint toolchain), ADR 0008 (type-aware lint), CLAUDE.md "Documentation style"

## Context

Vale has checked the published Starlight docs against the [Google developer documentation style guide](https://developers.google.com/style) since August, and those docs are clean. Everything else was left out on purpose. CLAUDE.md said source comments were "written for maintainers," so a guide for user-facing prose didn't apply to them.

That reasoning left the repository with two styles:

- **Docs** use `word—word`; **comments** use `word — word`. Nothing enforces either one outside the docs.
- **ADRs, CLAUDE.md, the READMEs, and the CHANGELOGs** aren't linted at all, although they're what a new reader, or a coding agent, reads first.

Three facts undermine the idea that comments aren't user-facing:

1. **JSDoc ships.** `vp pack` emits `.d.ts` files with every JSDoc block, and a consumer's editor shows them on hover. For most people who use `louise-toolkit`, that hover text is the documentation.
2. **Agents read all of it.** A coding agent working in this repository, and the assistant planned for the whole stack, learn the house voice from whatever they read. Two styles teach two voices.
3. **The solo maintainer is the only author.** No contributor workflow depends on the old style, so a rewrite costs time but breaks nothing.

The size of the gap on 2026-09-24, counting Vale error-level findings only:

| Area                                       | Files | Errors |
| ------------------------------------------ | ----- | ------ |
| Starlight docs                             | 40    | 0      |
| ADRs                                       | 12    | 138    |
| Other Markdown (CLAUDE.md, READMEs, plans) | 10    | 59     |
| Changelogs                                 | 3     | 7      |
| Comments: `louise-toolkit`                 | 172   | 1,860  |
| Comments: `@louise-toolkit/astro`          | 7     | 81     |
| Comments: workers                          | 41    | 166    |
| Comments: tests and tooling                | 115   | 336    |

Most of the comment findings are one rule, `Google.EmDash`: the spaced dash the comments were written with.

## Decision

### 1. One style, everywhere

The Google developer documentation style guide applies to every doc and all prose in code:

- the Starlight docs, ADRs, CLAUDE.md, READMEs, changesets, and CHANGELOGs
- code comments and JSDoc, in source, tests, and tooling
- user-facing strings: error messages, editor and studio UI copy, and email templates

Comments move to `word—word`, like the docs. The split style ends.

The bar is Vale's **error** level, the same bar the Starlight docs already meet. Warnings and suggestions, such as `Google.Passive` and `Google.Parens`, are advice for the writer, not a gate.

Two Google rules stay off, each with its reason in `.vale.ini`: `LyHyphens`, which misreads "supply-chain," and `Quotes`, which would put a period inside a quoted literal value.

### 2. A small house style on top of Google

`vale/styles/Louise` holds what Google's rules can't know about this stack. It starts with one rule, `Louise.Names`, which checks product and tool names such as `daisyUI`, `GitHub`, and `TypeScript`. It also has a vocabulary, `vale/styles/config/vocabularies/Louise/accept.txt`, for names that aren't dictionary words.

The house style is committed, unlike the Google package, which `vale sync` still fetches. The same rule as `.ast-grep/rules/` applies: keep the set small, and give every rule a comment that explains why it exists. Other repositories in the stack consume it as a Vale package. Publishing that package is a follow-up.

### 3. A per-file ratchet enforces the rollout

Turning on 2,647 findings as a hard gate would block every PR until the whole rewrite landed. Leaving them ungated would let the count grow during the rewrite. `scripts/ci/checks/vale-ratchet.mjs` does neither:

- `vale/baseline.json` records each file's error count. A file that isn't listed has a baseline of zero, so every new file, and every file already clean, is held to zero.
- The check fails when a file **gains** findings, and it lists the new ones.
- The check also fails when a file **loses** findings until the baseline records it (`corepack pnpm run lint:docs -- --update`). Otherwise, the headroom could be spent on a new finding later.
- `--update` only ever lowers counts. It refuses to record a regression.

`lint:docs` runs the ratchet, so the CI job and the local command stay the same. When every file reaches zero, the baseline is empty, and the ratchet is a plain Vale gate.

### 4. A style-only rewrite isn't an amendment

The rule that an ADR which stops being true gets amended covers **substance**. Rewriting an ADR for style changes its wording, not its decision, so it needs no amendment. A style rewrite must not change a decision, a date, or a status line. Anything that does is a change of substance and gets an amendment, as before.

### 5. User-facing strings come next

Vale lints comments, not string literals. A follow-up adds a check that extracts user-facing strings, such as `LouiseError` messages, `json({ error })` bodies, and JSX text, and lints them as prose. Until then, the rule applies to them, but nothing enforces it.

## Consequences

- **Large diffs, in one direction.** The rewrite touches most source files, but only comments and docs. Reviewing it means checking that no code changed, which a diff filtered to comment lines makes quick.
- **Fenced code samples stay exempt.** A reader copies them verbatim, so they aren't prose.
- **Tests aren't exempt.** A test's comment explains behavior to the next reader, the same as a source comment.
- **The ratchet adds one file to keep current.** A PR that fixes findings also lowers `vale/baseline.json`. The check says so when it's needed.

## Alternatives considered

- **Keep the split.** Rejected: JSDoc is published documentation, and two voices teach agents two voices.
- **A lighter style for comments.** Rejected: a second style is the same split with extra configuration.
- **Rewrite everything first, then turn on the gate.** Rejected: the rewrite takes several PRs, and without a gate the count can grow between them.

## Amendment (2026-09-24, publishing the house package)

Decision 2 left publishing the house style as a follow-up. It's done, and the shape differs from what decision 2 describes.

**The house style is now a complete Vale package in `vale/package/`.** The package carries more than the `Louise` style. Its own `.vale.ini` holds every shared choice from this ADR: the error-level bar, the two Google rules that stay off, frontmatter handling, and turning `Google.Spacing` off for code files. `vale sync` reads a package's `.vale.ini` before the repository's own, so a consuming repository's `.vale.ini` only sets `StylesPath` and names the packages.

**This repository consumes its own package.** Its `.vale.ini` names `vale/package` by path; every other repository names the release asset by URL. Both read the same files, so a rule can't drift between the repository that defines it and the ones that use it. `vale sync` copies both packages into the gitignored `.vale/`, and `vale/styles/` is gone.

**Releases are pinned tags.** Pushing a `vale-v<semver>` tag runs `.github/workflows/vale-package.yml`. It builds `Louise.zip` with `scripts/vale-package.sh`, checks that the zip works as a package, and attaches it to a release. Consuming repositories pin the tag in their URL, for the same reason the Google package is pinned: a rule change should reach a repository in a commit that repository makes, not overnight.
