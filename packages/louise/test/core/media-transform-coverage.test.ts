// core/media/transform—Image Resizing URLs, width-descriptor srcsets, and the
// Images binding re-encode (#695).
import { describe, expect, it } from "vitest";
import { cfImage, cfImageSrcset, transformImage } from "../../src/core/media/transform.js";

const SRC = "https://media.example.com/web/photo.jpg";

describe("cfImage", () => {
  it("writes every option in a fixed order and keeps the query string", () => {
    expect(
      cfImage(`${SRC}?v=2`, {
        width: 640,
        height: 400,
        fit: "contain",
        gravity: "top",
        format: "webp",
        quality: 70,
      }),
    ).toBe(
      "https://media.example.com/cdn-cgi/image/width=640,height=400,fit=contain,gravity=top,format=webp,quality=70/web/photo.jpg?v=2",
    );
  });

  it("emits only the format when no other option is set", () => {
    expect(cfImage(SRC, {})).toBe(
      "https://media.example.com/cdn-cgi/image/format=auto/web/photo.jpg",
    );
  });

  it("returns an empty string or an unparsable URL untouched", () => {
    expect(cfImage("", { width: 100 })).toBe("");
    expect(cfImage("https://", { width: 100 })).toBe("https://");
    expect(cfImage("http://exa mple.com/a.png", { width: 100 })).toBe("http://exa mple.com/a.png");
  });
});

describe("cfImageSrcset", () => {
  it("derives heights from a ratio and lists sorted width descriptors", () => {
    const { src, srcset } = cfImageSrcset(SRC, { width: 800, ratio: "16/10" });
    expect(src).toBe(
      "https://media.example.com/cdn-cgi/image/width=800,height=500,fit=cover,gravity=auto,format=auto,quality=82/web/photo.jpg",
    );
    const entries = srcset.split(", ");
    expect(entries.map((e) => e.split(" ")[1])).toEqual(["400w", "600w", "800w", "1200w", "1600w"]);
    expect(entries[0]).toContain("width=400,height=250,");
    expect(entries[4]).toContain("width=1600,height=1000,");
  });

  it("omits height without a ratio and honors custom knobs", () => {
    const { src, srcset } = cfImageSrcset(SRC, {
      width: 300,
      steps: [2, 1, 1],
      fit: "scale-down",
      gravity: "center",
      quality: 60,
    });
    expect(src).toBe(
      "https://media.example.com/cdn-cgi/image/width=300,fit=scale-down,gravity=center,format=auto,quality=60/web/photo.jpg",
    );
    // Duplicate steps collapse, and the list sorts ascending.
    expect(srcset.split(", ").map((e) => e.split(" ")[1])).toEqual(["300w", "600w"]);
  });

  it("tolerates spaces in the ratio and ignores a malformed one", () => {
    expect(cfImageSrcset(SRC, { width: 100, ratio: " 4 / 3 ", steps: [1] }).src).toContain(
      "width=100,height=75,",
    );
    expect(cfImageSrcset(SRC, { width: 100, ratio: "wide", steps: [1] }).src).not.toContain(
      "height=",
    );
  });

  it("passes a relative URL through for every entry", () => {
    const { src, srcset } = cfImageSrcset("/local.jpg", { width: 100, steps: [1, 2] });
    expect(src).toBe("/local.jpg");
    expect(srcset).toBe("/local.jpg 100w, /local.jpg 200w");
  });
});

describe("transformImage", () => {
  /** A fake Images binding that records what it was given. */
  function images() {
    const seen: { input?: unknown; transform?: unknown; output?: unknown } = {};
    const binding = {
      input(stream: unknown) {
        seen.input = stream;
        const t = {
          transform(opts: unknown) {
            seen.transform = opts;
            return t;
          },
          async output(opts: { format: string }) {
            seen.output = opts;
            return {
              response: () => new Response("encoded", { headers: { "content-type": opts.format } }),
            };
          },
        };
        return t;
      },
    } as unknown as ImagesBinding;
    return { binding, seen };
  }

  it("passes a ReadableStream through untouched", async () => {
    const { binding, seen } = images();
    const stream = new Blob([new Uint8Array([1, 2])]).stream();
    const res = await transformImage(binding, stream, {
      format: "png",
      fit: "pad",
      gravity: "face",
    });
    expect(seen.input).toBe(stream);
    expect(seen.transform).toEqual({
      width: undefined,
      height: undefined,
      fit: "pad",
      gravity: "face",
    });
    expect(seen.output).toEqual({ format: "image/png", quality: 82 });
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(await res.text()).toBe("encoded");
  });

  it("wraps an ArrayBuffer in a stream carrying the same bytes", async () => {
    const { binding, seen } = images();
    await transformImage(binding, new Uint8Array([7, 8, 9]).buffer);
    expect(seen.input).toBeInstanceOf(ReadableStream);
    const bytes = new Uint8Array(await new Response(seen.input as ReadableStream).arrayBuffer());
    expect([...bytes]).toEqual([7, 8, 9]);
  });
});
