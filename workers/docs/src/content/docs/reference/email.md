---
title: email
description: "louise-toolkit/email—Cloudflare Email Sending."
sidebar:
  order: 5
---

```ts
import { sendEmail, type EmailSender, type SendEmailInput } from "louise-toolkit/email";
```

A tiny wrapper over the modern **Cloudflare Email Sending** binding
(`env.EMAIL.send({ … }) → { messageId }`). No peers.

:::note[Email Sending, not Email Routing]
This uses the object-form Email Sending API, **not** the legacy
`cloudflare:email` / mimetext path (which routes through Email Routing and can
only deliver to _verified_ destinations). Email Sending delivers to any recipient
once the `from` domain is onboarded—`wrangler email sending enable <domain>`.
:::

## `sendEmail(binding, input, options?)`

```ts
function sendEmail(
  binding: EmailSender | null | undefined,
  input: SendEmailInput,
  options?: SendEmailOptions,
): Promise<SendEmailResult>;

interface SendEmailInput {
  from: string | { email: string; name?: string };
  to: string | string[];
  subject: string;
  html: string;
  text?: string; // derived from `html` when omitted (spam-score hygiene)
  replyTo?: string;
}

interface SendEmailOptions {
  dev?: boolean; // is this a development environment? see below
  simulateWhenUnconfigured?: boolean; // log instead of throwing when no binding
  devLog?: boolean; // print the message BODY in the simulated log
  log?: (message: string) => void; // defaults to console.info
}

interface SendEmailResult {
  messageId?: string; // present only on a real send
  simulated?: boolean; // true when logged rather than delivered
}
```

Sends a transactional email and returns the provider `messageId`. If you omit
`text`, Louise derives a plain-text alternative from `html`. A failure is wrapped
in [`LouiseEmailError`](/reference/errors/) with the original as `cause`.

### No binding: `dev` decides what happens

With no `EMAIL` binding provisioned, a send either **simulates**—logging the
message instead of delivering it—or **throws**. Which one is the point of `dev`.

Pass it. This library runs on Workers, where there is no reliable way to tell a
development environment from production, and it decides two things that matter:
whether an unconfigured send is a convenience or a misconfiguration, and whether
a **credential-bearing body** is printed. A magic-link email _is_ the credential.

If you omit `dev`, the fallback reads `NODE_ENV` and treats absent as
**production**. Forgetting it is therefore safe but pessimistic: an unconfigured
send throws, and the body is withheld from the log.

`getLouiseAuth` passes this for you, derived from the request's own hostname—so
with no `EMAIL` binding on localhost the magic link still prints to the console,
which is the only way to sign in locally.

```ts
// A hand-rolled contact route that should simulate in local dev:
await sendEmail(env.EMAIL, mail, { dev: url.hostname === "localhost" });
```

```ts
import { sendEmail } from "louise-toolkit/email";

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
works—which is exactly what makes `sendEmail` trivial to unit-test with a fake.

```ts
const fake: EmailSender = { send: async () => ({ messageId: "test" }) };
await sendEmail(fake, input); // no network, no mocks
```
