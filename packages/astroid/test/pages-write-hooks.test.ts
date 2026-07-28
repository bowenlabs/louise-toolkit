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

// ADR 0005 block layer. Both write paths have to resolve a block's def to check
// (or scrub) it, and unlike the section catalog there's no built-in vocabulary to
// fall back on — block types are wholly site-defined. So `config.blockCatalog` is
// load-bearing: without it the on-canvas block toolbar appears to work and every
// save 422s.
describe("astroidPagesWriteHooks — block catalog (ADR 0005)", () => {
  const sectionCatalog = {
    content: { label: "Content", fields: {}, blocks: { allow: ["text"] } },
  };
  const blockCatalog = {
    text: { label: "Text", fields: { body: { type: "richText" as const } } },
  };
  const withBlocks: AstroidConfig = { ...config, sectionCatalog, blockCatalog };
  const withoutBlocks: AstroidConfig = { ...config, sectionCatalog };

  const page = (body = "hi") => ({
    sections: [{ _type: "content", blocks: [{ _type: "text", body }] }],
  });

  it("rejects every block as unknown when no blockCatalog is configured", async () => {
    // The regression this seam fixes: the section type resolves fine, so the write
    // looks valid right up until the block's own def can't be found.
    await expect(
      astroidPagesWriteHooks(withoutBlocks).validate(page(), { operation: "update" }),
    ).rejects.toThrow(/unknown block type/i);
  });

  it("accepts the same write once the blockCatalog is configured (both paths)", async () => {
    await expect(
      astroidPagesWriteHooks(withBlocks).validate(page(), { operation: "update" }),
    ).resolves.toBeUndefined();

    const hook = astroidPagesCollection(withBlocks).hooks?.beforeChange?.[0];
    if (!hook) throw new Error("pages collection has no beforeChange hook");
    await expect(hook({ data: page() } as never)).resolves.toBeDefined();
  });

  it("still rejects a block type the section's `allow` policy excludes", async () => {
    const bad = { sections: [{ _type: "content", blocks: [{ _type: "image" }] }] };
    await expect(
      astroidPagesWriteHooks(withBlocks).validate(bad, { operation: "update" }),
    ).rejects.toThrow(/not allowed in this section/i);
  });

  it("sanitizes a block's rich text — the catalog gates scrubbing, not just validation", () => {
    const out = sanitizeAstroidPageSections(withBlocks, page("<p>ok</p><script>x=1</script>"));
    const body = (out.sections as { blocks: { body: string }[] }[])[0].blocks[0].body;
    expect(body).not.toContain("<script>");
    expect(body).toContain("ok");
  });
});

describe("site sectionCatalog injection (FW-2)", () => {
  // A site with bespoke sections (coracle's `homeHero` etc.) registers its own
  // catalog; the write hooks must then validate ITS `_type`s, not the built-in
  // vocabulary — and still reject anything outside the site's own catalog.
  const siteConfig: AstroidConfig = {
    ...config,
    sectionCatalog: {
      homeHero: {
        label: "Home hero",
        icon: "ph ph-sparkle",
        fields: { heading: { type: "text" }, body: { type: "textarea" } },
      },
    },
  };
  const siteHooks = astroidPagesWriteHooks(siteConfig);

  it("accepts a site `_type` that the built-in catalog would reject", async () => {
    const section = { sections: [{ _type: "homeHero", heading: "Hi" }] };
    // built-in catalog has no `homeHero` → rejects
    await expect(hooks.validate(section, { operation: "update" })).rejects.toThrow(
      /unknown section type/i,
    );
    // the site catalog has it → accepts
    await expect(siteHooks.validate(section, { operation: "update" })).resolves.toBeUndefined();
  });

  it("still rejects a `_type` outside the site catalog", async () => {
    await expect(
      siteHooks.validate({ sections: [{ _type: "hero", heading: "x" }] }, { operation: "update" }),
    ).rejects.toThrow(/unknown section type/i);
  });
});
