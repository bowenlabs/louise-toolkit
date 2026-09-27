// Behavior coverage for the grammar checker's ProseMirror plugin and its Harper
// wrapper (`src/client/grammar/plugin.ts`, `linter.ts`), #695. `harper.js` is
// mocked, so no WASM loads: the fake `WorkerLinter` flags every "teh" as a
// spelling issue, and each test drives a real ProseKit editor under happy-dom.

import { defineBasicExtension } from "prosekit/basic";
import { createEditor, type Editor, union } from "prosekit/core";
import type { EditorState, Plugin } from "@prosekit/pm/state";
import type { DecorationSet, EditorView } from "@prosekit/pm/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CHROME_LANG } from "../../src/client/a11y.js";
import { defineGrammarExtension } from "../../src/client/grammar/plugin.js";

interface FakeSuggestion {
  text: string;
  kind: number;
}

const harper = vi.hoisted(() => {
  const state = {
    constructed: [] as unknown[],
    setup: (): Promise<void> => Promise.resolve(),
    lint: vi.fn<(text: string) => Promise<unknown[]>>(),
    // The suggestions the fake reports for each "teh", as Harper's raw kinds:
    // 0 replace, 1 remove, 2 insertAfter.
    suggestions: [{ text: "the", kind: 0 }] as { text: string; kind: number }[],
  };
  return state;
});

vi.mock("harper.js", () => ({
  WorkerLinter: class {
    constructor(options: unknown) {
      harper.constructed.push(options);
    }
    setup(): Promise<void> {
      return harper.setup();
    }
    lint(text: string): Promise<unknown[]> {
      return harper.lint(text);
    }
  },
}));
vi.mock("harper.js/binaryInlined", () => ({ binaryInlined: "inlined-binary" }));

/** A Harper-shaped `Lint` for each "teh" in `text`, with code-point spans. */
function fakeLints(text: string, suggestions: FakeSuggestion[]): unknown[] {
  const points = Array.from(text);
  const lints: unknown[] = [];
  for (let i = 0; i + 3 <= points.length; i++) {
    if (points.slice(i, i + 3).join("") !== "teh") continue;
    const start = i;
    lints.push({
      span: () => ({ start, end: start + 3 }),
      message: () => "Did you mean to spell “teh” this way?",
      lint_kind: () => "Spelling",
      suggestions: () =>
        suggestions.map((s) => ({ get_replacement_text: () => s.text, kind: () => s.kind })),
    });
  }
  return lints;
}

const DEBOUNCE_MS = 600;

/** Let pending promise chains (mocked imports, setup, lint) run to completion. */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

/** Wait out the debounce, then let the lint finish. */
async function lintNow(): Promise<void> {
  await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
  await flush();
}

const cleanups: (() => void)[] = [];

function mount(html: string): { editor: Editor; view: EditorView; host: HTMLElement } {
  const editor = createEditor({
    extension: union(defineBasicExtension(), defineGrammarExtension()),
    defaultContent: html,
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  editor.mount(host);
  cleanups.push(() => {
    if (editor.mounted) editor.unmount();
    host.remove();
  });
  return { editor, view: editor.view, host };
}

function grammarPlugin(state: EditorState): Plugin<DecorationSet> {
  const plugin = state.plugins.find((p) =>
    (p as unknown as { key: string }).key.startsWith("louiseGrammar"),
  );
  if (!plugin) throw new Error("grammar plugin missing");
  return plugin as Plugin<DecorationSet>;
}

/** Every underline as `[from, to, flagged text]`. */
function underlines(view: EditorView): [number, number, string][] {
  const set = grammarPlugin(view.state).getState(view.state);
  return (set?.find() ?? []).map((d) => [d.from, d.to, view.state.doc.textBetween(d.from, d.to)]);
}

/** Run the plugin's click handler at `pos`, the way a click in the editor does. */
function clickAt(view: EditorView, pos: number): boolean {
  const plugin = grammarPlugin(view.state);
  const handler = plugin.props.handleClick as (v: EditorView, p: number, e: MouseEvent) => boolean;
  return handler.call(plugin, view, pos, new MouseEvent("click"));
}

function popover(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".louise-grammar-popover");
}

function mousedown(el: EventTarget): void {
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
}

function typeAt(view: EditorView, pos: number, text: string): void {
  view.dispatch(view.state.tr.insertText(text, pos, pos));
}

beforeAll(async () => {
  // Warm the mocked modules so the plugin's dynamic imports resolve in microtasks.
  await import("harper.js");
  await import("harper.js/binaryInlined");
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  harper.constructed.length = 0;
  harper.setup = () => Promise.resolve();
  harper.suggestions = [{ text: "the", kind: 0 }];
  harper.lint.mockReset();
  harper.lint.mockImplementation((text) => Promise.resolve(fakeLints(text, harper.suggestions)));
});

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
  document.querySelectorAll(".louise-grammar-popover").forEach((el) => el.remove());
  vi.useRealTimers();
});

