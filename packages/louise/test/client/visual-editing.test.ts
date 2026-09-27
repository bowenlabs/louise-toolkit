import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stegaDecode, stegaEncode } from "../../src/core/content/stega.js";
import {
  EDIT_ATTR,
  PREVIEW_VALUES_MESSAGE,
  VISUAL_EDIT_MESSAGE,
  applyPreviewValues,
  decodeEditRef,
  editAttr,
  encodeEditRef,
  mountPreviewSync,
  mountStegaClipboardGuard,
  mountVisualEditing,
  newBlockKey,
  parseBlockFieldRef,
} from "../../src/core/content/visual-editing.js";

// Click-to-edit and live preview (#508): the ref encoding, the editor-to-preview
// value channel and its origin and document checks, the hover overlay, the
// click-to-select message to the parent window, stega text hit-testing, and the
// clipboard guard. Each mount's cleanup is asserted to remove its listeners.

const ref = { collection: "pages", id: 7, field: "title" };
const EDITOR = "https://editor.example.com";

/** Dispatch a `message` event on `window` as if another window had posted it. */
function post(data: unknown, origin = EDITOR): void {
  window.dispatchEvent(new MessageEvent("message", { data, origin }));
}

/**
 * Record what the overlay posts to the parent window. In an unframed test page
 * `window.parent` is `window` itself, so the post would otherwise loop back.
 */
function spyParentPost() {
  return vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
}

/**
 * An element as the `ParentNode` search root. The Workers types in this
 * package's `tsconfig` declare a narrower `ParentNode` than the DOM's, so an
 * element needs the cast even though it's a valid root at runtime.
 */
function asRoot(el: Element): ParentNode {
  return el as unknown as ParentNode;
}

function tagged(r = ref, text = "Old title", tag = "h1"): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(editAttr(r))) el.setAttribute(k, v);
  el.textContent = text;
  document.body.appendChild(el);
  return el;
}

/**
 * An outline highlight in any serialization order: happy-dom writes
 * `2px solid #hex` back as `#hex solid 2px`.
 */
function outlined(color = "#56c6be"): RegExp {
  const parts = ["2px", "solid", color].map((p) => `(?=.*${p})`);
  return new RegExp(`^${parts.join("")}`);
}

// Cleanups registered by `track`, run even when an assertion fails mid-test, so
// a leaked listener can't bleed into the next test.
const cleanups: Array<() => void> = [];
function track(stop: () => void): () => void {
  cleanups.push(stop);
  return stop;
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ref encoding", () => {
  it("round-trips an EditRef through the data attribute", () => {
    const attrs = editAttr(ref);
    expect(attrs).toEqual({ [EDIT_ATTR]: "pages:7:title" });
    expect(decodeEditRef(attrs[EDIT_ATTR])).toEqual(ref);
    expect(encodeEditRef(ref)).toBe("pages:7:title");
  });

  it("rejects a value without exactly three parts", () => {
    expect(decodeEditRef("pages:7")).toBeNull();
    expect(decodeEditRef("pages:7:title:extra")).toBeNull();
    expect(decodeEditRef("")).toBeNull();
  });

  it("rejects an empty collection, empty field, or non-numeric id", () => {
    expect(decodeEditRef(":7:title")).toBeNull();
    expect(decodeEditRef("pages:7:")).toBeNull();
    expect(decodeEditRef("pages:abc:title")).toBeNull();
  });
});

describe("newBlockKey", () => {
  it("starts with a letter, so it never reads as a legacy array index", () => {
    for (let i = 0; i < 20; i++) {
      const key = newBlockKey();
      expect(key).toMatch(/^b[0-9a-z]+$/);
      expect(Number.isNaN(Number(key))).toBe(true);
    }
  });

  it("produces distinct keys", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newBlockKey()));
    expect(keys.size).toBe(50);
  });
});

describe("parseBlockFieldRef", () => {
  it("splits a per-block wrapper ref", () => {
    expect(parseBlockFieldRef("blocks.bk1")).toEqual({ field: "blocks", key: "bk1" });
  });

  it("splits a per-field live-preview path, keeping only the first two segments", () => {
    expect(parseBlockFieldRef("blocks.2.heading")).toEqual({ field: "blocks", key: "2" });
  });

  it("returns null for a bare array ref or empty segments", () => {
    expect(parseBlockFieldRef("blocks")).toBeNull();
    expect(parseBlockFieldRef(".bk1")).toBeNull();
    expect(parseBlockFieldRef("blocks.")).toBeNull();
  });
});

