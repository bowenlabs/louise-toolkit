// Louise rich text — ProseKit-Solid everywhere (per LOUISE.md's stack row).
// One Solid component owns the editor; the vanilla inline surface reuses it
// through mountRichText (solid-js/web render), so inline fields and drawer
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
import { defineTextColor } from "prosekit/extensions/text-color";
import {
  defineSolidNodeView,
  ProseKit,
  type SolidNodeViewProps,
  useEditor,
  useEditorDerivedValue,
} from "prosekit/solid";
import { BlockInserter, BlockInserterButton, defineBlocksExtension } from "./blocks.jsx";
import {
  BlockHandleDraggable,
  BlockHandlePositioner,
  BlockHandleRoot,
} from "prosekit/solid/block-handle";
import {
  InlinePopoverPopup,
  InlinePopoverPositioner,
  InlinePopoverRoot,
} from "prosekit/solid/inline-popover";
import { ResizableHandle, ResizableRoot } from "prosekit/solid/resizable";
import { createSignal, For, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import { Icon, type IconName } from "./icons.jsx";

/**
 * Uploads a dropped/pasted/picked image to R2 through the same
 * /api/louise/media endpoint the drawer panels use (web/ scope), returning the
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

/** Brand text colors offered by the toolbar swatch popover (prairie palette). */
const TEXT_COLORS = [
  { label: "Rust", value: "#a8482c" },
  { label: "Plum", value: "#5e3a52" },
  { label: "Sage", value: "#4f6933" },
  { label: "Gold", value: "#9a7328" },
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

function louiseExtension(blocks = false) {
  return union(
    defineBasicExtension(),
    defineBlockquote(),
    defineTextColor(),
    // Paste/drop an image → upload to R2 and insert (temp URL swapped for the
    // final one when the upload resolves).
    defineImageUploadHandler({ uploader: r2ImageUploader }),
    // Replace the default image rendering with the resizable node view.
    defineSolidNodeView({ name: "image", component: ResizableImage }),
    // Page-builder blocks (#16) — opt-in: the drawer Pages panel composes
    // whole pages, while inline prose fields stay blocks-free.
    ...(blocks ? [defineBlocksExtension()] : []),
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
  /** Enable page-builder blocks (#16) — the Pages panel opts in. */
  blocks?: boolean;
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
function Toolbar() {
  const editor = useEditor<LouiseEditorExtension>();
  const active = useEditorDerivedValue((e: Editor<LouiseEditorExtension>) => ({
    bold: e.marks.bold.isActive(),
    italic: e.marks.italic.isActive(),
    underline: e.marks.underline.isActive(),
    strike: e.marks.strike.isActive(),
    h2: e.nodes.heading.isActive({ level: 2 }),
    h3: e.nodes.heading.isActive({ level: 3 }),
    bullet: e.nodes.list.isActive({ kind: "bullet" }),
    ordered: e.nodes.list.isActive({ kind: "ordered" }),
    quote: e.nodes.blockquote.isActive(),
  }));

  // Swatch popover visibility is click-toggled state, not CSS :hover. The old
  // hover disclosure had a 4px gap between the palette button and the swatches;
  // crossing it dropped :hover and hid the popover before a swatch could be
  // clicked — which is why text color never applied (#14).
  const [colorOpen, setColorOpen] = createSignal(false);

  // oxlint-disable-next-line no-unassigned-vars -- assigned by Solid's `ref` binding below
  let imageInput!: HTMLInputElement;
  const pickImage = () => imageInput.click();
  const onImagePicked = (e: Event & { currentTarget: HTMLInputElement }) => {
    const file = e.currentTarget.files?.[0];
    if (file) editor().exec(uploadImage({ uploader: r2ImageUploader, file }));
    e.currentTarget.value = "";
  };

  const applyColor = (color: string) => {
    editor().commands.addTextColor({ color });
    setColorOpen(false);
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

  return (
    <InlinePopoverRoot>
      {/* hoist → render in the top layer (native Popover API) so the toolbar
          floats above the field/drawer instead of being positioned (and
          clipped) inside the relatively-positioned .louise-rt frame.
          strategy="fixed" is the correct floating-ui pairing for top-layer. */}
      <InlinePopoverPositioner placement="top" hoist strategy="fixed">
        <InlinePopoverPopup>
          {/* Flex/pill styling lives on this inner div, never on the popup
              element itself — a `display:flex` there would override the
              overlay's own `[hidden]` and keep it visible when closed. */}
          <div class="louise-toolbar" role="toolbar" aria-label="Formatting">
            <Btn
              icon="bold"
              title="Bold"
              on={active().bold}
              run={() => editor().commands.toggleBold()}
            />
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
                        style={{ background: c.value }}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyColor(c.value)}
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
          </div>
        </InlinePopoverPopup>
      </InlinePopoverPositioner>
    </InlinePopoverRoot>
  );
}

export function RichText(props: RichTextProps) {
  const editor = createEditor({
    extension: louiseExtension(props.blocks ?? false),
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
        <Show when={props.toolbar !== false}>
          <Toolbar />
        </Show>
        <div class={props.class ?? "louise-prose-surface"} ref={host} />
        {/* Floating drag handle that appears in the gutter of the hovered
            block, letting editors reorder blocks by dragging. */}
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
): RichTextField {
  const defaultContent: NodeJSON | string = initialDoc ?? (el.innerHTML.trim() || "<p></p>");
  let field: RichTextField | null = null;
  el.innerHTML = "";
  const disposeRoot = render(
    () => (
      <RichText
        initialDoc={defaultContent}
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
