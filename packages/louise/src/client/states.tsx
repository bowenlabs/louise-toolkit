// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Loading, empty, and error states for the editor's panels (#468). Before these,
// each view improvised: some showed "Loading…", some nothing, and a failed list
// read as an empty one ("No pages yet."), which is wrong rather than unhelpful.
//
// The live regions follow one rule: the region is in the page before its message.
// Many screen readers announce a change to a region that's already there, not a
// region inserted along with its text, so each state mounts its region empty and
// fills it a tick later.

import { createSignal, type JSX, onCleanup, onMount, Show } from "solid-js";

/** Fill a just-mounted live region a tick later, so the change is announced. */
function useAnnounced(): () => boolean {
  const [ready, setReady] = createSignal(false);
  onMount(() => {
    const timer = setTimeout(() => setReady(true), 0);
    onCleanup(() => clearTimeout(timer));
  });
  return ready;
}

/**
 * A loading placeholder in the shape of what's coming: list rows, a grid of
 * tiles, or a panel of text lines. The container is `aria-busy`, and its label
 * ("Loading pages") is the text a screen reader hears. The shimmer stops under
 * `prefers-reduced-motion`.
 */
export function Skeleton(props: {
  /** What's loading, read to a screen reader: "Loading pages". */
  label: string;
  /** The shape of the content. Default `rows`. */
  shape?: "rows" | "grid" | "panel";
  /** How many rows, tiles, or lines. Default 3. */
  count?: number;
}): JSX.Element {
  const items = () => Array.from({ length: props.count ?? 3 });
  return (
    <div class="louise-skeleton" data-shape={props.shape ?? "rows"} role="status" aria-busy="true">
      <span class="louise-sr-only">{props.label}</span>
      {items().map(() => (
        <span class="louise-skeleton-item" aria-hidden="true" />
      ))}
    </div>
  );
}

/** Nothing here yet, and optionally the one thing to do about it. */
export function EmptyState(props: {
  /** Plain words: "No pages yet." */
  message: string;
  /** The next step, such as "New page". */
  action?: { label: string; onClick: () => void };
}): JSX.Element {
  return (
    <div class="louise-empty">
      <p class="louise-muted">{props.message}</p>
      <Show when={props.action}>
        {(action) => (
          <button class="louise-btn" type="button" onClick={action().onClick}>
            {action().label}
          </button>
        )}
      </Show>
    </div>
  );
}

/**
 * Something failed, and the way out. `onRetry` is required: a failure view
 * with nothing to do about it shouldn't be expressible. The message sits in a
 * `role="alert"` region that mounts empty and fills a tick later.
 */
export function ErrorState(props: {
  /** What failed and what's still true: "Couldn't load your pages." Pass
   *  `apiErrorMessage(error, fallback)` for an API failure. */
  message: string;
  onRetry: () => void;
  /** Default "Try again". */
  retryLabel?: string;
}): JSX.Element {
  const ready = useAnnounced();
  return (
    <div class="louise-error-state">
      <p class="louise-error-text" role="alert">
        {ready() ? props.message : ""}
      </p>
      <button class="louise-btn" type="button" onClick={() => props.onRetry()}>
        {props.retryLabel ?? "Try again"}
      </button>
    </div>
  );
}

/**
 * A field-level message. It's always in the page, empty while there's nothing
 * to say, so setting `message` is announced. Point the field's
 * `aria-describedby` at `id`.
 */
export function InlineError(props: {
  id: string;
  message: string | null | undefined;
}): JSX.Element {
  return (
    <p id={props.id} class="louise-field-error" aria-live="polite">
      {props.message ?? ""}
    </p>
  );
}
