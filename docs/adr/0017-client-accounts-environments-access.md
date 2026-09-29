# ADR 0017: Client accounts, environments, access, and one runtime

- **Status:** Proposed (2026-09-26). **Amended 2026-09-26** (see _Amendment_ below): staging runs on Worker Previews instead of a second Worker, releases are trunk-based with a tag as the release, and Workers Builds deploys production from a branch only the release tag moves. **Amended again 2026-09-26** (see _Amendment: native clients_ below): native apps are Tauri 2 shells, per ADR 0020. **Amended 2026-09-29** (see _Amendment (2026-09-29): who publishes a client's native app_ below): which Apple Developer account and Firebase project publish a client's app is recorded as open, to settle before the first app ships.
- **Deciders:** Baylee (solo maintainer)
- **Related:** ADR 0006 (zero-dependency core), ADR 0014 (coverage floor), ADR 0016 (privacy-first), #521 (branch pushes deploy production), the per-site staging issues, the platform plan in louise-ops

## Context

Each client site already runs in its owner's Cloudflare account, with Baylee as a member, and the BowenLabs account holds only the toolkit's reference site, the sandbox, and louise-ops. That layout came from one client's cutover, whose notes record that D1, R2, KV, Queues, and the Secrets Store can't move between accounts, so an account is chosen once. It was never written down as the model, and the details vary: one site's `wrangler.jsonc` pins no account ID, roles were granted ad hoc, and there's no step that reduces them after handoff.

Every site deploys through Workers Builds, and every push to any branch deploys production (#521). Only one site uploads versions for branches. That blocks two things the platform plan needs: Watchtower dispatching an agent to fix a site, and the Action's `agent:fix` tier, because a bot's branch would go live before anyone reviewed it.

Scaling to more clients raises three questions: whether to consolidate under Workers for Platforms, what access Baylee holds before and after handoff, and whether any new service should be written in another language. Baylee offered Go, Rust, Java, and Python.

## Decision

### 1. One Cloudflare account per client, owned by the client

Every client site lives in a Cloudflare account the client owns. The BowenLabs account holds only shared services: the toolkit's reference site and sandbox, louise-ops, and Watchtower. Every `wrangler.jsonc` pins its `account_id`, and a provisioning checklist in louise-ops (`docs/PROVISIONING.md`) turns the cutover notes into a forward procedure: account, zone, DNSSEC, Workers Builds, the Secrets Store, D1, KV, R2, Queues, Email Service, Access for staging, and the billing owner.

Workers for Platforms is declined. It runs tenants' code in a dispatch namespace inside one account, which would put every client's billing and data ownership in BowenLabs and turn handoff into a migration. Past roughly 20 sites, revisit through Cloudflare's tenant API for creating sub-accounts, not through dispatch namespaces.

### 2. Three environments, and branches never deploy production

Every site has local (dev), staging, and production. Staging is one `env.staging` Worker per site with its own D1, KV, R2, and queues, sandbox payment credentials, seeded data (never a production copy), and it hosts every PR preview. Branches upload versions, `main` deploys staging, and a tag or a manual promote deploys production. Once two sites have the shape, astroidjs generates it.

### 3. Access: unrestricted during the build, least privilege after handoff

Checked against the Cloudflare docs on 2026-09-26: only a Super Administrator can manage members, billing, and account-owned API tokens; a member can hold several roles; account-owned API tokens (the `cfat_` prefix) are generally available and act as service principals independent of any person. With one account and one zone per client, account-level roles are enough.

**Build phase, from account creation to handoff.** Baylee creates the client's account and is its Super Administrator from day one. She adds the Workers Paid plan and other subscriptions, provisions every resource, onboards Email Sending, connects Workers Builds with her own GitHub identity (the repository lives in the bowenlabs GitHub organization until the contract's handoff terms say otherwise), and sets up Access for staging. During the build, not at the end, two things happen: the client is invited as a second Super Administrator as soon as they have an email to invite, and the client sets the billing profile to their own payment method before the first paid subscription renews. Every account-level action is dated in the site's runbook.

**Handoff, the "reduce roles" step.** The client confirms they can sign in as Super Administrator. Baylee creates the Watchtower token (below), then changes her own membership to the operate-phase roles. Baylee is never the only Super Administrator past handoff, and the last one is never removed.

**Operate phase, Baylee as a member.** Read-only by default: `Administrator Read Only`, `Audit Logs Viewer`, and `Analytics`. Deploys go through git and Workers Builds, so a fix needs no dashboard write. On the Supported service tier, Baylee keeps `Workers Platform Admin` so a hotfix secret or a rollback doesn't wait on the client. On the other tiers the client re-adds it for a named change and removes it after, and the runbook logs both.

**Operate phase, a service account for Watchtower.** One account-owned API token per site, created before the reduce-roles step and stored as a secret on the louise-ops Worker; afterward only the client can rotate or revoke it. Its permissions are read-only: `Workers Scripts Read`, `Workers CI Read` (build and deploy status), `D1 Read` (pending migrations), `Account Analytics Read`, `Zone Read`, `SSL and Certificates Read` (certificate expiry), and `Zone DNS Read`. Not `Workers Tail Read`, because a tail exposes request data. The token has an expiry date, and Watchtower shows the days remaining. Uptime and TLS probes need no token and stay outside-in.

**What isn't a Cloudflare credential.** The ticket write-back and the incident ingest use per-site bearer tokens against the site's own routes, hashed in the site's D1 and revocable from the Users panel. `agent:fix` needs no Cloudflare access: it pushes a branch, and Workers Builds deploys it to staging.

### 4. One runtime: TypeScript on Workers, and Swift for the iOS app

Every service in the stack (the kit, the adapter, the sites, louise-ops, Watchtower, the ticket mirror) is TypeScript on Workers. The reasons: they share types, the zero-dependency core (ADR 0006), one CI shape, one Vale style pipeline (ADR 0013), one coverage floor (ADR 0014), and one knowledge base with a code map. A second language doubles all of that, and every service here is I/O-bound glue over D1, Queues, and HTTP, where a faster language buys nothing.

The languages considered, and where each would earn its keep:

- **Rust** runs on Workers through WebAssembly, but adds a build toolchain and gives no benefit for glue. Worth it only for a CPU-bound job the platform doesn't have.
- **Go** isn't a fit for services (it reaches Workers only through TinyGo, with weak support). As a single static binary for one-shot work it fits well: provisioning an account from the checklist, scaffolding a site from templates, running the handoff and readiness checks, exporting a site. That's parked until the provisioning checklist exists to automate. The boundary: astroidjs regenerates `src/schema.ts`, `src/worker.ts`, and `src/middleware.ts` on every build from the typed config, so that generator stays TypeScript, and a Go command-line tool would call it rather than replace it.
- **Java** isn't a Workers target. It would need a virtual machine or a container outside the client's account, which breaks rule 1 and ADR 0016.
- **Python** Workers run on Pyodide, still in beta, with slow cold starts and limited packages. No service here needs the Python ecosystem; Workers AI handles the model calls.
- **Revisit** when a CPU-heavy job appears that Workers AI, Images, and Browser Rendering can't cover. Then use Cloudflare Containers in the same account, in whichever language fits, behind a Worker that keeps the public interface in TypeScript.
- **Swift** is required for the iOS app: passkeys through Associated Domains, push notifications, and App Store distribution all need a native shell. The app stays a thin client over the site's owner routes.

## Amendment (2026-09-26): Worker Previews, trunk-based releases, and the deploy pointer

Decision 2 was written before Cloudflare's Worker Previews, which changes how
staging is built, and before the release model was settled. What decision 2
promised stays: branches never deploy production, staging has its own data,
and production deploys only on a deliberate step. How it's done changes.

### Staging is Worker Previews, not an `env.staging` Worker

A Preview is an isolated environment for a branch under the same Worker, with
the variables, secrets, and bindings in the `previews` block of
`wrangler.jsonc`. Cloudflare now recommends Previews over both earlier options
for branch testing: a Version URL runs against production's resources, and a
Wrangler environment is a second Worker with its own Workers Builds project and
a binding list mirrored by hand.

- **One `previews` block per site** binds a staging D1, KV, and R2, each
  provisioned once, and staging secrets set once in the Previews Base
  configuration (sandbox payment keys, a test Turnstile key). Every branch
  Preview shares that staging data. Durable Objects get a namespace per Preview
  on their own.
- **Left out on purpose:** queue producers, because a queue consumer can't
  target a Preview and the toolkit falls back to inline work when the binding
  is absent; Workflows, because a Preview would call production's; and Cron
  Triggers, which target production only.
- **Hosts:** a preview-only custom domain, `staging.<domain>`
  (`previews_enabled: true`, `enabled: false`). The `main` branch's Preview,
  `main.staging.<domain>`, is staging; every other branch gets
  `<branch>.staging.<domain>`. One Cloudflare Access application covers
  `*.staging.<domain>` and the workers.dev Preview URLs.
- **Anything that differs by environment is runtime configuration.** Workers
  Builds runs one build command for production and Previews, so the build can't
  know which it is. Astroid's generated Worker reads the media base from
  `env.MEDIA_URL` per request, and a Preview serves media from a path on its own
  host.
- **`astroid doctor` checks the block:** a binding production has and the block
  leaves out, a binding pointed at a production resource, a var that isn't
  restated, and crons, routes, or queue consumers inside it.

### Releases are trunk-based, and the tag is the release

The model is Google's trunk-based development (_Software Engineering at
Google_, chapters 16 and 24, and the release engineering chapter of _Site
Reliability Engineering_), with Release Flow's branch names:

- **`main` is the trunk,** changed only through pull requests. Work happens on
  short-lived `feature/<issue>-<name>` and `bugfix/<issue>-<name>` branches.
  Unfinished work merges behind a flag rather than living on a long branch.
- **A release is a tag, `v<version>`, on a commit of `main`** that's been
  checked on staging. There's no release branch per release.
- **A release branch, `release/<version>`, is cut only when a released version
  needs a fix and `main` already holds work that isn't ready.** The fix lands
  on `main` first and is cherry-picked into the release branch, which is tagged
  with the next patch version. A release branch never merges back.
- **No branch exists for an environment,** with the one machine-owned exception
  below.

### Workers Builds deploys production from a pointer that only the tag moves

Workers Builds deploys only on a branch push; it can't watch tags. So each
site's Workers Builds project uses `deploy/production` as its production
branch, and a release workflow that runs on a `v*` tag moves that branch to the
tagged commit and creates a GitHub release. A repository ruleset lets only that
workflow update the branch, and nobody commits to it: it's a tag carried as a
branch. Every other branch, `main` included, is a Preview build.

That keeps decision 3's rule that deploys go through git and Workers Builds,
and GitHub holds no Cloudflare credential. Production and staging build the
same way, in one place.

### Open: who Workers Builds deploys as after handoff

