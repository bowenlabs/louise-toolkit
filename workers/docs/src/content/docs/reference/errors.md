---
title: errors
description: "louise-toolkit/errors—LouiseError, its typed subclasses, reportDegraded for a fallback that fired, and loggableError for a caught error you log."
sidebar:
  order: 7
---

```ts
import { LouiseError, LouiseValidationError } from "louise-toolkit/errors";
```

Every Louise primitive throws `LouiseError` or a typed subclass—never a raw
`Error`. No peers. (These are also re-exported from the modules that throw them,
for example, `LouiseEmailError` from `/email`.)

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
    console.error(e.code, e.cause); // for example, "EMAIL_ERROR"
  } else {
    throw e; // re-throw the unexpected
  }
}
```

## Subclasses

| Class                | `code`          | Thrown by                         |
| -------------------- | --------------- | --------------------------------- |
| `LouiseAuthError`    | `AUTH_ERROR`    | auth primitives                   |
| `LouiseDbError`      | `DB_ERROR`      | db primitives                     |
| `LouiseStorageError` | `STORAGE_ERROR` | storage primitives                |
| `LouiseCacheError`   | `CACHE_ERROR`   | cache primitives                  |
| `LouiseEmailError`   | `EMAIL_ERROR`   | [`/email`](/reference/email/)     |
| `LouiseSessionError` | `SESSION_ERROR` | session primitives                |
| `LouiseQueueError`   | `QUEUE_ERROR`   | [`/queues`](/reference/queues/)   |
| `LouiseContentError` | `CONTENT_ERROR` | [`/content`](/reference/content/) |

Two content subclasses carry extra structure so a routing layer can map them by
`instanceof` instead of matching message text:

- **`LouiseAccessDeniedError`** (extends `LouiseContentError`) → map to **403**.
- **`LouiseValidationError`** (extends `LouiseContentError`) → map to **422**; carries
  `violations: ValidationViolation[]` (each `{ path, message, severity }`). Only
  `"error"`-severity violations are ever thrown; warnings are returned.

One db subclass names what's wrong:

- **`LouisePendingMigrationsError`** (extends `LouiseDbError`)—the database
  hasn't applied migrations the running code needs. `files` lists them, in apply
  order. Thrown by `assertMigrationsApplied` ([`/db`](/reference/db/)).

And for HTTP clients:

- **`LouiseApiError`**—carries `status: number` and the parsed `body`, so
  callers branch on `status` (403 → denied, 404 → not found) instead of
  re-parsing `{ error }` bodies.

```ts
import { LouiseValidationError } from "louise-toolkit/errors";

try {
  await api.create(doc, ctx);
} catch (e) {
  if (e instanceof LouiseValidationError) {
    return Response.json({ violations: e.violations }, { status: 422 });
  }
  throw e;
}
```

## `reportDegraded(name, cause?, details?)`

```ts
function reportDegraded(name: string, cause?: unknown, details?: DegradedDetails): void;
```

Reports that a fallback fired: the code caught a failure and served something
lesser, such as seed or stale content, an empty result, or a skipped side
effect, rather than failing the request. Degrading beats crashing, but a
degrade is quiet by design. A page that falls back to seed content still
answers 200, so without a report nothing notices until a person looks.

It logs exactly one line at error level, in a fixed shape:

```text
[louise] degraded <name>: <cause> <details as JSON>
```

```text
[louise] degraded commerce.products: UpstreamError: Fourthwall GET /products 401: bad token {"source":"seed"}
```

- **`name`** says which fallback fired. Keep it stable and dotted, area first
  (`content.read`, `commerce.products`), so one search finds every occurrence
  across deploys.
- **`cause`** is whatever the `catch` caught: an `Error` logs as
  `Name: message`, and anything else as its string form. An `UpstreamError`
  logs the way `upstreamLogLine` ([`/security`](/reference/security/)) formats
  it, with the operation and what the provider said. A failed query's error
  from drizzle-orm logs its statement's kind and table and the database's own
  error, never the SQL or the bound values its message carries:
  `DrizzleQueryError: Failed query: insert into inquiries. Cause: D1_ERROR: UNIQUE constraint failed: inquiries.email`.
  The line stays one line, and a long message is cut at 500 characters.
- **`details`** is optional, small, JSON-serializable context, such as an ID, a
  count, or a status. It's logged, so never put a secret, a token, or personal
  data in it, including a visitor's IP address.

It returns nothing and **never throws**, whatever `cause` and `details` hold: a
string, `undefined`, a circular object, or an object whose getters throw. A
reporter that threw would turn a graceful degrade into the crash it was written
to avoid.

Call it in every `catch` that serves seed or stale content, and in every
best-effort `catch` that swallows an error:

```ts
import { reportDegraded } from "louise-toolkit/errors";

