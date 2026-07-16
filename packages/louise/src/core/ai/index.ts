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
