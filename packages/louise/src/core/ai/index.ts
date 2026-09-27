// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/ai—optional Workers AI editorial assists (#75).
//
// A minimal, model-catalog-agnostic runner contract plus best-effort helpers that
// DEGRADE GRACEFULLY: given no binding (or on any model error) they return `null`,
// so a save / upload / publish is never blocked or broken by AI. The binding
// (`env.AI`) is passed in, and the module takes the model id as a string—it has
// no opinion on which models exist, so it isn't pinned to a `@cloudflare/workers-types`
// model catalog. That keeps the door open for routing `run` through AI Gateway
// later (#87) without touching callers.

import { reportDegraded } from "../degraded.js";
import { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from "../seo/limits.js";

/** The one capability these helpers need from a Workers AI binding: `run(model,
 *  inputs)`. `env.AI` satisfies this structurally—pass it directly. Hand-defined
 *  (rather than importing the workers-types `Ai` generic) so the module stays
 *  catalog-agnostic; a test double is just `{ run }`. */
export interface AiRunner {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
}

/** The env members the generation kill switch reads. Structural, so a caller's
 *  own `CloudflareEnv` satisfies it without importing anything. */
export interface AiEnv {
  AI?: AiRunner;
  /** Deploy-time kill switch for AI **generation**. See {@link aiRunner}. */
  LOUISE_AI?: string;
}

/**
 * Values that mean "off", matched case-insensitively.
 *
 * Deliberately more than just `"off"`. The failure mode of strictness is a kill
 * switch that silently doesn't engage—someone writes `LOUISE_AI="false"`,
 * redeploys, believes generation is off, and it isn't. Every other value
 * (including unset) means on, so there is no way to accidentally *disable* AI
 * by typo, only to accidentally spell "off" correctly in more than one way.
 */
const OFF_VALUES = new Set(["off", "false", "0", "no", "disabled"]);

/**
 * Whether this deploy has turned AI generation off by choice.
 *
 * Takes `unknown` rather than `AiEnv`: the routes are generic over their own
 * `Env`, and constraining every one of them to know about a var only this module
 * reads would push a Workers AI detail through signatures that have nothing to do
 * with it. Reading one string defensively is the smaller cost.
 */
export function aiGenerationDisabled(env: unknown): boolean {
  const flag = (env as AiEnv | null | undefined)?.LOUISE_AI;
  return typeof flag === "string" && OFF_VALUES.has(flag.trim().toLowerCase());
}

/**
 * The runner to hand a generation route—the binding, unless this deploy has
 * turned generation off.
 *
 * ```ts
 * aiRoute({ resolveEditor, ai: aiRunner })
 * ```
 *
 * **One definition, not four.** Every consumer reached the runner through its
 * own `ai: (env) => env.AI`, so a flag expressed at each call site would be four
 * chances to get it wrong—and a kill switch you don't trust is worse than none.
 *
 * **`LOUISE_AI` cannot turn AI on.** It only ever subtracts: with no binding
 * there is nothing to enable, which keeps the env var a ceiling rather than a
 * second source of truth.
 *
 * **Embeddings are deliberately NOT gated by this.** They power site search and
 * generate no content, so folding them in would mean "disable AI writing"
 * silently breaks search—a consequence nobody predicts from the flag's name,
 * surfacing as "search returns nothing" long after the flag was flipped. A site
 * that genuinely wants everything off can still unprovision the binding.
 *
 * Takes `unknown` for the same reason {@link aiGenerationDisabled} does, and it
 * matters more here: this is passed *as* a route's `ai` accessor, whose parameter
 * is that route's own `Env`. An `AiEnv` parameter shares no properties with an
 * `EditorRouteEnv`, so TypeScript rejects the assignment outright—the helper
 * would be typed to describe the env it reads and unusable in the one position it
 * exists for.
 */
export function aiRunner(env: unknown): AiRunner | undefined {
  if (aiGenerationDisabled(env)) return undefined;
  return (env as AiEnv | null | undefined)?.AI;
}

/**
 * Why a generation route has no runner—so "off by choice" and "never
 * configured" can read differently.
 *
 * Both produce a 503 and both hide the button, which is right for an
 * unprovisioned binding: there is nothing to tell the editor about. It is wrong
 * for a deliberate opt-out, where the honest answer is "AI assists are turned off
 * for this site" rather than a control that quietly isn't there.
 */
export function aiUnavailableReason(env: unknown): "disabled" | "unconfigured" {
  return aiGenerationDisabled(env) ? "disabled" : "unconfigured";
}

/**
 * Run a model best-effort: returns its raw output, or `null` when `runner` is
 * absent (binding not provisioned) or the call throws. **Never throws**—AI is
 * an assist, never a gate—so callers wire it inline and keep their non-AI
 * fallback (empty alt, the original prose, no SEO suggestion).
 */
export async function runAi(
  runner: AiRunner | undefined,
  model: string,
  inputs: Record<string, unknown>,
  options?: Record<string, unknown>,
): Promise<unknown> {
  if (!runner) return null;
  try {
    return await runner.run(model, inputs, options);
  } catch (err) {
    // Best-effort still, but not *silent*: a bare swallow hid two real prod
    // failures (a retired model; an unmet JSON schema). Report so the cause shows
    // in `wrangler tail`—the return contract (null on failure) is unchanged.
    reportDegraded("ai.run", err, { model });
    return null;
  }
}

/** Token counts a model reported for one call. A count the model didn't report
 *  is `null`. */
export interface AiUsage {
  /** Tokens in the prompt. */
  promptTokens: number | null;
  /** Tokens the model generated. */
  completionTokens: number | null;
  /** Prompt and completion together. */
  totalTokens: number | null;
}

/** A text generation's answer, and how it ended. */
export interface AiTextResult {
  /** The model's raw output, for a caller that reads more than the text, such as
   *  a JSON-mode object. */
  output: unknown;
  /** The generated text, or `null` when the output carries none. */
  text: string | null;
  /**
   * Whether the output token cap cut the answer off. `true` when the model
   * reports a finish reason of `length` or `max_tokens`, or when it generated at
   * least the `max_tokens` requested. Workers AI doesn't always report a finish
   * reason, so the token count is the check that always runs.
   */
  truncated: boolean;
  /** The finish reason as the model reported it, or `null` when it reported none. */
  finishReason: string | null;
  /** Token counts, or `null` when the model reported none. */
  usage: AiUsage | null;
}

/** Finish reasons that mean the output cap ended the answer, matched
 *  case-insensitively: `length` in the OpenAI shape, `max_tokens` in others. */
const TRUNCATED_FINISH_REASONS = new Set(["length", "max_tokens"]);

/**
 * Run a text-generating model best-effort, and report whether the output cap
 * cut its answer off.
 *
 * The same contract as {@link runAi}: `null` when `runner` is absent or the call
 * throws, and it never throws. Otherwise it returns the text along with
 * `truncated`, read from `inputs.max_tokens` and what the model reported. A
 * truncated answer is reported with `reportDegraded` as `ai.truncated`, with the
 * model ID, so it shows in `wrangler tail` and an `onDegraded` listener hears it.
 *
 * Check `truncated` before you store or show the text. A cut-off answer reads as
 * complete until someone notices that it stops mid-sentence.
 */
export async function runAiText(
  runner: AiRunner | undefined,
  model: string,
  inputs: Record<string, unknown>,
  options?: Record<string, unknown>,
): Promise<AiTextResult | null> {
  const output = await runAi(runner, model, inputs, options);
  if (output === null) return null;
  const finishReason = readFinishReason(output);
  const usage = readUsage(output);
  const maxTokens = typeof inputs.max_tokens === "number" ? inputs.max_tokens : null;
  const hitCap =
    maxTokens !== null && usage?.completionTokens != null && usage.completionTokens >= maxTokens;
  const truncated =
    (finishReason !== null && TRUNCATED_FINISH_REASONS.has(finishReason.toLowerCase())) || hitCap;
  if (truncated) {
    // A cut-off answer is a degrade: the helpers refuse it and the caller keeps
    // its fallback. Report it in the same shape as `ai.run`, so one search finds
    // both and an `onDegraded` listener hears it.
    reportDegraded("ai.truncated", "answer hit the output token cap", {
      model,
      finishReason,
      completionTokens: usage?.completionTokens ?? null,
      maxTokens,
    });
  }
  return { output, text: extractText(output), truncated, finishReason, usage };
}

/** The first `choices` entry of an OpenAI-shaped output, if there is one. */
function firstChoice(out: unknown): Record<string, unknown> | null {
  if (!out || typeof out !== "object") return null;
  const choices = (out as Record<string, unknown>).choices;
  if (!Array.isArray(choices)) return null;
  const first: unknown = choices[0];
  return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
}

/** Read a finish reason from the shapes models report one in: `finish_reason`
 *  or `stop_reason` at the top level, or on the first of `choices`. */
function readFinishReason(out: unknown): string | null {
  if (!out || typeof out !== "object") return null;
  for (const source of [out as Record<string, unknown>, firstChoice(out)]) {
    if (!source) continue;
    const reason = source.finish_reason ?? source.stop_reason ?? source.finishReason;
    if (typeof reason === "string" && reason.length > 0) return reason;
  }
  return null;
}

/** Read token counts from `usage`, in the `prompt_tokens`/`completion_tokens`
 *  shape Workers AI uses or the `input_tokens`/`output_tokens` shape. */
function readUsage(out: unknown): AiUsage | null {
  if (!out || typeof out !== "object") return null;
  const usage = (out as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const count = (...values: unknown[]): number | null => {
    for (const v of values) if (typeof v === "number" && Number.isFinite(v)) return v;
    return null;
  };
  const result: AiUsage = {
    promptTokens: count(u.prompt_tokens, u.input_tokens),
    completionTokens: count(u.completion_tokens, u.output_tokens),
    totalTokens: count(u.total_tokens),
  };
  const reported =
    result.promptTokens !== null || result.completionTokens !== null || result.totalTokens !== null;
  return reported ? result : null;
}

/**
 * Route a Workers AI call through [AI Gateway](https://developers.cloudflare.com/ai-gateway/)
 * (#87). Passed to `run` as `options.gateway`, so a gateway `id` puts response
 * caching (identical prompts are free on repeat), cost caps / rate limits,
 * provider fallback, retries, and request logging in front of every call—without
 * changing this module's contract. Omit it and calls go direct.
 * Hand-defined (a subset of workers-types' `GatewayOptions`) to stay decoupled.
 */
export interface AiGatewayOptions {
  /** The AI Gateway id (created in the Cloudflare dashboard or via the API). */
  id: string;
  /** Custom cache key. Gateway caching already keys on the full request (model +
   *  inputs), so identical calls dedupe by default; set this only to *widen* a
   *  cache entry (for example, a content hash) across incidental request variance. */
  cacheKey?: string;
  /** Cache TTL in seconds. Caching is on by default; `0` disables it. */
  cacheTtl?: number;
  /** Skip the cache for this call (force a fresh model run). */
  skipCache?: boolean;
}

/** The `run` options object for a gateway config, or `undefined` when unset—so
 *  callers thread it inline: `runAi(runner, model, inputs, gatewayRun(gateway))`. */
function gatewayRun(gateway?: AiGatewayOptions): Record<string, unknown> | undefined {
  return gateway ? { gateway } : undefined;
}

/** Default vision model for {@link generateAltText}—image bytes + a prompt in,
 *  a text `description` out. Overridable per call so a site can swap models
 *  without a code change here. */
export const DEFAULT_ALT_TEXT_MODEL = "@cf/llava-hf/llava-1.5-7b-hf";

const DEFAULT_ALT_TEXT_PROMPT =
  "Write concise, descriptive alt text for this image in a single sentence. " +
  "Describe only what is visibly in the image. Do not begin with 'an image of', " +
  "'a photo of', or similar.";

/** Alt text should be short—long descriptions defeat the purpose for screen
 *  readers. Trimmed to this many characters (with an ellipsis). */
export const MAX_ALT_TEXT_LENGTH = 240;

/** What's known about where an image appears, so alt text can say what it's
 *  for, not only what it shows (#599). */
export interface AltTextContext {
  /** The page it appears on. */
  pageTitle?: string;
  /** The nearest heading above it. */
  heading?: string;
  /** Its caption. */
  caption?: string;
  /** Where it links, for a linked image: its alt text should say where the
   *  link goes, since that's what a screen reader user needs. */
  href?: string;
}

/** The prompt's context lines, or nothing when none is known. */
function altContextPrompt(context: AltTextContext | undefined): string {
  if (!context) return "";
  const lines: string[] = [];
  if (context.pageTitle) lines.push(`It appears on a page titled "${context.pageTitle}".`);
  if (context.heading) lines.push(`It sits under the heading "${context.heading}".`);
  if (context.caption) lines.push(`Its caption is "${context.caption}".`);
  if (context.href) {
    lines.push(
      `It's a link to ${context.href}: describe where the link goes, not what the image looks like.`,
    );
  }
  return lines.length ? ` ${lines.join(" ")}` : "";
}

export interface AltTextOptions {
  /** Vision model id. Default {@link DEFAULT_ALT_TEXT_MODEL}. */
  model?: string;
  /** Where the image appears, folded into the prompt. Upload knows none of
   *  this, so it's omitted there; the backfill passes the caption. */
  context?: AltTextContext;
  /** Prompt sent with the image. Default asks for one concise sentence. */
  prompt?: string;
  /** Output token cap. Default 128 (alt text is short). */
  maxTokens?: number;
  /** Route through AI Gateway (#87)—caching, cost caps, fallbacks, logging. */
  gateway?: AiGatewayOptions;
}

/**
 * Generate concise alt text for an image via Workers AI. Best-effort: returns
 * `null` when the runner is absent, the model errors, it yields no text, or the
 * output cap cut its answer off—the caller keeps its empty-alt fallback, which an
 * editor can fill in by hand. A cut-off caption is refused rather than stored,
 * because tidying makes half a sentence look finished. The result is tidied:
 * whitespace-collapsed, common "an image of…" lead-ins stripped, sentence-cased,
 * and length-capped ({@link MAX_ALT_TEXT_LENGTH}).
 */
export async function generateAltText(
  runner: AiRunner | undefined,
  image: ArrayBuffer | Uint8Array | number[],
  opts: AltTextOptions = {},
): Promise<string | null> {
  const out = await runAiText(
    runner,
    opts.model ?? DEFAULT_ALT_TEXT_MODEL,
    {
      // Vision models take the image as an array of byte values.
      image: Array.from(toBytes(image)),
      prompt: `${opts.prompt ?? DEFAULT_ALT_TEXT_PROMPT}${altContextPrompt(opts.context)}`,
      max_tokens: opts.maxTokens ?? 128,
    },
    gatewayRun(opts.gateway),
  );
  if (!out?.text || out.truncated) return null;
  return tidyAltText(out.text);
}

/** Normalize image input to a byte view without copying when already a `Uint8Array`. */
function toBytes(image: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (image instanceof Uint8Array) return image;
  if (image instanceof ArrayBuffer) return new Uint8Array(image);
  return Uint8Array.from(image);
}

/** Pull the generated text out of a Workers AI response. Vision models return
 *  `{ description }`, text-generation models `{ response }`, and OpenAI-shaped
 *  models `{ choices: [{ message: { content } }] }`; tolerate a few shapes (and a
 *  bare string) so a model swap doesn't need code changes. */
function extractText(out: unknown): string | null {
  if (typeof out === "string") return out;
  if (!out || typeof out !== "object") return null;
  const o = out as Record<string, unknown>;
  const candidate = o.description ?? o.response ?? o.text ?? o.result;
  if (typeof candidate === "string") return candidate;
  const choice = firstChoice(out);
  const message = choice?.message as Record<string, unknown> | undefined;
  const content = message?.content ?? choice?.text;
  return typeof content === "string" ? content : null;
}

/** Tidy a raw model caption into usable alt text. */
function tidyAltText(raw: string): string {
  let s = raw.trim().replace(/\s+/g, " ");
  // Models often still prepend "An image of …" / "A photo showing …" despite the
  // prompt—strip a single such lead-in.
  s = s.replace(
    /^(an?|the)\s+(image|picture|photo(?:graph)?)\s+(of|showing|shows|that shows|depicting|depicts)\s+/i,
    "",
  );
  if (s.length > MAX_ALT_TEXT_LENGTH) {
    s = `${s.slice(0, MAX_ALT_TEXT_LENGTH - 1).trimEnd()}…`;
  }
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ── Text assists: rewrite + SEO ──────────────────────────────────────────────

/** Default instruct model for {@link rewriteText} and {@link suggestSeo}.
 *  Overridable per call so a site can swap models without a code change.
 *  Was `@cf/meta/llama-3.1-8b-instruct`, retired by Workers AI (EOL 2026-05-30);
 *  bumped to the current Llama 3.3 fp8-fast build so the assists keep working. */
export const DEFAULT_TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** How {@link rewriteText} should transform the passage. */
export type RewriteMode = "tighten" | "rephrase" | "simplify" | "fix";

/** The four rewrite modes, in menu order—export so a toolbar can list them. */
export const REWRITE_MODES: readonly RewriteMode[] = ["tighten", "rephrase", "simplify", "fix"];

const REWRITE_INSTRUCTIONS: Record<RewriteMode, string> = {
  tighten:
    "Rewrite the user's text to be tighter and more concise while preserving its meaning and tone.",
  rephrase: "Rephrase the user's text in different words while preserving its meaning and tone.",
  simplify: "Rewrite the user's text in plainer, simpler language while preserving its meaning.",
  fix: "Correct spelling, grammar, and punctuation in the user's text without otherwise changing its meaning, tone, or wording.",
};

/** The default output token cap for {@link rewriteText}. */
export const REWRITE_MAX_TOKENS = 512;

/**
 * The longest passage, in characters, that {@link REWRITE_MAX_TOKENS} leaves
 * room to rewrite: 1,536, a few paragraphs. The editor's rewrite route refuses a
 * longer selection with a `413`.
 *
 * Sized from the output cap, because a rewrite runs about as long as its input.
 * English averages about four characters per token, so budgeting three per token
 * keeps a typical passage near three-quarters of the cap, and leaves headroom for
 * a rewrite that comes back longer than it went in. A passage past the cap spends
 * tokens on an answer that comes back cut off, and {@link rewriteText} refuses a
 * cut-off answer.
 */
export const REWRITE_MAX_CHARS = REWRITE_MAX_TOKENS * 3;

/** A before-and-after pair that shows the model the site's voice. */
export interface RewriteExample {
  before: string;
  after: string;
}

/** Site guidance appended to a fixed prompt: the site's voice, audience, and
 *  locale (#553). A site fact, so a parameter; there's no default voice. */
function withGuidance(prompt: string, instructions: string | undefined): string {
  const guidance = instructions?.trim();
  return guidance ? `${prompt}\n\nFollow this guidance for the site: ${guidance}` : prompt;
}

export interface RewriteOptions {
  /** How to transform the text. Default `"tighten"`. */
  mode?: RewriteMode;
  /**
   * The site's voice, audience, and locale, in plain words, appended to the
   * fixed prompt: "Warm and plain. Readers are neighbors, not experts. British
   * English." No default.
   */
  instructions?: string;
  /** One or two before-and-after pairs in the site's voice, sent as example
   *  turns ahead of the text. Past two, the rest are ignored. */
  examples?: readonly RewriteExample[];
  /** Instruct model id. Default {@link DEFAULT_TEXT_MODEL}. */
  model?: string;
  /** Output token cap. Default {@link REWRITE_MAX_TOKENS}. */
  maxTokens?: number;
  /** Route through AI Gateway (#87)—caching, cost caps, fallbacks, logging. */
  gateway?: AiGatewayOptions;
}

/**
 * Rewrite a passage of text (tighten / rephrase / simplify / fix) via Workers AI.
 * Best-effort: returns `null` when the runner is absent, the input is blank, the
 * model errors or returns nothing, or the output cap cut its answer off—the
 * caller keeps the original text. A cut-off rewrite is refused, because swapping
 * it in would replace the whole passage with a fragment. The result is stripped
 * of any wrapping quotes or "Here is the rewrite:" preamble the model may add.
 *
 * Keep `text` within {@link REWRITE_MAX_CHARS} for the default cap; a longer
 * passage is likely to come back cut off, and so as `null`.
 */
/** Added to the rewrite prompt when the text holds several paragraphs, so the
 *  editor can put each one back in its own block (#551). A single paragraph
 *  gets the prompt unchanged. */
const KEEP_PARAGRAPHS =
  " Keep the same paragraphs in the same order, separated by one blank line, as in the text.";

export async function rewriteText(
  runner: AiRunner | undefined,
  text: string,
  opts: RewriteOptions = {},
): Promise<string | null> {
  const input = text.trim();
  if (!input) return null;
  const instruction = REWRITE_INSTRUCTIONS[opts.mode ?? "tighten"];
  const out = await runAiText(
    runner,
    opts.model ?? DEFAULT_TEXT_MODEL,
    {
      messages: [
        {
          role: "system",
          content: withGuidance(
            `${instruction}${input.includes("\n\n") ? KEEP_PARAGRAPHS : ""} Reply with only the rewritten text — no preamble, no quotation marks, no explanation.`,
            opts.instructions,
          ),
        },
        ...(opts.examples ?? []).slice(0, 2).flatMap((example) => [
          { role: "user", content: example.before },
          { role: "assistant", content: example.after },
        ]),
        { role: "user", content: input },
      ],
      max_tokens: opts.maxTokens ?? REWRITE_MAX_TOKENS,
    },
    gatewayRun(opts.gateway),
  );
  if (!out?.text || out.truncated) return null;
  return unwrapModelText(out.text) || null;
}

/** A suggested SEO title + meta description. Either field may be `null` when the
 *  model didn't produce a usable value. */
export interface SeoSuggestion {
  title: string | null;
  description: string | null;
}

export interface SeoOptions {
  /** The site's voice, audience, and locale, appended to the fixed prompt, as
   *  for {@link RewriteOptions.instructions}. No default. */
  instructions?: string;
  model?: string;
  maxTokens?: number;
  /** Max chars of `content` sent to the model (keeps the prompt bounded). Default 4000. */
  maxContentChars?: number;
  /** Route through AI Gateway (#87)—caching, cost caps, fallbacks, logging. */
  gateway?: AiGatewayOptions;
}

/** Search engines truncate around these; keep suggestions within them. The
 *  same limits are exported from `louise-toolkit/seo`. */
export { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX };

/**
 * Suggest an SEO title + meta description from page content via Workers AI.
 * Best-effort: `null` when the runner is absent, the content is blank, the output
 * cap cut the reply off, or the reply can't be parsed as the expected JSON.
 * Fields are length-capped, and a missing/empty field becomes `null` (a result
 * with neither is `null` overall).
 */
export async function suggestSeo(
  runner: AiRunner | undefined,
  content: string,
  opts: SeoOptions = {},
): Promise<SeoSuggestion | null> {
  const input = content.trim();
  if (!input) return null;
  const out = await runAiText(
    runner,
    opts.model ?? DEFAULT_TEXT_MODEL,
    {
      messages: [
        {
          role: "system",
          content: withGuidance(
            `You are an SEO assistant. From the page content, write a concise SEO title ` +
              `(max ${SEO_TITLE_MAX} characters) and meta description (max ${SEO_DESCRIPTION_MAX} ` +
              `characters). Reply with ONLY a JSON object: {"title": string, "description": string}.`,
            opts.instructions,
          ),
        },
        { role: "user", content: input.slice(0, opts.maxContentChars ?? 4000) },
      ],
      max_tokens: opts.maxTokens ?? 256,
      // JSON mode (Workers AI structured outputs): force a valid
      // `{title, description}` object regardless of the model's prose habits.
      // Without it, `parseJsonObject` had to salvage JSON from freeform text—which
      // silently broke on a model swap (a chattier model wrapped/annotated
      // the JSON). The system prompt is kept as a belt-and-braces hint.
      response_format: {
        type: "json_schema",
        json_schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
          },
          required: ["title", "description"],
        },
      },
    },
    gatewayRun(opts.gateway),
  );
  // A cut-off reply can still parse, with a description that stops mid-sentence.
  if (!out || out.truncated) return null;
  const parsed = extractJsonObject(out.output);
  if (!parsed) return null;
  const title = nonEmptyString(parsed.title) ? capLength(parsed.title.trim(), SEO_TITLE_MAX) : null;
  const description = nonEmptyString(parsed.description)
    ? capLength(parsed.description.trim(), SEO_DESCRIPTION_MAX)
    : null;
  return title === null && description === null ? null : { title, description };
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Strip a leading "Sure, here's …:" preamble and a single pair of wrapping
 *  quotes a chat model may add around the rewritten text. */
function unwrapModelText(raw: string): string {
  let s = raw
    .trim()
    .replace(/^(sure[,!.]?\s*)?(here('s| is|’s)\b[^\n:]*:)\s*/i, "")
    .trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/** Best-effort parse of a JSON object possibly wrapped in prose or code fences. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj: unknown = JSON.parse(text.slice(start, end + 1));
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Coerce a Workers AI response into a plain object, tolerating every shape a
 *  JSON-producing call can take: JSON mode (a parsed object under `response`), a
 *  JSON *string* (via {@link extractText} → {@link parseJsonObject}), or freeform
 *  text a model returned when it ignored the schema. So structured parsing (SEO)
 *  survives a model swap or a partial JSON-mode implementation. */
function extractJsonObject(out: unknown): Record<string, unknown> | null {
  if (out && typeof out === "object") {
    const resp = (out as Record<string, unknown>).response;
    if (resp && typeof resp === "object" && !Array.isArray(resp)) {
      return resp as Record<string, unknown>;
    }
  }
  const text = extractText(out);
  return text ? parseJsonObject(text) : null;
}

function capLength(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// Semantic search (embeddings + Vectorize, #86)—same module surface
// (`louise-toolkit/ai`), same degrade-gracefully contract. Kept in its own file
// (embeddings.ts) since it adds the Vectorize index contract on top of the
// Workers AI runner these editorial assists use.
export * from "./embeddings.js";

// Rank fusion for hybrid search (#555). Pure and binding-free: it merges the
// ranked lists that keyword, semantic, or any other retriever returns.
export * from "./fusion.js";