describe("grammar plugin: linting", () => {
  it("waits for the debounce, then underlines each issue at its document position", async () => {
    const { view, host } = mount("<p>I saw teh cat</p><p>and <strong>teh</strong> dog</p>");

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    await flush();
    expect(harper.lint).not.toHaveBeenCalled();
    expect(underlines(view)).toEqual([]);

    await lintNow();
    // One Harper worker per editor, built from the inlined binary.
    expect(harper.constructed).toEqual([{ binary: "inlined-binary" }]);
    // Each textblock is linted once, against its own text (marks flattened).
    expect(harper.lint.mock.calls.map(([t]) => t)).toEqual(["I saw teh cat", "and teh dog"]);
    // "teh" at code points [6, 9) of block 0 (pos 0), and [4, 7) of block 1 (pos 15).
    expect(underlines(view)).toEqual([
      [7, 10, "teh"],
      [20, 23, "teh"],
    ]);
    const marked = [...host.querySelectorAll(".louise-grammar-issue")].map((el) => el.textContent);
    expect(marked).toEqual(["teh", "teh"]);
  });

  it("skips empty paragraphs and lints nested textblocks", async () => {
    const { view } = mount("<p></p><ul><li><p>teh item</p></li></ul>");
    await lintNow();
    expect(harper.lint.mock.calls.map(([t]) => t)).toEqual(["teh item"]);
    const [[from, to, text]] = underlines(view);
    expect(text).toBe("teh");
    expect(to - from).toBe(3);
  });

  it("maps code-point spans across astral characters", async () => {
    const { view } = mount("<p>\u{1F600} teh</p>");
    await lintNow();
    // The emoji is one code point but two UTF-16 units, so "teh" starts at 1 + 3.
    expect(underlines(view)).toEqual([[4, 7, "teh"]]);
  });

  it("restarts the debounce on every edit and lints once after the pause", async () => {
    const { view } = mount("<p>x</p>");
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 100);
      typeAt(view, view.state.doc.content.size - 1, i === 4 ? " teh" : "y");
    }
    await flush();
    expect(harper.lint).not.toHaveBeenCalled();

    await lintNow();
    expect(harper.lint).toHaveBeenCalledTimes(1);
    expect(harper.lint).toHaveBeenCalledWith("xyyyy teh");
    expect(underlines(view)).toEqual([[7, 10, "teh"]]);
  });

  it("carries underlines along with an edit until the next lint replaces them", async () => {
    const { view } = mount("<p>teh end</p>");
    await lintNow();
    expect(underlines(view)).toEqual([[1, 4, "teh"]]);

    typeAt(view, 1, "Oh ");
    // Before the debounce fires, the old underline has shifted with the text.
    expect(underlines(view)).toEqual([[4, 7, "teh"]]);

    await lintNow();
    expect(underlines(view)).toEqual([[4, 7, "teh"]]);
  });

  it("doesn't relint when a transaction leaves the document unchanged", async () => {
    const { view } = mount("<p>teh</p>");
    await lintNow();
    harper.lint.mockClear();

    view.dispatch(view.state.tr.setMeta("unrelated", true));
    await lintNow();
    expect(harper.lint).not.toHaveBeenCalled();
  });

  it("clears the underlines once the text is fixed", async () => {
    const { view } = mount("<p>teh</p>");
    await lintNow();
    view.dispatch(view.state.tr.insertText("the", 1, 4));
    await lintNow();
    expect(underlines(view)).toEqual([]);
  });

  it("maps an unknown Harper suggestion kind to a replacement", async () => {
    harper.suggestions = [{ text: "the", kind: 42 }];
    const { view } = mount("<p>teh</p>");
    await lintNow();
    const [deco] = grammarPlugin(view.state).getState(view.state)!.find();
    expect((deco.spec as { match: { suggestions: unknown[] } }).match.suggestions).toEqual([
      { text: "the", kind: "replace" },
    ]);
  });
});

