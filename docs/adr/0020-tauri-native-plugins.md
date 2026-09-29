# ADR 0020: Native apps use Tauri 2, with in-house plugins in `louise-toolkit-native`

- **Status:** Proposed (2026-09-26). **Amended 2026-09-28** (see _Amendment (2026-09-28, WebView proof of concept)_ below): Apple Pay in the WebView is a candidate first path from iOS 16, pending one sandbox payment on a physical iPhone and the Android WebView setup, so `tauri-plugin-louise-square` could follow a first release rather than gate it; a shell that loads a remote URL raises the App Review 4.2 risk and can't work offline through a service worker; and a capability grants native access to a whole origin, so the app that holds it needs its own.
- **Deciders:** Baylee (solo maintainer)
- **Related:** ADR 0017 (decision 4, one runtime), ADR 0016 (privacy-first), ADR 0013 (Google style), ADR 0006 (zero-dependency core), [bowenlabs/louise-toolkit-native](https://github.com/bowenlabs/louise-toolkit-native), [bowenlabs/astroidjs#79](https://github.com/bowenlabs/astroidjs/issues/79) (the mobile target)

## Context

A native mobile app is the end goal for a café site's ordering: its web order app is the first client of a JSON API, and a native app later reuses that API. The timing is open, but the stack for it isn't. The sites' UI is Solid, React is off the table, and Solid has no production-ready native renderer. The realistic Solid route is a native shell around the web UI with native plugins for what the web can't do: remote push, native payments, and deep links.

Two shells fit. Capacitor has official Solid templates, an official push plugin, and the more mature mobile ecosystem. Tauri 2 wraps the same WebView (WKWebView on iOS, the Android System WebView) around a Rust core, builds desktop apps from the same code, and puts every native capability behind an explicit permission. Baylee chose Tauri 2 and wants the plugins written in-house.

What exists today in Tauri 2's ecosystem shapes the plugin list:

- **Push.** The official notification plugin sends local notifications only. Remote push (APNs and FCM) exists only as community plugins.
- **Payments.** Neither Tauri nor Square ships a Tauri plugin for Square's In-App Payments SDK.
- **Updates.** Tauri's updater is desktop-only, so mobile releases go through the app stores.

ADR 0017's decision 4 keeps every service on TypeScript and Workers, and names Swift as the one exception, for the iOS owner app's native shell. It doesn't cover a Rust core or Kotlin.

## Decision

### 1. Tauri 2 is the native shell

Every native app the stack ships is a Tauri 2 app around a Solid UI. Services stay TypeScript on Workers, as ADR 0017 decides; this ADR extends its decision 4 to native clients only. Rust, Swift, and Kotlin appear only in Tauri plugins and in an app's generated `src-tauri/`, never in a Worker.

Whether the iOS owner app from ADR 0017 moves to the same shell is left open (see _Open questions_).

### 2. Plugins live in their own repository, `louise-toolkit-native`

The capability plugins any Tauri app could use (push, payments) live in [bowenlabs/louise-toolkit-native](https://github.com/bowenlabs/louise-toolkit-native), a public repository beside this one. They're unopinionated, like the toolkit. `astroidjs` holds the opinions: a mobile target that decides which plugins an app gets and generates its `src-tauri/`.

Dependencies still flow one way. `astroidjs` depends on `louise-toolkit` and `louise-toolkit-native`; `louise-toolkit-native` depends at most on the published `louise-toolkit` package, and `louise-toolkit` depends on neither.

The repository is a Cargo workspace. Each plugin keeps the layout that `tauri plugin new --ios --android` generates, with its Swift and Kotlin inside its own folder:

```text
louise-toolkit-native/
  Cargo.toml                        # the workspace
  tauri-plugin-louise-push/
    src/                            # Rust: commands, permissions, the mobile bridge
    ios/                            # Swift package
    android/                        # Kotlin library
    guest-js/                       # TypeScript bindings for the UI
    permissions/
  tauri-plugin-louise-square/       # bridge to Square's In-App Payments SDK
```

A plugin holds no site facts. The APNs topic, the FCM project, the Square application ID, and the location are parameters its host app passes in, never constants.

### 3. The first plugins, in order

1. **Push** (`tauri-plugin-louise-push`): register with APNs and FCM, return the device token, and deliver received notifications to the UI. It's the smallest of the three, and it proves the whole path from Rust to Swift and Kotlin to TypeScript.
2. **Square payments** (`tauri-plugin-louise-square`): wrap the In-App Payments SDK's card entry, Apple Pay, and Google Pay, and return the single-use payment token. The plugin never sees card numbers; it passes the SDK's token to the UI, which sends it to the same checkout route the web client uses.
3. **Deep links:** Tauri's official deep-link plugin comes first. An in-house one is written only if it falls short.

Nothing is built until the first native app starts.

### 4. Names

The crates are `tauri-plugin-louise-<name>`, and the TypeScript bindings are `@louise-toolkit/tauri-<name>`. Only the npm scope carries `louise-toolkit`; the brand tokens stay `louise`.

### 5. CI and release, in the new repository

- **CI:** `cargo fmt --check`, `cargo clippy`, and `cargo test` on Linux, the Android build on Linux, and the iOS build on a macOS runner, because only Xcode builds against the iOS SDK. Standard runners, macOS included, are free for a public repository.
- **Release:** each plugin's crate and its `guest-js` package share one version, published to crates.io and npm in one release.
- **House rules carry over:** Google style and the Vale ratchet for prose (ADR 0013), no client site names, and no site facts in plugin code. The repository gets its own `CLAUDE.md` listing its checks.

### 6. Privacy

A device token is personal data under ADR 0016. The push plugin hands it to the host app and stores nothing itself. The app sends it only to its own site's API, which keeps it in the site's own database, in the client's own account.

## Open questions

- **The iOS owner app.** ADR 0017 plans a Swift shell for passkeys through Associated Domains and push. Tauri configures entitlements, but WebAuthn inside a WKWebView with Associated Domains has to be verified before the owner app moves to Tauri.
- **Apple App Review guideline 4.2** (minimum functionality) rejects a thin wrapper around a website. Push, Apple Pay, and working offline mitigate it, and the first submission is the test.
- **Apple Pay in the WebView.** The Square plugin uses the native SDK, so this matters only as a fallback.

## Amendment (2026-09-28, WebView proof of concept)

On 2026-09-28, a proof of concept for a café site's order app ran a Tauri 2 shell on the iOS 26.4 simulator, as a reference for the mobile target in [astroidjs#79](https://github.com/bowenlabs/astroidjs/issues/79). The shell doesn't bundle the UI. It bundles one start page, then loads the live order app over HTTPS, so the web app and the native app share one codebase and one deploy. None of this overturns the preceding decision. It answers part of two open questions and changes what a first release needs.

### What the proof of concept measured

Everything here ran on the simulator. The proof of concept made no payment, and it didn't test Android.

- **Apple Pay reported as available in the WebView.** With Tauri's scripts injected, `ApplePaySession.canMakePayments()` returned `true` on an HTTPS page. iOS 13 through 15 turned Apple Pay off in any WKWebView whose app injected scripts, and WebKit removed that rule in Safari 16 ([commit aa041a623c](https://github.com/WebKit/WebKit/commit/aa041a623c)). Tauri injects its own scripts into the pages it loads, so a shell that relies on Apple Pay in the WebView needs iOS 16 or later. Availability isn't a payment: a sandbox payment on a physical iPhone is still untested.
- **A capability matches a remote page by origin, never by path.** A grant for the order app's path on the site's host never matched, and a grant for the host covers every page on it. A plugin's permission granted to a remote site therefore reaches every page that site's origin serves, including CMS-edited pages when they share the host.
- **The service worker API is absent.** `navigator.serviceWorker` is undefined in the app's WKWebView, which doesn't use App-Bound Domains. The proof of concept didn't try App-Bound Domains, which could enable it.

Android wasn't measured, but its setup is documented: Google Pay in the Android System WebView needs the app to turn on the Payment Request API, declare the payment intents in its manifest, and get approval in Google's Pay & Wallet Console ([Chrome's guide](https://developer.chrome.com/docs/android/payments-in-webviews)).

### What changes

- **Apple Pay in the WebView** is a candidate first path, not only a fallback. Decision 3 has `tauri-plugin-louise-square` wrap Apple Pay and Google Pay through the In-App Payments SDK. A shell that loads the site can take the same payments through the Web Payments SDK the web client already uses. If one sandbox payment on a physical iPhone succeeds, and the Android WebView setup above passes, a first release can ship with the web checkout, and the Square plugin becomes an upgrade rather than a prerequisite. Until both pass, decision 3 stands as written.
- **App Review guideline 4.2** is a higher risk for a shell that loads a remote URL, since that's the thin wrapper around a website the guideline targets. Working offline, one of the mitigations the open question lists, can't come from a service worker in such a shell. It has to come from the bundled start page, from App-Bound Domains, or from bundling the UI. Push and Apple Pay carry more of the weight, and the first submission is still the test.
- **A plugin's permission goes to the app's own origin.** Because a grant covers a whole host, the mobile target grants plugin permissions only to an origin that serves the app alone, such as `app.example.com`, never to one shared with the rest of a site. The proof of concept doesn't meet this rule: it loaded the order app from the site's staging host, because the order app's separate origin doesn't exist yet.

The passkeys question for the iOS owner app stays open: the proof of concept didn't test WebAuthn.

## Consequences

- **This repository doesn't change.** Its CI, checks, and release stay TypeScript-only, and a contributor here needs no Rust, Xcode, or Android SDK.
- **A second repository to maintain:** its CI, Renovate configuration, and `CLAUDE.md`.
- **Every plugin is maintained in-house,** on Tauri's and the platforms' release cycles: iOS and Android SDK updates, Tauri 2 minor versions, and Square SDK updates.
- **Desktop comes along.** A staff app, such as an order board at the bar, builds from the same Solid UI and plugins.
- **ADR 0017's decision 4 is amended** to point here.

## Alternatives considered

- **Capacitor with SolidJS.** A more mature mobile ecosystem and an official push plugin. Rejected in favor of Tauri 2, which also builds desktop apps and keeps the native layer in Rust.
- **Community Tauri plugins.** Several push plugins exist. Rejected: push and payments sit on the path of personal data and money, and an in-house plugin is one that can be read, tested, and kept current.
- **A `native/` Cargo workspace inside this repository.** Rejected: the plugins share almost nothing with the toolkit's code (a payment token is a string), their toolchains and release cadence differ entirely, and every check here would have to learn about Rust, Swift, and Kotlin.
- **Top-level `/swift` and `/kotlin` directories.** Possible, because a plugin's `build.rs` can point `ios_path` and `android_path` anywhere. Rejected: it splits one plugin across three trees and fights the layout the Tauri CLI and every example use.
- **Plugins in `astroidjs`.** Rejected: a push or payments capability carries no opinion about how a site is built, so it belongs in the unopinionated layer.
- **React Native or Flutter.** Ruled out: the stack doesn't use React, and Flutter's Dart shares no code with the TypeScript stack.