describe("applyPreviewValues", () => {
  it("patches every region tagged with a matching field and leaves others alone", () => {
    const a = tagged(ref, "Old", "h1");
    const b = tagged(ref, "Old", "span");
    const other = tagged({ ...ref, field: "summary" }, "Keep");
    const otherDoc = tagged({ ...ref, id: 8 }, "Other doc");

    applyPreviewValues(document, { collection: "pages", id: 7 }, { title: "New title" });

    expect(a.textContent).toBe("New title");
    expect(b.textContent).toBe("New title");
    expect(other.textContent).toBe("Keep");
    expect(otherDoc.textContent).toBe("Other doc");
  });

  it("skips non-string values", () => {
    const el = tagged();
    applyPreviewValues(
      document,
      { collection: "pages", id: 7 },
      { title: 42, other: null, nested: { a: 1 } },
    );
    expect(el.textContent).toBe("Old title");
  });

  it("writes text, not markup, so a value can't inject elements", () => {
    const el = tagged();
    applyPreviewValues(
      document,
      { collection: "pages", id: 7 },
      { title: '<img src="x" onerror="alert(1)">' },
    );
    expect(el.textContent).toBe('<img src="x" onerror="alert(1)">');
    expect(el.querySelector("img")).toBeNull();
  });

  it("searches only within the given root", () => {
    const outside = tagged();
    const container = document.createElement("section");
    document.body.appendChild(container);
    const inside = document.createElement("p");
    inside.setAttribute(EDIT_ATTR, encodeEditRef(ref));
    container.appendChild(inside);

    applyPreviewValues(asRoot(container), { collection: "pages", id: 7 }, { title: "Scoped" });

    expect(inside.textContent).toBe("Scoped");
    expect(outside.textContent).toBe("Old title");
  });
});

describe("mountPreviewSync", () => {
  it("applies values from the allowed origin for the matching document", () => {
    const el = tagged();
    const stop = track(mountPreviewSync({ collection: "pages", id: 7, allowedOrigin: EDITOR }));
    post({ type: PREVIEW_VALUES_MESSAGE, collection: "pages", id: 7, values: { title: "Live" } });
    expect(el.textContent).toBe("Live");
    stop();
  });

  it("ignores a message from any other origin when allowedOrigin is set", () => {
    const el = tagged();
    const stop = track(mountPreviewSync({ collection: "pages", id: 7, allowedOrigin: EDITOR }));
    const msg = {
      type: PREVIEW_VALUES_MESSAGE,
      collection: "pages",
      id: 7,
      values: { title: "X" },
    };
    post(msg, "https://attacker.example.com");
    post(msg, "https://editor.example.com.attacker.example.com");
    post(msg, "http://editor.example.com");
    post(msg, "null");
    expect(el.textContent).toBe("Old title");
    stop();
  });

  it("accepts any origin when allowedOrigin is unset", () => {
    const el = tagged();
    const stop = track(mountPreviewSync({ collection: "pages", id: 7 }));
    post(
      { type: PREVIEW_VALUES_MESSAGE, collection: "pages", id: 7, values: { title: "Any" } },
      "https://other.example.com",
    );
    expect(el.textContent).toBe("Any");
    stop();
  });

  it("ignores messages for another document", () => {
    const el = tagged();
    const stop = track(mountPreviewSync({ collection: "pages", id: 7, allowedOrigin: EDITOR }));
    post({ type: PREVIEW_VALUES_MESSAGE, collection: "pages", id: 8, values: { title: "A" } });
    post({ type: PREVIEW_VALUES_MESSAGE, collection: "posts", id: 7, values: { title: "B" } });
    // A string id isn't coerced: "7" isn't 7.
    post({ type: PREVIEW_VALUES_MESSAGE, collection: "pages", id: "7", values: { title: "C" } });
    expect(el.textContent).toBe("Old title");
    stop();
  });

  it("ignores messages of another type or with no payload", () => {
    const el = tagged();
    const stop = track(mountPreviewSync({ collection: "pages", id: 7, allowedOrigin: EDITOR }));
    post({ type: VISUAL_EDIT_MESSAGE, collection: "pages", id: 7, values: { title: "A" } });
    post(null);
    post("louise:preview-values");
    post(undefined);
    post({ type: PREVIEW_VALUES_MESSAGE, collection: "pages", id: 7 });
    expect(el.textContent).toBe("Old title");
    stop();
  });

  it("patches within a custom root", () => {
    const outside = tagged();
    const root = document.createElement("div");
    const inside = document.createElement("p");
    inside.setAttribute(EDIT_ATTR, encodeEditRef(ref));
    root.appendChild(inside);
    const stop = track(mountPreviewSync({ collection: "pages", id: 7, root: asRoot(root) }));
    post({ type: PREVIEW_VALUES_MESSAGE, collection: "pages", id: 7, values: { title: "Root" } });
    expect(inside.textContent).toBe("Root");
    expect(outside.textContent).toBe("Old title");
    stop();
  });

  it("stops listening after cleanup", () => {
    const el = tagged();
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const stop = track(mountPreviewSync({ collection: "pages", id: 7 }));
    stop();
    const handler = add.mock.calls.find(([type]) => String(type) === "message")?.[1];
    expect(handler).toBeTypeOf("function");
    expect(remove).toHaveBeenCalledWith("message", handler);

    post({ type: PREVIEW_VALUES_MESSAGE, collection: "pages", id: 7, values: { title: "Late" } });
    expect(el.textContent).toBe("Old title");
  });
});

