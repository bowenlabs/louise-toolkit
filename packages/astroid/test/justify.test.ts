import { describe, expect, it } from "vitest";
import { DEFAULT_ASPECT, justifyRows } from "../src/components/justify.js";
import { type AstroidConfig, defineAstroid } from "../src/config.js";
import { generateAstroidGalleryPage } from "../src/portfolio/scaffold.js";

/** Total width a row occupies, gaps included. */
const rowWidth = (row: { boxes: { width: number }[] }, gap: number) =>
  row.boxes.reduce((sum, b) => sum + b.width, 0) + gap * (row.boxes.length - 1);

const square = (n: number) => Array.from({ length: n }, () => ({ aspect: 1 }));

describe("justifyRows", () => {
  it("fills the container width exactly on every stretched row", () => {
    const rows = justifyRows(square(12), { containerWidth: 960, targetHeight: 200, gap: 8 });
    // Rounding each box independently leaves a ragged right edge; the last box
    // absorbing the remainder is what keeps this exact rather than ±2px.
    for (const row of rows.slice(0, -1)) {
      expect(rowWidth(row, 8)).toBe(960);
    }
  });

  it("keeps every box in a row at one height", () => {
    const rows = justifyRows(
      [{ aspect: 1.5 }, { aspect: 0.67 }, { aspect: 1 }, { aspect: 2.2 }, { aspect: 1.3 }],
      { containerWidth: 800, targetHeight: 180, gap: 10 },
    );
    for (const row of rows) {
      expect(new Set(row.boxes.map((b) => b.height)).size).toBe(1);
    }
  });

  it("preserves each item's aspect ratio within a pixel or two of rounding", () => {
    const aspects = [1.5, 0.75, 2.4, 1];
    const rows = justifyRows(
      aspects.map((aspect) => ({ aspect })),
      { containerWidth: 1200, targetHeight: 220, gap: 6 },
    );
    for (const row of rows) {
      for (const box of row.boxes) {
        expect(box.width / box.height).toBeCloseTo(aspects[box.index], 1);
      }
    }
  });

  it("emits every item exactly once, in order", () => {
    const rows = justifyRows(square(17), { containerWidth: 700, targetHeight: 150 });
    const indices = rows.flatMap((r) => r.boxes.map((b) => b.index));
    expect(indices).toEqual([...Array(17).keys()]);
  });

  it("lands rows near the target height", () => {
    const rows = justifyRows(square(20), { containerWidth: 1000, targetHeight: 200, gap: 8 });
    // Rows close as soon as the fitted height drops to the target, so they sit
    // at or just below it — never far above.
    for (const row of rows.slice(0, -1)) {
      expect(row.height).toBeLessThanOrEqual(200);
      expect(row.height).toBeGreaterThan(100);
    }
  });

  it("does not stretch a sparse last row into a giant banner", () => {
    // 6 squares at 1000px wide: the first row closes at 5 (h≈194), leaving one.
    // Stretched, that leftover would be 1000px tall beside a ~194px row.
    const rows = justifyRows(square(6), { containerWidth: 1000, targetHeight: 240, gap: 8 });
    const last = rows[rows.length - 1];
    expect(last.boxes.length).toBe(1);
    expect(last.height).toBeLessThanOrEqual(240 * 1.5);
    // And it keeps its natural width rather than spanning the container.
    expect(last.boxes[0].width).toBeLessThan(1000);
  });

  it("does stretch a last row that is nearly full", () => {
    // 7 squares at target 300: a row of 4 closes, leaving 3 — which fit at
    // h≈328, inside the slack allowance, so they justify to the full width.
    const rows = justifyRows(square(7), { containerWidth: 1000, targetHeight: 300, gap: 8 });
    const last = rows[rows.length - 1];
    expect(last.boxes.length).toBe(3);
    expect(rowWidth(last, 8)).toBe(1000);
  });

  it("substitutes a sane aspect for an image that hasn't decoded yet", () => {
    // A zero/NaN ratio would divide the row height to Infinity and take the
    // whole grid with it — this is the SSR-before-decode case, not an edge case.
    const rows = justifyRows([{ aspect: 0 }, { aspect: Number.NaN }, { aspect: 1 }], {
      containerWidth: 900,
      targetHeight: 200,
      gap: 8,
    });
    for (const row of rows) {
      for (const box of row.boxes) {
        expect(Number.isFinite(box.width)).toBe(true);
        expect(Number.isFinite(box.height)).toBe(true);
        expect(box.width).toBeGreaterThan(0);
      }
    }
    // The fallback is the common photographic frame, so first paint is close.
    expect(rows[0].boxes[0].width / rows[0].boxes[0].height).toBeCloseTo(DEFAULT_ASPECT, 1);
  });

  it("returns nothing rather than NaN boxes when the container is unmeasured", () => {
    // Server render with no width, or a display:none parent. The caller renders
    // its own fallback; boxes at NaN would poison the DOM.
    expect(justifyRows(square(4), { containerWidth: 0, targetHeight: 200 })).toEqual([]);
    expect(justifyRows(square(4), { containerWidth: Number.NaN, targetHeight: 200 })).toEqual([]);
    expect(justifyRows(square(4), { containerWidth: 900, targetHeight: 0 })).toEqual([]);
    expect(justifyRows([], { containerWidth: 900, targetHeight: 200 })).toEqual([]);
  });

  it("handles one very wide panorama without collapsing the row", () => {
    const rows = justifyRows([{ aspect: 8 }], { containerWidth: 600, targetHeight: 200 });
    expect(rows).toHaveLength(1);
    expect(rows[0].boxes[0].height).toBeGreaterThanOrEqual(1);
    expect(rows[0].boxes[0].width).toBeGreaterThan(0);
  });

  it("never emits a zero-width box on a crowded row", () => {
    // 30 tall portraits in a narrow container drives per-box width toward zero.
    const rows = justifyRows(Array.from({ length: 30 }, () => ({ aspect: 0.4 })), {
      containerWidth: 320,
      targetHeight: 120,
      gap: 4,
    });
    for (const row of rows) {
      for (const box of row.boxes) expect(box.width).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("generateAstroidGalleryPage", () => {
  const config = (archetype: AstroidConfig["archetype"]): AstroidConfig =>
    defineAstroid({
      key: "acme",
      archetype,
      theme: { name: "Acme", colors: { brand: "#123456" } },
    });

  it("scaffolds a gallery page for the portfolio archetype only", () => {
    expect(generateAstroidGalleryPage(config("portfolio"))).toContain("JustifiedGallery");
    for (const other of ["marketing", "storefront", "wholesale"] as const) {
      expect(generateAstroidGalleryPage(config(other))).toBeNull();
    }
  });

  it("emits balanced frontmatter fences", () => {
    // An unbalanced `---` turns the whole component into frontmatter and the
    // page renders blank — a failure that only shows up at build time.
    const page = generateAstroidGalleryPage(config("portfolio")) as string;
    expect(page.split("\n").filter((l) => l.trim() === "---")).toHaveLength(2);
    expect(page.startsWith("---\n")).toBe(true);
  });

  it("carries intrinsic dimensions through so first paint isn't a guess", () => {
    const page = generateAstroidGalleryPage(config("portfolio")) as string;
    expect(page).toContain("width, height FROM media");
    expect(page).toContain("row.width");
    expect(page).toContain("row.height");
  });

  it("defaults a missing alt to empty string, never the filename", () => {
    const page = generateAstroidGalleryPage(config("portfolio")) as string;
    expect(page).toContain('alt: row.alt ?? ""');
    expect(page).not.toContain("alt: row.key");
  });

  it("builds media URLs from the configured media base", () => {
    const custom = defineAstroid({
      key: "acme",
      archetype: "portfolio",
      theme: { name: "Acme", colors: { brand: "#123456" } },
      deploy: { platform: "cloudflare", mediaBase: "/assets" },
    });
    expect(generateAstroidGalleryPage(custom)).toContain("`/assets/${row.key}`");
  });
});
