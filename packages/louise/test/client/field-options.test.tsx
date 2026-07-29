// Async field options (ADR 0010 Phase A2, #344).
//
// The three states a picker has — choices, wait, failure — plus the dedup that
// keeps ten fields of one type from firing ten requests.

import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFieldOptions, resetFieldOptionsCache } from "../../src/client/field-options.js";
import type { FieldOption } from "../../src/core/content/field-types.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A resolver that settles when the test says so. */
function deferred() {
  let resolve!: (v: FieldOption[]) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<FieldOption[]>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const fn = vi.fn(() => promise);
  return { fn, resolve, reject };
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  resetFieldOptionsCache();
  vi.restoreAllMocks();
});

describe("a literal option set", () => {
  it("is available immediately, with nothing to wait for", () => {
    createRoot((d) => {
      dispose = d;
      const s = createFieldOptions(() => [{ value: "a" }, { value: "b", label: "B" }]);
      // No spinner over a static list — that would be a lie about what's happening.
      expect(s.loading()).toBe(false);
      expect(s.error()).toBe("");
      expect(s.options().map((o) => o.value)).toEqual(["a", "b"]);
    });
  });

  it("treats an absent set as empty rather than as an error", () => {
    createRoot((d) => {
      dispose = d;
      const s = createFieldOptions(() => undefined);
      expect(s.options()).toEqual([]);
      expect(s.error()).toBe("");
    });
  });
});

describe("a resolved option set", () => {
  it("reports loading, then the choices", async () => {
    const { fn, resolve } = deferred();
    let s!: ReturnType<typeof createFieldOptions>;
    createRoot((d) => {
      dispose = d;
      s = createFieldOptions(() => fn);
    });

    expect(s.loading()).toBe(true);
    expect(s.options()).toEqual([]);

    resolve([{ value: "loc_1", label: "Downtown" }]);
    await tick();

    expect(s.loading()).toBe(false);
    expect(s.options()).toEqual([{ value: "loc_1", label: "Downtown" }]);
    expect(s.error()).toBe("");
  });

  it("surfaces a failure instead of rendering an empty picker", async () => {
    // The state that earns its keep: an empty dropdown after a failed fetch is
    // indistinguishable from a source that genuinely has nothing.
    const { fn, reject } = deferred();
    let s!: ReturnType<typeof createFieldOptions>;
    createRoot((d) => {
      dispose = d;
      s = createFieldOptions(() => fn);
    });

    reject(new Error("Square is unavailable"));
    await tick();

    expect(s.loading()).toBe(false);
    expect(s.error()).toBe("Square is unavailable");
    expect(s.options()).toEqual([]);
  });

  it("falls back to a readable message when the failure has none", async () => {
    const { fn, reject } = deferred();
    let s!: ReturnType<typeof createFieldOptions>;
    createRoot((d) => {
      dispose = d;
      s = createFieldOptions(() => fn);
    });

    reject("nope"); // a thrown string, not an Error
    await tick();
    expect(s.error()).toBe("Couldn’t load choices");
  });
});

describe("dedup", () => {
  it("fires one request for many fields sharing a resolver", async () => {
    // The case that matters is CONCURRENT mounts: an inspector opens with all its
    // fields at once, before anything has resolved. Caching only the result would
    // still fire one request per field.
    const { fn, resolve } = deferred();
    const states: ReturnType<typeof createFieldOptions>[] = [];
    createRoot((d) => {
      dispose = d;
      for (let i = 0; i < 5; i++) states.push(createFieldOptions(() => fn));
    });

    expect(fn).toHaveBeenCalledTimes(1);

    resolve([{ value: "x" }]);
    await tick();
    for (const s of states) expect(s.options()).toEqual([{ value: "x" }]);
  });

  it("does not cache a failure — the next editor gets a fresh attempt", async () => {
    // An outage ten minutes ago shouldn't be permanent for the session.
    const first = deferred();
    createRoot((d) => {
      dispose = d;
      createFieldOptions(() => first.fn);
    });
    first.reject(new Error("down"));
    await tick();
    dispose?.();

    let s!: ReturnType<typeof createFieldOptions>;
    createRoot((d) => {
      dispose = d;
      s = createFieldOptions(() => first.fn);
    });
    // Called again rather than replaying the rejection.
    expect(first.fn).toHaveBeenCalledTimes(2);
    expect(s.error()).toBe("");
  });

  it("keeps a resolved set for the session", async () => {
    const { fn, resolve } = deferred();
    createRoot((d) => {
      dispose = d;
      createFieldOptions(() => fn);
    });
    resolve([{ value: "a" }]);
    await tick();
    dispose?.();

    let s!: ReturnType<typeof createFieldOptions>;
    createRoot((d) => {
      dispose = d;
      s = createFieldOptions(() => fn);
    });
    await tick();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(s.options()).toEqual([{ value: "a" }]);
  });
});

describe("a stale resolution", () => {
  it("can't overwrite the field the inspector moved to", async () => {
    // The effect re-runs when the inspector moves on. Without the liveness guard
    // the older promise lands last and shows the previous field's choices.
    const slow = deferred();
    const fast = deferred();
    let s!: ReturnType<typeof createFieldOptions>;
    let which: "slow" | "literal" = "slow";
    createRoot((d) => {
      dispose = d;
      s = createFieldOptions(() => (which === "slow" ? slow.fn : [{ value: "literal" }]));
    });

    expect(s.loading()).toBe(true);
    dispose?.(); // the inspector closed — every effect is torn down
    slow.resolve([{ value: "stale" }]);
    await tick();

    // Nothing was written back into a disposed scope.
    expect(s.options()).toEqual([]);
    void which;
    void fast;
  });
});
