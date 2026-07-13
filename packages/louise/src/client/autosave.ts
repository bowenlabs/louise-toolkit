// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/client — the auto-save scheduler shared by both on-page editing
// surfaces (inline fields in `index.ts` and the sections dock in `sections.tsx`).
//
// It is deliberately framework-agnostic (no Solid, no DOM): give it the surface's
// existing save function and it debounces edits, calls that save, and — crucially
// — serializes saves so two never overlap. When an edit lands while a save is
// in flight, exactly one coalesced re-run is queued for when it settles, so no
// edit is ever dropped. The save function keeps owning persistence + status
// reporting; this only owns *when* to call it.
//
// Not a bare `debounce()`: the overlap coordination, `flush()` (for blur /
// tab-hide / unload), and the `pending()` signal (for the `beforeunload` guard)
// are what the surfaces would otherwise each reimplement.

/** Public option shape. `true`/`undefined` enable with the default delay; an
 *  object tunes the debounce; `false` disables (opt-out — auto-save is on by
 *  default). */
export type AutoSaveOption = boolean | { debounceMs?: number };

export interface Autosave {
  /** Call after any edit — (re)arms the idle debounce. */
  schedule(): void;
  /** Save now, bypassing the debounce (blur / tab-hide / unload). */
  flush(): void;
  /** Drop a pending debounce without saving — for a manual action (Publish, a
   *  structural change) that supersedes the queued auto-save. */
  cancel(): void;
  /** A save is scheduled, in flight, or queued to re-run — i.e. there is unsaved
   *  or in-transit work. Drives the `beforeunload` unsaved-changes guard. */
  pending(): boolean;
}

const DEFAULT_DEBOUNCE_MS = 800;

/** Normalize the public `autoSave` option once, so both surfaces agree on the
 *  default (ON) and the fallback delay. */
export function resolveAutoSave(opt: AutoSaveOption | undefined): {
  enabled: boolean;
  debounceMs: number;
} {
  if (opt === false) return { enabled: false, debounceMs: DEFAULT_DEBOUNCE_MS };
  if (opt === undefined || opt === true) return { enabled: true, debounceMs: DEFAULT_DEBOUNCE_MS };
  return { enabled: true, debounceMs: opt.debounceMs ?? DEFAULT_DEBOUNCE_MS };
}

/**
 * Build an auto-save scheduler around a surface's `save`. `save` may be sync or
 * async and is expected to report its own success/failure (it typically leaves
 * the surface "dirty" on error, so the next `schedule()` naturally retries — the
 * scheduler intentionally does not hot-retry a failing endpoint).
 */
export function createAutosave(save: () => unknown, debounceMs = DEFAULT_DEBOUNCE_MS): Autosave {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  // Set when a schedule/flush arrives during an in-flight save: run one more,
  // coalesced, save when the current one settles.
  let rerun = false;

  const run = async (): Promise<void> => {
    timer = null;
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      await save();
    } catch {
      // `save` reports its own errors; swallow here so a throw can't wedge the
      // scheduler (leaving `running` stuck true).
    } finally {
      running = false;
      if (rerun) {
        rerun = false;
        schedule();
      }
    }
  };

  function schedule(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => void run(), debounceMs);
  }

  function flush(): void {
    if (timer !== null) {
      clearTimeout(timer);
      void run();
    } else if (running) {
      // Mid-save with nothing queued yet — make sure the latest state gets one
      // more save after the in-flight one, so flush is never a silent no-op.
      rerun = true;
    }
  }

  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    rerun = false;
  }

  function pending(): boolean {
    return timer !== null || running || rerun;
  }

  return { schedule, flush, cancel, pending };
}
