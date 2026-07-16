// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/ai — optional Workers AI editorial assists (#75).
//
// A minimal, model-catalog-agnostic runner contract plus best-effort helpers that
// DEGRADE GRACEFULLY: given no binding (or on any model error) they return `null`,
// so a save / upload / publish is never blocked or broken by AI. The binding
// (`env.AI`) is passed in, and the module takes the model id as a string — it has
// no opinion on which models exist, so it isn't pinned to a `@cloudflare/workers-types`
// model catalog. That keeps the door open for routing `run` through AI Gateway
// later (#87) without touching callers.

/** The one capability these helpers need from a Workers AI binding: `run(model,
 *  inputs)`. `env.AI` satisfies this structurally — pass it directly. Hand-defined
 *  (rather than importing the workers-types `Ai` generic) so the module stays
 *  catalog-agnostic; a test double is just `{ run }`. */
export interface AiRunner {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
}

/**
 * Run a model best-effort: returns its raw output, or `null` when `runner` is
 * absent (binding not provisioned) or the call throws. **Never throws** — AI is
 * an assist, never a gate — so callers wire it inline and keep their non-AI
 * fallback (empty alt, the original prose, no SEO suggestion).
 */
export async function runAi(
  runner: AiRunner | undefined,
  model: string,
  inputs: Record<string, unknown>,
  options?: Record<string, unknown>,
): Promise<unknown | null> {
  if (!runner) return null;
  try {
    return await runner.run(model, inputs, options);
  } catch {
    return null;
  }
}

/** Default vision model for {@link generateAltText} — image bytes + a prompt in,
 *  a text `description` out. Overridable per call so a site can swap models
 *  without a code change here. */
export const DEFAULT_ALT_TEXT_MODEL = "@cf/llava-hf/llava-1.5-7b-hf";

const DEFAULT_ALT_TEXT_PROMPT =
  "Write concise, descriptive alt text for this image in a single sentence. " +
  "Describe only what is visibly in the image. Do not begin with 'an image of', " +
  "'a photo of', or similar.";

/** Alt text should be short — long descriptions defeat the purpose for screen
 *  readers. Trimmed to this many characters (with an ellipsis). */
export const MAX_ALT_TEXT_LENGTH = 240;

export interface AltTextOptions {
  /** Vision model id. Default {@link DEFAULT_ALT_TEXT_MODEL}. */
  model?: string;
  /** Prompt sent with the image. Default asks for one concise sentence. */
  prompt?: string;
  /** Output token cap. Default 128 (alt text is short). */
  maxTokens?: number;
}

/**
 * Generate concise alt text for an image via Workers AI. Best-effort: returns
 * `null` when the runner is absent, the model errors, or it yields no text — the
 * caller keeps its empty-alt fallback, which an editor can fill in by hand. The
 * result is tidied: whitespace-collapsed, common "an image of…" lead-ins
 * stripped, sentence-cased, and length-capped ({@link MAX_ALT_TEXT_LENGTH}).
 */
export async function generateAltText(
  runner: AiRunner | undefined,
  image: ArrayBuffer | Uint8Array | number[],
  opts: AltTextOptions = {},
): Promise<string | null> {
  const out = await runAi(runner, opts.model ?? DEFAULT_ALT_TEXT_MODEL, {
    // Vision models take the image as an array of byte values.
    image: Array.from(toBytes(image)),
    prompt: opts.prompt ?? DEFAULT_ALT_TEXT_PROMPT,
    max_tokens: opts.maxTokens ?? 128,
  });
  const text = extractText(out);
  return text ? tidyAltText(text) : null;
}

/** Normalize image input to a byte view without copying when already a `Uint8Array`. */
function toBytes(image: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (image instanceof Uint8Array) return image;
  if (image instanceof ArrayBuffer) return new Uint8Array(image);
  return Uint8Array.from(image);
}

/** Pull the generated text out of a Workers AI response. Vision models return
 *  `{ description }`, text-generation models `{ response }`; tolerate a couple of
 *  shapes (and a bare string) so a model swap doesn't need code changes. */
function extractText(out: unknown): string | null {
  if (typeof out === "string") return out;
  if (!out || typeof out !== "object") return null;
  const o = out as Record<string, unknown>;
  const candidate = o.description ?? o.response ?? o.text ?? o.result;
  return typeof candidate === "string" ? candidate : null;
}

