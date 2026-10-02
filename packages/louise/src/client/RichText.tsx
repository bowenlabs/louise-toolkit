// Louise rich text—ProseKit-Solid everywhere (per LOUISE.md's stack row).
// One Solid component owns the editor; the vanilla inline surface reuses it
// through mountRichText (solid-js/web render), so inline fields and Settings
// forms share the exact same editor + ProseMirror JSON storage contract.

import { defineBasicExtension } from "prosekit/basic";
import {
  createEditor,
  defineDocChangeHandler,
  defineKeymap,
  defineNodeAttr,
  definePlugin,
  htmlFromNode,
  union,
  type Editor,
  type NodeJSON,
} from "prosekit/core";
import {
  DOMSerializer,
  Fragment,
  type Node as PMNode,
  type Schema,
  Slice,
} from "@prosekit/pm/model";
import { Plugin } from "@prosekit/pm/state";
import { defineBlockquote } from "prosekit/extensions/blockquote";
import { defineImageUploadHandler, uploadImage } from "prosekit/extensions/image";
import { defineLink } from "prosekit/extensions/link";
import { defineTextColor } from "prosekit/extensions/text-color";
import {
  defineSolidNodeView,
  ProseKit,
  type SolidNodeViewProps,
  useEditor,
  useEditorDerivedValue,
} from "prosekit/solid";
import { BlockInserter, BlockInserterButton, defineBlocksExtension } from "./blocks.jsx";
import { defineGrammarExtension } from "./grammar/plugin.js";
import {
  BlockHandleDraggable,
  BlockHandlePositioner,
  BlockHandleRoot,
} from "prosekit/solid/block-handle";
import { ResizableHandle, ResizableRoot } from "prosekit/solid/resizable";
import {
  InlinePopoverPopup,
  InlinePopoverPositioner,
  InlinePopoverRoot,
} from "prosekit/solid/inline-popover";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { CHROME_LANG, wirePopoverDismiss, wireToolbarRoving } from "./a11y.js";
import { render } from "solid-js/web";
import { Icon, type IconName } from "./icons.jsx";
import type { RichTextColor, RichTextTypography } from "../core/content/sections.js";
import { defineLanguageMark, defineTypography, LANGUAGE_TAG } from "./typography.js";
import { thumb } from "./thumb.js";

/**
 * Uploads a dropped/pasted/picked image to R2 through the same
 * /api/louise/media endpoint the Settings panels use (web/ scope), returning the
 * public URL. Shared by the paste/drop handler and the toolbar image button.
 */
async function r2ImageUploader({ file }: { file: File }): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("scope", "web");
  const res = await fetch("/api/louise/media", { method: "POST", body: fd });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return data.url;
}

/**
 * The text colours the format bubble offers when a field names none (#182
 * Phase 5, #605). Each is a **daisyUI theme token**, not a fixed hex—the mark
 * stores `color: var(--color-<token>)`, so it resolves to the SITE's own theme
 * colour at render and a re-theme flows through with no content rewrite. The
 * swatch preview uses the same `var()`, so it shows the site's actual colour in
 * the editor. Brand roles only: text in a state colour (info, success, warning,
 * error) reads as a message, and a theme can change what those look like.
 */
const DEFAULT_TEXT_COLORS: readonly RichTextColor[] = [
  { label: "Primary", token: "primary" },
  { label: "Secondary", token: "secondary" },
  { label: "Accent", token: "accent" },
  { label: "Neutral", token: "neutral" },
];

/** A token that fits `var(--color-<token>)`, the only shape the sanitizer keeps. */
const COLOR_TOKEN = /^[a-z][a-z0-9-]*$/;

/**
 * AI rewrite modes offered by the toolbar sparkle menu (#75/#166). The `mode`
 * values match the server's `/api/louise/ai/rewrite` enum (core/ai `RewriteMode`);
 * kept as a small local list so the browser bundle doesn't pull in the `core/ai`
 * barrel (which re-exports the embeddings helpers).
 */
const REWRITE_ACTIONS = [
  { mode: "tighten", label: "Tighten" },
  { mode: "rephrase", label: "Rephrase" },
  { mode: "simplify", label: "Simplify" },
  { mode: "fix", label: "Fix grammar" },
] as const;

/** Shown in the sparkle menu when a rewrite fails for any reason other than
 *  length. The selection is never touched on failure, so it says so. */
const REWRITE_FAILED = "Couldn’t rewrite this right now. Your text hasn’t changed.";

/** Shown when AI is out of capacity for now, so trying again later can work. */
const REWRITE_BUSY = "AI is busy right now. Try again in a minute. Your text hasn’t changed.";

/** Shown when the rewrite came back cut off, so a shorter selection can work. */
const REWRITE_TOO_MUCH = "That’s too much to rewrite at once. Select less, and try again.";

/** Shown once when the site has no AI binding, before the control retires. */
const REWRITE_UNAVAILABLE = "AI rewrite isn’t set up for this site.";

/** Why rewrite is off for a selection holding a link: the model could change
 *  where the link goes, and a plain-text answer would drop it (#551). */
const REWRITE_NO_LINKS = "Rewrite can’t keep links yet. Select text without a link.";

/** Why Replace is off when the answer's paragraphs don't line up with the
 *  selection's blocks, so they can't go back into the same headings and items. */
