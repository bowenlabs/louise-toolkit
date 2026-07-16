// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The Harper linter wrapper for the grammar checker (#110). Harper is Automattic's
// Rust→WASM grammar checker; `harper.js`'s `WorkerLinter` runs the WASM inside a
// Web Worker, so linting never blocks the editor and — crucially — the text never
// leaves the browser (no server, better privacy than a self-hosted service).
//
// `harper.js` is an OPTIONAL peer, pulled in via dynamic `import()` only when a
// site enables grammar checking — so nothing (least of all a multi-MB WASM blob)
// ships to the client bundle otherwise. The `binaryInlined` build base64-inlines
// the WASM into the JS module, so there's no separate `.wasm` asset for a
// bundler to resolve. All `harper.js` types are contained here: the wrapper hands
// back our own plain {@link GrammarMatch} shape so nothing downstream touches WASM.

import type { Lint, Suggestion } from "harper.js";
import type { GrammarMatch, GrammarSuggestion, GrammarSuggestionKind } from "./offsets.js";

// Harper's SuggestionKind enum is `Replace | Remove | InsertAfter` (0, 1, 2).
const SUGGESTION_KINDS: readonly GrammarSuggestionKind[] = ["replace", "remove", "insertAfter"];

export interface GrammarLinter {
  /** Lint one block of text, returning normalized matches (code-point offsets). */
  lint(text: string): Promise<GrammarMatch[]>;
  /** Release the underlying worker/WASM. */
  destroy(): void;
}

function toSuggestion(suggestion: Suggestion): GrammarSuggestion {
  return {
    text: suggestion.get_replacement_text(),
    kind: SUGGESTION_KINDS[suggestion.kind()] ?? "replace",
  };
}

function toMatch(lint: Lint): GrammarMatch {
  const span = lint.span();
  return {
    start: span.start,
    end: span.end,
    message: lint.message(),
    kind: lint.lint_kind(),
    suggestions: lint.suggestions().map(toSuggestion),
  };
}

/**
 * Create a grammar linter backed by Harper's WASM in a Web Worker. Async because
 * it dynamically imports `harper.js` and compiles the WASM; call once per editor
 * and reuse. Returns our own {@link GrammarLinter} so the plugin never sees a
 * `harper.js` type.
 */
export async function createGrammarLinter(): Promise<GrammarLinter> {
  const [harper, inlined] = await Promise.all([
    import("harper.js"),
    import("harper.js/binaryInlined"),
  ]);
  const linter = new harper.WorkerLinter({ binary: inlined.binaryInlined });
  await linter.setup();
  return {
    async lint(text: string): Promise<GrammarMatch[]> {
      const lints = await linter.lint(text);
      return lints.map(toMatch);
    },
    destroy(): void {
      // wasm-bindgen registers finalizers, so the Lint/Suggestion objects free
      // themselves on GC; the worker is reclaimed when the linter is collected.
    },
  };
}
