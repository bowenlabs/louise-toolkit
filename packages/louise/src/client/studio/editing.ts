// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Two small behaviours every studio form needs, and every site got wrong the
// same way. Both are plain DOM—no framework, no router.

// ── Unsaved changes ──────────────────────────────────────────────────────────

export interface UnsavedChangesOptions {
  /**
   * A dirtiness the snapshot can't see—for example, a rich-text document that loads
   * after the form opens, so it has no value to compare at open.
   */
  alsoDirty?: () => boolean;
  /** The question asked before discarding changes. */
  message?: string;
  /** How to ask. Default `window.confirm`. */
  confirm?: (message: string) => boolean;
}

export interface UnsavedChanges {
  /** Whether the form differs from when it opened (or was last saved). */
  dirty: () => boolean;
  /** For an exit inside the form (Back, Cancel): ask first if there's anything to lose. */
  leave: (go: () => void) => void;
  /**
   * For a router's navigation blocker: `true` means stay. Asks the question
   * only when dirty. With TanStack Router:
   * `useBlocker({ shouldBlockFn: guard.shouldBlock, enableBeforeUnload: guard.dirty })`.
   */
  shouldBlock: () => boolean;
  /** Re-baseline after a save, so the form is clean again without closing it. */
  markSaved: () => void;
  /**
   * Prompt on refresh / close / leaving the site while dirty (the browser's
   * own prompt; its wording is the browser's). Returns the detach function—call
   * it on unmount. Skip this if your router's blocker already does it.
   */
  watchUnload: () => () => void;
}

/**
 * "You have unsaved changes" for a studio form.
 *
 * Dirty is decided by comparing `snapshot()`—the form's save payload—with
 * its value when the guard was created, so typing a letter and deleting it
 * again is not a change, and no field has to remember to mark itself dirty.
 * The snapshot must be JSON-serializable.
 *
 * Router-agnostic on purpose: in-form exits call `leave`, a router's blocker
 * calls `shouldBlock`, and the browser's own exits go through `watchUnload`.
 * A form that forgets one of the three drops edits without a word—which is
 * what happened on each of them before this existed.
 */
export function unsavedChanges(
  snapshot: () => unknown,
  options: UnsavedChangesOptions = {},
): UnsavedChanges {
  const message = options.message ?? "You have unsaved changes. Leave without saving?";
  const ask = options.confirm ?? ((m: string) => window.confirm(m));
  let baseline = JSON.stringify(snapshot());
  const dirty = () => (options.alsoDirty?.() ?? false) || JSON.stringify(snapshot()) !== baseline;

  return {
    dirty,
    leave: (go) => {
      if (!dirty() || ask(message)) go();
    },
    shouldBlock: () => dirty() && !ask(message),
    markSaved: () => {
      baseline = JSON.stringify(snapshot());
    },
    watchUnload: () => {
      const onBeforeUnload = (e: BeforeUnloadEvent) => {
        if (!dirty()) return;
        e.preventDefault();
        // Older browsers need a returnValue to show the prompt at all.
        e.returnValue = "";
      };
      window.addEventListener("beforeunload", onBeforeUnload);
      return () => window.removeEventListener("beforeunload", onBeforeUnload);
    },
  };
}

// ── A select that saves when a choice is made ────────────────────────────────

/** Keys that move a closed <select>'s value one step (Windows, and Chrome elsewhere). */
const STEP_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

export interface SettledSelectHandlers {
  onPointerDown: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onChange: (e: Event) => void;
  onBlur: () => void;
}

/**
 * Event handlers for a `<select>` that saves on change—but only once a
 * choice is actually made.
 *
 * Arrowing through a closed select fires `change` on every step. For a select
 * that saves on change, that is one save per option passed: a status went
 * New → Replied → Quoted → Won, logging each, on the way to the one intended.
 * So a keyboard change is held until it's committed—Enter, or leaving the
 * field—while a pointer pick still saves at once.
 *
 * Spread onto the element: `<select {...settledSelect(save)}>`.
 */
export function settledSelect(commit: (value: string) => void): SettledSelectHandlers {
  let fromKeys = false;
  let pending: string | null = null;
  const flush = () => {
    if (pending === null) return;
    const value = pending;
    pending = null;
    commit(value);
  };
  return {
    onPointerDown: () => {
      fromKeys = false;
    },
    onKeyDown: (e) => {
      if (STEP_KEYS.has(e.key)) fromKeys = true;
      else if (e.key === "Enter") flush();
    },
    onChange: (e) => {
      const value = (e.currentTarget as HTMLSelectElement).value;
      if (fromKeys) pending = value;
      else commit(value);
    },
    onBlur: () => {
      fromKeys = false;
      flush();
    },
  };
}
