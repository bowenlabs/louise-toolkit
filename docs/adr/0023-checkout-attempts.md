# ADR 0023: Checkout attempts (a payment key without prices, and settled outcomes in KV)

- **Status:** Lives in astroidjs
- **Lives at:** [bowenlabs/astroidjs → docs/adr/0023](https://github.com/bowenlabs/astroidjs/blob/main/docs/adr/0023-checkout-attempts.md)

This ADR governs the checkout key and attempt records in astroidjs's
`packages/astroid/src/commerce`. Its client half, `checkoutSession`, lives here in
`louise-toolkit/commerce`.

**This file is a pointer, kept on purpose.** ADR numbers are shared with
astroidjs, so a new decision in either repository takes the next number free in
**both**. This file reserves 0023 here, so the next ADR written in this
repository doesn't take it. See the
[index there](https://github.com/bowenlabs/astroidjs/blob/main/docs/adr/README.md).
