import { describe, expect, it, vi } from "vitest";
import {
  type AiRunner,
  aiGenerationDisabled,
  aiRunner,
  aiUnavailableReason,
  DEFAULT_ALT_TEXT_MODEL,
  DEFAULT_TEXT_MODEL,
  generateAltText,
  MAX_ALT_TEXT_LENGTH,
  REWRITE_MAX_CHARS,
  REWRITE_MAX_TOKENS,
  rewriteText,
  runAi,
  runAiText,
  SEO_TITLE_MAX,
  suggestSeo,
} from "../../src/core/ai/index.js";

/** A fake runner that returns a canned output and records the call. */
function runner(output: unknown): {
  runner: AiRunner;
  calls: { model: string; inputs: Record<string, unknown>; options?: Record<string, unknown> }[];
} {
  const calls: {
    model: string;
    inputs: Record<string, unknown>;
    options?: Record<string, unknown>;
  }[] = [];
  return {
    calls,
    runner: {
      run: vi.fn(
        async (
          model: string,
          inputs: Record<string, unknown>,
          options?: Record<string, unknown>,
        ) => {
          calls.push({ model, inputs, options });
          return output;
        },
      ),
    },
  };
}

// Type-level: the workers-types `Ai` binding satisfies AiRunner, so a site wires
// `altText: (env) => env.AI` with no cast. (Compile-time check; never called.)
() => {
  const ai = undefined as unknown as Ai;
  const asRunner: AiRunner = ai;
  void asRunner;
};

describe("runAi", () => {
  it("returns null when the runner is absent (binding not provisioned)", async () => {
    expect(await runAi(undefined, "m", {})).toBeNull();
  });

  it("returns the model output when present", async () => {
    const { runner: r } = runner({ response: "ok" });
    expect(await runAi(r, "m", { a: 1 })).toEqual({ response: "ok" });
  });

  it("swallows a thrown model error and returns null (never a gate)", async () => {
    const r: AiRunner = {
      run: async () => {
        throw new Error("model down");
      },
    };
    expect(await runAi(r, "m", {})).toBeNull();
  });
});

