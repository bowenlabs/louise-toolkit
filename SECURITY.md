# Security policy

## Supported versions

Louise Toolkit is **pre-1.0**. Only the latest published version of each package
receives fixes; there are no backports to earlier minors.

| package                 | supported         |
| ----------------------- | ----------------- |
| `louise-toolkit`        | latest minor only |
| `@louise-toolkit/astro` | latest minor only |

Pre-1.0 means a breaking change ships as a **minor**, so a security fix may
arrive alongside one. Read the changelog before upgrading.

`astroidjs` and `create-astroid` are released from
[bowenlabs/astroidjs](https://github.com/bowenlabs/astroidjs) and have their own
policy.

## Reporting a vulnerability

Please report privately rather than opening a public issue:
**[Report a vulnerability](https://github.com/bowenlabs/louise-toolkit/security/advisories/new)**.

Include what you need to make it reproducible—affected version, a minimal case,
and what an attacker gets. You'll get an acknowledgement within a few days. This
is a small project with a single maintainer, so please allow reasonable time
before disclosing publicly.

## What's in scope

The published packages: the library, its Astro adapter, and the Worker routes and
editor client they ship. Concretely, the sharp edges are worth naming, because
they're where a real issue is most likely to be:

- **The editor write path.** Anything that lets an unauthenticated request reach a
  draft, a publish, or a settings write.
- **Rich text.** `sanitizeRichHtml` is what stands between editor input and a
  rendered page. A bypass is a stored XSS.
- **Auth and sessions.** Magic links, session cookies, the editor gate, and the
  rate limiter in front of them.
- **Media.** Upload handling and anything that turns a user-supplied key into a
  URL or a fetch.

Out of scope: the marketing site, the docs site, the sandbox, findings that
require a compromised Cloudflare account or an already-authenticated editor
acting within their own permissions, and dependency advisories with no reachable
call path (see below).

## How dependency advisories are handled

`pnpm audit --prod` must stay clean; CI fails the build if it doesn't. Dev-only
advisories are fixed when a fix exists; when one doesn't, it's recorded rather
than ignored.

Fixes go in `pnpm-workspace.yaml` under `overrides`, **scoped to the affected
major** (`js-yaml@4`, `brace-expansion@1`). A bare package-name key overrides
every dependent regardless of the range it asked for, which has broken this repo
once: an unscoped `js-yaml` pin handed a 4.x to a package that requires `^3.6.1`
and calls `yaml.safeLoad`, taking out every `changeset` command until it was
caught. Each entry carries the advisory id and the reasoning.

### Accepted, unfixable

- **`extract-zip` ≤2.0.1 — [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv)**,
  unvalidated symlink path traversal. The advisory names 2.0.2 as the fix; **no
  such version has been published**, so there is nothing to upgrade to. It
  reaches the tree only through `@cloudflare/puppeteer`, which is an _optional_
  peer dependency loaded by dynamic import for OG-image rendering — so it is
  absent unless a consumer opts in, and `extract-zip` itself runs at browser-
  download time, not at Worker runtime. Revisit if a 2.0.2 ships.
