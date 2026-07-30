---
title: ai
description: "louise-toolkit/ai — best-effort Workers AI editorial assists (alt text, rewrite, SEO) plus embeddings-based semantic search."
sidebar:
  order: 13.5
---

```ts
import { runAi, generateAltText, rewriteText, suggestSeo } from "louise-toolkit/ai";
```

Optional Workers AI editorial assists and semantic search. Every helper
**degrades gracefully**: with no `env.AI` binding, or on any model error, it
returns `null` / `[]` — a save, upload, or publish is never blocked or broken by
AI. The binding is passed in and the model id is a plain string, so the module is
catalog-agnostic. Binding: `AI` (+ `VECTORIZE` for search). No required peers.
See the [AI assists guide](/guide/ai-assists/).

## `aiRunner(env)` — turning generation off

```ts
function aiRunner(env: unknown): AiRunner | undefined;
function aiGenerationDisabled(env: unknown): boolean;
function aiUnavailableReason(env: unknown): "disabled" | "unconfigured";
```

Binding presence is a real switch, and for "this site never uses AI" it is
arguably the right one — nothing to configure, nothing to drift. It stops working
the moment you want to keep the binding and still disable _generation_: an
embeddings-backed search that must keep running while alt-text and SEO
suggestions go quiet, a client whose contract forbids generated copy, or a
temporary kill after a bad model swap.

Set `LOUISE_AI` in your `vars` and redeploy:

```jsonc
{ "vars": { "LOUISE_AI": "off" } }
```

Then wire the accessor through `aiRunner` rather than reading the binding
directly:

```ts
aiRoute({ resolveEditor, ai: aiRunner });
seoFixRoute({ table: pages, resolveEditor, ai: aiRunner });
mediaRoute({ /* … */ altText: aiRunner });
```

Astroid-generated workers do this for you.

All three take `unknown` rather than a typed env. They are passed _as_ a route's
accessor, whose parameter is that route's own `Env` — and a parameter typed
`{ AI?, LOUISE_AI? }` shares no properties with an `EditorRouteEnv`, so
TypeScript rejects the assignment outright. Describing the env precisely would
make the helper unusable in the only position it exists for.

**Three things worth knowing.**

**It cannot turn AI on.** `LOUISE_AI` only ever subtracts — with no binding there
is nothing to enable. That keeps the env var a ceiling rather than a second
source of truth about whether AI works.

**Embeddings are deliberately not gated by it.** Semantic search generates no
content, and folding it in would mean disabling "AI content" silently breaks
search — a consequence nobody predicts from the flag's name, and one that
surfaces as "search returns nothing" long after the flag was flipped. Keep
`vector.ai` on the binding:

```ts
vector: { index: (env) => env.VECTORIZE, ai: (env) => env.AI }
```

A site that genuinely wants everything off can still unprovision the binding.

**`off`, `false`, `0`, `no`, and `disabled` all mean off**, case- and
space-insensitively. There is no matching leniency in the other direction: every
other value (including unset) means on, so no typo can accidentally _disable_ AI
— only spell "off" correctly in more than one way. The failure this avoids is a
kill switch that silently doesn't engage.

Both "off by choice" and "never configured" answer `503`, which the client reads
as "hide the control". The response carries `reason` so the two can be told
apart — right for an unprovisioned binding, where there is nothing to tell the
editor about, and honest for a deliberate opt-out, where the answer is "AI
assists are turned off for this site".

## `runAi(runner, model, inputs, options?)`

```ts
function runAi(
  runner: AiRunner | undefined,
  model: string,
  inputs: Record<string, unknown>,
  options?: Record<string, unknown>,
): Promise<unknown | null>;
```