describe("mountVisualEditing: element targets", () => {
  let parentPost: ReturnType<typeof spyParentPost>;

  beforeEach(() => {
    parentPost = spyParentPost();
  });

  function hover(target: EventTarget, init: MouseEventInit = {}): void {
    target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, ...init }));
  }

  function click(target: EventTarget, init: MouseEventInit = {}): MouseEvent {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  it("outlines a tagged element on hover and restores it on leaving", () => {
    const el = tagged();
    el.style.outline = "1px dotted red";
    const original = el.style.outline;
    const plain = document.createElement("p");
    document.body.appendChild(plain);
    const stop = track(mountVisualEditing({ highlightColor: "#123456" }));

    hover(el);
    expect(el.style.outline).toMatch(outlined("#123456"));
    expect(el.style.outlineOffset).toBe("2px");
    expect(el.style.cursor).toBe("pointer");

    hover(plain);
    expect(el.style.outline).toBe(original);
    stop();
  });

  it("highlights the nearest tagged ancestor of a hovered child", () => {
    const el = tagged();
    const child = document.createElement("em");
    el.appendChild(child);
    const stop = track(mountVisualEditing());
    hover(child);
    expect(el.style.outline).toMatch(outlined());
    stop();
  });

  it("moves the highlight from one tagged element to the next", () => {
    const a = tagged();
    const b = tagged({ ...ref, field: "summary" }, "Summary", "p");
    const stop = track(mountVisualEditing());
    hover(a);
    hover(a); // Re-hovering the same element is a no-op.
    expect(a.style.outline).toMatch(outlined());
    hover(b);
    expect(a.style.outline).toBe("");
    expect(b.style.outline).toMatch(outlined());
    stop();
  });

  it("ignores a hover whose target isn't an element", () => {
    const stop = track(mountVisualEditing());
    expect(() => document.dispatchEvent(new MouseEvent("mouseover"))).not.toThrow();
    stop();
  });

  it("selects on click: calls onSelect, posts to the parent, and swallows the click", () => {
    const el = tagged();
    const onSelect = vi.fn();
    const bubbled = vi.fn();
    document.body.addEventListener("click", bubbled);
    const stop = track(mountVisualEditing({ onSelect, targetOrigin: EDITOR }));

    const event = click(el);

    expect(onSelect).toHaveBeenCalledWith(ref, el);
    expect(parentPost).toHaveBeenCalledWith({ type: VISUAL_EDIT_MESSAGE, ref }, EDITOR);
    expect(event.defaultPrevented).toBe(true);
    expect(bubbled).not.toHaveBeenCalled();
    stop();
  });

  it("posts to the wildcard origin by default", () => {
    const el = tagged();
    const stop = track(mountVisualEditing());
    click(el);
    expect(parentPost).toHaveBeenCalledWith({ type: VISUAL_EDIT_MESSAGE, ref }, "*");
    stop();
  });

  it("lets a click on a malformed tag through untouched", () => {
    const el = document.createElement("h1");
    el.setAttribute(EDIT_ATTR, "not-a-ref");
    document.body.appendChild(el);
    const onSelect = vi.fn();
    const stop = track(mountVisualEditing({ onSelect }));
    const event = click(el);
    expect(onSelect).not.toHaveBeenCalled();
    expect(parentPost).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    stop();
  });

  it("lets a click on an untagged element through when no stega resolver is set", () => {
    const plain = document.createElement("a");
    document.body.appendChild(plain);
    const onSelect = vi.fn();
    const stop = track(mountVisualEditing({ onSelect }));
    const event = click(plain);
    expect(onSelect).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    stop();
  });

  it("removes its listeners and restores the outline on cleanup", () => {
    const el = tagged();
    const onSelect = vi.fn();
    const stop = track(mountVisualEditing({ onSelect }));
    hover(el);
    stop();
    expect(el.style.outline).toBe("");

    click(el);
    hover(el);
    expect(onSelect).not.toHaveBeenCalled();
    expect(parentPost).not.toHaveBeenCalled();
    expect(el.style.outline).toBe("");
  });
});

