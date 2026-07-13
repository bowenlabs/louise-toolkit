---
title: errors
description: "louise/errors — LouiseError and its typed subclasses."
sidebar:
  order: 7
---

```ts
import { LouiseError, LouiseValidationError } from "louise/errors";
```

Every Louise primitive throws `LouiseError` or a typed subclass — never a raw
`Error`. No peers. (These are also re-exported from the modules that throw them,
e.g. `LouiseEmailError` from `/email`.)

## `LouiseError`

```ts
class LouiseError extends Error {
  readonly code: string;
  readonly cause?: unknown;
  constructor(message: string, code: string, cause?: unknown);
}
```

The base class. `code` identifies which primitive threw; `cause` carries the
original error. In V8/workerd, the stack trace is captured via
`Error.captureStackTrace` (feature-detected).

```ts
try {
  await sendEmail(env.EMAIL, input);
} catch (e) {
  if (e instanceof LouiseError) {
    console.error(e.code, e.cause); // e.g. "EMAIL_ERROR"
  } else {
    throw e; // re-throw the unexpected
  }
}
```

## Subclasses

| Class                | `code`          | Thrown by                       |
| -------------------- | --------------- | ------------------------------- |
| `LouiseAuthError`    | `AUTH_ERROR`    | auth primitives                 |
| `LouiseDbError`      | `DB_ERROR`      | db primitives                   |
| `LouiseStorageError` | `STORAGE_ERROR` | storage primitives              |
| `LouiseCacheError`   | `CACHE_ERROR`   | cache primitives                |
| `LouiseEmailError`   | `EMAIL_ERROR`   | [`/email`](/reference/email/)   |
| `LouiseSessionError` | `SESSION_ERROR` | session primitives              |
| `LouiseQueueError`   | `QUEUE_ERROR`   | [`/queues`](/reference/queues/) |
| `LouiseCmsError`     | `CMS_ERROR`     | [`/cms`](/reference/cms/)       |

Two CMS subclasses carry extra structure so a routing layer can map them by
`instanceof` instead of matching message text:

- **`LouiseAccessDeniedError`** (extends `LouiseCmsError`) → map to **403**.
- **`LouiseValidationError`** (extends `LouiseCmsError`) → map to **422**; carries
  `violations: ValidationViolation[]` (each `{ path, message, severity }`). Only
  `"error"`-severity violations are ever thrown; warnings are returned.

And for HTTP clients:

- **`LouiseApiError`** — carries `status: number` and the parsed `body`, so
  callers branch on `status` (403 → denied, 404 → not found) instead of
  re-parsing `{ error }` bodies.

```ts
import { LouiseValidationError } from "louise/errors";

try {
  await api.create(doc, ctx);
} catch (e) {
  if (e instanceof LouiseValidationError) {
    return Response.json({ violations: e.violations }, { status: 422 });
  }
  throw e;
}
```
