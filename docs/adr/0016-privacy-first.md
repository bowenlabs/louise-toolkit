# ADR 0016: Privacy-first, as an enforced rule

- **Status:** Proposed (2026-09-26)
- **Deciders:** Baylee (solo maintainer)
- **Related:** ADR 0012 (API boundary), ADR 0015 (two audiences), ADR 0017 (client accounts and access), ADR 0004 (edge caching), the platform plan in louise-ops

## Context

Louise already makes several privacy-preserving choices, but they're scattered, and none is written down as a rule:

- Owners sign in with magic links and passkeys, so the kit stores no password for them. Two customer portals on client sites still use passwords.
- Analytics runs on Analytics Engine, first-party, and the reference site's cookie banner is a notice rather than a consent gate because nothing non-essential is stored.
- The README claims published pages ship no editor JavaScript, and nothing in CI checks it.
- Each client site runs in the client's own Cloudflare account, so its data is the client's. That's an accident of history as much as a decision (ADR 0017 makes it one).
- ADR 0012 keeps the owner's session in an HttpOnly cookie and confines bearer tokens to non-browser callers.

The platform plan adds surfaces that handle more personal data: tickets and feedback from owners, incident capture with request context, an operator dashboard across sites, alerts to Discord, and error reporting to Sentry. Each one is a place where a customer's email body, a form submission, or a request payload could leave the client's account without anyone deciding it should. The rule has to exist before those surfaces do.

## Decision

### 1. Client data stays in the client's account

Content, media, settings, form submissions, tickets, ticket messages, incidents, and analytics live in the site's own D1, R2, KV, and Analytics Engine, in the client's Cloudflare account. Nothing copies them to a Bowen Labs system as a matter of course.

louise-ops receives only what it needs to act on: a ticket's ID, subject, status, site, and timestamps; an incident's fingerprint, kind, path, and release. A ticket body or a message is fetched from the site on demand, over the site's own route with a per-site token, and isn't stored. A form submission never leaves the site.

### 2. No third-party scripts on public pages, and no editor JavaScript either

A published page loads scripts only from its own origin. The editor client, the owner bar, and the sign-in page load nothing from a third party; fonts are inlined and icons are inline SVG.

Two checks enforce this in CI:

- **No editor JavaScript on a public page.** A build-time check renders the reference site's public pages and fails if any `louise-toolkit/client` chunk is referenced. This is the README claim that nothing verified.
- **An allowlist of external hosts.** Each site declares the hosts its public pages may load from (a payment provider's SDK, for example). A new host fails CI until it's added with a reason.

Turnstile is Cloudflare's script, served from a Cloudflare host, and it stays opt-in per site. It's allowed on the sign-in page and on public forms when a site passes a site key, and never anywhere else.

### 3. First-party analytics only

Analytics Engine is the only analytics sink. No site adds a third-party analytics or tag script, and the kit provides no hook for one. The cookie notice stays a notice; the day a site stores something non-essential, that site needs a consent gate, and this ADR gets an amendment.

### 4. Data minimization in auth

Owners sign in with magic links and passkeys. `getLouiseAuth` drops password sign-in for customers too, in a `minor` changeset, so a site running the kit's auth stores no password hash for anyone. Sessions stay at 45 days rolling. Each site pins its passkey relying-party ID to its apex.

### 5. Each site says what it stores

Every site publishes a plain-language "what this site stores about you" page, generated from its settings and the modules it has turned on: the session cookie, the edit-mode cookie, form submissions and who reads them, order data and which provider holds it, and the analytics counts. It's a site fact, so it's a parameter, and it updates when the site's configuration does.

### 6. Owners can export and delete

An owner can export their site: content, media, settings, tickets, and the auth tables, as files they can keep. Export ships first, because it's also the handoff artifact when a client leaves. Deletion is a request the owner makes through the same surface, and the site's runbook says how it's carried out.

### 7. Vendors get a line each

Every third party that receives anything from a site or from louise-ops is listed here with what reaches it and why. The list is amended, never silently extended.

| Vendor                              | What reaches it                                                                                                                                      | Why                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Cloudflare                          | Everything, as the hosting platform, in the client's own account                                                                                     | The platform                                                                |
| Sentry (opt-in per site, astroidjs) | An incident's fingerprint, stack trace, release, and path; `sendDefaultPii` off; request bodies and headers scrubbed; no browser SDK on public pages | Error triage with stack traces and release tracking                         |
| Snyk                                | Repository source and dependency manifests                                                                                                           | Dependency and code scanning on pull requests                               |
| Discord (Bowen Labs' server)        | A site name, a ticket ID and subject, an incident fingerprint, a probe status                                                                        | Alerts to Baylee; never a ticket body, a customer name, or an email address |
| GitHub                              | Repository source; an issue title and a ticket ID when a ticket becomes engineering work                                                             | Source control and engineering work                                         |

Cloudflare's own products used from a Worker (Workers AI, Images, Email Service, Browser Rendering) run inside the client's account and don't appear as vendors.

## Consequences

- **Two new CI checks** in the reference site's build, and the same checks in astroidjs's scaffold so every site inherits them.
- **The support module and incident capture are designed around rule 1.** Ticket bodies stay in the site; louise-ops stores metadata and fetches the rest.
- **A Sentry sink is an astroidjs opt-in**, never in the zero-dependency core, and it ships with PII off and scrubbing on. A site that wants more sends more, knowingly.
- **The comparison page and the owner docs state the rule** in one paragraph each, in plain words.
- **Some convenience is declined.** No session replay, no third-party chat widget, no marketing pixels. A site that needs one of those is asking for a different platform.

## Alternatives considered

- **A privacy policy without enforcement.** Rejected: the README already made a claim nothing checked. A rule that CI doesn't hold is a hope.
- **Centralize tickets and incidents in louise-ops for convenience.** Rejected: it moves a customer's words into a Bowen Labs database by default, and a leak there is a leak across every client at once.
- **Sentry as the system of record for errors.** Rejected: the site's D1 keeps the incident row and Sentry gets a scrubbed copy, so an owner's data doesn't depend on a vendor's retention.
