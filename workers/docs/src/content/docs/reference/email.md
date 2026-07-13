---
title: email
description: "louise/email — Cloudflare Email Sending."
sidebar:
  order: 5
---

```ts
import { sendEmail, type EmailSender, type SendEmailInput } from "louise/email";
```

A tiny wrapper over the modern **Cloudflare Email Sending** binding
(`env.EMAIL.send({ … }) → { messageId }`). No peers.

:::note[Email Sending, not Email Routing]
This uses the object-form Email Sending API, **not** the legacy
`cloudflare:email` / mimetext path (which routes through Email Routing and can
only deliver to _verified_ destinations). Email Sending delivers to any recipient
once the `from` domain is onboarded — `wrangler email sending enable <domain>`.
:::

## `sendEmail(binding, input)`

```ts
function sendEmail(binding: EmailSender, input: SendEmailInput): Promise<{ messageId: string }>;

interface SendEmailInput {
  from: string | { email: string; name?: string };
  to: string | string[];
  subject: string;
  html: string;
  text?: string; // derived from `html` when omitted (spam-score hygiene)
  replyTo?: string;
}
```

Sends a transactional email and returns the provider `messageId`. If you omit
`text`, Louise derives a plain-text alternative from `html`. A failure is wrapped
in [`LouiseEmailError`](/reference/errors/) with the original as `cause`.

```ts
import { sendEmail } from "louise/email";

await sendEmail(env.EMAIL, {
  from: { email: "studio@example.com", name: "The Studio" },
  to: "collector@example.com",
  subject: "Your commission is ready",
  html: "<p>It's finished — come take a look.</p>",
});
```

## `EmailSender`

The binding shape Louise expects, kept local so the module doesn't pin a specific
`@cloudflare/workers-types` version. Any object with a matching `send` method
works — which is exactly what makes `sendEmail` trivial to unit-test with a fake.

```ts
const fake: EmailSender = { send: async () => ({ messageId: "test" }) };
await sendEmail(fake, input); // no network, no mocks
```