const REWRITE_LOST_PARAGRAPHS =
  "The rewrite didn’t keep your paragraphs. Try again, or select one paragraph.";

/** The text blocks a selection covers, as the ranges inside each that it
 *  selects, in document order. Empty ranges are left out. */
function selectedBlocks(
  doc: PMNode,
  from: number,
  to: number,
): Array<{ from: number; to: number; text: string }> {
  const blocks: Array<{ from: number; to: number; text: string }> = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    const start = Math.max(from, pos + 1);
    const end = Math.min(to, pos + 1 + node.content.size);
    const text = end > start ? doc.textBetween(start, end, " ").trim() : "";
    if (text) blocks.push({ from: start, to: end, text });
    return false;
  });
  return blocks;
}

/** A rewrite waiting for the owner's Replace or Discard (#544). */
interface RewritePreview {
  original: string;
  result: string;
  /** The ranges each answer paragraph replaces, one per selected block. */
  blocks: Array<{ from: number; to: number }>;
  parts: string[];
  /** The doc the rewrite was asked about; Replace refuses a changed one. */
  doc: PMNode;
  /** The selection held bold, italics, or other marks, which won't carry over. */
  lostFormatting: boolean;
}

/**
 * The message for a failed rewrite. A `413` means the selection is past the
 * server's cap, and its `error` says what to do about it, so it's shown as is.
 * Anything else gets {@link REWRITE_FAILED}: a `400` or `502` body is written for
 * logs, not for the person editing.
 */
async function rewriteFailure(res: Response): Promise<string> {
  if (res.status !== 413 && res.status !== 502) return REWRITE_FAILED;
  const data = (await res.json().catch(() => null)) as { error?: unknown; reason?: unknown } | null;
  if (res.status === 502) {
    // The server's `error` is log-facing; its `reason` says what an editor can do.
    if (data?.reason === "rate-limited") return REWRITE_BUSY;
    if (data?.reason === "truncated") return REWRITE_TOO_MUCH;
    return REWRITE_FAILED;
  }
  return typeof data?.error === "string" && data.error ? data.error : REWRITE_FAILED;
}

/**
 * Resizable image node view: wraps the image node's DOM in ProseKit's
 * resizable custom element so editors can drag the corner to set explicit
 * width/height. The dimensions persist onto the node's attrs, which serialize
 * to `<img width height>`—exactly what the site renders via set:html.
 */
