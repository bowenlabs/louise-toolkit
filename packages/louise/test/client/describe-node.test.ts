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
