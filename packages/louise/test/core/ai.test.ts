import { describe, expect, it, vi } from "vitest";
import {
  type AiRunner,
  DEFAULT_ALT_TEXT_MODEL,
  generateAltText,
  MAX_ALT_TEXT_LENGTH,
  runAi,
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
