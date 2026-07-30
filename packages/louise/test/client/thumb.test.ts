import { describe, expect, it } from "vitest";
import { thumb } from "../../src/client/thumb.js";

const MASTER = "https://media.example.com/originals/camera-master.jpg";

describe("thumb", () => {
  it("asks for a derivative at 2× the display box", () => {
    // The whole point: a 120px tile fetches ~240px, not a 6MB master.
    const url = new URL(thumb(MASTER, 120));
    expect(url.pathname).toContain("/cdn-cgi/image/");
    expect(url.pathname).toContain("width=240");
    expect(url.pathname).toContain("fit=cover");
    expect(url.pathname).toContain("quality=75");
    // `auto` so the CDN serves AVIF/WebP per Accept rather than a fixed encode.
    expect(url.pathname).toContain("format=auto");
  });

  it("keeps the original path so the asset still resolves", () => {
    expect(thumb(MASTER, 120)).toContain("/originals/camera-master.jpg");
  });

  it("passes non-http values through untouched", () => {
    // Every call site renders whatever the field holds, which is not always a
    // media-library URL. Guarding here is what keeps the call sites clean.
    expect(thumb("", 120)).toBe("");
    expect(thumb("/local/placeholder.png", 120)).toBe("/local/placeholder.png");
    expect(thumb("data:image/gif;base64,R0lGOD", 120)).toBe("data:image/gif;base64,R0lGOD");
  });

  it("does not double-wrap an already-transformed URL", () => {
    const once = thumb(MASTER, 120);
    expect(thumb(once, 240)).toBe(once);
  });
});