describe("mountVisualEditing: stega text targets", () => {
  // Stand-ins for the two caret APIs, which happy-dom doesn't implement.
  interface CaretApis {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null;
  }
  const doc = document as unknown as CaretApis;
  let parentPost: ReturnType<typeof spyParentPost>;

  beforeEach(() => {
    parentPost = spyParentPost();
  });

  afterEach(() => {
    delete doc.caretRangeFromPoint;
    delete doc.caretPositionFromPoint;
    document.querySelectorAll("div[style]").forEach((n) => n.remove());
  });

  /** A paragraph whose text carries an invisible stega ref. */
  function stegaParagraph(): { p: HTMLParagraphElement; text: Text } {
    const p = document.createElement("p");
    const text = document.createTextNode(stegaEncode(ref, "Hello"));
    p.appendChild(text);
    document.body.appendChild(p);
    return { p, text };
  }

  /** The floating highlight box, found by its fixed position. */
  function stegaBox(): HTMLElement | null {
    return (
      [...document.body.querySelectorAll<HTMLElement>("div")].find(
        (d) => d.style.position === "fixed",
      ) ?? null
    );
  }

  function pointAt(node: Node | null): void {
    doc.caretRangeFromPoint = () => {
      if (!node) return null;
      const range = document.createRange();
      range.setStart(node, 0);
      return range;
    };
  }

  it("shows a floating box over a stega run on hover, and hides it off the run", () => {
    const { p, text } = stegaParagraph();
    pointAt(text);
    const stop = track(
      mountVisualEditing({ resolveStega: stegaDecode, highlightColor: "#abcdef" }),
    );

    p.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: 5, clientY: 5 }));
    const box = stegaBox();
    expect(box).not.toBeNull();
    expect(box?.style.display).toBe("block");
    expect(box?.style.outline).toMatch(outlined("#abcdef"));
    expect(box?.style.pointerEvents).toBe("none");

    // Off any run: the caret lands on no node.
    pointAt(null);
    document.body.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(box?.style.display).toBe("none");

    // Hovering a tagged element also hides the box.
    pointAt(text);
    p.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(box?.style.display).toBe("block");
    const el = tagged();
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(box?.style.display).toBe("none");
    expect(stegaBox()).toBe(box); // Reused, not recreated.

    stop();
    expect(stegaBox()).toBeNull();
  });

  it("selects a stega run on click and reports its parent element", () => {
    const { p, text } = stegaParagraph();
    pointAt(text);
    const onSelect = vi.fn();
    const stop = track(
      mountVisualEditing({ resolveStega: stegaDecode, onSelect, targetOrigin: EDITOR }),
    );

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    p.dispatchEvent(event);

    expect(onSelect).toHaveBeenCalledWith(ref, p);
    expect(parentPost).toHaveBeenCalledWith({ type: VISUAL_EDIT_MESSAGE, ref }, EDITOR);
    expect(event.defaultPrevented).toBe(true);
    stop();
  });

  it("falls back to document.body for a run with no parent element", () => {
    const detached = document.createTextNode(stegaEncode(ref, "Loose"));
    pointAt(detached);
    const onSelect = vi.fn();
    const stop = track(mountVisualEditing({ resolveStega: stegaDecode, onSelect }));
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onSelect).toHaveBeenCalledWith(ref, document.body);
    stop();
  });

  it("uses caretPositionFromPoint when caretRangeFromPoint is missing", () => {
    const { p, text } = stegaParagraph();
    doc.caretPositionFromPoint = () => ({ offsetNode: text });
    const onSelect = vi.fn();
    const stop = track(mountVisualEditing({ resolveStega: stegaDecode, onSelect }));
    p.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onSelect).toHaveBeenCalledWith(ref, p);
    stop();
  });

  it("ignores a click on plain text, an element node, or with no caret API", () => {
    const plain = document.createElement("p");
    plain.textContent = "No payload";
    document.body.appendChild(plain);
    const onSelect = vi.fn();
    const stop = track(mountVisualEditing({ resolveStega: stegaDecode, onSelect }));

    // No caret API at all.
    plain.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    // A text node without a payload.
    pointAt(plain.firstChild);
    plain.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    // The caret lands on an element, not a text node.
    doc.caretPositionFromPoint = () => ({ offsetNode: plain });
    delete doc.caretRangeFromPoint;
    plain.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    // An empty text node.
    const empty = document.createTextNode("");
    plain.appendChild(empty);
    doc.caretPositionFromPoint = () => ({ offsetNode: empty });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    plain.dispatchEvent(event);

    expect(onSelect).not.toHaveBeenCalled();
    expect(parentPost).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    stop();
  });

  it("doesn't hit-test text without a resolver", () => {
    const { p, text } = stegaParagraph();
    const caret = vi.fn(() => {
      const range = document.createRange();
      range.setStart(text, 0);
      return range;
    });
    doc.caretRangeFromPoint = caret;
    const stop = track(mountVisualEditing());
    p.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    p.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(caret).not.toHaveBeenCalled();
    expect(stegaBox()).toBeNull();
    stop();
  });
});

