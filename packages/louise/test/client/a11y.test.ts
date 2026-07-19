// happy-dom coverage for the shared modal-dialog accessibility helper: the four
// behaviours every Louise overlay (Settings drawer, version history, inspector)
// needs — focus moves in on open, Tab stays inside, Escape closes, and focus
// returns to the opener on close.

import { afterEach, describe, expect, it } from "vitest";
import {
  humanizeFieldKey,
  nameEditable,
  wireDialogA11y,
  wirePopoverDismiss,
} from "../../src/client/a11y.js";

/** Let the helper's deferred initial focus (a queued microtask) run. */
const flush = () => new Promise<void>((r) => queueMicrotask(r));

/** A dialog appended to the body, with a focused "opener" button behind it. */
function mountDialog(inner: string): { dialog: HTMLElement; opener: HTMLButtonElement } {
  const opener = document.createElement("button");
  opener.textContent = "Open";
  document.body.appendChild(opener);
  opener.focus();
  const dialog = document.createElement("aside");
  dialog.innerHTML = inner;
  document.body.appendChild(dialog);
  return { dialog, opener };
}

const press = (el: HTMLElement, key: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));

afterEach(() => document.body.replaceChildren());

describe("wireDialogA11y", () => {
  it("marks the dialog modal and moves focus into it", async () => {
    const { dialog } = mountDialog('<button id="a">A</button><button id="b">B</button>');
    const off = wireDialogA11y(dialog, { onClose: () => {} });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("tabindex")).toBe("-1");
    await flush();
    expect(document.activeElement).toBe(dialog.querySelector("#a"));
    off();
  });

  it("honours an explicit initialFocus", async () => {
    const { dialog } = mountDialog('<button id="a">A</button><button id="b">B</button>');
    const off = wireDialogA11y(dialog, {
      onClose: () => {},
      initialFocus: () => dialog.querySelector<HTMLElement>("#b"),
    });
    await flush();
    expect(document.activeElement).toBe(dialog.querySelector("#b"));
    off();
  });

  it("closes on Escape from anywhere inside", async () => {
    let closed = 0;
    const { dialog } = mountDialog('<button id="a">A</button>');
    const off = wireDialogA11y(dialog, { onClose: () => closed++ });
    await flush();
    press(dialog.querySelector<HTMLElement>("#a")!, "Escape");
    expect(closed).toBe(1);
    off();
  });

  it("wraps Tab at both edges so focus can't reach the page behind", async () => {
    const { dialog } = mountDialog('<button id="a">A</button><button id="b">B</button>');
    const off = wireDialogA11y(dialog, { onClose: () => {} });
    await flush();
    const a = dialog.querySelector<HTMLElement>("#a")!;
    const b = dialog.querySelector<HTMLElement>("#b")!;

    b.focus();
    press(b, "Tab"); // last → first
    expect(document.activeElement).toBe(a);

    a.focus();
    press(a, "Tab", { shiftKey: true }); // first → last
    expect(document.activeElement).toBe(b);
    off();
  });

  it("leaves the contents of a collapsed <details> out of the tab ring", async () => {
    const { dialog } = mountDialog(
      '<button id="a">A</button><button id="z">Z</button>' +
        '<details><summary id="s">More</summary><button id="buried">B</button></details>',
    );
    const off = wireDialogA11y(dialog, { onClose: () => {} });
    await flush();
    // The summary is the last tabbable — the buried button inside the closed
    // <details> doesn't count — so Tab from it wraps back to the first.
    const s = dialog.querySelector<HTMLElement>("#s")!;
    s.focus();
    press(s, "Tab");
    expect(document.activeElement).toBe(dialog.querySelector("#a"));
    off();
  });

  it("restores focus to the opener and unmarks the dialog on dispose", async () => {
    const { dialog, opener } = mountDialog('<button id="a">A</button>');
    const off = wireDialogA11y(dialog, { onClose: () => {} });
    await flush();
    expect(document.activeElement).not.toBe(opener);
    off();
    expect(document.activeElement).toBe(opener);
    expect(dialog.hasAttribute("aria-modal")).toBe(false);
  });

  it("doesn't fight an opener that has since been removed", async () => {
    const { dialog, opener } = mountDialog('<button id="a">A</button>');
    const off = wireDialogA11y(dialog, { onClose: () => {} });
    await flush();
    opener.remove(); // e.g. the on-canvas ⚙ unmounts with the chrome
    expect(() => off()).not.toThrow();
  });
});

describe("nameEditable", () => {
  it("gives a bare contenteditable a textbox role and a name", () => {
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "plaintext-only");
    nameEditable(el, "Hero headline");
    expect(el.getAttribute("role")).toBe("textbox");
    expect(el.getAttribute("aria-label")).toBe("Hero headline");
    expect(el.hasAttribute("aria-multiline")).toBe(false);
  });

  it("marks multiline fields and never clobbers an author's own name", () => {
    const multi = document.createElement("div");
    nameEditable(multi, "Body", true);
    expect(multi.getAttribute("aria-multiline")).toBe("true");

    const authored = document.createElement("div");
    authored.setAttribute("aria-label", "Author's own label");
    nameEditable(authored, "Derived");
    expect(authored.getAttribute("aria-label")).toBe("Author's own label");
  });
});

describe("humanizeFieldKey", () => {
  it("turns a field key into a readable label", () => {
    expect(humanizeFieldKey("heroTitle")).toBe("Hero Title");
    expect(humanizeFieldKey("title")).toBe("Title");
  });
});

describe("wirePopoverDismiss", () => {
  /** A trigger + panel pair, as the menus render them. */
  function mountPopover() {
    const trigger = document.createElement("button");
    const panel = document.createElement("div");
    const item = document.createElement("button");
    panel.appendChild(item);
    document.body.appendChild(trigger);
    document.body.appendChild(panel);
    return { trigger, panel, item };
  }

  it("closes on Escape from inside the panel and returns focus to the trigger", () => {
    let closed = 0;
    const { trigger, panel, item } = mountPopover();
    const off = wirePopoverDismiss(panel, { onClose: () => closed++, trigger });
    item.focus();
    press(item, "Escape");
    expect(closed).toBe(1);
    expect(document.activeElement).toBe(trigger);
    off();
  });

  it("closes on an outside press but not on a press inside the panel or trigger", () => {
    let closed = 0;
    const { trigger, panel, item } = mountPopover();
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    const off = wirePopoverDismiss(panel, { onClose: () => closed++, trigger });

    item.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(closed).toBe(0); // inside the panel
    // The trigger is excluded so its own click toggles instead of closing then
    // immediately reopening.
    trigger.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(closed).toBe(0);

    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(closed).toBe(1);
    off();
  });

  it("detaches its listeners on dispose", () => {
    let closed = 0;
    const { trigger, panel } = mountPopover();
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    wirePopoverDismiss(panel, { onClose: () => closed++, trigger })();
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(closed).toBe(0);
  });
});
