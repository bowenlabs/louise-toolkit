// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The `pages` write-integrity contract, at the seam where it broke.
//
// `versionsRoute` enforces the section catalog because it takes the collection
// `config` and runs its `beforeChange` hook. `pagesRoute` takes NO config and
// runs no hook — so a direct POST/PATCH to /api/louise/pages persisted an
// unknown section `_type`, a setting outside its options, or unsanitized section
// rich text, and `<Sections>` then dropped the bad section with no error
// anywhere. `astroidPagesWriteHooks` closes that gap by giving pagesRoute the
// same sanitize + validate the hook applies; these tests assert the two paths
// enforce ONE contract by exercising the hooks and the collection hook side by
// side against the same inputs.

import { describe, expect, it } from "vitest";
import type { AstroidConfig } from "../src/config.js";
import {
  assertAstroidPageSections,
  astroidPagesCollection,
  astroidPagesWriteHooks,
  sanitizeAstroidPageSections,
} from "../src/schema/collections.js";

const config: AstroidConfig = {
  key: "acme",
  archetype: "marketing",
  theme: { name: "Acme", colors: { brand: "#1f6e6d" } },
};

const hooks = astroidPagesWriteHooks(config);

// Run the collection's own beforeChange hook — the versionsRoute path — so each
// case below can be asserted against BOTH write paths from one input.
const collectionHook = astroidPagesCollection(config).hooks?.beforeChange?.[0];
const runCollectionHook = (data: Record<string, unknown>) => {
  if (!collectionHook) throw new Error("pages collection has no beforeChange hook");
  return collectionHook({ data } as never) as Promise<Record<string, unknown>>;
};

describe("astroidPagesWriteHooks — validate", () => {
  it("rejects an unknown section _type (both write paths)", async () => {
    const bad = { sections: [{ _type: "definitely-not-a-section", heading: "x" }] };
    await expect(hooks.validate(bad, { operation: "update" })).rejects.toThrow(
      /unknown section type/i,
    );
    // The collection hook (versionsRoute path) rejects the same input.
    await expect(runCollectionHook(bad)).rejects.toThrow(/unknown section type/i);
  });

  it("rejects a _settings token outside its declared options", async () => {
    // `heading` is present so the ONLY violation is the colorway token — proving
    // it's the setting that's rejected, not a missing required field.
    const bad = {
      sections: [{ _type: "hero", heading: "Hi", _settings: { colorway: "chartreuse" } }],
    };
    await expect(hooks.validate(bad, { operation: "update" })).rejects.toThrow();
    await expect(runCollectionHook(bad)).rejects.toThrow();
  });

  it("accepts a valid section", async () => {
    const good = {
      sections: [{ _type: "hero", heading: "Hi", _settings: { colorway: "brand" } }],
    };
    await expect(hooks.validate(good, { operation: "update" })).resolves.toBeUndefined();
    await expect(runCollectionHook(good)).resolves.toBeDefined();
  });

  it("is a no-op when the write carries no sections (a partial PATCH)", async () => {
    await expect(
      hooks.validate({ title: "Just the title" }, { operation: "update" }),
    ).resolves.toBeUndefined();
  });

  it("surfaces per-field violations on the thrown error", async () => {
    const err = await hooks
      .validate({ sections: [{ _type: "nope" }] }, { operation: "update" })
      .then(
        () => null,
        (e) => e as { violations?: unknown[] },
      );
    expect(err?.violations).toBeTruthy();
    expect(Array.isArray(err?.violations)).toBe(true);
  });
});

describe("astroidPagesWriteHooks — sanitize", () => {
  it("scrubs a <script> from the body via the richField sanitizer", () => {
    const out = hooks.sanitize("<p>hi</p><script>window.__x=1</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("hi");
  });

  it("sanitizes richText inside an array item field (faq.items[].answer)", () => {
    // faq.items[].answer is richText rendered with set:html — the exact field the
    // live probe injected into, and the reason richField body-only sanitizing was
    // not enough.
    const out = sanitizeAstroidPageSections(config, {
      sections: [
        {
          _type: "faq",
          items: [{ question: "q", answer: "<p>ok</p><script>window.__x=1</script>" }],
        },
      ],
    });
    const answer = (out.sections as { items: { answer: string }[] }[])[0].items[0].answer;
    expect(answer).not.toContain("<script>");
    expect(answer).toContain("ok");
  });

  it("leaves a payload without sections untouched", () => {
    const input = { title: "t", body: "<p>clean</p>" };
    expect(sanitizeAstroidPageSections(config, input)).toEqual(input);
  });

  it("the collection hook sanitizes section rich text too — the paths agree", async () => {
    const out = await runCollectionHook({
      sections: [
        {
          _type: "faq",
          items: [{ question: "q", answer: "<p>ok</p><script>window.__x=1</script>" }],
        },
      ],
    });
    const answer = (out.sections as { items: { answer: string }[] }[])[0].items[0].answer;
    expect(answer).not.toContain("<script>");
  });
});

describe("assertAstroidPageSections", () => {
  it("is a no-op when sections is absent", async () => {
    await expect(assertAstroidPageSections(config, { title: "t" })).resolves.toBeUndefined();
  });
});