function ResizableImage(props: SolidNodeViewProps) {
  const attrs = () =>
    props.node.attrs as {
      src?: string | null;
      alt?: string | null;
      width?: number | null;
      height?: number | null;
    };
  const [editingAlt, setEditingAlt] = createSignal(false);
  const alt = () => attrs().alt ?? "";
  // An empty string, as opposed to null, marks the image decorative (#599).
  const decorative = () => attrs().alt === "";
  const altLabel = () => (decorative() ? "Decorative" : alt() ? "Alt" : "Alt?");
  return (
    <ResizableRoot
      class="louise-rt-image"
      width={attrs().width ?? undefined}
      height={attrs().height ?? undefined}
      onResizeEnd={(e) => props.setAttrs({ width: e.detail.width, height: e.detail.height })}
    >
      {/* Transformed for DISPLAY only. `attrs().src` is what serializes into the
          stored markup and what the site renders via set:html—rewriting it
          would persist a CDN URL into content and defeat re-cropping later. The
          resizable node knows its own width, so ask for that; an unresized image
          falls back to a typical editor column. */}
      <img
        src={thumb(attrs().src ?? "", attrs().width ?? 640)}
        alt={alt()}
        loading="lazy"
        decoding="async"
      />
      <ResizableHandle class="louise-rt-resize" position="bottom-right" />
      {/* Alt-text authoring (WCAG 1.1.1): without this an inline image ships to
          the published page with no description. `contentEditable={false}` keeps
          ProseMirror from treating the control as document content. */}
      <div class="louise-rt-alt" contentEditable={false} lang={CHROME_LANG}>
        <Show
          when={editingAlt()}
          fallback={
            <button
              type="button"
              class="louise-rt-alt-btn"
              classList={{ "is-unset": !alt() && !decorative() }}
              title={
                decorative()
                  ? "Marked decorative: screen readers skip it"
                  : alt()
                    ? `Alt text: ${alt()}`
                    : "Add alt text to describe this image"
              }
              aria-label={
                decorative()
                  ? "Edit alt text: marked decorative"
                  : alt()
                    ? `Edit alt text: ${alt()}`
                    : "Add alt text for this image"
              }
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setEditingAlt(true)}
            >
              {altLabel()}
            </button>
          }
        >
          {/* Closes when focus leaves the whole editor, not the text field, so
              the decorative checkbox beside it can take focus. The handlers are
              delegated: they hear focus and keys from the two controls inside. */}
          {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */}
          <div
            class="louise-rt-alt-edit"
            onFocusOut={(e) => {
              const next = e.relatedTarget as Node | null;
              if (!next || !e.currentTarget.contains(next)) setEditingAlt(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setEditingAlt(false);
              }
            }}
          >
            <input
              class="louise-rt-alt-input"
              aria-label="Image alt text"
              placeholder="Describe this image…"
              value={alt()}
              disabled={decorative()}
              ref={(el) => queueMicrotask(() => el.focus())}
              onMouseDown={(e) => e.stopPropagation()}
              // Clearing the text means "not written yet", not decorative.
              onInput={(e) => props.setAttrs({ alt: e.currentTarget.value || null })}
            />
            {/* Stops the editor taking the selection; the checkbox inside is the control. */}
            {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
            <label class="louise-rt-alt-decorative" onMouseDown={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={decorative()}
                onChange={(e) => props.setAttrs({ alt: e.currentTarget.checked ? "" : null })}
              />
              Decorative image
            </label>
          </div>
        </Show>
      </div>
    </ResizableRoot>
  );
}

/** Serialize a doc as **inline** HTML—the inline content of its block(s), with
 *  no block wrapper. `inline` rich-text fields (a heading, a tagline) store inline
 *  HTML that the site drops into its own element via `set:html`
 *  (`<h1 set:html={value}>`); serializing the whole doc would emit a `<p>`/`<h2>`
 *  wrapper that then nests inside that element and loses its style.
 *
 *  Blocks are joined with one space (#449). The inline paste rule keeps the doc
 *  to one block, but a doc seeded with several can still reach this point, and
 *  joining them with nothing runs the last word of one into the first word of
 *  the next. No space is added where a block already ends or starts with
 *  whitespace, and empty blocks contribute nothing. */
function inlineHTMLFromDoc(editor: Editor): string {
  const { doc } = editor.view.state;
  const serializer = DOMSerializer.fromSchema(doc.type.schema);
  const host = document.createElement("div");
  let previous: string | null = null;
  doc.forEach((block) => {
    if (block.content.size === 0) return;
    const text = block.textContent;
    if (previous !== null && !/\s$/.test(previous) && !/^\s/.test(text)) host.append(" ");
    host.appendChild(serializer.serializeFragment(block.content));
    previous = text;
  });
  return host.innerHTML;
}

/** A line break inside pasted text, with any whitespace around it. */
const LINE_BREAK = /\s*(?:\r\n?|\n)\s*/g;

/** Flatten pasted content into one run of inline content (#449), for `inline`
 *  mode. The Enter keys are already suppressed there, but a paste of several
 *  lines or blocks would still split the field into paragraphs. This keeps the
 *  inline content of every textblock, joins the textblocks with one space
 *  (skipped where one side already has whitespace), and turns each line
 *  break—a newline in text or a hard break—into a space. Block leaves, such as an
 *  image, are dropped: an inline field never stores them anyway. */
function flattenToInline(slice: Slice, schema: Schema): Slice {
  const runs: PMNode[][] = [];
  let run: PMNode[] = [];
  const endRun = () => {
    if (run.length > 0) runs.push(run);
    run = [];
  };
  const inline = (node: PMNode): PMNode => {
    if (node.isText) return schema.text((node.text ?? "").replace(LINE_BREAK, " "), node.marks);
    if (node.type.name === "hardBreak") return schema.text(" ", node.marks);
    return node;
  };
  const visit = (node: PMNode) => {
    if (node.isInline) {
      run.push(inline(node));
    } else if (node.isTextblock) {
      endRun();
      node.forEach((child) => run.push(inline(child)));
      endRun();
    } else {
      node.forEach(visit);
    }
  };
  slice.content.forEach(visit);
  endRun();

  const nodes: PMNode[] = [];
  for (const next of runs) {
    const last = nodes.at(-1);
    const first = next[0];
    const lastText = last?.isText ? (last.text ?? "") : "";
    const firstText = first?.isText ? (first.text ?? "") : "";
    if (last && !/\s$/.test(lastText) && !/^\s/.test(firstText)) nodes.push(schema.text(" "));
    nodes.push(...next);
  }
  if (nodes.length === 0) return Slice.empty;
  // An open paragraph: its inline content merges into whatever block the
  // selection is in, so the paste never adds a block.
  const paragraph = schema.nodes.paragraph.create(null, Fragment.fromArray(nodes));
  return new Slice(Fragment.from(paragraph), 1, 1);
}

function louiseExtension(
  builder = false,
  grammar = false,
  inline = false,
  typography?: RichTextTypography,
) {
  return union(
    defineBasicExtension(),
    defineLanguageMark(),
    ...(typography ? [defineTypography(typography)] : []),
    // Inline mode (#182): a single-line rich-text field (heading/tagline). Suppress
    // the block-splitting keys so the value stays one inline run—paired with
    // inlineHTMLFromDoc, the field never gains a block wrapper. A paste or a drop
    // goes through `transformPasted`, which flattens it to one run too (#449).
    ...(inline
      ? [
          defineKeymap({ Enter: () => true, "Shift-Enter": () => true, "Mod-Enter": () => true }),
          definePlugin(
            new Plugin({
              props: {
                transformPasted: (slice, view) => flattenToInline(slice, view.state.schema),
              },
            }),
          ),
        ]
      : []),
    defineBlockquote(),
    defineTextColor(),
    // Inline link mark (#182 Phase 5)—surfaced in the format bubble; renders to
    // `<a href>`, which the sanitizer already allows.
    defineLink(),
    // Paste/drop an image → upload to R2 and insert (temp URL swapped for the
    // final one when the upload resolves).
    defineImageUploadHandler({ uploader: r2ImageUploader }),
    // ProseKit's image node ships only src/width/height, and its toDOM emits
    // exactly the node's attrs—so without this an inline image can carry no
    // description (WCAG 1.1.1) AND an authored `alt=` is silently dropped the
    // first time the field round-trips through the editor. Adding the attr makes
    // it both serialize to `<img alt>` and parse back in; the sanitizer already
    // allows `alt` on `img`.
    defineNodeAttr<"image", "alt", string | null>({
      type: "image",
      attr: "alt",
      default: null,
      // Three states (#599): null is "not written" and serializes no alt; ""
      // is decorative and serializes `alt=""`, which tells a screen reader to
      // skip the image; anything else is the description. Parsing keeps `""`,
      // so a decorative image survives a round trip.
      toDOM: (value) => (value === null || value === undefined ? null : ["alt", value]),
      parseDOM: (element) => (element.hasAttribute("alt") ? element.getAttribute("alt") : null),
    }),
    // Replace the default image rendering with the resizable node view.
    defineSolidNodeView({ name: "image", component: ResizableImage }),
    // Builder blocks (#16)—opt-in: the Settings Pages panel composes
    // whole pages, while inline prose fields stay builder-free.
    ...(builder ? [defineBlocksExtension()] : []),
    // Grammar/spelling check (#110)—opt-in: adding the extension lazy-loads
    // Harper's WASM checker; off by default so nothing extra ships otherwise.
    ...(grammar ? [defineGrammarExtension()] : []),
  );
}

/** The editor's extension type—threaded to `useEditor`/derived values so the
 * toolbar's mark/node/command access is typed rather than collapsing to `never`. */
type LouiseEditorExtension = ReturnType<typeof louiseExtension>;

export interface RichTextProps {
  /** Starting document—ProseMirror JSON, or an HTML string to parse. */
  initialDoc?: NodeJSON | string;
  /** Fires on every document edit. */
  onDocChange?: (getJSON: () => NodeJSON) => void;
  /** Receives the field handle once the editor is live. */
  ref?: (field: RichTextField) => void;
  /** Show the formatting toolbar (default true). */
  toolbar?: boolean;
  /** Enable the page builder (#16): its builder blocks (hero, columns,
   *  gallery …), the slash menu, and the "+ Block" button. For a full page body. */
  builder?: boolean;
  /** @deprecated Renamed {@link RichTextProps.builder} (#537); a section's
   *  `blocks` are a different thing. Still read when `builder` is unset. */
  blocks?: boolean;
  /** Enable the Harper grammar/spelling checker (#110). Off by default; when on,
   *  the WASM checker is lazy-loaded and issues are underlined with suggestions. */
  grammar?: boolean;
  /** Light-inline mode (#182): the format bubble shows only inline formatting
   *  (bold/italic/underline/strike/link/colour) and the block drag-handle is
   *  omitted—for section rich-text fields (a tagline, a body line), not a full
   *  page body. The schema is unchanged; only the chrome is trimmed. */
  minimal?: boolean;
  /** Inline mode (#182): a single-line rich-text field—a heading or tagline the
   *  site renders inside its own element (`<h1 set:html={value}>`). Like `minimal`
   *  for chrome (inline formatting only), but ALSO constrains the value to inline
   *  HTML: block-splitting keys are suppressed, a multi-line paste is flattened
   *  to one line with a space where each line break was, and the value
   *  serializes with no block wrapper, so editing a heading can't turn it into a `<p>`/`<h2>` that
   *  nests in the element and loses its brand style. The level stays whatever the
   *  site's element is—the editor never changes it. */
  inline?: boolean;
  /** Show the "Insert image" button in the block-controls group (default true).
   *  Only relevant in non-`minimal` mode, where the block controls render. Pass
   *  `false` to drop it—for example, a section heading field where an inline image
   *  makes no sense but the other block buttons (heading/list/quote) do. */
  image?: boolean;
  /** The text colors to offer, as theme tokens (#605). Default: primary,
   *  secondary, accent, and neutral. An empty list hides the color button. */
  colors?: readonly RichTextColor[];
  /** Typographic input rules (#606): dashes, an ellipsis, and, with `quotes`,
   *  curly quotes. Off when absent. */
  typography?: RichTextTypography;
  /** Show the Language button, which marks a phrase with `<span lang>` (#606). */
  language?: boolean;
  /** Where the editor sits (#761). `panel` (the default) is a field in the
   *  drawer or a form: the surface gets the panel's padding, minimum height,
   *  and type size. `canvas` is a field edited in place on the live page,
   *  inside the site's own element: the surface inherits that element's font,
   *  color, and spacing, so a heading still looks like the heading while it's
   *  edited. `mountRichText` defaults to `canvas`. */
  surface?: "panel" | "canvas";
  /** A class for the editing surface, in place of the one `surface` picks. */
  class?: string;
}

export interface RichTextField {
  /** Current document as ProseMirror JSON. */
  getJSON: () => NodeJSON;
  /** Current document serialized to HTML—what the site stores + renders. */
  getHTML: () => string;
  /** Tear the editor down and stop listening. */
  destroy: () => void;
}

/**
 * Selection-based floating formatting toolbar (#15). Uses ProseKit's
 * InlinePopover, which opens over the current selection, so inline editing on
 * the live page stays clean until the editor actually selects text. Reads
 * active mark/node state reactively and runs editor commands.
 */
function Toolbar(props: {
  minimal?: boolean;
  image?: boolean;
  colors?: readonly RichTextColor[];
  language?: boolean;
}) {
  const colors = () =>
    (props.colors ?? DEFAULT_TEXT_COLORS).filter((c) => COLOR_TOKEN.test(c.token));
  const editor = useEditor<LouiseEditorExtension>();
  const active = useEditorDerivedValue((e: Editor<LouiseEditorExtension>) => ({
    bold: e.marks.bold.isActive(),
    italic: e.marks.italic.isActive(),
    underline: e.marks.underline.isActive(),
    strike: e.marks.strike.isActive(),
    link: e.marks.link.isActive(),
    language: e.marks.lang.isActive(),
    h2: e.nodes.heading.isActive({ level: 2 }),
    h3: e.nodes.heading.isActive({ level: 3 }),
    bullet: e.nodes.list.isActive({ kind: "bullet" }),
    ordered: e.nodes.list.isActive({ kind: "ordered" }),
    quote: e.nodes.blockquote.isActive(),
    // `e.view` throws before mount (assertView); `e.mounted` never does, so gate
    // the selection read. Drives the AI-rewrite button's enabled state.
    hasSelection: e.mounted && !e.view.state.selection.empty,
    // A selection holding a link can't be rewritten (#551).
    selectionHasLink:
      e.mounted &&
      !e.view.state.selection.empty &&
      e.view.state.doc.rangeHasMark(
        e.view.state.selection.from,
        e.view.state.selection.to,
        e.view.state.schema.marks.link!,
      ),
  }));

  // Swatch popover visibility is click-toggled state, not CSS :hover. The old
  // hover disclosure had a 4px gap between the palette button and the swatches;
  // crossing it dropped :hover and hid the popover before a swatch could be
  // clicked—which is why text color never applied (#14).
  const [colorOpen, setColorOpen] = createSignal(false);
  // Popover triggers: excluded from their panel's outside-press check, and
  // refocused when Escape dismisses the panel.
  let colorTrigger: HTMLButtonElement | undefined;
  let aiTrigger: HTMLButtonElement | undefined;

  // AI rewrite (#75/#166): opt-in, degrade-gracefully. The sparkle menu POSTs the
  // selected text to /api/louise/ai/rewrite and swaps in the result. `aiAvailable`
  // starts true and flips off on the first 503 (the AI binding isn't provisioned),
  // retiring the control for the session. Any other failure leaves the original
  // text untouched and keeps the menu open with a message (`aiError`), so a
  // too-long selection (413) says what to do instead of silently doing nothing.
  const [aiOpen, setAiOpen] = createSignal(false);
  const [aiBusy, setAiBusy] = createSignal(false);
  const [aiAvailable, setAiAvailable] = createSignal(true);
  const [aiError, setAiError] = createSignal<string | null>(null);
  const [aiPreview, setAiPreview] = createSignal<RewritePreview | null>(null);
  // A 503 retires the control, but only once the owner has read why.
  const [retiring, setRetiring] = createSignal(false);
  const closeAi = () => {
    setAiOpen(false);
    setAiError(null);
    setAiPreview(null);
    if (retiring()) setAiAvailable(false);
  };

  // Ask for a rewrite and show it under the original; nothing changes until
  // Replace (#544). Each selected block is its own paragraph, with a blank line
  // between, so the answer goes back into the same headings and list items
  // (#551). A selection holding a link isn't sent at all.
  const runRewrite = async (mode: string) => {
    const view = editor().view;
    const { from, to, empty } = view.state.selection;
    if (empty) return;
    const { doc, schema } = view.state;
    if (doc.rangeHasMark(from, to, schema.marks.link!)) {
      setAiError(REWRITE_NO_LINKS);
      return;
    }
    const blocks = selectedBlocks(doc, from, to);
    if (blocks.length === 0) return;
    const original = blocks.map((b) => b.text).join("\n\n");
    const lostFormatting = Object.values(schema.marks).some(
      (mark) => mark !== schema.marks.link && doc.rangeHasMark(from, to, mark),
    );
    setAiError(null);
    setAiPreview(null);
    setAiBusy(true);
    let failure: string | null = null;
    try {
      const res = await fetch("/api/louise/ai/rewrite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: original, mode }),
      });
      // 503 → the AI binding is absent: say so, then retire the control when
      // the menu closes. Anything else not OK → keep the original and say why.
      if (res.status === 503) {
        failure = REWRITE_UNAVAILABLE;
        setRetiring(true);
        return;
      }
      if (!res.ok) {
        failure = await rewriteFailure(res);
        return;
      }
      const data = (await res.json().catch(() => null)) as { text?: string } | null;
      const result = data?.text?.trim();
      if (!result) {
        failure = REWRITE_FAILED;
        return;
      }
      const parts = result
        .split(/\n\s*\n/)
        .map((p) => p.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      setAiPreview({
        original,
        result: parts.join("\n\n"),
        blocks: blocks.map(({ from: f, to: t }) => ({ from: f, to: t })),
        parts,
        doc,
        lostFormatting,
      });
    } catch {
      // Network error → keep the original text.
      failure = REWRITE_FAILED;
    } finally {
      setAiBusy(false);
      if (failure) setAiError(failure);
    }
  };

  /** Whether the answer's paragraphs line up with the selected blocks. */
  const previewFits = (p: RewritePreview) => p.parts.length === p.blocks.length;

  // Replace each selected block's text with its answer paragraph, last first so
  // earlier positions stay valid. Refuses if the text changed while the owner
  // read the preview, since the captured positions no longer point at it.
  const replaceWithRewrite = () => {
    const p = aiPreview();
    if (!p || !previewFits(p)) return;
    const { state } = editor().view;
    if (state.doc !== p.doc) {
      setAiPreview(null);
      setAiError("Your text changed while the rewrite ran. Select it and try again.");
      return;
    }
    let tr = state.tr;
    for (let i = p.blocks.length - 1; i >= 0; i--) {
      tr = tr.insertText(p.parts[i]!, p.blocks[i]!.from, p.blocks[i]!.to);
    }
    editor().view.dispatch(tr);
    closeAi();
  };

  // oxlint-disable-next-line no-unassigned-vars -- assigned by Solid's `ref` binding below
  let imageInput!: HTMLInputElement;
  const pickImage = () => imageInput.click();
  const onImagePicked = (e: Event & { currentTarget: HTMLInputElement }) => {
    const file = e.currentTarget.files?.[0];
    if (file) editor().exec(uploadImage({ uploader: r2ImageUploader, file }));
    e.currentTarget.value = "";
  };

  const applyColor = (token: string) => {
    editor().commands.addTextColor({ color: `var(--color-${token})` });
    setColorOpen(false);
  };

  // Link (#182 Phase 5): toggle off if the selection is already linked, else
  // prompt for a URL. `prompt` keeps the editor's selection intact, so the mark
  // lands on the right range without a focus dance in the bubble.
  const editLink = () => {
    if (active().link) {
      editor().commands.removeLink();
      return;
    }
    const existing = editor()
      .view.state.selection.$from.marks()
      .find((m) => m.type.name === "link");
    const href = window.prompt("Link URL", (existing?.attrs.href as string) ?? "https://");
    if (href === null) return;
    const trimmed = href.trim();
    if (trimmed) editor().commands.addLink({ href: trimmed });
    else editor().commands.removeLink();
  };

  // Mark the selection as another language (#606). An empty answer removes the
  // mark; a tag that isn't BCP 47-shaped is refused rather than stored, since
  // the sanitizer would drop it on save anyway.
  const editLanguage = () => {
    const view = editor().view;
    const { from, to, empty } = view.state.selection;
    const type = view.state.schema.marks.lang;
    if (empty || !type) return;
    const existing = view.state.selection.$from.marks().find((m) => m.type === type);
    const answer = window.prompt(
      "Language of the selected text, as a tag such as fr or pt-BR. Leave it empty to remove it.",
      (existing?.attrs.lang as string | undefined) ?? "",
    );
    if (answer === null) return;
    const tag = answer.trim();
    if (tag && !LANGUAGE_TAG.test(tag)) {
      window.alert(`"${tag}" isn't a language tag. Use one like fr, de, or pt-BR.`);
      return;
    }
    let tr = view.state.tr.removeMark(from, to, type);
    if (tag) tr = tr.addMark(from, to, type.create({ lang: tag }));
    view.dispatch(tr);
    view.focus();
  };

  const Btn = (p: { icon: IconName; on?: boolean; title: string; run: () => void }) => (
    <button
      type="button"
      class="louise-tb-btn"
      classList={{ "is-active": !!p.on }}
      title={p.title}
      aria-label={p.title}
      aria-pressed={!!p.on}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => p.run()}
    >
      <Icon name={p.icon} />
    </button>
  );

  // Rendered by RichText inside a focus-shown dock (not a selection popover), so
  // the formatting menu is available while typing, not only when text is
  // highlighted. Buttons use onMouseDown-preventDefault so clicking one doesn't
  // blur the editor (which would hide the dock).
  return (
    <div
      class="louise-toolbar"
      role="toolbar"
      aria-label="Formatting"
      ref={(el) => onCleanup(wireToolbarRoving(el))}
    >
      <Btn icon="bold" title="Bold" on={active().bold} run={() => editor().commands.toggleBold()} />
      <Btn
        icon="italic"
        title="Italic"
        on={active().italic}
        run={() => editor().commands.toggleItalic()}
      />
      <Btn
        icon="underline"
        title="Underline"
        on={active().underline}
        run={() => editor().commands.toggleUnderline()}
      />
      <Btn
        icon="strike"
        title="Strikethrough"
        on={active().strike}
        run={() => editor().commands.toggleStrike()}
      />
      <Btn
        icon="link"
        title={active().link ? "Remove link" : "Add link"}
        on={active().link}
        run={editLink}
      />
      <Show when={props.language}>
        <Btn icon="translate" title="Language" on={active().language} run={editLanguage} />
      </Show>
      {/* Block-level controls (headings, lists, quote, image)—hidden in the
          `minimal` (light-inline) mode used by section rich-text fields, which
          get inline formatting only. */}
      <Show when={!props.minimal}>
        <span class="louise-tb-sep" />
        <Btn
          icon="heading"
          title="Heading"
          on={active().h2}
          run={() => editor().commands.toggleHeading({ level: 2 })}
        />
        <Btn
          icon="paragraph"
          title="Subheading"
          on={active().h3}
          run={() => editor().commands.toggleHeading({ level: 3 })}
        />
        <Btn
          icon="listBullets"
          title="Bullet list"
          on={active().bullet}
          run={() => editor().commands.toggleList({ kind: "bullet" })}
        />
        <Btn
          icon="listNumbers"
          title="Numbered list"
          on={active().ordered}
          run={() => editor().commands.toggleList({ kind: "ordered" })}
        />
        <Btn
          icon="quote"
          title="Quote"
          on={active().quote}
          run={() => editor().commands.toggleBlockquote()}
        />
        <Show when={props.image !== false}>
          <span class="louise-tb-sep" />
          <Btn icon="image" title="Insert image" run={pickImage} />
          <input
            ref={imageInput}
            type="file"
            accept="image/*"
            class="louise-hidden-file"
            aria-hidden="true"
            tabindex={-1}
            onChange={onImagePicked}
          />
        </Show>
      </Show>
      <Show when={colors().length > 0}>
        <span class="louise-tb-sep" />
        <div class="louise-tb-color">
          <button
            ref={(el) => {
              colorTrigger = el;
            }}
            type="button"
            class="louise-tb-btn"
            classList={{ "is-active": colorOpen() }}
            title="Text color"
            aria-label="Text color"
            aria-haspopup="true"
            aria-expanded={colorOpen()}
            aria-controls="louise-tb-swatches"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setColorOpen((v) => !v)}
          >
            <Icon name="palette" />
          </button>
          <Show when={colorOpen()}>
            <div
              id="louise-tb-swatches"
              class="louise-tb-swatches"
              role="group"
              aria-label="Text color"
              ref={(el) =>
                onCleanup(
                  wirePopoverDismiss(el, {
                    onClose: () => setColorOpen(false),
                    trigger: colorTrigger,
                  }),
                )
              }
            >
              <For each={colors()}>
                {(c) => (
                  <button
                    type="button"
                    class="louise-swatch"
                    title={c.label}
                    aria-label={`Text color ${c.label}`}
                    style={{ background: `var(--color-${c.token})` }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyColor(c.token)}
                  />
                )}
              </For>
              <button
                type="button"
                class="louise-swatch louise-swatch-clear"
                title="Default color"
                aria-label="Clear text color"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  editor().commands.removeTextColor();
                  setColorOpen(false);
                }}
              >
                <Icon name="x" />
              </button>
            </div>
          </Show>
        </div>
      </Show>
      {/* AI rewrite (#75/#166). Hidden once we learn the AI binding is absent
          (first 503). Enabled only over a real selection—there's nothing to
          rewrite at a bare caret. Anchored to the right so the menu stays
          on-screen at the toolbar's trailing edge. */}
      <Show when={aiAvailable() && !props.minimal}>
        <span class="louise-tb-sep" />
        <div class="louise-tb-ai">
          <button
            ref={(el) => {
              aiTrigger = el;
            }}
            type="button"
            class="louise-tb-btn"
            classList={{ "is-active": aiOpen() }}
            title="Rewrite with AI"
            aria-label="Rewrite with AI"
            aria-haspopup="true"
            aria-expanded={aiOpen()}
            aria-controls="louise-tb-ai-menu"
            disabled={!active().hasSelection || aiBusy()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (aiOpen() ? closeAi() : setAiOpen(true))}
          >
            <Icon name="sparkle" />
          </button>
          <Show when={aiOpen()}>
            {/* A labelled button group, not role="menu"—plain buttons in the tab
                order; "menu" would promise arrow-key roving we don't implement. */}
            <div
              id="louise-tb-ai-menu"
              class="louise-tb-ai-menu"
              role="group"
              aria-label="Rewrite with AI"
              ref={(el) =>
                onCleanup(wirePopoverDismiss(el, { onClose: closeAi, trigger: aiTrigger }))
              }
            >
              {/* The menu's messages, in the page while it's open so a change is
                  announced: an error, or why rewrite is off for this selection. */}
              <p class="louise-tb-ai-error" role="alert">
                {aiError() ?? (active().selectionHasLink ? REWRITE_NO_LINKS : "")}
              </p>
              <Show when={!aiBusy()} fallback={<span class="louise-tb-ai-busy">Rewriting…</span>}>
                <Show
                  when={aiPreview()}
                  fallback={
                    <For each={REWRITE_ACTIONS}>
                      {(a) => (
                        <button
                          type="button"
                          class="louise-tb-ai-item"
                          disabled={active().selectionHasLink || retiring()}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => runRewrite(a.mode)}
                        >
                          {a.label}
                        </button>
                      )}
                    </For>
                  }
                >
                  {(p) => (
                    <div class="louise-tb-ai-preview" role="status">
                      <p class="louise-tb-ai-label">Original</p>
                      <p class="louise-tb-ai-text is-original">{p().original}</p>
                      <p class="louise-tb-ai-label">Rewrite</p>
                      <p class="louise-tb-ai-text">{p().result}</p>
                      <Show when={p().lostFormatting}>
                        <p class="louise-tb-ai-note">
                          Bold, italics, and other formatting in the selection won’t carry over.
                        </p>
                      </Show>
                      <Show when={!previewFits(p())}>
                        <p class="louise-tb-ai-note">{REWRITE_LOST_PARAGRAPHS}</p>
                      </Show>
                      <div class="louise-tb-ai-actions">
                        <button
                          type="button"
                          class="louise-btn louise-btn-primary louise-btn-xs"
                          disabled={!previewFits(p())}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={replaceWithRewrite}
                        >
                          Replace
                        </button>
                        <button
                          type="button"
                          class="louise-btn louise-btn-xs"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setAiPreview(null)}
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  )}
                </Show>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/** The editing surface's class for a `surface` (#761). On the canvas, an
 *  `inline` field's one paragraph is the editor's own, not the site's, so it
 *  takes `is-inline` and the stylesheet gives it the host's font and no margin.
 *  A prose body keeps the site's paragraph rules. */
