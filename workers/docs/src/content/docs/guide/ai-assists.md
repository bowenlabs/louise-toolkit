---
title: AI editorial assists
description: Optional Workers AI helpers—alt text on upload, rewrite, and SEO suggestions—with AI Gateway for caching, cost caps, and fallbacks.
sidebar:
  order: 12
---

`louise-toolkit/ai` adds optional [Workers AI](https://developers.cloudflare.com/workers-ai/)
editorial help: **alt text** generated from an uploaded image, **rewrite/tighten**
a passage, and **SEO** title + description suggestions. Everything is **opt-in**
and **best-effort**—with no `AI` binding, or on any model error, the helpers
return `null` and never block a save, upload, or publish.

## Wiring

Add the binding, then opt each feature in.

```jsonc
// wrangler.jsonc
"ai": { "binding": "AI" }
```

**Alt text on upload**—an accessor on the media route fills each new image's
`alt` from the image:

```ts
mediaRoute({ table: media, resolveEditor, altText: (env) => env.AI });
```

**Rewrite + SEO**—mount `aiRoute` for the editor client to call:

```ts
aiRoute({ resolveEditor, ai: (env) => env.AI });
//  POST /api/louise/ai/rewrite  { text, mode? }  → { text }
//  POST /api/louise/ai/seo      { content }       → { title, description }
```

Both are session-gated, same-origin mutations (each call spends AI budget), and
answer `503` when the binding is absent—so the assist is cleanly optional.

## Cost

Workers AI is billed in **Neurons** with a **10,000/day free allocation**, then
`$0.011` per 1,000 Neurons. In practice each assist is a fraction of a cent
(alt text ≈ `$0.0002–0.0004`/image; rewrite/SEO ≈ `$0.0002–0.0004`/call), and the
first few hundred actions each day are free.

## AI Gateway—caching, cost caps, fallbacks

Route the calls through [AI Gateway](https://developers.cloudflare.com/ai-gateway/)
for **response caching** (identical prompts are free on repeat), **rate limiting**
(bound request volume and spend), **retries + provider fallback**, and **request
logging/analytics**—all configured on the gateway, transparent to your code.

1. Create a gateway in the Cloudflare dashboard (**AI → AI Gateway → Create
   Gateway**) and note its **id**. Set caching, rate limits, and fallback there.
2. Pass the gateway config through—per feature:

```ts
// alt text: options flow through the media route
mediaRoute({
  table: media,
  resolveEditor,
  altText: (env) => env.AI,
  altTextOptions: { gateway: { id: "louise-gw", cacheTtl: 86400 } },
});

// rewrite + SEO: a gateway accessor on the route
aiRoute({
  resolveEditor,
  ai: (env) => env.AI,
  gateway: (env) => ({ id: "louise-gw" }),
});
```

Gateway caching already keys on the full request (model + inputs), so identical
calls dedupe automatically. Set `cacheKey` only to deliberately widen a cache
entry (for example, a content hash) across incidental request variance; `cacheTtl: 0`
disables caching for a call, and `skipCache: true` forces a fresh run.

Omit `gateway` and calls go straight to Workers AI—the gateway is purely
additive.

## Troubleshooting

The assists are best-effort, so a failing model doesn't throw. The helper returns
`null` and the route answers `502` (`"Rewrite unavailable"` or
`"Suggestion unavailable"`). A `503` means something else: no runner, because
the binding is absent or generation is turned off.

When an assist starts answering `502`:

1. **Check `wrangler tail`.** [`runAi`](/reference/ai/#runairunner-model-inputs-options)
   logs the underlying error before it returns `null`: a retired model, an unmet
   JSON schema, or a quota.
2. **Check the model ID against the [Workers AI model
   catalog](https://developers.cloudflare.com/workers-ai/models/).** Cloudflare
   deprecates models on a schedule, and a retired model fails every call. If
   rewrite and SEO both fail, suspect the shared text model rather than one
   feature. The helpers take a per-call `model` option, so you can pin a
   current one.

If you call `runAi` yourself with JSON mode (`response_format` of type
`json_schema`), read the result as an object: Workers AI returns the parsed
JSON under `response`, not a string. Code that expects text gets nothing back
from a structured call.