describe("mountStegaClipboardGuard", () => {
  afterEach(() => {
    delete document.documentElement.dataset.louiseStegaGuard;
    document.getSelection()?.removeAllRanges();
  });

  /** A cancelable `copy` event with a recording clipboard. */
  function copyEvent(): { event: Event; setData: ReturnType<typeof vi.fn> } {
    const setData = vi.fn();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData } });
    return { event, setData };
  }

  function select(node: Node): void {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  it("strips a stega payload from the copied text and HTML", () => {
    const p = document.createElement("p");
    p.textContent = stegaEncode(ref, "Hello");
    document.body.appendChild(p);
    select(p);
    const stop = track(mountStegaClipboardGuard());

    const { event, setData } = copyEvent();
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(setData).toHaveBeenCalledWith("text/plain", "Hello");
    const html = setData.mock.calls.find(([type]) => type === "text/html")?.[1];
    expect(html).toBe("Hello");
    stop();
  });

  it("leaves an ordinary copy to the browser", () => {
    const p = document.createElement("p");
    p.textContent = "Plain";
    document.body.appendChild(p);
    select(p);
    const stop = track(mountStegaClipboardGuard());

    const { event, setData } = copyEvent();
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(setData).not.toHaveBeenCalled();
    stop();
  });

  it("does nothing for a collapsed selection or a missing clipboard", () => {
    const p = document.createElement("p");
    p.textContent = stegaEncode(ref, "Hello");
    document.body.appendChild(p);
    const stop = track(mountStegaClipboardGuard());

    // Collapsed selection.
    const range = document.createRange();
    range.setStart(p.firstChild as Text, 0);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    const collapsed = copyEvent();
    document.dispatchEvent(collapsed.event);
    expect(collapsed.setData).not.toHaveBeenCalled();

    // Real selection, but no clipboardData on the event.
    select(p);
    const bare = new Event("copy", { bubbles: true, cancelable: true });
    document.dispatchEvent(bare);
    expect(bare.defaultPrevented).toBe(false);
    stop();
  });

  it("installs once per document and removes its listener on cleanup", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");

    const stop = track(mountStegaClipboardGuard());
    expect(document.documentElement.dataset.louiseStegaGuard).toBe("1");
    const again = mountStegaClipboardGuard();
    expect(add.mock.calls.filter(([type]) => type === "copy")).toHaveLength(1);

    again(); // The no-op cleanup from the second mount leaves the guard in place.
    expect(document.documentElement.dataset.louiseStegaGuard).toBe("1");

    stop();
    expect(document.documentElement.dataset.louiseStegaGuard).toBeUndefined();
    const handler = add.mock.calls.find(([type]) => type === "copy")?.[1];
    expect(remove).toHaveBeenCalledWith("copy", handler, true);

    // With the guard gone, a stega copy is left alone.
    const p = document.createElement("p");
    p.textContent = stegaEncode(ref, "Hello");
    document.body.appendChild(p);
    select(p);
    const { event, setData } = copyEvent();
    document.dispatchEvent(event);
    expect(setData).not.toHaveBeenCalled();
  });
});