function surfaceClass(props: RichTextProps): string {
  if (props.surface !== "canvas") return "louise-prose-surface";
  return props.inline ? "louise-canvas-surface is-inline" : "louise-canvas-surface";
}

export function RichText(props: RichTextProps) {
  const builder = () => props.builder ?? props.blocks ?? false;
  const editor = createEditor({
    extension: louiseExtension(
      builder(),
      props.grammar ?? false,
      props.inline ?? false,
      props.typography,
    ),
    defaultContent: props.initialDoc || "<p></p>",
  });

  const dispose = editor.use(
    defineDocChangeHandler(() => props.onDocChange?.(() => editor.getDocJSON())),
  );

  // oxlint-disable-next-line no-unassigned-vars -- assigned by Solid's `ref` binding below
  let host!: HTMLDivElement;
  onMount(() => {
    editor.mount(host);
    props.ref?.({
      getJSON: () => editor.getDocJSON(),
      getHTML: () =>
        props.inline ? inlineHTMLFromDoc(editor) : htmlFromNode(editor.view.state.doc),
      destroy: () => {
        dispose();
        editor.unmount();
      },
    });
  });

  return (
    <ProseKit editor={editor}>
      <div class="louise-rt">
        {/* Format bubble (#182 Phase 5): a floating toolbar that appears over the
            current text selection, so inline editing on the live page stays
            clean until the editor highlights text. ProseKit's inline popover is
            three elements (#761): the root tracks the selection and holds the
            open state, the positioner places itself over the selection, and the
            popup shows and hides. The root alone renders its children in the
            flow, always visible. */}
        <Show when={props.toolbar !== false}>
          <InlinePopoverRoot>
            <InlinePopoverPositioner class="louise-format-bubble">
              <InlinePopoverPopup class="louise-format-popup">
                <Toolbar
                  minimal={props.minimal || props.inline}
                  image={props.image}
                  colors={props.colors}
                  language={props.language}
                />
              </InlinePopoverPopup>
            </InlinePopoverPositioner>
          </InlinePopoverRoot>
        </Show>
        <div class={props.class ?? surfaceClass(props)} ref={host} />
        {/* Block drag-handle + inserters—omitted in `minimal`/`inline`
            (light-inline) modes, where there's no block layer to reorder. */}
        <Show when={!(props.minimal || props.inline)}>
          {/* Builder-block inserters (#16)—only with the builder on: a visible
              "+ Block" button (deterministic) plus the slash menu (fast path). */}
          <Show when={builder()}>
            <BlockInserter />
            <BlockInserterButton />
          </Show>
          <BlockHandleRoot class="louise-rt-block-handle">
            <BlockHandlePositioner>
              <BlockHandleDraggable class="louise-rt-drag" aria-label="Drag to move block">
                <Icon name="dragHandle" />
              </BlockHandleDraggable>
            </BlockHandlePositioner>
          </BlockHandleRoot>
        </Show>
      </div>
    </ProseKit>
  );
}