/** Tidy a raw model caption into usable alt text. */
function tidyAltText(raw: string): string {
  let s = raw.trim().replace(/\s+/g, " ");
  // Models often still prepend "An image of …" / "A photo showing …" despite the
  // prompt — strip a single such lead-in.
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
 *  Overridable per call so a site can swap models without a code change. */
export const DEFAULT_TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct";

/** How {@link rewriteText} should transform the passage. */
export type RewriteMode = "tighten" | "rephrase" | "simplify" | "fix";

/** The four rewrite modes, in menu order — export so a toolbar can list them. */
export const REWRITE_MODES: readonly RewriteMode[] = ["tighten", "rephrase", "simplify", "fix"];

const REWRITE_INSTRUCTIONS: Record<RewriteMode, string> = {
  tighten:
    "Rewrite the user's text to be tighter and more concise while preserving its meaning and tone.",
  rephrase: "Rephrase the user's text in different words while preserving its meaning and tone.",
  simplify: "Rewrite the user's text in plainer, simpler language while preserving its meaning.",
  fix: "Correct spelling, grammar, and punctuation in the user's text without otherwise changing its meaning, tone, or wording.",
};

export interface RewriteOptions {
  /** How to transform the text. Default `"tighten"`. */
  mode?: RewriteMode;
  /** Instruct model id. Default {@link DEFAULT_TEXT_MODEL}. */
  model?: string;
  /** Output token cap. Default 512. */
  maxTokens?: number;
}

/**
 * Rewrite a passage of text (tighten / rephrase / simplify / fix) via Workers AI.
 * Best-effort: returns `null` when the runner is absent, the input is blank, or
 * the model errors / returns nothing — the caller keeps the original text. The
 * result is stripped of any wrapping quotes or "Here is the rewrite:" preamble
 * the model may add.
 */
export async function rewriteText(
  runner: AiRunner | undefined,
  text: string,
  opts: RewriteOptions = {},
): Promise<string | null> {
  const input = text.trim();
  if (!input) return null;
  const instruction = REWRITE_INSTRUCTIONS[opts.mode ?? "tighten"];
  const out = await runAi(runner, opts.model ?? DEFAULT_TEXT_MODEL, {
    messages: [
      {
        role: "system",
        content: `${instruction} Reply with only the rewritten text — no preamble, no quotation marks, no explanation.`,
      },
      { role: "user", content: input },
    ],
    max_tokens: opts.maxTokens ?? 512,
  });
  const result = extractText(out);
  return result ? unwrapModelText(result) || null : null;
}

/** A suggested SEO title + meta description. Either field may be `null` when the
 *  model didn't produce a usable value. */
export interface SeoSuggestion {
  title: string | null;
  description: string | null;
}

export interface SeoOptions {
  model?: string;
  maxTokens?: number;
  /** Max chars of `content` sent to the model (keeps the prompt bounded). Default 4000. */
  maxContentChars?: number;
}

/** Search engines truncate around these; keep suggestions within them. */
export const SEO_TITLE_MAX = 60;
export const SEO_DESCRIPTION_MAX = 155;

/**
 * Suggest an SEO title + meta description from page content via Workers AI.
 * Best-effort: `null` when the runner is absent, the content is blank, or the
 * reply can't be parsed as the expected JSON. Fields are length-capped, and a
 * missing/empty field becomes `null` (a result with neither is `null` overall).
 */
export async function suggestSeo(
  runner: AiRunner | undefined,
  content: string,
  opts: SeoOptions = {},
): Promise<SeoSuggestion | null> {
  const input = content.trim();
  if (!input) return null;
  const out = await runAi(runner, opts.model ?? DEFAULT_TEXT_MODEL, {
    messages: [
      {
        role: "system",
        content:
          `You are an SEO assistant. From the page content, write a concise SEO title ` +
          `(max ${SEO_TITLE_MAX} characters) and meta description (max ${SEO_DESCRIPTION_MAX} ` +
          `characters). Reply with ONLY a JSON object: {"title": string, "description": string}.`,
      },
      { role: "user", content: input.slice(0, opts.maxContentChars ?? 4000) },
    ],
    max_tokens: opts.maxTokens ?? 256,
  });
  const text = extractText(out);
  const parsed = text ? parseJsonObject(text) : null;
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

function capLength(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
