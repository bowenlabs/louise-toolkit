import { describe, expect, it } from "vitest";
import { type AstroidConfig, defineAstroid } from "../src/config.js";
import { AstroidConfigError } from "../src/errors.js";
import { generateAstroidWorker } from "../src/worker/generate.js";

// `media.maxUploadBytes` exists because the default 10 MB is wrong for the
// projects where the MASTERS are the product — a painter's or photographer's
// portfolio uploads 40 MB camera files and serves only resized derivatives, so
// the master's size costs storage, not page weight. Before this option the
// generated `mediaRoute(...)` call was a fixed string, and a site had no seam
// at all: hand-editing the generated worker is undone by the next `generate`.
const base: AstroidConfig = {
  key: "acme",
  archetype: "portfolio",
  theme: { name: "Acme", colors: { brand: "#1f6e6d" } },
};

const MB = 1024 * 1024;

describe("media.maxUploadBytes → generated worker", () => {
  it("omits maxBytes entirely when unset, so the route keeps the toolkit default", () => {
    const worker = generateAstroidWorker(defineAstroid(base));
    expect(worker).toContain("mediaRoute({");
    expect(worker).not.toContain("maxBytes");
  });

  it("emits the byte count when a site raises it", () => {
    const worker = generateAstroidWorker(defineAstroid({ ...base, media: { maxUploadBytes: 40 * MB } }));
    expect(worker).toContain(`maxBytes: ${40 * MB}`);
  });

  it("keeps the rest of the media route intact", () => {
    const worker = generateAstroidWorker(defineAstroid({ ...base, media: { maxUploadBytes: 40 * MB } }));
    expect(worker).toContain("table: media");
    expect(worker).toContain("referenceSources: MEDIA_REFERENCE_SOURCES");
    expect(worker).toContain("altText: aiRunner");
  });
});

describe("media.maxUploadBytes validation", () => {
  it("rejects a value above Cloudflare's 100 MB request-body limit", () => {
    // The edge rejects the body before any handler runs, so a limit above it
    // could never be honoured — and the editor would see an opaque failure
    // rather than the media route's own 413.
    expect(() => defineAstroid({ ...base, media: { maxUploadBytes: 120 * MB } })).toThrow(
      AstroidConfigError,
    );
    expect(() => defineAstroid({ ...base, media: { maxUploadBytes: 120 * MB } })).toThrow(
      /100 MB request-body limit/,
    );
  });

  it("accepts exactly the limit", () => {
    expect(() => defineAstroid({ ...base, media: { maxUploadBytes: 100 * MB } })).not.toThrow();
  });

  it("rejects zero, negatives, and non-integers — a common megabytes-not-bytes slip", () => {
    for (const bad of [0, -1, 40.5]) {
      expect(() => defineAstroid({ ...base, media: { maxUploadBytes: bad } })).toThrow(
        /positive integer number of BYTES/,
      );
    }
  });
});
