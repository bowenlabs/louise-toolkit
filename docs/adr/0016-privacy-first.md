# ADR 0016: Privacy-first, as an enforced rule

- **Status:** Proposed (2026-09-26). **Amended 2026-09-29** (see _Amendment (2026-09-29, push for native apps)_ below): Apple Push Notification service and Firebase Cloud Messaging join the vendor list, for native apps only; a notification carries a reference, a status, and at most one line of text, never personal details; a device token stays in the site's D1 only as long as its purpose; and iOS notifications go to Apple directly, never through Google. **Amended again 2026-09-29** (see _Amendment (2026-09-29, push consent and credentials)_ below): the rules hold for any native app, whatever its shell; the Android app creates no Firebase token or installation ID before the person allows notifications; a site holds push keys only when they publish that client's apps alone; the Android app deletes its FCM token whenever the site deletes its copy; and no notification carries a message's text. **Amended 2026-10-02** (see _Amendment (2026-10-02, customer sign-in by link)_ below): dropping customer passwords ships first as an opt-in, `customers.signIn: "magic-link"`, and becomes the default in a later `minor` once every site that runs customer accounts on the kit has switched.
- **Deciders:** Baylee (solo maintainer)
- **Related:** ADR 0012 (API boundary), ADR 0015 (two audiences), ADR 0017 (client accounts and access), ADR 0004 (edge caching), ADR 0020 (native apps), the platform plan in louise-ops

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

Owners sign in with magic links and passkeys. `getLouiseAuth` drops password sign-in for customers too, in a `minor` changeset, so a site running the kit's auth stores no password hash for anyone. Sessions stay at 45 days rolling. Each site pins its passkey relying-party ID to its apex. (Amended 2026-10-02: the drop ships as an opt-in first; see _Amendment (2026-10-02, customer sign-in by link)_.)

### 5. Each site says what it stores

Every site publishes a plain-language "what this site stores about you" page, generated from its settings and the modules it has turned on: the session cookie, the edit-mode cookie, form submissions and who reads them, order data and which provider holds it, and the analytics counts. It's a site fact, so it's a parameter, and it updates when the site's configuration does.

### 6. Owners can export and delete

An owner can export their site: content, media, settings, tickets, and the auth tables, as files they can keep. Export ships first, because it's also the handoff artifact when a client leaves. Deletion is a request the owner makes through the same surface, and the site's runbook says how it's carried out.

### 7. Vendors get a line each

Every third party that receives anything from a site or from louise-ops is listed here with what reaches it and why. The list is amended, never silently extended.

