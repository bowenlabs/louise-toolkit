import type { SectionCatalog, SectionItem } from "louise-toolkit/content";
import { describe, expect, it } from "vitest";
import {
  collectSectionMediaUrls,
  mediaKeyFromUrl,
  resolveSectionMedia,
} from "../src/components/media-meta.js";
import {
  alignClass,
  astroidSectionCatalog,
  COLORWAY_CLASS,
  type Colorway,
  colorwayClass,
  field,
  isRenderableSection,
  itemField,
  list,
  setting,
} from "../src/components/sections.js";

describe("astroidSectionCatalog", () => {
  it("declares a def for every type the dispatcher renders", () => {
    for (const type of ["hero", "featureGrid", "cta", "contact"]) {
      expect(isRenderableSection(type)).toBe(true);
      expect(astroidSectionCatalog[type].label).toBeTruthy();
    }
  });

  it("rejects a type it has no component for", () => {
    // An unknown `_type` is legitimate mid-migration; `<Sections>` skips it
    // rather than rendering a hole.
    expect(isRenderableSection("marquee")).toBe(false);
    expect(isRenderableSection("")).toBe(false);
    // Guards against inherited Object.prototype keys being read as section types.
    expect(isRenderableSection("toString")).toBe(false);
    expect(isRenderableSection("constructor")).toBe(false);
  });

  it("declares token settings as closed choices, not free text (#272)", () => {
    const { colorway, align } = astroidSectionCatalog.hero.settings ?? {};
    expect(colorway?.type).toBe("select");
    expect(align?.type).toBe("select");
    // Non-inline: a token isn't something you can type on the design.
    expect(colorway?.inline).toBe(false);
  });

  it("derives picker options from the token maps so they cannot drift", () => {
    // The regression this guards: adding a colorway to COLORWAY_CLASS but
    // forgetting to add it to the options list, so the inspector offers a set
    // that differs from what the site can actually render.
    const options = astroidSectionCatalog.hero.settings?.colorway?.options ?? [];
    expect(options.map((o) => o.value).sort()).toEqual(Object.keys(COLORWAY_CLASS).sort());
    for (const option of options) {
      expect(colorwayClass(option.value)).toBe(COLORWAY_CLASS[option.value as Colorway]);
    }
  });

  it("keeps link URLs out of in-place editing", () => {
    // You can't point at a URL on the page, so it belongs in the inspector.
    expect(astroidSectionCatalog.hero.fields.ctaHref.inline).toBe(false);
    expect(astroidSectionCatalog.cta.fields.ctaHref.inline).toBe(false);
    // Visible copy stays inline (the default for text/textarea).
    expect(astroidSectionCatalog.hero.fields.heading.inline).toBeUndefined();
  });

  it("models repeatables as a real array, not numbered slots", () => {
    const items = astroidSectionCatalog.featureGrid.fields.items;
    expect(items.type).toBe("array");
    expect(Object.keys(items.itemFields ?? {})).toEqual(["title", "body"]);
    // The `card1…card6` flattening other sites fall back to would show up here.
    expect(Object.keys(astroidSectionCatalog.featureGrid.fields)).not.toContain("card1");
  });
});

describe("token resolution", () => {
  const item = (settings?: Record<string, unknown>): SectionItem => ({
    _type: "hero",
    ...(settings ? { _settings: settings } : {}),
  });

  it("maps stored tokens to site-owned classes", () => {
    expect(colorwayClass(setting(item({ colorway: "brand" }), "colorway"))).toBe(
      "bg-primary text-primary-content",
    );
    expect(alignClass(setting(item({ align: "center" }), "align"))).toBe(
      "text-center items-center",
    );
  });

  it("falls back rather than throwing on a token that isn't in the map", () => {
    // `_settings` is untrusted JSON. A stale or hand-edited token must degrade
    // to the default, not take the page's render down.
    expect(colorwayClass(setting(item({ colorway: "chartreuse" }), "colorway"))).toBe(
      colorwayClass("base"),
    );
    expect(colorwayClass(setting(item({ colorway: 42 }), "colorway", "base"))).toBe(
      colorwayClass("base"),
    );
    expect(alignClass(setting(item(), "align", "center"))).toBe("text-center items-center");
  });
});

