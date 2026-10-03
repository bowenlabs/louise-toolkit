# ADR 0024: Subscription plans snapshot (one KV key, one writer, many readers)

- **Status:** Lives in astroidjs
- **Lives at:** [bowenlabs/astroidjs → docs/adr/0024](https://github.com/bowenlabs/astroidjs/blob/main/docs/adr/0024-subscription-plans-snapshot.md)

This ADR governs the subscription plans snapshot in astroidjs's
`packages/astroid/src/commerce/subscription-plans.ts`. It reads plans through
`listSubscriptionPlans` in `louise-toolkit/commerce/square`, and its fallbacks
report to incident capture (ADR 0022).

**This file is a pointer, kept on purpose.** ADR numbers are shared with
astroidjs, so a new decision in either repository takes the next number free in
**both**. This file reserves 0024 here, so the next ADR written in this
repository doesn't take it. See the
[index there](https://github.com/bowenlabs/astroidjs/blob/main/docs/adr/README.md).
