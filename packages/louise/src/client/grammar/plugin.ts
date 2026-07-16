// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The ProseMirror plugin for the grammar checker (#110). It debounce-lints each
// textblock through Harper (client-side WASM — see `linter.ts`), underlines the
// issues with inline `Decoration`s, and on click shows a small popover to apply a
// suggestion via a transaction. Added to the editor only when a site opts in
// (see `louiseExtension`/`RichText`), so its `linter.ts` — and thus `harper.js` —
// loads lazily and never ships to the bundle otherwise.
//
// Correctness notes: the decoration set is mapped through every transaction so
// underlines track edits until the next lint replaces them; a per-edit generation
// counter discards a lint whose result arrives after the document has moved on.

import { definePlugin } from "prosekit/core";
import { Plugin, PluginKey } from "@prosekit/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@prosekit/pm/view";
import { createGrammarLinter, type GrammarLinter } from "./linter.js";
import {
  blockMatchesToDecorations,
  gatherTextBlocks,
  type GrammarDecoration,
  type GrammarMatch,
  type GrammarSuggestion,
} from "./offsets.js";

/** Debounce before (re)linting — never per keystroke; wait for a typing pause. */
const DEBOUNCE_MS = 600;

const grammarKey = new PluginKey<DecorationSet>("louiseGrammar");

// ── Suggestion popover ──────────────────────────────────────────────────────
// A single, lightweight DOM popover (not a Solid island — this is ProseMirror
// land). Kept module-scoped so only one is ever open.

let activePopover: HTMLElement | null = null;
let onOutside: ((e: Event) => void) | null = null;

function closePopover(): void {
  if (onOutside) {
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onOutside, true);
    onOutside = null;
  }
  activePopover?.remove();
  activePopover = null;
}

function applySuggestion(
  view: EditorView,
  from: number,
  to: number,
  suggestion: GrammarSuggestion,
): void {
  const tr = view.state.tr;
  if (suggestion.kind === "insertAfter") tr.insertText(suggestion.text, to, to);
  else if (suggestion.kind === "remove") tr.delete(from, to);
  else tr.insertText(suggestion.text, from, to); // replace
  view.dispatch(tr);
  view.focus();
}

function openPopover(view: EditorView, from: number, to: number, match: GrammarMatch): void {
  closePopover();
  const coords = view.coordsAtPos(from);
  const el = document.createElement("div");
  el.className = "louise-grammar-popover";
  el.style.left = `${coords.left + window.scrollX}px`;
  el.style.top = `${coords.bottom + window.scrollY + 4}px`;

  const msg = document.createElement("div");
  msg.className = "louise-grammar-popover-msg";
  msg.textContent = match.message;
  el.appendChild(msg);

  const suggestions = match.suggestions.slice(0, 5);
  for (const suggestion of suggestions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "louise-grammar-suggest";
    btn.textContent = suggestion.kind === "remove" ? "Remove" : suggestion.text || "(blank)";
    // mousedown (not click) so the editor selection isn't lost before we apply.
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      applySuggestion(view, from, to, suggestion);
      closePopover();
    });
    el.appendChild(btn);
  }
  if (suggestions.length === 0) {
    const none = document.createElement("div");
    none.className = "louise-grammar-popover-none";
    none.textContent = "No suggestions";
    el.appendChild(none);
  }

  document.body.appendChild(el);
  activePopover = el;

  // Dismiss on an outside click or Escape.
  onOutside = (e: Event) => {
    if (e instanceof KeyboardEvent && e.key !== "Escape") return;
    if (e instanceof MouseEvent && activePopover?.contains(e.target as Node)) return;
    closePopover();
  };
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onOutside, true);
}

// ── Plugin ──────────────────────────────────────────────────────────────────

function createGrammarPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: grammarKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        const fresh = tr.getMeta(grammarKey) as GrammarDecoration[] | undefined;
        if (fresh) {
          const decos = fresh.map((d) =>
            Decoration.inline(d.from, d.to, { class: "louise-grammar-issue" }, { match: d.match }),
          );
          return DecorationSet.create(tr.doc, decos);
        }
        // No new lint this transaction — carry underlines along with the edit.
        return old.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations(state) {
        return grammarKey.getState(state);
      },
      handleClick(view, pos) {
        const set = grammarKey.getState(view.state);
        const hit = set?.find(pos, pos) ?? [];
        const deco = hit[0];
        const match = deco && (deco.spec as { match?: GrammarMatch }).match;
        if (!deco || !match) return false;
        openPopover(view, deco.from, deco.to, match);
        return false; // let the click also place the caret
      },
    },
    view(view) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let generation = 0;
      let linterPromise: Promise<GrammarLinter> | null = null;
      let destroyed = false;

      const run = async (): Promise<void> => {
        timer = null;
        const gen = generation;
        let linter: GrammarLinter;
        try {
          linter = await (linterPromise ??= createGrammarLinter());
        } catch (err) {
          console.error("[louise] grammar checker failed to load", err);
          return;
        }
        if (destroyed || gen !== generation) return; // superseded by a newer edit
        const blocks = gatherTextBlocks(view.state.doc);
        const results = await Promise.all(
          blocks.map(async (block) => ({ block, matches: await linter.lint(block.text) })),
        );
        if (destroyed || gen !== generation) return; // doc moved on while linting
        view.dispatch(view.state.tr.setMeta(grammarKey, blockMatchesToDecorations(results)));
      };

      const schedule = (): void => {
        generation++; // invalidate any in-flight lint
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => void run(), DEBOUNCE_MS);
      };

      schedule(); // initial pass

      return {
        update(_view, prevState) {
          if (!prevState.doc.eq(view.state.doc)) schedule();
        },
        destroy() {
          destroyed = true;
          if (timer !== null) clearTimeout(timer);
          closePopover();
          void linterPromise?.then((linter) => linter.destroy());
        },
      };
    },
  });
}

/**
 * A ProseKit extension that adds the Harper-backed grammar checker to the editor.
 * Include it only when a site enables grammar checking — its presence is what
 * triggers the lazy `harper.js` load.
 */
export function defineGrammarExtension() {
  return definePlugin(createGrammarPlugin());
}