describe("field readers", () => {
  it("reads strings and ignores anything else", () => {
    const item: SectionItem = { _type: "hero", heading: "Hi", subheading: 7 as unknown as string };
    expect(field(item, "heading")).toBe("Hi");
    expect(field(item, "subheading")).toBeUndefined();
    expect(field(item, "missing")).toBeUndefined();
  });

  it("drops non-object entries from an array field", () => {
    const item: SectionItem = {
      _type: "featureGrid",
      items: [{ title: "A" }, "nope", null, ["x"], { title: "B" }],
    };
    expect(list(item, "items")).toEqual([{ title: "A" }, { title: "B" }]);
    expect(list(item, "absent")).toEqual([]);
    expect(itemField({ title: "A" }, "title")).toBe("A");
    expect(itemField({ title: 1 }, "title")).toBeUndefined();
  });
});

describe("collectSectionMediaUrls", () => {
  const catalog: SectionCatalog = {
    banner: { label: "Banner", fields: { image: { type: "image" }, heading: { type: "text" } } },
    gallery: {
      label: "Gallery",
      fields: {
        shots: { type: "array", itemFields: { src: { type: "image" }, alt: { type: "text" } } },
      },
    },
  };

  it("finds image fields at the top level and inside arrays", () => {
    const urls = collectSectionMediaUrls(
      [
        { _type: "banner", image: "/media/a.jpg", heading: "not a url" },
        { _type: "gallery", shots: [{ src: "/media/b.jpg" }, { src: "/media/c.jpg" }] },
      ],
      catalog,
    );
    expect(urls.sort()).toEqual(["/media/a.jpg", "/media/b.jpg", "/media/c.jpg"]);
  });

  it("deduplicates — the same asset used twice is one lookup", () => {
    const urls = collectSectionMediaUrls(
      [
        { _type: "banner", image: "/media/a.jpg" },
        { _type: "banner", image: "/media/a.jpg" },
      ],
      catalog,
    );
    expect(urls).toEqual(["/media/a.jpg"]);
  });

  it("is schema-driven — a text field holding a URL-ish string is not collected", () => {
    // The whole point of walking the catalog rather than sniffing values.
    const urls = collectSectionMediaUrls(
      [{ _type: "banner", heading: "/media/decoy.jpg" }],
      catalog,
    );
    expect(urls).toEqual([]);
  });

  it("ignores an unknown section type and empty values", () => {
    expect(
      collectSectionMediaUrls(
        [{ _type: "nope", image: "/media/x.jpg" }, { _type: "banner", image: "" }],
        catalog,
      ),
    ).toEqual([]);
  });

  it("walks blocks against the block catalog", () => {
    const urls = collectSectionMediaUrls(
      [{ _type: "banner", image: "/media/a.jpg", blocks: [{ _type: "figure", pic: "/media/d.jpg" }] }],
      catalog,
      { figure: { label: "Figure", fields: { pic: { type: "image" } } } },
    );
    expect(urls.sort()).toEqual(["/media/a.jpg", "/media/d.jpg"]);
  });

  it("picks up an image declared only on a discriminated variant", () => {
    const disc: SectionCatalog = {
      rich: {
        label: "Rich",
        fields: {
          // NOT named `blocks` — that key is reserved for the structural block
          // layer (`SectionItem.blocks: BlockItem[]`), so a catalog field of that
          // name would shadow it. The type checker catches this.
          parts: {
            type: "array",
            itemFields: { kind: { type: "text" } },
            discriminator: {
              key: "kind",
              variants: { image: { src: { type: "image" } }, quote: { text: { type: "text" } } },
            },
          },
        },
      },
    };
    const urls = collectSectionMediaUrls(
      [{ _type: "rich", parts: [{ kind: "image", src: "/media/v.jpg" }, { kind: "quote", text: "hi" }] }],
      disc,
    );
    expect(urls).toEqual(["/media/v.jpg"]);
  });
});

