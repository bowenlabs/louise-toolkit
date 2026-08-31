// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// Page-lifecycle seam — the framework-neutral replacement for listening to a
// specific router's navigation events (#327 Phase 1).
//
// The editor needs to know two things about a SOFT navigation, where the host's
// router swaps the DOM without a page load:
//
//   • before the swap — flush pending auto-saved edits, because none of the
//     browser's own "leaving" signals (`pagehide`, `beforeunload`,
//     `visibilitychange`) fire for one, so edits would be dropped (#74);
//   • after the swap — drop the now-defunct editor, clear the mount guard, and
//     close the realtime socket, so the next page mounts cleanly.
//
// This module used to get both by listening for `astro:before-swap` and
// `astro:after-swap` directly. That worked, and it put the name of one specific
// framework's events inside a library that claims to be framework-agnostic. The
// events are now the HOST's to observe: it calls {@link louiseNavigation}, and
// Louise never knows what produced the signal.
//
//   // an Astro host:
//   import { louiseNavigation } from "louise-toolkit/client";
//   document.addEventListener("astro:before-swap", louiseNavigation.beforeSwap);
//   document.addEventListener("astro:after-swap", louiseNavigation.afterSwap);
//
// A host with no soft navigation calls neither, and everything still works: hard
// navigations are covered by the browser events Louise wires itself.

/** The two moments a host reports around a soft navigation. */
export type LouiseNavigationPhase = "before-swap" | "after-swap";

type Handler = () => void;

const handlers: Record<LouiseNavigationPhase, Set<Handler>> = {
  "before-swap": new Set(),
  "after-swap": new Set(),
};

/**
 * Subscribe to a navigation phase. Returns an unsubscribe.
 *
 * Internal to the client modules — a site wires {@link louiseNavigation}
 * instead. Exported because the section dock and the settings drawer are
 * separate entry points that each need the signal.
 */
export function onLouiseNavigate(phase: LouiseNavigationPhase, handler: Handler): () => void {
  handlers[phase].add(handler);
  return () => {
    handlers[phase].delete(handler);
  };
}

function emit(phase: LouiseNavigationPhase): void {
  // Copy before iterating: an `after-swap` handler legitimately unsubscribes
  // itself (the settings drawer disposes on swap), and mutating a Set mid-
  // iteration would skip the next handler.
  for (const handler of [...handlers[phase]]) {
    try {
      handler();
    } catch (error) {
      // One subscriber failing must not stop the others — a swallowed flush in
      // the dock should never prevent the page-level editor being torn down,
      // which would leak a realtime socket across the navigation.
      console.error("[louise] navigation handler failed", error);
    }
  }
}

/**
 * What a host calls when its router swaps the page.
 *
 * Both are safe to call when nothing is mounted, and safe to call repeatedly —
 * a host can wire them once for the document's lifetime.
 */
export const louiseNavigation = {
  /** The DOM is about to be replaced. Flushes pending edits. */
  beforeSwap(): void {
    emit("before-swap");
  },
  /** The new DOM is in place. Tears down what belonged to the old page. */
  afterSwap(): void {
    emit("after-swap");
  },
} as const;
