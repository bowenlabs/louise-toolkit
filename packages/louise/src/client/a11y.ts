// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/client — modal-dialog accessibility, shared by every Louise
// overlay (the Settings drawer, the version-history drawer, the inspector
// popover). A modal must, per WCAG 2.4.3 / 2.1.2 / 4.1.2: move focus into itself
// on open, keep Tab within it (so the page behind can't be reached), close on
// Escape, and restore focus to whatever opened it on close. `wireDialogA11y`
// installs all four on a raw element and returns a disposer, so a Solid view can
// wire it from a `ref` + `onCleanup` without pulling in a dialog library. Pure
// DOM — unit-testable without mounting a framework.

/** Turn a field key (`heroTitle`) into a human label ("Hero Title") — the fallback
 *  accessible name for an inline editable with no authored label. */
export function humanizeFieldKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

/**
 * Name an inline `contenteditable` region for assistive tech. A bare
 * contenteditable announces as "edit text" with no identity, and the empty-state
 * hint is CSS `::before` content, which is not a reliable accessible name — so
 * give the region a textbox role and a real name (WCAG 1.3.1 / 4.1.2). Never
 * overwrites a name the author already supplied.
 */
export function nameEditable(el: HTMLElement, label: string, multiline = false): void {
  el.setAttribute("role", "textbox");
  if (multiline) el.setAttribute("aria-multiline", "true");
  if (label && !el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby")) {
    el.setAttribute("aria-label", label);
  }
}

/** Selector for the tabbable elements inside a dialog (visible + not disabled). */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  // A <summary> is natively tabbable and is the control for its <details> group
  // (the Settings panels are built from them).
  "summary",
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
].join(",");

/** The tabbable elements inside `root`, in DOM order. Skips `hidden` elements and
 *  the content of a collapsed `<details>` (which the browser omits from the tab
 *  order natively — the Settings groups rely on it). Layout-independent, so it
 *  behaves the same under a real browser and a headless test DOM. */
function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.hasAttribute("hidden")) return false;
    // Read `.open` rather than matching `details:not([open])` — the property is
    // the reliable signal across DOM implementations.
    const details = el.closest("details") as HTMLDetailsElement | null;
    if (details && !details.open) return el === details.querySelector("summary");
    return true;
  });
}

export interface PopoverDismissOptions {
  onClose: () => void;
  /** The control that toggles the popover. Excluded from the outside-press check
   *  (so pressing it toggles rather than closing then reopening), and refocused
   *  on Escape. */
  trigger?: HTMLElement | null;
}

/**
 * Dismiss a non-modal popup — a menu, palette, or swatch panel: Escape from
 * inside it (or from its trigger), and a pointer press anywhere outside. Unlike
 * {@link wireDialogA11y} this deliberately does NOT trap focus: these panels are
 * transient and their items stay in the normal tab order.
 */
export function wirePopoverDismiss(panel: HTMLElement, opts: PopoverDismissOptions): () => void {
  const doc = panel.ownerDocument;
  const inside = (n: EventTarget | null): boolean =>
    n instanceof Node && (panel.contains(n) || !!opts.trigger?.contains(n));

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "Escape" || !inside(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    opts.onClose();
    opts.trigger?.focus();
  };
  const onPointerDown = (e: Event): void => {
    if (!inside(e.target)) opts.onClose();
  };
  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("pointerdown", onPointerDown, true);
  return () => {
    doc.removeEventListener("keydown", onKeyDown, true);
    doc.removeEventListener("pointerdown", onPointerDown, true);
  };
}

export interface DialogA11yOptions {
  /** Called on Escape (and available for the view's own close controls). */
  onClose: () => void;
  /** The element to focus on open. Defaults to the first tabbable, else the
   *  dialog itself. */
  initialFocus?: () => HTMLElement | null | undefined;
}

/**
 * Make `dialog` behave as an accessible modal: mark it `aria-modal`, move focus
 * in, trap Tab, close on Escape, and restore focus to the opener on dispose.
 * Returns a disposer — call it when the dialog unmounts (e.g. Solid `onCleanup`).
 */
export function wireDialogA11y(dialog: HTMLElement, opts: DialogA11yOptions): () => void {
  const doc = dialog.ownerDocument;
  const opener = doc.activeElement as HTMLElement | null;

  dialog.setAttribute("aria-modal", "true");
  if (!dialog.hasAttribute("role")) dialog.setAttribute("role", "dialog");
  // So the dialog can hold focus itself when it has no tabbable children yet.
  if (!dialog.hasAttribute("tabindex")) dialog.tabIndex = -1;

  // Defer initial focus one microtask: a Portal-mounted node isn't laid out at
  // ref time, and `focus()` on a detached/hidden node is a no-op.
  queueMicrotask(() => {
    if (!dialog.isConnected) return;
    (opts.initialFocus?.() ?? tabbables(dialog)[0] ?? dialog).focus();
  });

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      opts.onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const items = tabbables(dialog);
    if (items.length === 0) {
      // Nothing to tab to — keep focus on the dialog itself.
      e.preventDefault();
      dialog.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = doc.activeElement;
    // Wrap at the edges so focus never leaves the dialog.
    if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
  dialog.addEventListener("keydown", onKeyDown);

  return () => {
    dialog.removeEventListener("keydown", onKeyDown);
    dialog.removeAttribute("aria-modal");
    // Restore focus to the opener if it's still around (it may have been removed,
    // e.g. the on-canvas ⚙ that opened the inspector unmounts with the chrome).
    if (opener && doc.contains(opener) && opener !== doc.body) opener.focus();
  };
}
