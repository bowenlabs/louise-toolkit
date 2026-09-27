// Behavior coverage for the keyboard helpers in src/client/a11y.ts (#695):
// toolbar arrow-key roving, the dialog's Tab ring with hidden and empty
// content, and a popover ignoring an Escape pressed outside it.

import { afterEach, describe, expect, it, vi } from "vitest";
import { wireDialogA11y, wirePopoverDismiss, wireToolbarRoving } from "../../src/client/a11y.js";

const flush = () => new Promise<void>((r) => queueMicrotask(r));
const press = (el: Element, key: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("wireToolbarRoving", () => {
  function toolbar(): { bar: HTMLElement; buttons: HTMLButtonElement[] } {
    const bar = document.createElement("div");
    bar.setAttribute("role", "toolbar");
    bar.innerHTML =
      '<button type="button">Save</button><button type="button" disabled>Publish</button><button type="button">Settings</button><button type="button">Sign out</button><input aria-label="Search">';
    document.body.appendChild(bar);
    return { bar, buttons: [...bar.querySelectorAll("button")] };
  }

  it("steps between enabled buttons with the arrows, wrapping, and jumps with Home and End", () => {
    const { bar, buttons } = toolbar();
    wireToolbarRoving(bar);
    const [save, , settings, signOut] = buttons;

    expect(press(save, "ArrowRight").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(settings);
    press(settings, "ArrowLeft");
    expect(document.activeElement).toBe(save);
    press(save, "ArrowLeft");
    expect(document.activeElement).toBe(signOut);
    press(signOut, "ArrowRight");
    expect(document.activeElement).toBe(save);
    press(save, "End");
    expect(document.activeElement).toBe(signOut);
    press(signOut, "Home");
    expect(document.activeElement).toBe(save);
  });

  it("leaves other keys and non-button targets alone, and detaches on dispose", () => {
    const { bar, buttons } = toolbar();
    const dispose = wireToolbarRoving(bar);
    const search = bar.querySelector("input") as HTMLInputElement;

    expect(press(buttons[0], "Enter").defaultPrevented).toBe(false);
    expect(press(search, "ArrowRight").defaultPrevented).toBe(false);

    dispose();
    buttons[0].focus();
    expect(press(buttons[0], "ArrowRight").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(buttons[0]);
  });
});

describe("wireDialogA11y—the Tab ring", () => {
  it("keeps focus on a dialog with nothing tabbable", async () => {
    const dialog = document.createElement("aside");
    dialog.innerHTML = "<p>Saving…</p>";
    document.body.appendChild(dialog);
    wireDialogA11y(dialog, { onClose: () => {} });
    await flush();

    expect(document.activeElement).toBe(dialog);
    expect(press(dialog, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog);
  });

  it("skips hidden controls and wraps from the dialog itself on Shift+Tab", async () => {
    const dialog = document.createElement("aside");
    dialog.innerHTML =
      '<button type="button" hidden>Hidden</button><button type="button">First</button><button type="button">Last</button>';
    document.body.appendChild(dialog);
    wireDialogA11y(dialog, { onClose: () => {}, initialFocus: () => dialog });
    await flush();
    const [, first, last] = [...dialog.querySelectorAll("button")];
    expect(document.activeElement).toBe(dialog);

    expect(press(dialog, "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    press(last, "Tab");
    expect(document.activeElement).toBe(first);

    // A Tab from the middle of the ring is the browser's to move.
    first.focus();
    expect(press(first, "Tab").defaultPrevented).toBe(false);
  });
});

describe("wirePopoverDismiss", () => {
  it("ignores an Escape pressed outside the panel and its trigger", () => {
    const panel = document.createElement("div");
    const outside = document.createElement("button");
    document.body.appendChild(panel);
    document.body.appendChild(outside);
    const onClose = vi.fn();
    wirePopoverDismiss(panel, { onClose });

    expect(press(outside, "Escape").defaultPrevented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
});
