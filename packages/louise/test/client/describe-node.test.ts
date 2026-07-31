// `describeNode` — the catalog→chrome seam (ADR 0010).
//
// This is the only place that knows a section from a block from a field, so it's
// where the interesting judgements live: whether a node can hold children,
// whether it has anything worth a wrench, and what happens to a path that no
// longer addresses anything.

import { describe, expect, it } from "vitest";
import type { BlockCatalog, SectionCatalog, SectionItem } from "../../src/core/content/sections.js";
import { describeNode } from "../../src/client/describe-node.js";

const catalog: SectionCatalog = {
  hero: {
    label: "Hero",
    // Inline-only: a heading is edited on the canvas, so there is nothing to
    // inspect and the wrench should stay away.
    fields: { heading: { type: "text" } },
  },
  content: {
    label: "Content",
    fields: { heading: { type: "richText" } },
    blocks: { allow: ["text", "button"] },
  },
  cta: {
    label: "Call to action",
    fields: {
      label: { type: "text" },
      href: { type: "link", label: "Button link", inline: false },
    },
  },
  tiles: {
    label: "Tiles",
    fields: { heading: { type: "text" } },
    layouts: { two: { label: "2 up" } },
  },
};

const blocks: BlockCatalog = {
  text: { label: "Text", fields: { body: { type: "richText" } } },
  button: {
    label: "Button",
    fields: { label: { type: "text" }, href: { type: "link", inline: false } },
  },
};

const items: SectionItem[] = [
  { _type: "hero", heading: "Hi" },
  { _type: "content", blocks: [{ _type: "text", body: "<p>x</p>" }, { _type: "button" }] },
  { _type: "content", blocks: [] },
  { _type: "cta", label: "Shop", href: "/shop" },
  { _type: "tiles", heading: "T" },
];

const ctx = { items, catalog, blocks };
const at = (path: (string | number)[]) => describeNode(path, ctx);

describe("describeNode — sections", () => {
  it("is ordered within the page and labelled", () => {
    expect(at([0])).toMatchObject({
      ordered: { index: 0, count: 5 },
      tone: "section",
      label: "Hero",
    });
  });

  it("is a container only when its def opts into blocks", () => {
    expect(at([1])?.children).toEqual({ count: 2 });
    // `hero` declares no block policy, so it holds nothing — and must not offer
    // an add-first button.
    expect(at([0])?.children).toBeUndefined();
  });

  it("reports zero children for an empty container", () => {
    // This is what drives the add-first affordance. Pre-0010 this state was a
    // dead end: no child to hover, so no `+` anywhere.
    expect(at([2])?.children).toEqual({ count: 0 });
  });

  // The chrome can't name what goes inside a container — its own label describes
  // the container, and using it produced "Add the first Hero" on a hero whose
  // children are CTAs (live QA, 2026-07-28). So the name is resolved here, where
  // the block policy actually is.
  it("names the child when the container accepts exactly one kind", () => {
    const one = {
      items: [{ _type: "strip", blocks: [] }] as SectionItem[],
      catalog: { strip: { label: "Strip", fields: {}, blocks: { allow: ["text"] } } },
      blocks,
    };
    expect(describeNode([0], one)?.children).toEqual({ count: 0, label: "Text" });
  });

  it("gives no child name when several kinds are allowed", () => {
    // `content` takes text OR button — there is no singular answer, and inventing
    // one would misname whichever the editor actually picks.
    expect(at([2])?.children).toEqual({ count: 0 });
  });

  it("names the child from the whole catalog when the policy bounds nothing", () => {
    // `allow` omitted means "any block type" (ADR 0005 §4), so a one-entry
    // catalog still has a single answer.
    const open = {
      items: [{ _type: "open", blocks: [] }] as SectionItem[],
      catalog: { open: { label: "Open", fields: {}, blocks: {} } },
      blocks: { text: blocks.text },
    };
    expect(describeNode([0], open)?.children).toEqual({ count: 0, label: "Text" });
  });

  it("holds nothing when the editor was given no block catalog", () => {
    // The `+` seeds a blank from the block's field shape, so without a catalog
    // there is nothing to add and the capability must not appear.
    expect(describeNode([1], { items, catalog })?.children).toBeUndefined();
  });

  it("offers a wrench only when there is something to configure", () => {
    // `hero` is a single inline heading — an inspector would read "Nothing to
    // configure here yet", which is exactly what live QA saw.
    expect(at([0])?.fields).toBe(false);
    // A non-inline field counts…
    expect(at([3])?.fields).toBe(true);
    // …and so does a layout picker, even with only inline fields.
    expect(at([4])?.fields).toBe(true);
  });
});

