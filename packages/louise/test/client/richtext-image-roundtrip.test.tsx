// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { mountRichText } from "../../src/client/RichText.jsx";

// The editor's image node view renders a CDN derivative so a 6 MB master isn't
// fetched to fill an editor column (#333). The stored `src` must stay the
// ORIGINAL: it is what serializes into content and what the site renders through
// `set:html`, so persisting a transform URL would bake a fixed width and crop
// into the document and defeat re-cropping later.
//
// The separation is structural — the node view is display, `DOMSerializer` reads
// the node's attrs — but "structural" is exactly the kind of guarantee a later
// refactor quietly breaks, and the symptom (a CDN URL in stored content) would
// only surface long after the change.

const MASTER = "https://media.example.com/originals/master.jpg";

const hosts: HTMLElement[] = [];
function mount(html: string) {
  const el = document.createElement("div");
  // `mountRichText` seeds from the host's existing markup when no doc is passed
  // — the same path a site's `set:html` value takes into the editor.
  el.innerHTML = html;
  document.body.appendChild(el);
  hosts.push(el);
  return mountRichText(el, () => {});
}

afterEach(() => {
  for (const el of hosts.splice(0)) el.remove();
});

describe("RichText image round-trip", () => {
  it("displays a derivative while serializing the original", async () => {
    const rt = mount(`<p><img src="${MASTER}" alt="A print drying"></p>`);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Both halves in one test on purpose. Asserting only the serialized side
    // would still pass if the node view stopped transforming altogether — which
    // is the regression that reintroduces the 6 MB fetch this fixed.
    const displayed = document.querySelector("img")?.getAttribute("src") ?? "";
    expect(displayed).toContain("/cdn-cgi/image/");

    const html = rt.getHTML();
    expect(html).toContain(MASTER);
    expect(html).not.toContain("/cdn-cgi/image/");
    rt.destroy();
  });

  it("keeps the original across a full parse → serialize → parse cycle", () => {
    // One pass could serialize correctly by luck; feeding the output back in is
    // what catches a transform that only leaks on the second round.
    const first = mount(`<p><img src="${MASTER}" alt="A print drying"></p>`);
    const once = first.getHTML();
    first.destroy();

    const second = mount(once);
    const twice = second.getHTML();
    second.destroy();

    expect(twice).toContain(MASTER);
    expect(twice).not.toContain("/cdn-cgi/image/");
    // Alt survives too — it is the reason the node gained a custom attr at all.
    expect(twice).toContain('alt="A print drying"');
  });
});
