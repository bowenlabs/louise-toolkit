// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Resolving a field's choices at edit time (ADR 0010, Phase A2 — epic #341,
// slice #344).
//
// A `select` used to take a literal array, so a picker whose values come from an
// API — Square locations, a product catalog — could not be expressed in a section
// catalog at all. The settings drawer's `render` escape hatch was the only way to
// build one, and the section inspector has no equivalent. This is the seam that
// makes it a field type rather than an escape hatch.
//
// Three states, deliberately, because a picker has three: the choices, the wait,
// and the failure. A picker that renders empty when its fetch failed is
// indistinguishable from one whose source genuinely has nothing, and an editor
// staring at an empty dropdown has no way to tell which happened.

import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import {
  type FieldOption,
  type FieldOptions,
  type FieldOptionsResolver,
  isOptionsResolver,
} from "../core/content/field-types.js";

/**
 * One in-flight or settled fetch per resolver, shared by every field using it.
 *
 * Keyed on the resolver's own identity, which works because a catalog declares it
 * once and every field naming that type gets the same function reference.
 *
 * The cached value is the PROMISE, not the result — that is what dedups
 * concurrent mounts. Caching the result only, as `link-field.tsx` does for its
 * page list, still fires N requests when N fields mount before the first one
 * resolves, which is the common case: an inspector opens with all its fields at
 * once.
 */
const inflight = new Map<FieldOptionsResolver, Promise<FieldOption[]>>();

/** Drop every cached resolution. Tests only — a resolved list would otherwise
 *  leak across cases, and a resolver stubbed per-case would be ignored after the
 *  first. */
export function resetFieldOptionsCache(): void {
  inflight.clear();
}

/** What an editor needs to draw a picker. */
export interface FieldOptionsState {
  options: () => FieldOption[];
  /** A fetch is outstanding. False for a literal set — there is nothing to wait
   *  for, and flashing a spinner over a static list is a lie. */
  loading: () => boolean;
  /** Empty unless the fetch failed, in which case it is what to tell the editor. */
  error: () => string;
}

/**
 * Resolve a field's `options` — literal or fetched — into the three states an
 * editor renders.
 *
 * `get` is an accessor rather than a value so the caller can pass a reactive
 * source; re-reading it re-resolves, which is what happens when the inspector
 * moves to a different field.
 */
export function createFieldOptions(get: () => FieldOptions | undefined): FieldOptionsState {
  const [fetched, setFetched] = createSignal<FieldOption[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  // A literal set is known synchronously and must stay that way. Routing it
  // through the effect below would defer it by a tick, and a static picker would
  // render empty for a frame before filling in — a flash the old direct `<For>`
  // never had, introduced by a feature that isn't even about static lists.
  const literal = createMemo(() => {
    const opts = get();
    return isOptionsResolver(opts) ? null : (opts ?? []);
  });

  createEffect(() => {
    const opts = get();

    if (!isOptionsResolver(opts)) {
      // Nothing to fetch — and clear any state left by a resolver this field was
      // pointed at a moment ago.
      setFetched([]);
      setLoading(false);
      setError("");
      return;
    }

    // The effect can re-run before a fetch settles (the inspector moved on).
    // Without this guard the older promise would land last and overwrite the
    // newer field's choices with the previous field's.
    let live = true;
    onCleanup(() => {
      live = false;
    });

    let pending = inflight.get(opts);
    if (!pending) {
      pending = opts();
      inflight.set(opts, pending);
    }

    setLoading(true);
    setError("");
    void pending.then(
      (list) => {
        if (!live) return;
        setFetched(list);
        setLoading(false);
      },
      (err: unknown) => {
        // A failure is not cached: the next editor to open this field should get
        // a fresh attempt rather than inheriting an outage from ten minutes ago.
        inflight.delete(opts);
        if (!live) return;
        setFetched([]);
        setError(err instanceof Error && err.message ? err.message : "Couldn’t load choices");
        setLoading(false);
      },
    );
  });

  // The literal set when there is one, the fetched set otherwise. Never both —
  // `literal()` is null exactly when `options` is a resolver.
  const options = (): FieldOption[] => literal() ?? fetched();

  return { options, loading, error };
}
