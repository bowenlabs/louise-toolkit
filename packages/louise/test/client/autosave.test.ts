// Unit tests for the auto-save scheduler (createAutosave) and the option
// normalizer (resolveAutoSave): debounce coalescing, single-flight overlap
// protection (no dropped edits), flush/cancel, and the pending() signal.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosave, resolveAutoSave } from "../../src/client/autosave.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("resolveAutoSave", () => {
  it("is enabled by default (undefined / true)", () => {
    expect(resolveAutoSave(undefined)).toEqual({ enabled: true, debounceMs: 800 });
    expect(resolveAutoSave(true)).toEqual({ enabled: true, debounceMs: 800 });
  });

  it("disables only on an explicit false", () => {
    expect(resolveAutoSave(false).enabled).toBe(false);
  });

  it("tunes the debounce via an object, falling back to the default", () => {
    expect(resolveAutoSave({ debounceMs: 250 })).toEqual({ enabled: true, debounceMs: 250 });
    expect(resolveAutoSave({})).toEqual({ enabled: true, debounceMs: 800 });
  });
});

describe("createAutosave", () => {
  it("coalesces rapid schedule() calls into one save", async () => {
    const save = vi.fn(() => Promise.resolve());
    const auto = createAutosave(save, 100);
    auto.schedule();
    auto.schedule();
    auto.schedule();
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush() saves immediately and cancels the pending debounce", async () => {
    const save = vi.fn(() => Promise.resolve());
    const auto = createAutosave(save, 1000);
    auto.schedule();
    auto.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    // The original debounce timer must not fire a second save.
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("never overlaps: an edit during an in-flight save queues exactly one re-run", async () => {
    let release = () => {};
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const auto = createAutosave(save, 50);

    auto.schedule();
    await vi.advanceTimersByTimeAsync(50); // save #1 starts, awaits the promise
    expect(save).toHaveBeenCalledTimes(1);

    // An edit lands while save #1 is still in flight.
    auto.schedule();
    await vi.advanceTimersByTimeAsync(50);
    expect(save).toHaveBeenCalledTimes(1); // still one — no overlap

    release(); // save #1 resolves → the queued re-run is scheduled
    await vi.advanceTimersByTimeAsync(50);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("cancel() drops a pending debounce without saving", async () => {
    const save = vi.fn(() => Promise.resolve());
    const auto = createAutosave(save, 100);
    auto.schedule();
    auto.cancel();
    await vi.advanceTimersByTimeAsync(500);
    expect(save).not.toHaveBeenCalled();
  });

  it("pending() reports armed → in-flight → settled", async () => {
    let release = () => {};
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const auto = createAutosave(save, 50);

    expect(auto.pending()).toBe(false);
    auto.schedule();
    expect(auto.pending()).toBe(true); // debounce armed
    await vi.advanceTimersByTimeAsync(50);
    expect(auto.pending()).toBe(true); // save in flight
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(auto.pending()).toBe(false);
  });

  it("survives a save that rejects (scheduler is not wedged)", async () => {
    const save = vi.fn(() => Promise.reject(new Error("boom")));
    const auto = createAutosave(save, 20);
    auto.schedule();
    await vi.advanceTimersByTimeAsync(20);
    expect(save).toHaveBeenCalledTimes(1);
    // A later edit still schedules and runs — the rejection didn't stick.
    auto.schedule();
    await vi.advanceTimersByTimeAsync(20);
    expect(save).toHaveBeenCalledTimes(2);
    expect(auto.pending()).toBe(false);
  });
});
