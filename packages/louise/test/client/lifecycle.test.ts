import { describe, expect, it, vi } from "vitest";
import { louiseNavigation, onLouiseNavigate } from "../../src/client/lifecycle.js";

describe("the page-lifecycle seam", () => {
  it("delivers each phase only to its own subscribers", () => {
    const before = vi.fn();
    const after = vi.fn();
    const offB = onLouiseNavigate("before-swap", before);
    const offA = onLouiseNavigate("after-swap", after);

    louiseNavigation.beforeSwap();
    expect(before).toHaveBeenCalledTimes(1);
    expect(after).not.toHaveBeenCalled();

    louiseNavigation.afterSwap();
    expect(after).toHaveBeenCalledTimes(1);
    offB();
    offA();
  });

  it("stops delivering after unsubscribe", () => {
    const fn = vi.fn();
    onLouiseNavigate("before-swap", fn)();
    louiseNavigation.beforeSwap();
    expect(fn).not.toHaveBeenCalled();
  });

  it("is a no-op with nothing mounted", () => {
    // A host wires these once for the document's lifetime, so they fire on pages
    // where no editor was ever mounted.
    expect(() => {
      louiseNavigation.beforeSwap();
      louiseNavigation.afterSwap();
    }).not.toThrow();
  });

  it("keeps going when one subscriber throws", () => {
    // The real hazard: the section dock's flush failing must not prevent the
    // page-level teardown, which would leak a realtime socket across the nav.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const survivor = vi.fn();
    const offBad = onLouiseNavigate("before-swap", () => {
      throw new Error("flush blew up");
    });
    const offGood = onLouiseNavigate("before-swap", survivor);

    expect(() => louiseNavigation.beforeSwap()).not.toThrow();
    expect(survivor).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalled();
    offBad();
    offGood();
    spy.mockRestore();
  });

  it("lets a handler unsubscribe itself mid-emit without skipping the next one", () => {
    // Exactly what the settings drawer does: it disposes on the first swap and
    // removes itself. Iterating the live Set would skip whoever came after it.
    const second = vi.fn();
    const offFirst = onLouiseNavigate("before-swap", () => offFirst());
    const offSecond = onLouiseNavigate("before-swap", second);

    louiseNavigation.beforeSwap();
    expect(second).toHaveBeenCalledTimes(1);
    offSecond();
  });
});