| Vendor                                                                        | What reaches it                                                                                                                                                                                                                       | Why                                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Cloudflare                                                                    | Everything, as the hosting platform, in the client's own account                                                                                                                                                                      | The platform                                                                   |
| Sentry (opt-in per site, astroidjs)                                           | An incident's fingerprint, stack trace, release, and path; `sendDefaultPii` off; request bodies and headers scrubbed; no browser SDK on public pages                                                                                  | Error triage with stack traces and release tracking                            |
| Snyk                                                                          | Repository source and dependency manifests                                                                                                                                                                                            | Dependency and code scanning on pull requests                                  |
| Discord (Bowen Labs' server)                                                  | A site name, a ticket ID and subject, an incident fingerprint, a probe status                                                                                                                                                         | Alerts to Baylee; never a ticket body, a customer name, or an email address    |
| GitHub                                                                        | Repository source; an issue title and a ticket ID when a ticket becomes engineering work                                                                                                                                              | Source control and engineering work                                            |
| Apple Push Notification service, APNs (iOS apps only, amended 2026-09-29)     | A device token, the app's bundle ID, and each notification's payload: a reference, a status, and at most one line of text, never a name, contact detail, item, amount, or message text                                                | Push notifications to iOS devices, which reach an iOS device only through APNs |
| Firebase Cloud Messaging, FCM, Google (Android apps only, amended 2026-09-29) | After the person allows notifications, and not before: a registration token, the Firebase installation ID that the messaging SDK creates on the device, the Firebase project ID, and each notification's payload, limited as for APNs | Push notifications to Android devices                                          |

Cloudflare's own products used from a Worker (Workers AI, Images, Email Service, Browser Rendering) run inside the client's account and don't appear as vendors.

## Amendment (2026-09-29, push for native apps)

ADR 0020 makes remote push the first in-house plugin, `tauri-plugin-louise-push`, for notifications such as a café site's order app sending "order ready." A native app can't receive a remote notification any other way: iOS delivers them only through Apple Push Notification service (APNs), and Android through Firebase Cloud Messaging (FCM). Both services receive the device token and every notification a site sends, so decision 7 gains a row for each. None of this ships before the push plugin does. It covers every native app on the stack, such as a café's order app now and the iOS owner app that ADR 0017 plans; the web apps keep polling.

### What reaches each service

- **Apple, for iOS:** the device token, the app's bundle ID, and each notification's payload. The site's Worker sends each notification to APNs itself, authenticated with the site's APNs key. An iOS device keeps its own connection to APNs whether or not an app uses push, so the app adds the token and the payloads to what Apple already has, and nothing else.
- **Google, for Android:** the registration token, the Firebase project ID, and each notification's payload. The site's Worker sends each notification through the FCM HTTP v1 API, authenticated with the site's service account. On the device, the Firebase Cloud Messaging SDK creates a Firebase installation ID and sends it to Google to issue the token. The app includes that SDK and no other Firebase product: no Analytics, which decision 3 rules out, and no Crashlytics or Remote Config, which decision 7 doesn't list.

iOS notifications never go through FCM, even though FCM can deliver to iOS: that would put Google in the path of every iOS notification as well as Apple. A Worker can reach APNs directly. Its `fetch` speaks HTTP/1.1, and Cloudflare's edge speaks the HTTP/2 that APNs requires. That works on a deployed Worker but not in local `wrangler dev` on macOS ([cloudflare/workerd#4841](https://github.com/cloudflare/workerd/issues/4841)), so test APNs sends on a Preview.

### Rules for push

1. **A notification carries a reference and a status, not the record.** Its payload holds the record's short reference, its status, and at most one line of text: for an order, "Your order is ready"; for an owner's ticket, "New reply on a ticket." It never holds a person's name, email address, or phone number, an order's items or amount, or a message's text. The text shows on a locked screen and passes through Apple's or Google's servers, so it says only what's safe for anyone holding the phone to read.
2. **Tokens stay in the client's account.** The app's push code stores no token on the device beyond what the operating system and, on Android, the Firebase messaging SDK keep, and it sends its token only to its own site's API, which keeps it in the site's D1. For a Tauri app, that code is `tauri-plugin-louise-push` (ADR 0020 decision 6). louise-ops never receives a token, as decision 1 requires. (Amended 2026-09-29; see _Amendment (2026-09-29, push consent and credentials)_.)
3. **A token lasts as long as its purpose.** A token registered for one order's status is deleted when that order is picked up or canceled, or after 24 hours, whichever comes first. A token tied to a signed-in person, customer or owner, is deleted when they sign out, turn notifications off, or delete their account. A token that APNs or FCM reports as no longer valid is deleted on that response. Whenever the site deletes a token, the Android app also deletes its FCM token. (Amended 2026-09-29; see _Amendment (2026-09-29, push consent and credentials)_.)
4. **The credentials are the site's secrets, when they reach that client's apps alone.** The APNs key and the FCM service account key are stored as secrets in the client's Cloudflare account, never in code or in louise-ops, and only when the Apple Developer team and the Firebase project publish that client's apps and no one else's. Which account and project publish a client's app isn't decided yet; ADR 0017 records it as open, to settle before the first app ships. (Amended 2026-09-29; see _Amendment (2026-09-29, push consent and credentials)_.)
5. **The app asks for permission when it's useful.** It asks for notification permission only when there's something to be notified about, such as right after an order is placed, never at first launch. The system's prompt is the person's choice, and someone who declines still sees the status by polling.
6. **The site says so.** The page that decision 5 requires names push: that the site stores a device token, what for, how long, and that Apple or Google delivers each notification.

Decision 2 doesn't change. The Firebase SDK ships in the Android app, not on a public page, so it's not a script that the external-host allowlist covers.

## Amendment (2026-09-29, push consent and credentials)

A review of the preceding amendment, after it merged, found five gaps. This amendment closes them. It changes rules 2, 3, and 4, each marked where it stands, and the APNs and FCM rows in decision 7. Rules 1, 5, and 6 don't change.

### The rules hold for any native app

The preceding amendment scoped push to the native apps on the stack and leaned on `tauri-plugin-louise-push` in rule 2. ADR 0020 leaves open whether the iOS owner app moves to Tauri, and a Swift app wouldn't use that plugin. So the rules for push bind every native app, whatever its shell. For a Tauri app, the plugin is how it meets them; a Swift app meets them in its own code. Rule 2 now says so: the app's push code stores no token on the device beyond what the operating system and, on Android, the Firebase messaging SDK keep, and it sends its token only to its own site's API.

### No Firebase identifier before the person says yes

By default, the Firebase Cloud Messaging SDK creates a Firebase installation ID and a registration token when the app starts, which is before rule 5's permission prompt. Google would hear from every Android install, including from people who never allow notifications. Decision 3 allows nothing non-essential without a consent gate, and push is non-essential.

- **The Android app turns off messaging auto-init** in its manifest, so the SDK creates no installation ID and requests no token at start.
- **It turns auto-init on, and asks for a token, only after the person allows notifications** at the system prompt. That prompt is the consent gate decision 3 asks for.
- **An iOS app registers with APNs only after the person allows notifications**, the same way, so no token exists before then.

The FCM row in decision 7 now says so.

### No message text reaches either service

Rule 1 bars a message's text from a notification, but the APNs and FCM rows in decision 7 left it out of their exclusions. Both rows now exclude it, as rule 1 does.

### Deleting a token also deletes it at Google

Rule 3 deletes a token from the site's D1, which doesn't reach Google's copy. So the Android app deletes its FCM token, which revokes it at Google, whenever the site deletes its copy:

- **When the app causes the deletion,** because the person signs out, turns notifications off, or deletes their account in the app, it deletes its FCM token at the same time.
- **When the site deletes the token itself,** because an order was picked up or canceled, 24 hours passed, the service reported the token invalid, or the person deleted their account on the web, the app deletes its FCM token the next time it opens. On each launch it asks its site's API whether the site still holds its token, and deletes the FCM token when the answer is no. It requests a new one only when there's something new to be notified about.

On iOS, deleting the site's copy is enough while rule 4 holds: an APNs token delivers nothing without the key that signs each send, and under rule 4 only the site holds that key. Apple advises against unregistering from APNs outside rare cases, so the app doesn't. If the open question in ADR 0017 ends with a team that publishes more than one client's apps, this reasoning needs another look.

### A site holds push keys only when they reach that client's apps alone

An APNs key signs sends for every app on its Apple Developer team, and an FCM service account key for every app in its Firebase project. Rule 4 puts those keys in the client's Cloudflare account, which is right only when the team and the project publish that client's apps and no one else's. Otherwise, one client's account would hold a key that pushes to another client's app, which undoes decision 1 here and ADR 0017's decision 1.

So rule 4 holds only on that condition. Who publishes a client's app is still open; ADR 0017 records it. If the answer is a team that publishes more than one client's apps, its keys stay out of every client's account, and sending needs a design, and an amendment here, before the first app ships.

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

## Amendment (2026-10-02, customer sign-in by link)

Decision 4 had `getLouiseAuth` drop customer passwords in one `minor`. Sites already run customer accounts with passwords, and flipping every one of them in a single release would move each site's sign-in page, emails, and stored data at once. So the drop happens in two steps.

1. **Opt-in now.** `customers.signIn: "magic-link"` turns email and password off for an instance and signs customers in with a one-time link by email. The link verifies the address, so an account made that way never holds an unverified email either. `"password"` stays the default.
2. **The default flips later.** Once every site that runs customer accounts on the kit has switched, a later `minor` makes `"magic-link"` the default and removes the password path. That changeset says what a site that still uses passwords must do.

A site that switches keeps the password hashes its customers already made, in the `account` table's rows with `providerId = 'credential'`. They no longer sign anyone in. Until the site deletes those rows, it still stores a hash for those people, so decision 4's goal holds for that site only after it does. The auth reference says how.

An endpoint that mails any address is a new surface. Better Auth's own rate limiter guards it by default, as it guards every instance off `localhost` (ADR 0012's 2026-10-02 amendment says why). The other guards are the site's to turn on: Turnstile with real keys, a Durable Object for that limiter to count in, and `waitUntil` so the response time doesn't show whether an address has an account.
