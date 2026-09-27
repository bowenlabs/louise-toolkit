import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyPreviewValues,
  decodeEditRef,
  mountPreviewSync,
  mountVisualEditing,
} from "../../src/core/content/visual-editing.js";

// #698: hover restores every style it set, an odd field key can't throw, preview
// sync warns without allowedOrigin, ids parse strictly, and values must be an object.

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("visual editing fixes", () => {
  it("restores outline, outline-offset, and cursor after a hover", () => {
    const el = document.createElement("h1");
    el.setAttribute("data-louise-edit", "pages:1:title");
    document.body.appendChild(el);
    document.body.appendChild(document.createElement("p"));
    const off = mountVisualEditing();
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(el.style.cursor).toBe("pointer");
    document.body.lastElementChild?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect([el.style.outline, el.style.outlineOffset, el.style.cursor]).toEqual(["", "", ""]);
    off();
  });

  it("patches regions for an odd field key without throwing, and ignores non-object values", () => {
    const el = document.createElement("span");
    el.setAttribute("data-louise-edit", 'pages:1:a"]');
    document.body.appendChild(el);
    expect(() =>
      applyPreviewValues(document, { collection: "pages", id: 1 }, { 'a"]': "Hi" }),
    ).not.toThrow();
    expect(el.textContent).toBe("Hi");
    applyPreviewValues(document, { collection: "pages", id: 1 }, "xyz" as never);
    expect(el.textContent).toBe("Hi");
  });

  it("warns when preview sync accepts any origin", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mountPreviewSync({ collection: "pages", id: 1 })();
    expect(warn).toHaveBeenCalledTimes(1);
    mountPreviewSync({ collection: "pages", id: 1, allowedOrigin: "https://example.com" })();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("parses ids strictly", () => {
    expect(decodeEditRef("pages:7:title")).toEqual({ collection: "pages", id: 7, field: "title" });
    for (const bad of ["pages:7abc:title", "pages:-1:title", "pages::title"]) {
      expect(decodeEditRef(bad), bad).toBeNull();
    }
  });
});
