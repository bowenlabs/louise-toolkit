import { describe, expect, it, vi } from "vitest";
import {
  type AiRunner,
  DEFAULT_ALT_TEXT_MODEL,
  DEFAULT_TEXT_MODEL,
  generateAltText,
  MAX_ALT_TEXT_LENGTH,
  rewriteText,
  runAi,
  SEO_TITLE_MAX,
  suggestSeo,
} from "../../src/core/ai/index.js";

/** A fake runner that returns a canned output and records the call. */
function runner(output: unknown): {
  runner: AiRunner;
  calls: { model: string; inputs: Record<string, unknown> }[];
} {
  const calls: { model: string; inputs: Record<string, unknown> }[] = [];
  return {
    calls,
    runner: {
      run: vi.fn(async (model: string, inputs: Record<string, unknown>) => {
        calls.push({ model, inputs });
        return output;
      }),
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

  it("caps title/description and nulls missing or empty fields", async () => {
    const title = "x".repeat(200);
    const r = runner({ response: JSON.stringify({ title, description: "  " }) }).runner;
    const seo = await suggestSeo(r, "x");
    expect((seo?.title as string).length).toBeLessThanOrEqual(SEO_TITLE_MAX);
    expect(seo?.description).toBeNull();
  });

  it("returns null when the reply isn't parseable JSON", async () => {
    expect(await suggestSeo(runner("no json here").runner, "x")).toBeNull();
  });
});