describe("describeNode — blocks", () => {
  it("is ordered within its own section, not the page", () => {
    expect(at([1, "blocks", 1])).toMatchObject({
      ordered: { index: 1, count: 2 },
      tone: "block",
      label: "Button",
    });
  });

  it("holds nothing today, since no block declares a block policy", () => {
    expect(at([1, "blocks", 0])?.children).toBeUndefined();
  });

  it("offers a wrench only when the block has non-inline fields", () => {
    expect(at([1, "blocks", 0])?.fields).toBe(false); // text: inline body only
    expect(at([1, "blocks", 1])?.fields).toBe(true); // button: an href
  });
});

describe("describeNode — fields", () => {
  it("describes a section field as an inspectable value with no position", () => {
    expect(at([3, "href"])).toEqual({ fields: true, tone: "value", label: "Button link" });
  });

  it("describes a block field the same way", () => {
    expect(at([1, "blocks", 1, "href"])).toMatchObject({ fields: true, tone: "value" });
  });

  it("falls back to the key when the field declares no label", () => {
    expect(at([1, "blocks", 1, "href"])?.label).toBe("href");
  });

  it("never reports a position, so a value can't offer move or delete", () => {
    // Where a CTA sits belongs to whatever contains it — this absence is what
    // makes the wrench-only toolbar fall out instead of being hand-built.
    expect(at([3, "href"])?.ordered).toBeUndefined();
    expect(at([3, "href"])?.children).toBeUndefined();
  });
});

describe("describeNode — paths that address nothing", () => {
  it.each([
    ["a section past the end", [9]],
    ["a section whose type left the catalog", [0, "nope"]],
    ["a block past the end", [1, "blocks", 9]],
    ["blocks on a section that holds none", [0, "blocks", 0]],
    ["a field the catalog dropped", [3, "goneField"]],
    ["a block field the catalog dropped", [1, "blocks", 1, "goneField"]],
    ["a non-numeric first segment", ["blocks", 0]],
    ["an unknown collection key", [1, "items", 0]],
    ["a path deeper than anything real", [1, "blocks", 0, "body", "extra"]],
  ])("returns null for %s", (_label, path) => {
    // A stale marker must resolve to nothing rather than to a wrench over
    // something that no longer exists — the chrome then treats it as unmarked.
    expect(at(path as (string | number)[])).toBeNull();
  });
});

describe("describeNode — the source model (ADR 0010 Phase B)", () => {
  const external: SectionCatalog = {
    productGrid: {
      label: "Product grid",
      source: "external",
      fields: { heading: { type: "text" } },
      settings: { categoryId: { type: "select", inline: false, options: [] } },
    },
  };
  const extCtx = { items: [{ _type: "productGrid" }] as SectionItem[], catalog: external };

  it("tones an external-source section external, leaving its capabilities alone", () => {
    // The page still owns the section's position and inspector; only the tone
    // says its CONTENT mirrors a system the site doesn't own.
    expect(describeNode([0], extCtx)).toMatchObject({
      ordered: { index: 0, count: 1 },
      fields: true,
      tone: "external",
      label: "Product grid",
    });
  });

  it("resolves a declared shared key to a wrench-only green node", () => {
    const d = describeNode(["settings", "addressStreet"], {
      ...ctx,
      shared: { addressStreet: { label: "Street address" } },
    });
    expect(d).toEqual({ fields: true, tone: "shared", label: "Street address" });
  });

  it("falls back to the key when a shared def has no label", () => {
    const d = describeNode(["settings", "phone"], { ...ctx, shared: { phone: {} } });
    expect(d).toMatchObject({ tone: "shared", label: "phone" });
  });

  it.each([
    ["an undeclared shared key", ["settings", "nope"]],
    ["a shared path with no key", ["settings"]],
    ["a shared path deeper than a key", ["settings", "hours", "monday"]],
  ])("returns null for %s", (_label, path) => {
    // Same stale-marker rule as everywhere else: a settings marker the editor
    // wasn't told about reads as unmarked, not as a wrench over a mystery.
    expect(
      describeNode(path as (string | number)[], {
        ...ctx,
        shared: { hours: { label: "Hours" } },
      }),
    ).toBeNull();
  });

  it("returns null for any settings path when no shared map is given", () => {
    expect(describeNode(["settings", "addressStreet"], ctx)).toBeNull();
  });
});