/**
 * Vanilla-DOM adapter for the inline surface: takes over `el` (which already
 * contains the server-rendered rich text) with the same Solid-hosted editor.
 * `onChange` fires on every edit so the caller can mark the field dirty. The
 * editor is on the canvas, inside the site's own element, so its surface
 * inherits that element's type (`surface: "canvas"`) unless `opts.surface`
 * says otherwise.
 */
export function mountRichText(
  el: HTMLElement,
  onChange: () => void,
  initialDoc?: NodeJSON,
  opts?: {
    builder?: boolean;
    /** @deprecated Renamed `builder` (#537). */
    blocks?: boolean;
    grammar?: boolean;
    minimal?: boolean;
    image?: boolean;
    inline?: boolean;
    colors?: readonly RichTextColor[];
    typography?: RichTextTypography;
    language?: boolean;
    surface?: "panel" | "canvas";
  },
): RichTextField {
  const defaultContent: NodeJSON | string = initialDoc ?? (el.innerHTML.trim() || "<p></p>");
  let field: RichTextField | null = null;
  el.innerHTML = "";
  const disposeRoot = render(
    () => (
      <RichText
        initialDoc={defaultContent}
        builder={opts?.builder ?? opts?.blocks}
        grammar={opts?.grammar}
        minimal={opts?.minimal}
        image={opts?.image}
        inline={opts?.inline}
        colors={opts?.colors}
        typography={opts?.typography}
        language={opts?.language}
        surface={opts?.surface ?? "canvas"}
        onDocChange={() => onChange()}
        ref={(f) => {
          field = f;
        }}
      />
    ),
    el,
  );
  return {
    getJSON: () => field?.getJSON() ?? { type: "doc", content: [] },
    getHTML: () => field?.getHTML() ?? "",
    destroy: () => {
      field?.destroy();
      disposeRoot();
    },
  };
}
