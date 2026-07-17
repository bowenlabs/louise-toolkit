// #109 drawer action footer — happy-dom Solid tests for the push/pop stack, the
// footer rendering (actions + status pill + busy state), the empty-state
// collapse, and the Cmd/Ctrl+S shortcut. Exercises the mechanism in isolation
// with a synthetic consumer panel, independent of any real framework panel.

import { createSignal, type JSX, onCleanup, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DrawerFooter,
  type PanelAction,
  PanelActionsProvider,
  type SaveStatus,
  usePanelActions,
} from "../../src/client/settings/panel-actions.js";

let host: HTMLElement;
let dispose: (() => void) | undefined;

function mount(ui: () => JSX.Element) {
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(
    () => (
      <PanelActionsProvider>
        {ui()}
        <DrawerFooter />
      </PanelActionsProvider>
    ),
    host,
  );
}

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  vi.unstubAllGlobals();
});

/** A panel that pushes a footer frame on mount and pops it on unmount. */
function Consumer(props: { actions: PanelAction[]; status?: () => SaveStatus; tag?: string }) {
  const api = usePanelActions();
  onMount(() => onCleanup(api.push(props.actions, props.status)));
  return <div>{props.tag ?? "consumer"}</div>;
}

const footer = () => host.querySelector<HTMLElement>(".louise-drawer-foot");
const footBtn = (id: string) =>
  host.querySelector<HTMLButtonElement>(`.louise-drawer-foot [data-action="${id}"]`);
const footBtnLabels = () =>
  Array.from(host.querySelectorAll<HTMLButtonElement>(".louise-drawer-foot [data-action]")).map(
    (b) => b.textContent?.trim(),
  );
const pill = () => host.querySelector<HTMLElement>(".louise-foot-status");

describe("panel-actions — footer stack", () => {
  it("renders the active frame's actions and runs onClick", () => {
    const onSave = vi.fn();
    mount(() => (
      <Consumer actions={[{ id: "save", label: "Save", kind: "primary", onClick: onSave }]} />
    ));
    expect(footBtn("save")?.textContent?.trim()).toBe("Save");
    footBtn("save")!.click();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("collapses (no footer) when the active view has neither actions nor status", () => {
    mount(() => <Consumer actions={[]} />);
    expect(footer()).toBeNull();
  });

  it("deepest-wins: a nested frame replaces the parent's actions, and pops back on unmount", () => {
    const [open, setOpen] = createSignal(false);
    mount(() => (
      <>
        <Consumer actions={[{ id: "parent", label: "Parent", onClick: () => {} }]} />
        <Show when={open()}>
          <Consumer actions={[{ id: "child", label: "Child", onClick: () => {} }]} />
        </Show>
      </>
    ));
    // Parent frame owns the footer.
    expect(footBtnLabels()).toEqual(["Parent"]);
    // Child mounts → its frame is deepest → it owns the footer.
    setOpen(true);
    expect(footBtnLabels()).toEqual(["Child"]);
    // Child unmounts → identity pop restores the parent's actions.
    setOpen(false);
    expect(footBtnLabels()).toEqual(["Parent"]);
  });

  it("reactive disabled predicate enables/disables the primary", () => {
    const [dirty, setDirty] = createSignal(false);
    mount(() => (
      <Consumer
        actions={[
          {
            id: "save",
            label: "Save",
            kind: "primary",
            disabled: () => !dirty(),
            onClick: () => {},
          },
        ]}
      />
    ));
    expect(footBtn("save")?.disabled).toBe(true);
    setDirty(true);
    expect(footBtn("save")?.disabled).toBe(false);
  });

  it("shows busyLabel + disables while an async onClick is pending, then restores", async () => {
    let release!: () => void;
    const pending = new Promise<void>((r) => (release = r));
    mount(() => (
      <Consumer
        actions={[
          {
            id: "save",
            label: "Save",
            kind: "primary",
            busyLabel: "Saving…",
            onClick: () => pending,
          },
        ]}
      />
    ));
    footBtn("save")!.click();
    await vi.waitFor(() => expect(footBtn("save")?.textContent?.trim()).toBe("Saving…"));
    expect(footBtn("save")?.disabled).toBe(true);
    release();
    await vi.waitFor(() => expect(footBtn("save")?.textContent?.trim()).toBe("Save"));
    expect(footBtn("save")?.disabled).toBe(false);
  });
});

describe("panel-actions — status pill", () => {
  it("renders saving/saved/error and hides on idle", () => {
    const [status, setStatus] = createSignal<SaveStatus>({ state: "idle" });
    mount(() => <Consumer actions={[]} status={() => status()} />);
    // idle → no pill, and with no actions the whole footer collapses.
    expect(pill()).toBeNull();

    setStatus({ state: "saving" });
    expect(pill()?.textContent).toContain("Saving");

    setStatus({ state: "saved" });
    expect(pill()?.getAttribute("data-state")).toBe("saved");
    expect(pill()?.textContent).toContain("Saved");

    setStatus({ state: "error", message: "Nope" });
    expect(pill()?.getAttribute("data-state")).toBe("error");
    expect(pill()?.textContent).toContain("Nope");
  });
});

describe("panel-actions — Cmd/Ctrl+S", () => {
  const press = (init: KeyboardEventInit) =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", cancelable: true, ...init }));

  it("triggers the enabled primary on Cmd+S and Ctrl+S", () => {
    const onSave = vi.fn();
    mount(() => (
      <Consumer actions={[{ id: "save", label: "Save", kind: "primary", onClick: onSave }]} />
    ));
    press({ metaKey: true });
    press({ ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the primary is disabled or absent", () => {
    const onSave = vi.fn();
    mount(() => (
      <Consumer
        actions={[
          { id: "save", label: "Save", kind: "primary", disabled: () => true, onClick: onSave },
          { id: "cancel", label: "Cancel", onClick: () => {} },
        ]}
      />
    ));
    press({ metaKey: true });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("ignores a bare S with no modifier", () => {
    const onSave = vi.fn();
    mount(() => (
      <Consumer actions={[{ id: "save", label: "Save", kind: "primary", onClick: onSave }]} />
    ));
    press({});
    expect(onSave).not.toHaveBeenCalled();
  });
});
