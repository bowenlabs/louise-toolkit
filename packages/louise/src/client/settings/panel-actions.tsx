// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The Louise drawer's action footer — a shell-owned, always-visible bar where
// the active panel/editor declares its save / cancel / publish / delete actions,
// so they're never scattered inline and scrolled off. A push/pop STACK (not a
// single setter) is what makes nested editors work: the deepest mounted view
// (e.g. a per-asset media editor) owns the footer and restores the parent's
// actions when it unmounts. Auto-saving surfaces push a status instead of
// buttons, so "did it save?" has one consistent home.
//
// The provider wraps the drawer body subtree in shell.tsx and also installs the
// Cmd/Ctrl+S shortcut → the active frame's primary action.

import {
  type Accessor,
  createContext,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
  useContext,
} from "solid-js";

/** How an action reads: `primary` (blue Save/Publish), `ghost` (Cancel/Revert),
 *  `danger` (Delete). Maps onto the drawer's existing button styles. */
export type ActionKind = "primary" | "ghost" | "danger";

export interface PanelAction {
  /** Stable id (dedupe / test hook). */
  id: string;
  /** Button label, e.g. "Save", "Cancel", "Publish", "Delete". */
  label: string;
  /** Visual treatment; defaults to `ghost`. */
  kind?: ActionKind;
  /** Runs on click / on Cmd+S when this is the enabled primary. May be async —
   *  while its promise is pending the button shows {@link busyLabel} + disables. */
  onClick: () => void | Promise<void>;
  /** Reactive disabled predicate, e.g. `() => !dirty()`. */
  disabled?: () => boolean;
  /** Label shown while `onClick`'s promise is pending, e.g. "Saving…". */
  busyLabel?: string;
}

/** Status shown when a surface auto-saves (or after an explicit save settles). */
export type SaveStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved" }
  | { state: "error"; message: string };

/** One stacked footer frame: the active view's actions + optional live status. */
interface Frame {
  actions: PanelAction[];
  status?: () => SaveStatus;
}

export interface PanelActionsApi {
  /** Push this view's footer frame; returns a disposer that pops exactly it.
   *  Call in `onMount` and hand the disposer to `onCleanup` so the parent's
   *  actions restore when this view unmounts. */
  push(actions: PanelAction[], status?: () => SaveStatus): () => void;
}

interface PanelActionsCtxValue extends PanelActionsApi {
  /** The top-of-stack frame that currently drives the footer. */
  active: Accessor<Frame | undefined>;
}

const PanelActionsCtx = createContext<PanelActionsCtxValue>();

/**
 * Hosts the footer frame stack and the Cmd/Ctrl+S shortcut. Wrap the drawer
 * body + {@link DrawerFooter} in one of these. The stack is a plain signal (not
 * a store) so pushed frames keep referential identity — the disposer pops by
 * identity, which a store's proxying would silently break.
 */
export function PanelActionsProvider(props: { children: JSX.Element }): JSX.Element {
  const [stack, setStack] = createSignal<Frame[]>([]);
  const push: PanelActionsApi["push"] = (actions, status) => {
    const frame: Frame = { actions, status };
    setStack((s) => [...s, frame]);
    return () => setStack((s) => s.filter((f) => f !== frame));
  };
  const active = () => stack().at(-1);

  // Cmd/Ctrl+S triggers the active frame's enabled primary action. Only claims
  // the keystroke when there is one, so the browser's Save still works otherwise.
  const onKey = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s") return;
    const primary = active()?.actions.find(
      (a) => a.kind === "primary" && !(a.disabled?.() ?? false),
    );
    if (!primary) return;
    e.preventDefault();
    void primary.onClick();
  };
  onMount(() => window.addEventListener("keydown", onKey));
  onCleanup(() => window.removeEventListener("keydown", onKey));

  return (
    <PanelActionsCtx.Provider value={{ push, active }}>{props.children}</PanelActionsCtx.Provider>
  );
}

/** Access the footer action stack. Must run under a {@link PanelActionsProvider}
 *  (the drawer body is wrapped in one); throws otherwise so a missing provider
 *  is a loud bug rather than a silently swallowed push. */
export function usePanelActions(): PanelActionsApi {
  const ctx = useContext(PanelActionsCtx);
  if (!ctx) throw new Error("usePanelActions must be used within a <PanelActionsProvider>");
  return ctx;
}

function statusLabel(s: SaveStatus): string {
  switch (s.state) {
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved ✓";
    case "error":
      return s.message || "Couldn’t save";
    default:
      return "";
  }
}

function SaveStatusPill(props: { status: SaveStatus }): JSX.Element {
  return (
    <Show when={props.status.state !== "idle"}>
      <span
        class="louise-foot-status"
        data-state={props.status.state}
        role="status"
        aria-live="polite"
      >
        {statusLabel(props.status)}
      </span>
    </Show>
  );
}

function ActionButton(props: { action: PanelAction }): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const kind = () => props.action.kind ?? "ghost";
  const disabled = () => busy() || (props.action.disabled?.() ?? false);
  const run = async () => {
    const r = props.action.onClick();
    if (r && typeof (r as Promise<void>).then === "function") {
      setBusy(true);
      try {
        await r;
      } finally {
        setBusy(false);
      }
    }
  };
  return (
    <button
      type="button"
      class="louise-btn"
      classList={{
        "louise-btn-primary": kind() === "primary",
        "louise-btn-danger": kind() === "danger",
      }}
      data-action={props.action.id}
      disabled={disabled()}
      onClick={() => void run()}
    >
      {busy() && props.action.busyLabel ? props.action.busyLabel : props.action.label}
    </button>
  );
}

/**
 * The sticky footer, rendered by the shell after `louise-drawer-body`. Shows the
 * top-of-stack frame's status pill + action buttons; collapses (renders nothing)
 * when the active view has neither actions nor a status, so list/empty panels
 * (Inbox, the Home dashboard) don't show a bare bar.
 */
export function DrawerFooter(): JSX.Element {
  const ctx = useContext(PanelActionsCtx);
  if (!ctx) throw new Error("<DrawerFooter> must be used within a <PanelActionsProvider>");
  const shown = () => {
    const f = ctx.active();
    return f && (f.actions.length > 0 || f.status) ? f : undefined;
  };
  return (
    <Show when={shown()}>
      {(frame) => (
        <div class="louise-drawer-foot">
          <Show when={frame().status}>{(st) => <SaveStatusPill status={st()()} />}</Show>
          <div class="louise-foot-actions">
            <For each={frame().actions}>{(a) => <ActionButton action={a} />}</For>
          </div>
        </div>
      )}
    </Show>
  );
}
