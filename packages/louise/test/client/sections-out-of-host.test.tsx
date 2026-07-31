// Markers OUTSIDE the sections host (#374).
//
// The chrome has always hovered every marker in the document, but the editor's
// own lookups were host-scoped: the wireInline scan and `nodeEl` (the popover
// anchor) both queried under `props.host`. A marker rendered outside the host —
// which is exactly where ADR 0010 Phase B stamps `settings.*` paths, in the Nav
// and Footer — was silently inert for inline editing, and its inspector popover
// fell back to the viewport-origin default position.
//
// Both failures were silent, which is why each gets a named test.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";

const CATALOG: SectionCatalog = {
  hero: {
    label: "Hero",
    fields: {
      heading: { type: "text", label: "Heading" }, // inline — edited in place
      cta: { type: "link", label: "Cta link" }, // not inline — inspector-edited
    },
  },
};

const INITIAL: SectionItem[] = [{ _type: "hero", heading: "Hi", cta: "/shop" }];

const flush = () => new Promise((r) => setTimeout(r, 0));
const over = (node: Node) => node.dispatchEvent(new Event("mouseover", { bubbles: true }));
const click = (el: Element | null) => el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

/** The host holds the section; the two field markers render OUTSIDE it, as
 *  siblings — the shape of a chrome surface like the Nav. */
function page(): { host: HTMLElement; heading: HTMLElement; cta: HTMLElement } {
  const host = document.createElement("div");
  const sec = document.createElement("section");
  sec.setAttribute("data-louise-node", "0");
  host.appendChild(sec);
  const heading = document.createElement("div");
  heading.setAttribute("data-louise-node", "0.heading");
  heading.textContent = "Hi";
  const cta = document.createElement("a");
  cta.setAttribute("data-louise-node", "0.cta");
  cta.textContent = "Shop";
  // Three appendChild calls, not one variadic append(): with
  // @cloudflare/workers-types in the typecheck lib set, ParentNode.append
  // resolves to a 1–2 arg overload and TS2554s on three (CI-only — the
  // vitest transform doesn't typecheck).
  document.body.appendChild(host);
  document.body.appendChild(heading);
  document.body.appendChild(cta);
  return { host, heading, cta };
}

function mount(host: HTMLElement) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ versions: [], publishedVersionId: null, pages: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );
  return mountSections(host, { catalog: CATALOG, pageId: 1, initial: INITIAL, autoSave: false });
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  document.getElementById("louise-chrome-style")?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("markers outside the sections host (#374)", () => {
  it("wires inline editing on an out-of-host marker", async () => {
    const { host, heading } = page();
    dispose = mount(host);
    await flush();

    expect(heading.getAttribute("contenteditable")).toBe("plaintext-only");
    expect(heading.classList.contains("louise-sfield")).toBe(true);
  });

  it("anchors the inspector popover on an out-of-host marker", async () => {
    const { host, cta } = page();
    dispose = mount(host);
    await flush();

    over(cta);
    const wrench = [...document.querySelectorAll(".louise-chrome-toolbar button")].find(
      (b) => b.getAttribute("aria-label") === "Cta link",
    );
    expect(wrench).toBeTruthy();
    click(wrench ?? null);
    await flush();

    const inspector = document.querySelector<HTMLElement>(".louise-inspector");
    expect(inspector).not.toBeNull();
    // Anchored to the element's rect (zero in happy-dom → clamps to 8px), NOT
    // the 80px viewport-origin fallback that a host-scoped `nodeEl` produced.
    expect(inspector?.style.top).toBe("8px");
    expect(inspector?.style.left).toBe("8px");
  });
});