describe("mediaKeyFromUrl", () => {
  it("strips the media base", () => {
    expect(mediaKeyFromUrl("/media/photo.jpg", "/media")).toBe("photo.jpg");
    expect(mediaKeyFromUrl("/media/photo.jpg", "/media/")).toBe("photo.jpg");
    expect(mediaKeyFromUrl("/assets/photo.jpg", "/assets")).toBe("photo.jpg");
  });

  it("handles an absolute media origin", () => {
    expect(mediaKeyFromUrl("https://media.acme.test/photo.jpg", "/media")).toBe("photo.jpg");
  });

  it("returns null for nothing usable", () => {
    expect(mediaKeyFromUrl("", "/media")).toBeNull();
  });
});

describe("resolveSectionMedia", () => {
  /** A D1 stub that records the SQL + binds it was given. */
  const db = (rows: { key: string; alt: string | null; caption: string | null }[]) => {
    const calls: { sql: string; binds: unknown[] }[] = [];
    return {
      calls,
      prepare(sql: string) {
        return {
          bind(...binds: unknown[]) {
            calls.push({ sql, binds });
            return {
              async all<T>() {
                return { results: rows.filter((r) => binds.includes(r.key)) as T[] };
              },
            };
          },
        };
      },
    };
  };

  it("resolves alt/caption keyed by the URL the section stored", async () => {
    const meta = await resolveSectionMedia(
      db([{ key: "a.jpg", alt: "An A", caption: "Cap" }]),
      ["/media/a.jpg"],
      "/media",
    );
    expect(meta["/media/a.jpg"]).toEqual({ alt: "An A", caption: "Cap" });
  });

  it("uses ONE statement for a whole page's images", async () => {
    const stub = db([]);
    await resolveSectionMedia(stub, ["/media/a.jpg", "/media/b.jpg", "/media/c.jpg"], "/media");
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].sql).toContain("IN (?, ?, ?)");
    expect(stub.calls[0].binds).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  });

  it("chunks past SQLite's parameter ceiling instead of building one huge IN()", async () => {
    const urls = Array.from({ length: 250 }, (_, i) => `/media/${i}.jpg`);
    const stub = db([]);
    await resolveSectionMedia(stub, urls, "/media");
    // 250 keys at 100 per statement — and no statement over the limit.
    expect(stub.calls).toHaveLength(3);
    for (const call of stub.calls) expect(call.binds.length).toBeLessThanOrEqual(100);
    expect(stub.calls.flatMap((c) => c.binds)).toHaveLength(250);
  });

  it("maps one asset back onto every URL that referenced it", async () => {
    const meta = await resolveSectionMedia(
      db([{ key: "a.jpg", alt: "An A", caption: null }]),
      ["/media/a.jpg", "https://media.acme.test/a.jpg"],
      "/media",
    );
    expect(meta["/media/a.jpg"]?.alt).toBe("An A");
    expect(meta["https://media.acme.test/a.jpg"]?.alt).toBe("An A");
  });

  it("omits empty alt/caption rather than storing empty strings", async () => {
    const meta = await resolveSectionMedia(
      db([{ key: "a.jpg", alt: null, caption: null }]),
      ["/media/a.jpg"],
      "/media",
    );
    expect(meta["/media/a.jpg"]).toEqual({});
  });

  it("degrades to {} when there is no database or nothing to look up", async () => {
    expect(await resolveSectionMedia(undefined, ["/media/a.jpg"])).toEqual({});
    expect(await resolveSectionMedia(db([]), [])).toEqual({});
  });

  it("survives a media table that isn't provisioned yet", async () => {
    // Missing alt text degrades a page; it must not take the render down.
    const broken = {
      prepare() {
        return {
          bind() {
            return {
              async all() {
                throw new Error("no such table: media");
              },
            };
          },
        };
      },
    };
    await expect(resolveSectionMedia(broken, ["/media/a.jpg"], "/media")).resolves.toEqual({});
  });
});