describe("grammar plugin: stale results", () => {
  it("discards a lint that finishes after the document changed", async () => {
    let release: (value: unknown[]) => void = () => {};
    harper.lint.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { view } = mount("<p>teh one</p>");
    await lintNow();
    expect(harper.lint).toHaveBeenCalledTimes(1);

    // Edit while the first lint is still in flight, then let it land.
    typeAt(view, 1, "Now ");
    release(fakeLints("teh one", harper.suggestions));
    await flush();
    // The stale result would underline [1, 4) of the old text; it's discarded,
    // and the mapped (empty) set stays.
    expect(underlines(view)).toEqual([]);

    await lintNow();
    expect(underlines(view)).toEqual([[5, 8, "teh"]]);
  });

  it("discards a run whose document changed while Harper was still loading", async () => {
    let ready: () => void = () => {};
    harper.setup = () =>
      new Promise<void>((resolve) => {
        ready = resolve;
      });
    const { view } = mount("<p>teh</p>");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await flush();

    typeAt(view, 4, " teh");
    ready();
    await flush();
    expect(harper.lint).not.toHaveBeenCalled();

    await lintNow();
    // The load is shared: one worker, then one lint of the current text.
    expect(harper.constructed).toHaveLength(1);
    expect(harper.lint.mock.calls.map(([t]) => t)).toEqual(["teh teh"]);
    expect(underlines(view).map(([f, t]) => [f, t])).toEqual([
      [1, 4],
      [5, 8],
    ]);
  });
});