Workers Builds deploys with a user API token; account-owned tokens aren't
supported there yet. On a client site that token is Baylee's, and it can do no
more than her membership allows. The operate phase in decision 3 reduces her to
read-only roles by default, which would stop both staging and production
deploys on that site. Until Cloudflare supports account-owned tokens in Workers
Builds, one of these has to hold, and the choice isn't made yet:

- Baylee keeps a Workers write role, such as `Workers Platform Admin`, on every
  tier.
- The client reconnects Workers Builds under their own identity at handoff.

Revisit when account-owned tokens reach Workers Builds; then the token moves to
the account and neither is needed.

### Sites before launch run staging only

A site that hasn't launched has no production host: its top-level `routes`
hold only the preview-only staging domain, so a production deploy serves
nothing public. Its first `v*` tag, once it has a production host, is its
launch.

### Alternatives considered in this amendment

- **An `env.staging` Worker.** Rejected: a second Worker and Workers Builds
  project per site, a binding list mirrored by hand, and one shared Preview
  for every pull request instead of one each.
- **A tag deploys through GitHub Actions with a Cloudflare API token.**
  Followed Release Flow to the letter, and rejected: a token per client account
  that expires and that only the client can rotate after handoff, so a lapsed
  one silently blocks releases, and two build systems per site.
- **A release branch per release.** Rejected: small, frequent releases with one
  maintainer make it ceremony. A branch appears only when a patch needs one.

## Amendment (2026-09-26): native clients

Decision 4 still holds for services: every service is TypeScript on Workers.
Its Swift exception for the iOS app's shell widens to native clients in
general. Native apps are Tauri 2 shells around a Solid UI, so Rust, Swift, and
Kotlin appear in native clients, and only there. Their capability plugins live
in `bowenlabs/louise-toolkit-native`. [ADR 0020](0020-tauri-native-plugins.md)
records the decision. Whether the iOS owner app moves to the Tauri shell is
open there, pending a check that passkeys through Associated Domains work
inside its WebView.

## Amendment (2026-09-29): who publishes a client's native app

### Open: which Apple Developer account and Firebase project publish a client's app

A native app ships from an Apple Developer account and, on Android, a Firebase project for push. Decision 1 settles who owns a client's Cloudflare account; nothing here settles who owns these. It matters for privacy as well as ownership: an APNs key signs sends for every app on its team, and ADR 0016's push amendments keep push keys in the client's Cloudflare account only when the team and the Firebase project publish that client's apps alone. The choice isn't made yet, and it has to be before the first app ships:

- The client enrolls their own Apple Developer account and owns a Firebase project, with Baylee as a member, the same as their Cloudflare account. The app lists under the business's name, and handoff is a role change.
- The apps ship from a Bowen Labs team. Push keys then can't sit in any client's account, so sending needs its own design, and ADR 0016 needs another amendment.

## Consequences

- **Handoff is a role change, not a migration.** The client already owns the account, the zone, and the data.
- **The kit changes nothing at runtime** for this ADR. louise-ops gains a site registry with the token's expiry and the roles Baylee holds, and Watchtower shows both.
- **The provisioning checklist names exact roles**, because the dashboard's role list is long and `Administrator` (which can change subscriptions) is the tempting wrong pick for the operate phase.
- **Staging is a prerequisite** for Watchtower dispatch and for the Action's fix tier on a site. Neither runs on a site without it.
- **Every site pins its passkey relying-party ID to its apex** now, because the iOS app needs Associated Domains on the same ID later.

## Alternatives considered

- **Workers for Platforms.** Rejected for the reasons in decision 1.
- **A BowenLabs-owned account per client.** Rejected: billing and data ownership would sit with Bowen Labs, and handoff would be a migration.
- **Least privilege during the build too.** Rejected on 2026-09-26: Baylee creates the account and buys the plans, which needs Super Administrator, and a build-time restriction would only slow provisioning.
- **A user API token for Watchtower.** Rejected: it dies with the member, and it inherits whatever roles the member holds. An account-owned token is scoped on its own and survives the reduce-roles step.
- **A second language for any service.** Rejected for now, per decision 4.
