// Louise rich text — ProseKit-Solid everywhere (per LOUISE.md's stack row).
// One Solid component owns the editor; the vanilla inline surface reuses it
// through mountRichText (solid-js/web render), so inline fields and Settings
// forms share the exact same editor + ProseMirror JSON storage contract.

import { defineBasicExtension } from "prosekit/basic";
import {
  createEditor,
  defineDocChangeHandler,
  htmlFromNode,
  union,
  type Editor,
  type NodeJSON,
} from "prosekit/core";
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
import { InlinePopoverRoot } from "prosekit/solid/inline-popover";
import { createSignal, For, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import { Icon, type IconName } from "./icons.jsx";

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
 * Brand text colours offered by the format bubble's swatch popover (#182 Phase 5).
 * Each is a **daisyUI theme token**, not a fixed hex — the mark stores
 * `color: var(--color-<token>)`, so it resolves to the SITE's own theme colour at
 * render and a re-theme flows through with no content rewrite. The swatch preview
 * uses the same `var()`, so it shows the site's actual colour in the editor.
 */
const TEXT_COLORS = [
  { label: "Primary", token: "primary" },
  { label: "Secondary", token: "secondary" },
  { label: "Accent", token: "accent" },
  { label: "Neutral", token: "neutral" },
  { label: "Info", token: "info" },
  { label: "Success", token: "success" },
  { label: "Warning", token: "warning" },
  { label: "Error", token: "error" },
] as const;

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

/**
 * Resizable image node view: wraps the image node's DOM in ProseKit's
 * resizable custom element so editors can drag the corner to set explicit
 * width/height. The dimensions persist onto the node's attrs, which serialize
 * to `<img width height>` — exactly what the site renders via set:html.
 */
function ResizableImage(props: SolidNodeViewProps) {
  const attrs = () =>
    props.node.attrs as { src?: string | null; width?: number | null; height?: number | null };
  return (
    <ResizableRoot
      class="louise-rt-image"
      width={attrs().width ?? undefined}
      height={attrs().height ?? undefined}
      onResizeEnd={(e) => props.setAttrs({ width: e.detail.width, height: e.detail.height })}
    >
      <img src={attrs().src ?? ""} alt="" />
      <ResizableHandle class="louise-rt-resize" position="bottom-right" />
    </ResizableRoot>
  );
}

function louiseExtension(blocks = false, grammar = false) {
  return union(
    defineBasicExtension(),
    defineBlockquote(),
    defineTextColor(),
    // Inline link mark (#182 Phase 5) — surfaced in the format bubble; renders to
    // `<a href>`, which the sanitizer already allows.
    defineLink(),
    // Paste/drop an image → upload to R2 and insert (temp URL swapped for the
    // final one when the upload resolves).
    defineImageUploadHandler({ uploader: r2ImageUploader }),
    // Replace the default image rendering with the resizable node view.
    defineSolidNodeView({ name: "image", component: ResizableImage }),
    // Builder blocks (#16) — opt-in: the Settings Pages panel composes
    // whole pages, while inline prose fields stay blocks-free.
    ...(blocks ? [defineBlocksExtension()] : []),
    // Grammar/spelling check (#110) — opt-in: adding the extension lazy-loads
    // Harper's WASM checker; off by default so nothing extra ships otherwise.
    ...(grammar ? [defineGrammarExtension()] : []),
  );
}

/** The editor's extension type — threaded to `useEditor`/derived values so the
 * toolbar's mark/node/command access is typed rather than collapsing to `never`. */
type LouiseEditorExtension = ReturnType<typeof louiseExtension>;

export interface RichTextProps {
  /** Starting document — ProseMirror JSON, or an HTML string to parse. */
  initialDoc?: NodeJSON | string;
  /** Fires on every document edit. */
  onDocChange?: (getJSON: () => NodeJSON) => void;
  /** Receives the field handle once the editor is live. */
  ref?: (field: RichTextField) => void;
  /** Show the formatting toolbar (default true). */
  toolbar?: boolean;
  /** Enable builder blocks (#16) — the Pages panel opts in. */
  blocks?: boolean;
  /** Enable the Harper grammar/spelling checker (#110). Off by default; when on,
   *  the WASM checker is lazy-loaded and issues are underlined with suggestions. */
  grammar?: boolean;
  /** Light-inline mode (#182): the format bubble shows only inline formatting
   *  (bold/italic/underline/strike/link/colour) and the block drag-handle is
   *  omitted — for section rich-text fields (a tagline, a body line), not a full
   *  page body. The schema is unchanged; only the chrome is trimmed. */
  minimal?: boolean;
  class?: string;
}

export interface RichTextField {
  /** Current document as ProseMirror JSON. */
  getJSON: () => NodeJSON;
  /** Current document serialized to HTML — what the site stores + renders. */
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
function Toolbar(props: { minimal?: boolean }) {
  const editor = useEditor<LouiseEditorExtension>();
  const active = useEditorDerivedValue((e: Editor<LouiseEditorExtension>) => ({
    bold: e.marks.bold.isActive(),
    italic: e.marks.italic.isActive(),
    underline: e.marks.underline.isActive(),
    strike: e.marks.strike.isActive(),
    link: e.marks.link.isActive(),
    h2: e.nodes.heading.isActive({ level: 2 }),
    h3: e.nodes.heading.isActive({ level: 3 }),
    bullet: e.nodes.list.isActive({ kind: "bullet" }),
    ordered: e.nodes.list.isActive({ kind: "ordered" }),
    quote: e.nodes.blockquote.isActive(),
    // `e.view` throws before mount (assertView); `e.mounted` never does, so gate
    // the selection read. Drives the AI-rewrite button's enabled state.
    hasSelection: e.mounted && !e.view.state.selection.empty,
  }));

  // Swatch popover visibility is click-toggled state, not CSS :hover. The old
  // hover disclosure had a 4px gap between the palette button and the swatches;
  // crossing it dropped :hover and hid the popover before a swatch could be
  // clicked — which is why text color never applied (#14).
  const [colorOpen, setColorOpen] = createSignal(false);

  // AI rewrite (#75/#166): opt-in, degrade-gracefully. The sparkle menu POSTs the
  // selected text to /api/louise/ai/rewrite and swaps in the result. `aiAvailable`
  // starts true and flips off on the first 503 (the AI binding isn't provisioned),
  // retiring the control for the session; a 502/model hiccup leaves the original
  // text untouched.
  const [aiOpen, setAiOpen] = createSignal(false);
  const [aiBusy, setAiBusy] = createSignal(false);
  const [aiAvailable, setAiAvailable] = createSignal(true);

  const runRewrite = async (mode: string) => {
    const view = editor().view;
    const { from, to, empty } = view.state.selection;
    if (empty) return;
    const text = view.state.doc.textBetween(from, to, " ").trim();
    if (!text) return;
    setAiBusy(true);
    try {
      const res = await fetch("/api/louise/ai/rewrite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, mode }),
      });
      // 503 → the AI binding is absent; hide the control for the rest of the
      // session. 502/4xx → a model hiccup or bad response; keep the original text.
      if (res.status === 503) {
        setAiAvailable(false);
        return;
      }
      if (!res.ok) return;
      const data = (await res.json().catch(() => null)) as { text?: string } | null;
      const next = data?.text?.trim();
      if (!next) return;
      // Re-read state at apply time — the doc may have changed during the request.
      // Bail if the captured range no longer fits (avoids an out-of-range insert).
      const size = editor().view.state.doc.content.size;
      if (from > size || to > size) return;
      const tr = editor().view.state.tr.insertText(next, from, to);
      editor().view.dispatch(tr);
    } catch {
      // Network error → quiet no-op, keeping the original text.
    } finally {
      setAiBusy(false);
      setAiOpen(false);
    }
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
    <div class="louise-toolbar" role="toolbar" aria-label="Formatting">
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
      {/* Block-level controls (headings, lists, quote, image) — hidden in the
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
      <span class="louise-tb-sep" />
      <div class="louise-tb-color">
        <button
          type="button"
          class="louise-tb-btn"
          classList={{ "is-active": colorOpen() }}
          title="Text color"
          aria-label="Text color"
          aria-expanded={colorOpen()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setColorOpen((v) => !v)}
        >
          <Icon name="palette" />
        </button>
        <Show when={colorOpen()}>
          <div class="louise-tb-swatches">
            <For each={TEXT_COLORS}>
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
      {/* AI rewrite (#75/#166). Hidden once we learn the AI binding is absent
          (first 503). Enabled only over a real selection — there's nothing to
          rewrite at a bare caret. Anchored to the right so the menu stays
          on-screen at the toolbar's trailing edge. */}
      <Show when={aiAvailable() && !props.minimal}>
        <span class="louise-tb-sep" />
        <div class="louise-tb-ai">
          <button
            type="button"
            class="louise-tb-btn"
            classList={{ "is-active": aiOpen() }}
            title="Rewrite with AI"
            aria-label="Rewrite with AI"
            aria-expanded={aiOpen()}
            disabled={!active().hasSelection || aiBusy()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setAiOpen((v) => !v)}
          >
            <Icon name="sparkle" />
          </button>
          <Show when={aiOpen()}>
            <div class="louise-tb-ai-menu" role="menu">
              <Show when={!aiBusy()} fallback={<span class="louise-tb-ai-busy">Rewriting…</span>}>
                <For each={REWRITE_ACTIONS}>
                  {(a) => (
                    <button
                      type="button"
                      class="louise-tb-ai-item"
                      role="menuitem"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => runRewrite(a.mode)}
                    >
                      {a.label}
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

export function RichText(props: RichTextProps) {
  const editor = createEditor({
    extension: louiseExtension(props.blocks ?? false, props.grammar ?? false),
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
      getHTML: () => htmlFromNode(editor.view.state.doc),
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
            current text selection (ProseKit InlinePopover), so inline editing on
            the live page stays clean until the editor highlights text. */}
        <Show when={props.toolbar !== false}>
          <InlinePopoverRoot class="louise-format-bubble">
            <Toolbar minimal={props.minimal} />
          </InlinePopoverRoot>
        </Show>
        <div class={props.class ?? "louise-prose-surface"} ref={host} />
        {/* Block drag-handle + inserters — omitted in `minimal` (light-inline)
            mode, where there's no block layer to reorder or insert into. */}
        <Show when={!props.minimal}>
          {/* Block inserters (#16) — only where blocks are enabled: a visible
              "+ Block" button (deterministic) plus the slash menu (fast path). */}
          <Show when={props.blocks}>
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
 * `onChange` fires on every edit so the caller can mark the field dirty.
 */
export function mountRichText(
  el: HTMLElement,
  onChange: () => void,
  initialDoc?: NodeJSON,
  opts?: { blocks?: boolean; grammar?: boolean; minimal?: boolean },
): RichTextField {
  const defaultContent: NodeJSON | string = initialDoc ?? (el.innerHTML.trim() || "<p></p>");
  let field: RichTextField | null = null;
  el.innerHTML = "";
  const disposeRoot = render(
    () => (
      <RichText
        initialDoc={defaultContent}
        blocks={opts?.blocks}
        grammar={opts?.grammar}
        minimal={opts?.minimal}
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
