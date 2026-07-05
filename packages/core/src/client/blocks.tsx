// Block node-view framework for the page builder (#16).
//
// A "block" is a ProseKit custom node that serializes to semantic, classed
// HTML (`<section data-block="hero" class="pb-hero">…`) so the existing
// sanitized-HTML storage contract keeps working: `toDOM` is the persistence
// format (rendered verbatim on the public site via set:html after
// sanitization), `parseDOM` reconstructs the node when a stored page is
// edited again, and the Solid node view is *editing chrome only* — selection
// outline and per-block controls, never markup of record.
//
// Class names on serialized blocks use the `pb-` prefix exclusively: the
// site's sanitizer (workers/site/src/lib/sanitize.ts) strips any other class
// token, so editor-authored HTML can never borrow arbitrary site classes.

import type { Attrs } from "@prosekit/pm/model";
import { defineNodeSpec, insertNode, union, type Extension } from "prosekit/core";
import { defineSolidNodeView, useEditor, type SolidNodeViewComponent } from "prosekit/solid";
import {
  AutocompleteEmpty,
  AutocompleteItem,
  AutocompletePopup,
  AutocompletePositioner,
  AutocompleteRoot,
} from "prosekit/solid/autocomplete";
import { createSignal, For, Show } from "solid-js";

export interface BlockAttrSpec {
  default: string;
  /** Serialized as this data-* attribute (e.g. "data-size"). */
  attr: string;
}

export interface BlockDef {
  /** Node name in the schema (e.g. "dividerBlock"). */
  name: string;
  /** `data-block` token — the stable identity in serialized HTML. */
  block: string;
  /** Serialized tag (section/figure/hr/…). */
  tag: string;
  /** `pb-*` class on the serialized element. */
  class: string;
  /** ProseMirror content expression; omit for leaf blocks. */
  content?: string;
  /** Attribute specs, keyed by node attr name. */
  attrs?: Record<string, BlockAttrSpec>;
  /** True for content-less blocks (divider). */
  atom?: boolean;
  /** Editing chrome — optional: container blocks render fine through
   * ProseMirror's default toDOM rendering with CSS-only chrome. */
  component?: SolidNodeViewComponent;
}

/** Serialize a block's attrs into its data-* attributes. */
function dataAttrs(def: BlockDef, attrs: Attrs): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, spec] of Object.entries(def.attrs ?? {})) {
    const v = attrs[name];
    if (v != null && v !== "") out[spec.attr] = String(v);
  }
  return out;
}

/**
 * Define a page-builder block: node spec (persistence) + Solid node view
 * (editing chrome), mirroring how the resizable image is wired in RichText.
 */
export function defineBlock(def: BlockDef): Extension {
  const attrSpecs = Object.fromEntries(
    Object.entries(def.attrs ?? {}).map(([name, spec]) => [name, { default: spec.default }]),
  );
  const spec = defineNodeSpec({
    name: def.name,
    group: "block",
    content: def.content,
    atom: def.atom,
    defining: true,
    selectable: true,
    attrs: attrSpecs,
    parseDOM: [
      {
        tag: `${def.tag}[data-block="${def.block}"]`,
        // Beat the generic rules for the same tag (e.g. the basic
        // extension's bare `blockquote`), which share the default 50.
        priority: 60,
        getAttrs: (dom: HTMLElement) =>
          Object.fromEntries(
            Object.entries(def.attrs ?? {}).map(([name, spec]) => [
              name,
              dom.getAttribute(spec.attr) ?? spec.default,
            ]),
          ),
      },
    ],
    toDOM: (node) => {
      const attrs = {
        "data-block": def.block,
        class: def.class,
        ...dataAttrs(def, node.attrs),
      };
      return def.content ? [def.tag, attrs, 0] : [def.tag, attrs];
    },
  });
  return def.component
    ? union(spec, defineSolidNodeView({ name: def.name, component: def.component }))
    : spec;
}

/* ── Reference block: divider ─────────────────────────────────────────
   The simplest block — a leaf node proving the framework end-to-end
   (spec, view, data-* attrs, sanitizer round-trip). The block set proper
   lands in the follow-up slice. */

const DividerView: SolidNodeViewComponent = (props) => {
  const size = () => (props.node.attrs as { size?: string }).size ?? "md";
  const toggle = () => props.setAttrs({ size: size() === "md" ? "lg" : "md" });
  return (
    <div
      class="louise-block"
      classList={{ "is-selected": props.selected }}
      data-block-chrome="divider"
    >
      <hr class="pb-hr" data-size={size()} />
      <button
        class="louise-block-control"
        type="button"
        contentEditable={false}
        onClick={toggle}
        title="Toggle spacing"
      >
        {size() === "md" ? "Roomier" : "Tighter"}
      </button>
    </div>
  );
};