describe("runAiText—truncation (#466)", () => {
  it("returns null, like runAi, without a runner or on a thrown error", async () => {
    expect(await runAiText(undefined, "m", { max_tokens: 10 })).toBeNull();
    const r: AiRunner = {
      run: async () => {
        throw new Error("down");
      },
    };
    expect(await runAiText(r, "m", { max_tokens: 10 })).toBeNull();
  });

  it("reads a finished answer as not truncated", async () => {
    const r = runner({
      response: "A whole sentence.",
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
    }).runner;
    expect(await runAiText(r, "m", { max_tokens: 64 })).toEqual({
      output: {
        response: "A whole sentence.",
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
      },
      text: "A whole sentence.",
      truncated: false,
      finishReason: null,
      usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 },
    });
  });

  it("detects truncation from a finish reason, in each shape a model reports one", async () => {
    // With no usage at all, so only the finish reason can tell.
    const shapes: unknown[] = [
      { response: "Half a", finish_reason: "length" },
      { response: "Half a", stop_reason: "max_tokens" },
      { response: "Half a", finishReason: "MAX_TOKENS" },
      { choices: [{ message: { content: "Half a" }, finish_reason: "length" }] },
    ];
    for (const out of shapes) {
      const result = await runAiText(runner(out).runner, "m", { max_tokens: 512 });
      expect(result?.truncated, JSON.stringify(out)).toBe(true);
      expect(result?.text).toBe("Half a");
      expect(result?.usage).toBeNull();
    }
  });

  it("detects truncation from usage when the model reports no finish reason", async () => {
    // Workers AI often reports usage without a finish reason. Generating the
    // whole cap is the only sign the answer was cut off.
    const atCap = runner({ response: "Half a", usage: { completion_tokens: 128 } }).runner;
    const result = await runAiText(atCap, "m", { max_tokens: 128 });
    expect(result?.finishReason).toBeNull();
    expect(result?.truncated).toBe(true);

    // The `output_tokens` spelling counts too.
    const other = runner({ response: "Half a", usage: { output_tokens: 130 } }).runner;
    expect((await runAiText(other, "m", { max_tokens: 128 }))?.truncated).toBe(true);

    // One token under the cap is a finished answer.
    const under = runner({ response: "Whole.", usage: { completion_tokens: 127 } }).runner;
    expect((await runAiText(under, "m", { max_tokens: 128 }))?.truncated).toBe(false);
  });

  it("treats a finish reason of stop as finished, when usage is under the cap", async () => {
    const r = runner({
      response: "Whole.",
      finish_reason: "stop",
      usage: { completion_tokens: 3 },
    }).runner;
    const result = await runAiText(r, "m", { max_tokens: 128 });
    expect(result?.finishReason).toBe("stop");
    expect(result?.truncated).toBe(false);
  });

  it("can't read usage against a cap that wasn't requested", async () => {
    const r = runner({ response: "Whole.", usage: { completion_tokens: 900 } }).runner;
    expect((await runAiText(r, "m", {}))?.truncated).toBe(false);
  });

  it("logs a truncated answer with the model ID", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const r = runner({ response: "Half a", finish_reason: "length" }).runner;
      await runAiText(r, "@cf/example/model", { max_tokens: 16 });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("@cf/example/model");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("generateAltText", () => {
  it("returns null without a runner", async () => {
    expect(await generateAltText(undefined, new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("sends image bytes + prompt to the default model and tidies the caption", async () => {
    const { runner: r, calls } = runner({ description: "an image of a red mug on a table" });
    const alt = await generateAltText(r, new Uint8Array([137, 80, 78, 71]));

    // Default vision model, image passed as a byte array, a prompt supplied.
    expect(calls[0].model).toBe(DEFAULT_ALT_TEXT_MODEL);
    expect(calls[0].inputs.image).toEqual([137, 80, 78, 71]);
    expect(typeof calls[0].inputs.prompt).toBe("string");
    // "an image of " lead-in stripped, sentence-cased.
    expect(alt).toBe("A red mug on a table");
  });

  it("accepts an ArrayBuffer and number[] image", async () => {
    const { runner: r, calls } = runner({ description: "Sunset over hills" });
    await generateAltText(r, new Uint8Array([1, 2]).buffer);
    await generateAltText(r, [3, 4]);
    expect(calls[0].inputs.image).toEqual([1, 2]);
    expect(calls[1].inputs.image).toEqual([3, 4]);
  });

  it("reads text-generation shape (`response`) and a bare string too", async () => {
    const a = await generateAltText(runner({ response: "Blue bicycle" }).runner, new Uint8Array());
    const b = await generateAltText(runner("Green door").runner, new Uint8Array());
    expect(a).toBe("Blue bicycle");
    expect(b).toBe("Green door");
  });

  it("returns null when the model yields no usable text", async () => {
    expect(await generateAltText(runner({ nope: 1 }).runner, new Uint8Array())).toBeNull();
    expect(await generateAltText(runner(null).runner, new Uint8Array())).toBeNull();
  });

  it("returns null (not a throw) when the model errors — upload keeps its empty alt", async () => {
    const r: AiRunner = {
      run: async () => {
        throw new Error("boom");
      },
    };
    expect(await generateAltText(r, new Uint8Array([1]))).toBeNull();
  });

  it("never stores a truncated caption—it returns null for the empty-alt fallback", async () => {
    // Tidying would sentence-case the fragment and make it look finished.
    const byReason = runner({ description: "a red mug on a", finish_reason: "length" }).runner;
    expect(await generateAltText(byReason, new Uint8Array([1]))).toBeNull();

    const byUsage = runner({ description: "a red mug on a", usage: { completion_tokens: 128 } });
    expect(await generateAltText(byUsage.runner, new Uint8Array([1]))).toBeNull();
    expect(byUsage.calls[0].inputs.max_tokens).toBe(128);
  });

  it("caps very long captions with an ellipsis", async () => {
    const long = `${"word ".repeat(120)}`.trim();
    const alt = await generateAltText(runner({ description: long }).runner, new Uint8Array());
    expect(alt).not.toBeNull();
    expect((alt as string).length).toBeLessThanOrEqual(MAX_ALT_TEXT_LENGTH);
    expect(alt as string).toMatch(/…$/);
  });
});

describe("rewriteText", () => {
  it("returns null without a runner and for blank input", async () => {
    expect(await rewriteText(undefined, "hello")).toBeNull();
    expect(await rewriteText(runner({ response: "x" }).runner, "   ")).toBeNull();
  });

  it("sends the passage as the chat user message and returns the model's text", async () => {
    const { runner: r, calls } = runner({ response: "Tighter version." });
    const out = await rewriteText(r, "  a rather wordy original passage  ");
    const msgs = calls[0].inputs.messages as { role: string; content: string }[];
    expect(calls[0].model).toBe(DEFAULT_TEXT_MODEL);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1]).toEqual({ role: "user", content: "a rather wordy original passage" });
    expect(out).toBe("Tighter version.");
  });

  it("varies the system instruction by mode", async () => {
    const a = runner({ response: "x" });
    const b = runner({ response: "x" });
    await rewriteText(a.runner, "t", { mode: "tighten" });
    await rewriteText(b.runner, "t", { mode: "fix" });
    const sysA = (a.calls[0].inputs.messages as { content: string }[])[0].content;
    const sysB = (b.calls[0].inputs.messages as { content: string }[])[0].content;
    expect(sysA).not.toBe(sysB);
    expect(sysB.toLowerCase()).toContain("grammar");
  });

  it("strips a preamble and wrapping quotes the model may add", async () => {
    const r = runner({ response: 'Sure! Here is the rewrite: "A crisp sentence."' }).runner;
    expect(await rewriteText(r, "original")).toBe("A crisp sentence.");
  });

  it("returns null (not a throw) on a model error", async () => {
    const r: AiRunner = {
      run: async () => {
        throw new Error("down");
      },
    };
    expect(await rewriteText(r, "original")).toBeNull();
  });

  it("never returns a truncated rewrite, so the selection keeps its original text", async () => {
    const byReason = runner({ response: "The first half of", finish_reason: "length" }).runner;
    expect(await rewriteText(byReason, "original")).toBeNull();

    const byUsage = runner({
      response: "The first half of",
      usage: { completion_tokens: REWRITE_MAX_TOKENS },
    });
    expect(await rewriteText(byUsage.runner, "original")).toBeNull();
    expect(byUsage.calls[0].inputs.max_tokens).toBe(REWRITE_MAX_TOKENS);

    // A caller's own cap is the one the usage is read against.
    const custom = runner({ response: "Short.", usage: { completion_tokens: 64 } }).runner;
    expect(await rewriteText(custom, "original", { maxTokens: 64 })).toBeNull();
    expect(await rewriteText(custom, "original", { maxTokens: 65 })).toBe("Short.");
  });

  it("sizes its input cap from its output cap", () => {
    // The route's 413 rests on this relationship: three characters per token
    // of output cap.
    expect(REWRITE_MAX_CHARS).toBe(REWRITE_MAX_TOKENS * 3);
  });
});

describe("suggestSeo", () => {
  it("returns null without a runner or content", async () => {
    expect(await suggestSeo(undefined, "content")).toBeNull();
    expect(await suggestSeo(runner("{}").runner, "  ")).toBeNull();
  });

  it("parses a JSON title + description from the reply", async () => {
    const r = runner({
      response: '{"title":"Best Coffee in Town","description":"Freshly roasted."}',
    }).runner;
    expect(await suggestSeo(r, "page about coffee")).toEqual({
      title: "Best Coffee in Town",
      description: "Freshly roasted.",
    });
  });

  it("tolerates JSON wrapped in prose / code fences", async () => {
    const r = runner('```json\n{"title":"T","description":"D"}\n```').runner;
    expect(await suggestSeo(r, "x")).toEqual({ title: "T", description: "D" });
  });

  it("reads a JSON-mode object response (response is already parsed)", async () => {
    // Workers AI structured outputs return `response` as an OBJECT, not a string—the
    // shape that silently broke SEO on the model swap (extractText expected a
    // string). This is the case JSON mode + extractJsonObject now handle.
    const r = runner({ response: { title: "Structured", description: "From JSON mode." } }).runner;
    expect(await suggestSeo(r, "x")).toEqual({
      title: "Structured",
      description: "From JSON mode.",
    });
  });

  it("requests JSON mode (response_format json_schema)", async () => {
    const r = runner({ response: { title: "T", description: "D" } });
    await suggestSeo(r.runner, "x");
    const fmt = r.calls[0].inputs.response_format as { type?: string } | undefined;
    expect(fmt?.type).toBe("json_schema");
  });

  it("caps title/description and nulls missing or empty fields", async () => {
    const title = "x".repeat(200);
    const r = runner({ response: JSON.stringify({ title, description: "  " }) }).runner;
    const seo = await suggestSeo(r, "x");
    expect((seo?.title as string).length).toBeLessThanOrEqual(SEO_TITLE_MAX);
    expect(seo?.description).toBeNull();
  });

  it("returns null when the output cap cut the reply off, even if it parses", async () => {
    const r = runner({
      response: { title: "Coffee", description: "Freshly roasted beans from" },
      usage: { completion_tokens: 256 },
    }).runner;
    expect(await suggestSeo(r, "x")).toBeNull();
  });

  it("returns null when the reply isn't parseable JSON", async () => {
    expect(await suggestSeo(runner("no json here").runner, "x")).toBeNull();
  });
});

describe("AI Gateway routing (#87)", () => {
  const gw = { id: "louise-gw", cacheTtl: 3600 };

  it("threads the gateway config into the run options of each helper", async () => {
    const alt = runner({ description: "a cat" });
    await generateAltText(alt.runner, new Uint8Array([1]), { gateway: gw });
    expect(alt.calls[0].options).toEqual({ gateway: gw });

    const rw = runner({ response: "Tighter." });
    await rewriteText(rw.runner, "a wordy passage", { gateway: gw });
    expect(rw.calls[0].options).toEqual({ gateway: gw });

    const seo = runner({ response: '{"title":"T","description":"D"}' });
    await suggestSeo(seo.runner, "page content", { gateway: gw });
    expect(seo.calls[0].options).toEqual({ gateway: gw });
  });

  it("passes no gateway option when unset (calls Workers AI directly)", async () => {
    const alt = runner({ description: "a cat" });
    await generateAltText(alt.runner, new Uint8Array([1]));
    expect(alt.calls[0].options).toBeUndefined();
  });
});

describe("aiRunner — the generation kill switch (#334)", () => {
  const AI = { run: async () => null } as AiRunner;

  it("returns the binding when the flag is unset", () => {
    expect(aiRunner({ AI })).toBe(AI);
    expect(aiGenerationDisabled({ AI })).toBe(false);
  });

  it("returns undefined when the flag is off, even with a binding present", () => {
    // The whole point: keep the binding (embeddings still need it) and stop
    // generation.
    expect(aiRunner({ AI, LOUISE_AI: "off" })).toBeUndefined();
  });

  it("cannot turn AI on — it only ever subtracts", () => {
    // No binding means nothing to enable; the var is a ceiling, not a second
    // source of truth.
    expect(aiRunner({ LOUISE_AI: "on" })).toBeUndefined();
    expect(aiRunner({})).toBeUndefined();
  });

  it("accepts the obvious spellings of off, case- and space-insensitively", () => {
    // A kill switch that silently doesn't engage because someone wrote "false"
    // is worse than no kill switch. There is no matching leniency for "on"—every
    // other value means on, so no typo can accidentally DISABLE AI.
    for (const value of ["off", "OFF", " Off ", "false", "0", "no", "disabled"]) {
      expect(aiRunner({ AI, LOUISE_AI: value }), value).toBeUndefined();
    }
    for (const value of ["on", "true", "1", "", "yes", "enabled"]) {
      expect(aiRunner({ AI, LOUISE_AI: value }), value).toBe(AI);
    }
  });

  it("tells 'off by choice' apart from 'never configured'", () => {
    // Both 503 and both hide the control, which is right for an unprovisioned
    // binding—there is nothing to tell the editor. It is wrong for a
    // deliberate opt-out, where the honest answer is "turned off for this site".
    expect(aiUnavailableReason({ AI, LOUISE_AI: "off" })).toBe("disabled");
    expect(aiUnavailableReason({})).toBe("unconfigured");
    // Off-by-choice reads as disabled whether or not a binding exists.
    expect(aiUnavailableReason({ LOUISE_AI: "off" })).toBe("disabled");
  });

  it("survives an env that isn't an object", () => {
    // Reads `unknown` so generic route Envs don't need constraining.
    expect(aiGenerationDisabled(undefined)).toBe(false);
    expect(aiGenerationDisabled(null)).toBe(false);
    expect(aiGenerationDisabled({ LOUISE_AI: 0 as unknown as string })).toBe(false);
  });
});
