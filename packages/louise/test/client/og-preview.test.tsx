// happy-dom coverage for the live OG/social-card preview (issue #76): the pure
// image-vs-card decision, and that the component renders the generated card as
// inline SVG (no `data:` image) or a custom image when one is set.

import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { OgPreview, ogPreviewContent } from "../../src/client/settings/og-preview.jsx";

describe("ogPreviewContent", () => {
  it("uses a non-empty custom image, trimmed", () => {
    expect(ogPreviewContent("  https://cdn/x.jpg  ", "Hello")).toEqual({
      kind: "image",
      src: "https://cdn/x.jpg",
    });
  });

  it("generates a card from the title when there is no custom image", () => {
    const c = ogPreviewContent("", "My Page Title");
    expect(c.kind).toBe("card");
    if (c.kind === "card") {
      expect(c.svg).toContain("<svg");
      expect(c.svg).toContain("My Page Title");
    }
  });

  it("falls back to Untitled for a blank title", () => {
    const c = ogPreviewContent("   ", "   ");
    expect(c.kind).toBe("card");
    if (c.kind === "card") expect(c.svg).toContain("Untitled");
  });

  it("passes card options through to ogCardSvg", () => {
    const c = ogPreviewContent("", "T", { brand: "acmebrand" });
    expect(c.kind).toBe("card");
    if (c.kind === "card") expect(c.svg).toContain("acmebrand");
  });
});

describe("OgPreview", () => {
  let host: HTMLElement;
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    host?.remove();
  });

  const mount = (ui: () => JSX.Element) => {
    host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(ui, host);
  };

  it("renders the generated card as inline SVG when no image is set", () => {
    mount(() => <OgPreview customImage="" title="Launch Day" />);
    const card = host.querySelector(".louise-og-card");
    expect(card).toBeTruthy();
    expect(card?.querySelector("svg")).toBeTruthy();
    expect(host.querySelector(".louise-og-img")).toBeNull();
    expect(host.innerHTML).toContain("Launch Day");
  });

  it("renders the custom image when one is set", () => {
    mount(() => <OgPreview customImage="https://cdn/share.png" title="Launch Day" />);
    const img = host.querySelector(".louise-og-img");
    expect(img?.getAttribute("src")).toBe("https://cdn/share.png");
    expect(host.querySelector(".louise-og-card")).toBeNull();
  });
});
