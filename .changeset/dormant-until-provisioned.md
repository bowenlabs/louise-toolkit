---
"louise-toolkit": minor
"astroidjs": minor
"create-astroid": minor
---

Add the **dormant-until-provisioned** secret convention (#252): a feature whose secrets aren't set up yet should be *off*, not *broken*.

**`louise-toolkit/security` gains `readSecret(source, options?)`** — the mechanism. It returns `null` for every flavour of "not really configured": the binding is absent, the Secrets Store isn't provisioned (a declared-but-unset binding *throws* on `.get()`), the value is empty, or it still holds a placeholder sentinel the caller names. Values are trimmed before the sentinel compare, so whitespace can't smuggle one through. There is no built-in sentinel — the placeholder is the caller's convention, not the package's. `louise-toolkit/auth`'s Turnstile gate, which hand-rolled exactly this read, now sits on it.

**`astroidjs` gains the convention over it**: `ASTROID_SECRET_PLACEHOLDER` (`DUMMY_REPLACE_ME`), `readModuleSecret`, `resolveModuleSecrets`, and `describeModuleStatus`. `resolveModuleSecrets` collapses a module's whole secret set into one `configured` gate plus the list of what's still missing, so a module's `isConfigured()` and its "why not" message come from the same read. Partial provisioning counts as dormant — a half-configured integration fails mid-checkout rather than at boot, which is the failure this exists to prevent. The upshot is that a fresh `npm create astroid` clone builds and runs with zero external accounts, and the scaffold now ships one worked example: Turnstile captcha, seeded with the sentinel secret plus Cloudflare's always-passing test site key, enforcing only once *both* halves are real.

Two type widenings fall out, both `minor` because code that reads these off a `LouiseEnv`/`LouiseAuthEnv` as a binding must now narrow:

- `SESSION_SECRET` is `SecretBinding | string` — `getSessionSecret` reads either shape, so a site picks whichever it provisioned rather than the one Louise happened to name. It also takes an optional `placeholder`, and fails closed on a deployed host when the secret is still one. Without that, a scaffold that seeds placeholders everywhere could reach production signing sessions with a publicly-known constant.
- `TURNSTILE_SECRET` is optional. Captcha was always opt-in; requiring the binding to *declare* it was a type-level lie.

**The modules now actually use it.** The helpers above were the mechanism; on their own they left every module deciding dormancy by hand, which is the drift the convention exists to remove. Each opt-in module now declares its secrets in one place and derives its gate from that declaration:

- **`commerce`** gains `COMMERCE_PROVIDER_SECRETS` — per provider, the API credentials its `louise-toolkit/commerce/*` client needs and the webhook signing secret its receiver verifies with, kept separate because they're provisioned separately (a brand-new integration normally has one and not the other). `resolveCommerceStatus` reads them into a per-provider, per-role gate; `commerceSecretNames` is the flat list. Square requires `SQUARE_LOCATION_ID` alongside the access token deliberately: orders and payments refuse a request without one, so a token alone leaves checkout *broken* rather than dormant. Dormant commerce still serves — the D1 mirror returns whatever it last synced, the webhook receiver answers 503 so the provider retries instead of dropping events, and nothing calls upstream with a placeholder.
- **`email`** gains `resolveMailerStatus` / `resolveMailer`, replacing two ad-hoc `!binding` / `!from` checks. Both halves are required for the same reason: a binding with no sender can't build an envelope, and a sender with no binding has nothing to send through. A placeholder `MAIL_FROM` now counts as unconfigured rather than being handed to the Email API as an envelope. `AstroidMailEnv.MAIL_FROM` widens from `string` to `SecretSource` so a Secrets Store binding works there too.
- **`astroidModuleStatus` / `describeAstroidStatus`** compose every enabled module's gate into one report, and `astroidSecretNames` is the single declaration the scaffold seeds, the `env.d.ts` types, and the runtime gate all read — so they cannot drift.

**Dormant is fine; dormant and silent is not.** `astroid doctor` now reports which modules will run simulated locally and names the unset secrets. It is scoped to secrets read from `.dev.vars`: doctor is a static CLI and can't see runtime bindings, so claiming "email is dormant" would report its own blindness as the project's state. A dormant module is never an error — a fresh scaffold is *expected* to report everything dormant.

`create-astroid` seeds every module secret its config implies into `.env.example` with the sentinel, plus a one-line "where to get this" per provider, and `wrangler.jsonc` lists the names to provision (as comments — a committed file never carries a value, not even a placeholder). The point of seeding rather than omitting: the binding set is *complete*, so each module takes its dormant path deliberately instead of tripping over an undefined binding.

Fixed while wiring this: `queues/scaffold.ts` carried its own copy of each provider's webhook-secret name, so renaming one left the generated receiver reading a binding that no longer existed. It now reads the shared declaration, with a test pinning the two together.

Also adds a vitest suite to `packages/astroid` (it had none), wired into CI and `pnpm test`.