describe("grammar plugin: suggestion popover", () => {
  it("does nothing for a click away from an underline", async () => {
    const { view } = mount("<p>teh and more</p>");
    await lintNow();
    expect(clickAt(view, 10)).toBe(false);
    expect(popover()).toBeNull();
  });

  it("opens on a click inside an underline and replaces exactly the flagged range", async () => {
    harper.suggestions = [
      { text: "the", kind: 0 },
      { text: "tech", kind: 0 },
    ];
    const { view } = mount("<p>see teh cat</p><p>teh</p>");
    await lintNow();

    // A click still returns false, so the caret lands where the person clicked.
    expect(clickAt(view, 6)).toBe(false);
    const el = popover();
    expect(el).not.toBeNull();
    expect(el!.lang).toBe(CHROME_LANG);
    expect(el!.querySelector(".louise-grammar-popover-msg")?.textContent).toContain("teh");
    const buttons = [...el!.querySelectorAll<HTMLButtonElement>("button.louise-grammar-suggest")];
    expect(buttons.map((b) => b.textContent)).toEqual(["the", "tech"]);
    expect(buttons.every((b) => b.type === "button")).toBe(true);

    mousedown(buttons[1]);
    expect(view.state.doc.textContent).toBe("see tech cat" + "teh");
    expect(view.state.doc.child(0).textContent).toBe("see tech cat");
    expect(view.state.doc.child(1).textContent).toBe("teh");
    expect(popover()).toBeNull();
  });

  it("removes the flagged range for a remove suggestion", async () => {
    harper.suggestions = [{ text: "", kind: 1 }];
    const { view } = mount("<p>a teh b</p>");
    await lintNow();
    clickAt(view, 4);
    const [btn] = popover()!.querySelectorAll("button");
    expect(btn.textContent).toBe("Remove");
    mousedown(btn);
    expect(view.state.doc.textContent).toBe("a  b");
  });

  it("inserts after the flagged range for an insertAfter suggestion", async () => {
    harper.suggestions = [{ text: ",", kind: 2 }];
    const { view } = mount("<p>a teh b</p>");
    await lintNow();
    clickAt(view, 4);
    mousedown(popover()!.querySelector("button")!);
    expect(view.state.doc.textContent).toBe("a teh, b");
  });

  it("labels an empty replacement as blank, and lists at most five suggestions", async () => {
    harper.suggestions = [
      { text: "", kind: 0 },
      ...["a", "b", "c", "d", "e", "f"].map((text) => ({ text, kind: 0 })),
    ];
    const { view } = mount("<p>teh</p>");
    await lintNow();
    clickAt(view, 2);
    const labels = [...popover()!.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toEqual(["(blank)", "a", "b", "c", "d"]);
  });

  it("says there are no suggestions when Harper offers none", async () => {
    harper.suggestions = [];
    const { view } = mount("<p>teh</p>");
    await lintNow();
    clickAt(view, 2);
    expect(popover()!.querySelector(".louise-grammar-popover-none")?.textContent).toBe(
      "No suggestions",
    );
    expect(popover()!.querySelector("button")).toBeNull();
  });

  it("dismisses on Escape or an outside click, but not on other keys or an inside click", async () => {
    const { view } = mount("<p>teh</p>");
    await lintNow();

    clickAt(view, 2);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    mousedown(popover()!.querySelector(".louise-grammar-popover-msg")!);
    expect(popover()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(popover()).toBeNull();

    clickAt(view, 2);
    mousedown(document.body);
    expect(popover()).toBeNull();
    // The document itself is untouched by dismissing.
    expect(view.state.doc.textContent).toBe("teh");
  });

  it("keeps only one popover open at a time", async () => {
    const { view } = mount("<p>teh teh</p>");
    await lintNow();
    clickAt(view, 2);
    clickAt(view, 6);
    expect(document.querySelectorAll(".louise-grammar-popover")).toHaveLength(1);
  });
});

describe("grammar plugin: teardown", () => {
  it("cancels a pending lint and closes the popover when the editor unmounts", async () => {
    const { editor, view } = mount("<p>teh</p>");
    await lintNow();
    clickAt(view, 2);
    expect(popover()).not.toBeNull();

    harper.lint.mockClear();
    typeAt(view, 4, " teh");
    editor.unmount();
    expect(popover()).toBeNull();

    await lintNow();
    expect(harper.lint).not.toHaveBeenCalled();
  });

  it("drops a lint that resolves after the editor unmounted", async () => {
    let release: (value: unknown[]) => void = () => {};
    harper.lint.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { editor, view } = mount("<p>teh</p>");
    const dispatch = vi.spyOn(view, "dispatch");
    await lintNow();
    editor.unmount();
    release(fakeLints("teh", harper.suggestions));
    await flush();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

// Last on purpose: a failed load latches the checker off for the whole module.
describe("grammar plugin: Harper fails to load", () => {
  it("logs once, adds no underlines, and never retries", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let setups = 0;
    harper.setup = () => {
      setups++;
      return Promise.reject(new Error("no harper"));
    };
    const { editor, view } = mount("<p>teh</p>");
    await lintNow();

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("grammar checker unavailable");
    expect(underlines(view)).toEqual([]);

    // Edits in this editor, and a second editor, do no more lint work.
    typeAt(view, 4, " teh");
    const second = mount("<p>teh</p>");
    await lintNow();
    expect(setups).toBe(1);
    expect(harper.lint).not.toHaveBeenCalled();
    expect(underlines(second.view)).toEqual([]);

    // Tearing down after a rejected load doesn't surface an unhandled rejection.
    editor.unmount();
    await flush();
    error.mockRestore();
  });
});