let products: Product[];
try {
  products = await listProducts(env);
} catch (err) {
  reportDegraded("commerce.products", err, { source: "seed" });
  products = seedProducts;
}
```

Search a log stream for `[louise] degraded` to see every fallback, or for
`[louise] degraded commerce.` to see one area. In `wrangler tail`, add
`--search "[louise] degraded"`. `DEGRADED_LOG_PREFIX` exports the prefix.

### `onDegraded(listener)`

```ts
function onDegraded(listener: (event: DegradedEvent) => void): () => void;

interface DegradedEvent {
  readonly name: string;
  readonly message: string; // the cause as one line of text
  readonly cause: unknown; // the original cause, as passed
  readonly details: DegradedDetails | undefined;
}
```

Listens for every `reportDegraded` call in the isolate, for example, to forward
degrades to an error tracker or count them in a metric. It returns a function
that removes the listener. Listeners run synchronously after the log line, and
a listener that throws is ignored. Register one at module scope rather than per
request, because the listener set lives as long as the isolate. Louise's own
incident capture is meant to hook in here, so your `reportDegraded` calls don't
need to change when it does.

### Where the toolkit reports

The toolkit's own fallbacks call `reportDegraded` with these names:

| Name                                         | Fallback                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `security.rateLimit`                         | A KV, native, or Durable Object rate limiter failed open                 |
| `security.readSecret`                        | A declared secret binding threw on read, so the feature behind it is off |
| `auth.captcha-unavailable`                   | `resolveCaptcha` found a real site key with no readable secret           |
| `forms.turnstile`                            | Siteverify was unreachable, so the submission was refused                |
| `forms.notify.webhook`, `forms.notify.email` | A submission notification failed                                         |
| `editor.pages.afterWrite`                    | The pages route's `afterWrite` hook threw                                |
| `editor.overview`                            | A dashboard slice threw and was left out (`details.slice` names it)      |
| `editor.search`                              | The editor search failed and answered no results                         |
| `editor.draftBuffer`                         | A buffered draft didn't parse, so resume fell back to the D1 draft       |
| `editor.submissions`                         | A stored submission didn't parse and was listed empty                    |
| `health.summary`                             | The stored health summary didn't parse, so the card is hidden            |
| `worker.resolveEditor`                       | `resolveEditor` threw, so the request was treated as signed out          |
| `worker.healing`                             | A `withHealing` rule served its `fallback`                               |
| `worker.kvCache.read`, `.write`, `.bust`     | `kvCached` or `kvBust` couldn't reach KV                                 |
| `ai.run`                                     | A Workers AI call failed, so the assist returned `null`                  |
| `ai.truncated`                               | A model's answer hit its output token cap, so the assist returned `null` |
| `ai.vectors.upsert`, `.delete`, `.query`     | A Vectorize call failed, so indexing or semantic search was skipped      |
| `analytics.vitals`                           | A Core Web Vitals data point wasn't written                              |
| `media.imageProxy`                           | The image proxy couldn't resize and fell back                            |
| `realtime.persist`                           | A realtime session's `persist` failed and is retried on the next alarm   |
| `commerce.fourthwall.product`                | `getProduct` returned `null` for a reason other than a 404               |
| `commerce.square.paymentLink`                | `retrievePaymentLink` returned `null` for a reason other than a 404      |

## `loggableError(value)`

```ts
function loggableError(value: unknown): unknown;
```

Returns a value that's safe to pass to `console.error`. Starting with its
0.44 release, drizzle-orm's `DrizzleQueryError` puts a failed query's SQL and bound values in
its message and its stack, and the bound values are often personal data, such
as a name, an address, or a note. `loggableError` returns a copy of such an
error, or of an error with one anywhere in its `cause` chain, with each query
error reduced the way `reportDegraded` reduces it. The copy keeps the stack
frames and each error's own string and number fields, such as `code`. When it
can't tell whether part of the error holds a value, it leaves that part out.
A string that quotes a failed query comes back reduced. Anything else comes
back as it was, so it costs nothing to call on every caught error.

```ts
try {
  await saveInquiry(db, form);
} catch (err) {
  console.error("[site] inquiry save failed", loggableError(err));
  return new Response("Something went wrong. Try again.", { status: 500 });
}
```

The toolkit already calls it where it logs an error itself, and
`composeWorker` re-throws a failed query's error as this copy. Call it where
your own code logs a caught error.