/** Registry consumed by the inserter (slash menu). */
export interface BlockEntry {
  def: BlockDef;
  /** Inserter label. */
  label: string;
  /** Inserter keywords. */
  keywords: string[];
}

export const BLOCKS: BlockEntry[] = [
  {
    label: "Hero",
    keywords: ["hero", "header", "headline", "title"],
    def: {
      name: "heroBlock",
      block: "hero",
      tag: "section",
      class: "pb-hero",
      content: "block+",
    },
  },
  {
    label: "Two columns",
    keywords: ["columns", "cols", "image", "text", "split", "two"],
    def: {
      name: "colsBlock",
      block: "cols",
      tag: "section",
      class: "pb-cols",
      content: "pbCol pbCol",
    },
  },
  {
    label: "Full-bleed",
    keywords: ["bleed", "full", "wide", "image", "banner"],
    def: {
      name: "bleedBlock",
      block: "bleed",
      tag: "figure",
      class: "pb-bleed",
      content: "block+",
    },
  },
  {
    label: "Pull quote",
    keywords: ["quote", "pull", "blockquote", "callout"],
    def: {
      name: "quoteBlock",
      block: "quote",
      tag: "blockquote",
      class: "pb-quote",
      content: "block+",
    },
  },
  {
    label: "Call to action",
    keywords: ["cta", "call", "action", "button", "link"],
    def: {
      name: "ctaBlock",
      block: "cta",
      tag: "section",
      class: "pb-cta",
      content: "block+",
    },
  },
  {
    label: "Divider",
    keywords: ["divider", "spacer", "rule", "hr"],
    def: {
      name: "dividerBlock",
      block: "divider",
      tag: "hr",
      class: "pb-hr",
      atom: true,
      attrs: { size: { default: "md", attr: "data-size" } },
      component: DividerView,
    },
  },
];

/** Column child of the two-column block — not directly insertable, so it
 * lives outside the registry. Serializes as `<div class="pb-col">`. */
function definePbCol(): Extension {
  return defineNodeSpec({
    name: "pbCol",
    content: "block+",
    defining: true,
    parseDOM: [{ tag: "div.pb-col", priority: 60 }],
    toDOM: () => ["div", { class: "pb-col" }, 0],
  });
}

/** All block extensions, unioned — opt in via RichText's `blocks` prop. */
export function defineBlocksExtension(): Extension {
  return union(definePbCol(), ...BLOCKS.map((b) => defineBlock(b.def)));
}

/* ── Inserter: slash menu (#16 phase 2) ───────────────────────────────
   Type "/" at the start of an empty selection to open a filterable menu
   of blocks. ProseKit's autocomplete removes the matched "/query" text
   when an item is selected, then we insert the chosen block node. */

/** Matches "/…" as it's being typed; the query after the slash filters items. */
const SLASH = /\/(|\S*)$/u;

/** Deterministic inserter: a visible "+ Block" button below the editing
 *  surface with a plain Solid menu — no popover/anchor machinery, so it works
 *  everywhere the editor does. The slash menu remains the fast path. */
export function BlockInserterButton() {
  const editor = useEditor();
  const [open, setOpen] = createSignal(false);
  const insert = (name: string) => {
    editor().exec(insertNode({ type: name }));
    setOpen(false);
    editor().focus();
  };
  return (
    <div class="louise-block-add">
      <button class="louise-btn" type="button" onClick={() => setOpen(!open())}>
        + Block
      </button>
      <Show when={open()}>
        <div class="louise-block-add-menu" role="menu">
          <For each={BLOCKS}>
            {(b) => (
              <button
                class="louise-slash-item"
                type="button"
                role="menuitem"
                onClick={() => insert(b.def.name)}
              >
                {b.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export function BlockInserter() {
  const editor = useEditor();
  const insert = (name: string) => {
    editor().exec(insertNode({ type: name }));
  };
  return (
    <AutocompleteRoot regex={SLASH}>
      <AutocompletePositioner>
        <AutocompletePopup class="louise-slash-menu">
          <For each={BLOCKS}>
            {(b) => (
              <AutocompleteItem
                class="louise-slash-item"
                value={[b.label, ...b.keywords].join(" ")}
                onSelect={() => insert(b.def.name)}
              >
                {b.label}
              </AutocompleteItem>
            )}
          </For>
          <AutocompleteEmpty class="louise-slash-empty">No matching block</AutocompleteEmpty>
        </AutocompletePopup>
      </AutocompletePositioner>
    </AutocompleteRoot>
  );
}
