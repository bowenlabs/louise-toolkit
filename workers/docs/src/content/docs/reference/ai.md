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
function generateAltText(runner, image: ArrayBuffer | Uint8Array | number[], opts?: AltTextOptions): Promise<string | null>;
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

interface SeoSuggestion { title: string | null; description: string | null }
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
function semanticSearch(index, runner, namespace, query, opts?): Promise<{ id: number; score: number }[]>;
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