The low-level call: runs a model best-effort and returns its raw output, or
`null` when `runner` is absent or the call throws (**never throws** — it logs the
cause so it shows in `wrangler tail`). `env.AI` satisfies `AiRunner` structurally
— pass it directly. `AiGatewayOptions` (`{ id, cacheKey?, cacheTtl?, skipCache? }`)
routes a call through [AI Gateway](https://developers.cloudflare.com/ai-gateway/)
for response caching, cost caps, fallbacks, and logging.

## `generateAltText(runner, image, opts?)`

```ts
function generateAltText(
  runner,
  image: ArrayBuffer | Uint8Array | number[],
  opts?: AltTextOptions,
): Promise<string | null>;
```

Generate concise alt text for an image via a vision model
(`DEFAULT_ALT_TEXT_MODEL`). The result is tidied — whitespace-collapsed,
"an image of…" lead-ins stripped, sentence-cased, and capped at
`MAX_ALT_TEXT_LENGTH` (240) chars. `null` when the runner is absent, the model
errors, or it yields no text; the caller keeps its empty-alt fallback.

## `rewriteText(runner, text, opts?)`

```ts
function rewriteText(runner, text: string, opts?: RewriteOptions): Promise<string | null>;

type RewriteMode = "tighten" | "rephrase" | "simplify" | "fix";
```

Rewrite a passage via an instruct model (`DEFAULT_TEXT_MODEL`), transforming it
per `opts.mode` (default `"tighten"`). The reply is stripped of wrapping quotes
and any "Here is the rewrite:" preamble. `REWRITE_MODES` lists the four modes in
menu order (for a toolbar). `null` when the runner is absent, the input is blank,
or the model returns nothing — the caller keeps the original text.

```ts
const tighter = await rewriteText(env.AI, draft, { mode: "tighten" });
```

## `suggestSeo(runner, content, opts?)`

```ts
function suggestSeo(runner, content: string, opts?: SeoOptions): Promise<SeoSuggestion | null>;

interface SeoSuggestion {
  title: string | null;
  description: string | null;
}
```

Suggest an SEO title + meta description from page content, using Workers AI JSON
mode to force a `{ title, description }` object. Fields are length-capped
(`SEO_TITLE_MAX` 60, `SEO_DESCRIPTION_MAX` 155); a missing field becomes `null`,
and a result with neither is `null` overall. `null` when the runner is absent,
the content is blank, or the reply can't be parsed.

## Semantic search (embeddings)

```ts
import { embed, indexContent, semanticSearch, removeContentVector } from "louise-toolkit/ai";

function embed(runner, text, opts?): Promise<number[] | null>;
function indexContent(index, runner, namespace, id, text, opts?): Promise<boolean>;
function semanticSearch(
  index,
  runner,
  namespace,
  query,
  opts?,
): Promise<{ id: number; score: number }[]>;
function removeContentVector(index, namespace, id): Promise<void>;
```

Embeddings + a Cloudflare **Vectorize** index, sitting _alongside_ the keyword
(D1 FTS5) layer: keywords find tokens, embeddings find intent. `embed` turns text
into a dense vector (`DEFAULT_EMBEDDING_MODEL` — 768-dim `bge-base-en-v1.5`;
create the index with matching `--dimensions=768 --metric=cosine`).
`indexContent` embeds and upserts a content row under its `namespace:id`;
`semanticSearch` embeds a query and returns the nearest row ids + scores;
`removeContentVector` drops a row's vector on unpublish/delete. All best-effort:
no binding → `embed`/`search` return `null`/`[]` so the FTS path carries the
query unchanged, never on a write's critical path.

## Types

`AiRunner`, `AiGatewayOptions`, `AltTextOptions`, `RewriteMode`, `RewriteOptions`,
`SeoSuggestion`, `SeoOptions`, `EmbedOptions`, `VectorIndex`, `VectorRecord`,
`VectorMatch`, `IndexContentOptions`, `SemanticSearchOptions`. Constants:
`DEFAULT_ALT_TEXT_MODEL`, `MAX_ALT_TEXT_LENGTH`, `DEFAULT_TEXT_MODEL`,
`REWRITE_MODES`, `SEO_TITLE_MAX`, `SEO_DESCRIPTION_MAX`, `DEFAULT_EMBEDDING_MODEL`.
`contentVectorId` / `parseContentVectorId` compose and recover the vector id.
