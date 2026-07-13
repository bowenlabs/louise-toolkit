// Block node-view framework for the page builder (#16 + grid follow-up).
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
// package sanitizer (louise/security) strips any other class token, so
// editor-authored HTML can never borrow arbitrary site classes.
//
// The grid (rowBlock → columnBlock) is the adjustable layout primitive: a row
// serializes its column widths as a sanitizer-validated inline
// `grid-template-columns` fr track list (e.g. "6fr 4fr"), and the row node view
// exposes preset layouts, per-column width steppers, and add/remove column +
// add row — so widths are freely adjustable, not just fixed presets.

import type { Attrs, Node as PMNode } from "@prosekit/pm/model";
import type { Command } from "@prosekit/pm/state";
import { defineNodeSpec, insertNode, union, type Extension } from "prosekit/core";
import { defineSolidNodeView, useEditor, type SolidNodeViewComponent } from "prosekit/solid";
import {
  AutocompleteEmpty,
  AutocompleteItem,
  AutocompletePopup,
  AutocompletePositioner,
  AutocompleteRoot,
} from "prosekit/solid/autocomplete";
import { createSignal, For, onMount, Show } from "solid-js";
import { Icon } from "./icons.jsx";

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

/* ── Divider block ────────────────────────────────────────────────────── */

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

/* ── Adjustable grid: rowBlock → columnBlock ──────────────────────────────
   A row is a CSS grid whose track list is its `cols` attr (an fr weight list
   like "6fr 4fr"), serialized to the (sanitizer-validated) inline
   `grid-template-columns`. Columns hold arbitrary blocks. The row node view is
   editing chrome only — the serialized `toDOM` stays clean, so stored/rendered
   HTML never carries the toolbar. */

const DEFAULT_ROW_COLS = "1fr 1fr";
const MAX_COLUMNS = 6;

/** Preset layouts offered in the row toolbar (the user's ratio notation as fr). */
const ROW_PRESETS: { label: string; title: string; cols: string }[] = [
  { label: "1", title: "One column", cols: "1fr" },
  { label: "1:1", title: "Two equal", cols: "1fr 1fr" },
  { label: "6:4", title: "Two — wide left", cols: "6fr 4fr" },
  { label: "4:6", title: "Two — wide right", cols: "4fr 6fr" },
  { label: "1:1:1", title: "Three equal", cols: "1fr 1fr 1fr" },
  { label: "4:4:2", title: "Three — narrow right", cols: "4fr 4fr 2fr" },
  { label: "1:1:1:1", title: "Four equal", cols: "1fr 1fr 1fr 1fr" },
];

function parseWeights(cols: string): number[] {
  return cols
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => {
      const m = /([\d.]+)(?:fr|%)/.exec(t);
      return m ? Number.parseFloat(m[1]) : 1;
    });
}
function weightsToCols(weights: number[]): string {
  return weights.map((w) => `${w}fr`).join(" ");
}
function trackCount(cols: string): number {
  return cols.trim().split(/\s+/).filter(Boolean).length;
}
/** Normalize a track list to compare against a preset (ignores %/fr unit). */
function sameLayout(a: string, b: string): boolean {
  return weightsToCols(parseWeights(a)) === weightsToCols(parseWeights(b));
}

/** Rebuild a row's columns to match `cols`'s track count (preserving existing
 *  column content where the count grows; dropping trailing columns when it
 *  shrinks) and set the new track list. */
function setLayoutCommand(getPos: () => number | undefined, cols: string): Command {
  return (state, dispatch) => {
    const pos = getPos();
    if (pos == null) return false;
    const row = state.doc.nodeAt(pos);
    if (!row || row.type.name !== "rowBlock") return false;
    const colType = state.schema.nodes.columnBlock;
    if (!colType) return false;
    const target = Math.min(MAX_COLUMNS, Math.max(1, trackCount(cols)));
    const kids: PMNode[] = [];
    for (let i = 0; i < target; i++) {
      const kept = i < row.childCount ? row.child(i) : colType.createAndFill();
      if (kept) kids.push(kept);
    }
    if (dispatch) {
      const newRow = row.type.create({ ...row.attrs, cols }, kids);
      dispatch(state.tr.replaceRangeWith(pos, pos + row.nodeSize, newRow).scrollIntoView());
    }
    return true;
  };
}

/** Add or remove a column (rebalanced to even), keeping content. */
function changeColumnsCommand(getPos: () => number | undefined, delta: number): Command {
  return (state, dispatch) => {
    const pos = getPos();
    if (pos == null) return false;
    const row = state.doc.nodeAt(pos);
    if (!row || row.type.name !== "rowBlock") return false;
    const next = Math.min(MAX_COLUMNS, Math.max(1, row.childCount + delta));
    if (next === row.childCount) return false;
    return setLayoutCommand(getPos, Array.from({ length: next }, () => "1fr").join(" "))(
      state,
      dispatch,
    );
  };
}

/** Nudge one column's fr weight (arbitrary per-column width adjustment). */
function setColWeightCommand(
  getPos: () => number | undefined,
  index: number,
  delta: number,
): Command {
  return (state, dispatch) => {
    const pos = getPos();
    if (pos == null) return false;
    const row = state.doc.nodeAt(pos);
    if (!row || row.type.name !== "rowBlock") return false;
    const weights = parseWeights((row.attrs as { cols: string }).cols);
    if (index < 0 || index >= weights.length) return false;
    weights[index] = Math.min(11, Math.max(1, Math.round(weights[index] + delta)));
    if (dispatch) {
      dispatch(
        state.tr.setNodeMarkup(pos, undefined, { ...row.attrs, cols: weightsToCols(weights) }),
      );
    }
    return true;
  };
}

/** Insert a fresh two-column row directly after this one. */
function addRowBelowCommand(getPos: () => number | undefined): Command {
  return (state, dispatch) => {
    const pos = getPos();
    if (pos == null) return false;
    const row = state.doc.nodeAt(pos);
    if (!row || row.type.name !== "rowBlock") return false;
    const rowType = state.schema.nodes.rowBlock;
    const colType = state.schema.nodes.columnBlock;
    if (!rowType || !colType) return false;
    const columns = [colType.createAndFill(), colType.createAndFill()].filter(
      (c): c is PMNode => !!c,
    );
    const newRow = rowType.create({ cols: DEFAULT_ROW_COLS }, columns);
    if (dispatch) dispatch(state.tr.insert(pos + row.nodeSize, newRow).scrollIntoView());
    return true;
  };
}

/** Insert a new row with `count` empty columns at the selection (the inserter). */
export function insertRowCommand(cols = DEFAULT_ROW_COLS, count = 2): Command {
  return (state, dispatch) => {
    const rowType = state.schema.nodes.rowBlock;
    const colType = state.schema.nodes.columnBlock;
    if (!rowType || !colType) return false;
    const columns: PMNode[] = [];
    for (let i = 0; i < count; i++) {
      const col = colType.createAndFill();
      if (col) columns.push(col);
    }
    const row = rowType.create({ cols }, columns);
    if (dispatch) dispatch(state.tr.replaceSelectionWith(row).scrollIntoView());
    return true;
  };
}

const RowView: SolidNodeViewComponent = (props) => {
  const editor = useEditor();
  const cols = () => (props.node.attrs as { cols?: string }).cols ?? DEFAULT_ROW_COLS;
  const weights = () => parseWeights(cols());
  const run = (cmd: Command) => {
    editor().exec(cmd);
    editor().focus();
  };
  return (
    <div class="louise-row" classList={{ "is-selected": props.selected }} data-block-chrome="row">
      <div class="louise-row-bar" contentEditable={false}>
        <div class="louise-row-presets">
          <For each={ROW_PRESETS}>
            {(p) => (
              <button
                type="button"
                class="louise-chip"
                classList={{ "is-active": sameLayout(p.cols, cols()) }}
                title={p.title}
                onClick={() => run(setLayoutCommand(props.getPos, p.cols))}
              >
                {p.label}
              </button>
            )}
          </For>
        </div>
        <div class="louise-row-ops">
          <For each={weights()}>
            {(w, i) => (
              <span class="louise-col-adj" title={`Column ${i() + 1} width`}>
                <button
                  type="button"
                  class="louise-btn louise-btn-xs"
                  aria-label={`Narrow column ${i() + 1}`}
                  onClick={() => run(setColWeightCommand(props.getPos, i(), -1))}
                >
                  <Icon name="minus" />
                </button>
                <span class="louise-col-w">{w}</span>
                <button
                  type="button"
                  class="louise-btn louise-btn-xs"
                  aria-label={`Widen column ${i() + 1}`}
                  onClick={() => run(setColWeightCommand(props.getPos, i(), 1))}
                >
                  <Icon name="plus" />
                </button>
              </span>
            )}
          </For>
          <span class="louise-row-sep" />
          <button
            type="button"
            class="louise-btn louise-btn-xs"
            aria-label="Remove column"
            disabled={weights().length <= 1}
            onClick={() => run(changeColumnsCommand(props.getPos, -1))}
          >
            <Icon name="minus" /> col
          </button>
          <button
            type="button"
            class="louise-btn louise-btn-xs"
            aria-label="Add column"
            disabled={weights().length >= MAX_COLUMNS}
            onClick={() => run(changeColumnsCommand(props.getPos, 1))}
          >
            <Icon name="plus" /> col
          </button>
          <button
            type="button"
            class="louise-btn louise-btn-xs"
            aria-label="Add row"
            onClick={() => run(addRowBelowCommand(props.getPos))}
          >
            <Icon name="plus" /> row
          </button>
        </div>
      </div>
      <div
        class="pb-row"
        ref={(el) => props.contentRef(el)}
        style={{ "grid-template-columns": cols() }}
      />
    </div>
  );
};

function defineColumnBlock(): Extension {
  return defineNodeSpec({
    name: "columnBlock",
    content: "block+",
    defining: true,
    isolating: true,
    parseDOM: [{ tag: 'div[data-block="col"]', priority: 60 }],
    toDOM: () => ["div", { "data-block": "col", class: "pb-col" }, 0],
  });
}

function defineRowBlock(): Extension {
  const spec = defineNodeSpec({
    name: "rowBlock",
    group: "block",
    content: "columnBlock+",
    defining: true,
    isolating: true,
    selectable: true,
    attrs: { cols: { default: DEFAULT_ROW_COLS } },
    parseDOM: [
      {
        tag: 'div[data-block="row"]',
        priority: 60,
        getAttrs: (dom: HTMLElement) => ({
          cols: dom.style.gridTemplateColumns || DEFAULT_ROW_COLS,
        }),
      },
    ],
    toDOM: (node) => [
      "div",
      {
        "data-block": "row",
        class: "pb-row",
        style: `grid-template-columns: ${(node.attrs as { cols: string }).cols}`,
      },
      0,
    ],
  });
  return union(spec, defineSolidNodeView({ name: "rowBlock", component: RowView }));
}

function defineGridExtension(): Extension {
  return union(defineColumnBlock(), defineRowBlock());
}

/* ── Gallery block ────────────────────────────────────────────────────────
   A responsive image grid; `data-cols` sets the column count. Content is
   blocks (drop images in via the toolbar image button / paste). */

const GALLERY_COLS = ["2", "3", "4"];

const GalleryView: SolidNodeViewComponent = (props) => {
  const editor = useEditor();
  const cols = () => (props.node.attrs as { cols?: string }).cols ?? "3";
  const setCols = (c: string) =>
    run((state, dispatch) => {
      const pos = props.getPos();
      if (pos == null) return false;
      const node = state.doc.nodeAt(pos);
      if (!node) return false;
      if (dispatch) dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, cols: c }));
      return true;
    });
  const run = (cmd: Command) => {
    editor().exec(cmd);
    editor().focus();
  };
  return (
    <div
      class="louise-row"
      classList={{ "is-selected": props.selected }}
      data-block-chrome="gallery"
    >
      <div class="louise-row-bar" contentEditable={false}>
        <span class="louise-row-count">Gallery</span>
        <For each={GALLERY_COLS}>
          {(c) => (
            <button
              type="button"
              class="louise-chip"
              classList={{ "is-active": c === cols() }}
              onClick={() => setCols(c)}
            >
              {c} cols
            </button>
          )}
        </For>
      </div>
      <div class="pb-grid" ref={(el) => props.contentRef(el)} data-cols={cols()} />
    </div>
  );
};

function defineGalleryBlock(): Extension {
  const spec = defineNodeSpec({
    name: "galleryBlock",
    group: "block",
    content: "block+",
    defining: true,
    selectable: true,
    attrs: { cols: { default: "3" } },
    parseDOM: [
      {
        tag: 'section[data-block="grid"]',
        priority: 60,
        getAttrs: (dom: HTMLElement) => ({ cols: dom.getAttribute("data-cols") ?? "3" }),
      },
    ],
    toDOM: (node) => [
      "section",
      {
        "data-block": "grid",
        class: "pb-grid",
        "data-cols": String((node.attrs as { cols: string }).cols),
      },
      0,
    ],
  });
  return union(spec, defineSolidNodeView({ name: "galleryBlock", component: GalleryView }));
}

/* ── Button block ─────────────────────────────────────────────────────────
   A link styled as a button. An atom (label + href are node attrs, edited via an
   on-canvas popup) so there's no inline-content/link-mark ambiguity. Serializes
   to `<div data-block="button" class="pb-button"><a href="…">label</a></div>` —
   the div keeps class + data-block, the anchor keeps href, both surviving the
   sanitizer with no class needed on <a>. */

// Page list for the link picker, fetched once per session and shared.
let pagesCache: { slug: string; title: string }[] | null = null;

/** Link editor: a page picker (pulled from the louise/editor `pages` list)
 *  plus a free URL field, so a link can target an internal page or any URL.
 *  Commits on change/blur (not per keystroke) to avoid remounting the node view
 *  mid-type. */
function LinkField(props: { href: string; onChange: (href: string) => void }) {
  const [pages, setPages] = createSignal(pagesCache ?? []);
  const [url, setUrl] = createSignal(props.href);
  onMount(() => {
    if (pagesCache) return;
    void fetch("/api/louise/pages", { headers: { accept: "application/json" } })
      .then((r) =>
        r.ok ? (r.json() as Promise<{ pages?: { slug: string; title: string }[] }>) : { pages: [] },
      )
      .then((d) => {
        pagesCache = d.pages ?? [];
        setPages(pagesCache);
      })
      .catch(() => {});
  });
  return (
    <>
      <Show when={pages().length > 0}>
        <select
          class="louise-select"
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (v) {
              setUrl(v);
              props.onChange(v);
            }
          }}
        >
          <option value="">Link to a page…</option>
          <For each={pages()}>
            {(p) => (
              <option value={`/${p.slug}`} selected={url() === `/${p.slug}`}>
                {p.title}
              </option>
            )}
          </For>
        </select>
      </Show>
      <input
        class="louise-input"
        value={url()}
        placeholder="https://… or /path"
        aria-label="Link URL"
        onInput={(e) => setUrl(e.currentTarget.value)}
        onChange={() => props.onChange(url())}
      />
    </>
  );
}

const ButtonView: SolidNodeViewComponent = (props) => {
  const attrs = () => props.node.attrs as { label?: string; href?: string };
  const [label, setLabel] = createSignal(attrs().label ?? "Button");
  const [href, setHref] = createSignal(attrs().href ?? "#");
  return (
    <span
      class="louise-block louise-button-block"
      classList={{ "is-selected": props.selected }}
      data-block-chrome="button"
      contentEditable={false}
    >
      <a class="pb-button-link" href={href()} onClick={(e) => e.preventDefault()}>
        {label() || "Button"}
      </a>
      {/* Settings pop up when the button is selected or a field has focus (CSS);
          no separate Edit control. */}
      <span class="louise-button-pop">
        <input
          class="louise-input"
          value={label()}
          placeholder="Label"
          aria-label="Button label"
          onInput={(e) => setLabel(e.currentTarget.value)}
          onChange={() => props.setAttrs({ label: label(), href: href() })}
        />
        <LinkField
          href={href()}
          onChange={(h) => {
            setHref(h);
            props.setAttrs({ label: label(), href: h });
          }}
        />
      </span>
    </span>
  );
};

function defineButtonBlock(): Extension {
  const spec = defineNodeSpec({
    name: "buttonBlock",
    group: "block",
    atom: true,
    selectable: true,
    attrs: { label: { default: "Button" }, href: { default: "#" } },
    parseDOM: [
      {
        tag: 'div[data-block="button"]',
        priority: 60,
        getAttrs: (dom: HTMLElement) => {
          const a = dom.querySelector("a");
          return { label: a?.textContent ?? "Button", href: a?.getAttribute("href") ?? "#" };
        },
      },
    ],
    toDOM: (node) => {
      const a = node.attrs as { label: string; href: string };
      return [
        "div",
        { "data-block": "button", class: "pb-button" },
        ["a", { href: a.href }, a.label],
      ];
    },
  });
  return union(spec, defineSolidNodeView({ name: "buttonBlock", component: ButtonView }));
}

/** Insert a button with a default label + placeholder link. */
export function insertButtonCommand(): Command {
  return (state, dispatch) => {
    const type = state.schema.nodes.buttonBlock;
    if (!type) return false;
    const node = type.create({ label: "Button", href: "#" });
    if (dispatch) dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    return true;
  };
}

/* ── Legacy two-column block (pre-grid content) ───────────────────────────
   Kept registered so already-authored `<section data-block="cols">` bodies
   still parse and render; not offered in the inserter (rowBlock supersedes it). */

function defineLegacyColumns(): Extension {
  const cols = defineNodeSpec({
    name: "colsBlock",
    group: "block",
    content: "pbCol pbCol",
    defining: true,
    parseDOM: [{ tag: 'section[data-block="cols"]', priority: 60 }],
    toDOM: () => ["section", { "data-block": "cols", class: "pb-cols" }, 0],
  });
  const col = defineNodeSpec({
    name: "pbCol",
    content: "block+",
    defining: true,
    parseDOM: [{ tag: "div.pb-col", priority: 55 }],
    toDOM: () => ["div", { class: "pb-col" }, 0],
  });
  return union(cols, col);
}

/* ── Simple blocks (hero / full-bleed / pull quote / CTA / divider) ─────── */

const SIMPLE_BLOCKS: BlockDef[] = [
  { name: "heroBlock", block: "hero", tag: "section", class: "pb-hero", content: "block+" },
  { name: "bleedBlock", block: "bleed", tag: "figure", class: "pb-bleed", content: "block+" },
  { name: "quoteBlock", block: "quote", tag: "blockquote", class: "pb-quote", content: "block+" },
  { name: "ctaBlock", block: "cta", tag: "section", class: "pb-cta", content: "block+" },
  {
    name: "dividerBlock",
    block: "divider",
    tag: "hr",
    class: "pb-hr",
    atom: true,
    attrs: { size: { default: "md", attr: "data-size" } },
    component: DividerView,
  },
];

/** Registry consumed by the inserter (slash menu + button). */
export interface BlockEntry {
  /** Inserter label. */
  label: string;
  /** Inserter keywords. */
  keywords: string[];
  /** The command that inserts this block. */
  command: Command;
}

const insertByName = (name: string): Command => insertNode({ type: name });

export const BLOCKS: BlockEntry[] = [
  {
    label: "Hero",
    keywords: ["hero", "header", "headline", "title"],
    command: insertByName("heroBlock"),
  },
  {
    label: "Columns",
    keywords: ["columns", "cols", "grid", "row", "split", "layout"],
    command: insertRowCommand(),
  },
  {
    label: "Gallery",
    keywords: ["gallery", "grid", "images", "photos"],
    command: insertByName("galleryBlock"),
  },
  {
    label: "Button",
    keywords: ["button", "cta", "link", "action"],
    command: insertButtonCommand(),
  },
  {
    label: "Full-bleed",
    keywords: ["bleed", "full", "wide", "image", "banner"],
    command: insertByName("bleedBlock"),
  },
  {
    label: "Pull quote",
    keywords: ["quote", "pull", "blockquote", "callout"],
    command: insertByName("quoteBlock"),
  },
  {
    label: "Call to action",
    keywords: ["cta", "call", "action", "button", "link"],
    command: insertByName("ctaBlock"),
  },
  {
    label: "Divider",
    keywords: ["divider", "spacer", "rule", "hr"],
    command: insertByName("dividerBlock"),
  },
];

/** All block extensions, unioned — opt in via RichText's `blocks` prop. */
export function defineBlocksExtension(): Extension {
  return union(
    ...SIMPLE_BLOCKS.map(defineBlock),
    defineGridExtension(),
    defineGalleryBlock(),
    defineButtonBlock(),
    defineLegacyColumns(),
  );
}

/* ── Inserters ────────────────────────────────────────────────────────────
   "/" opens a filterable slash menu; the "+ Block" button is the deterministic
   fallback. Both run the selected entry's insert command. */

const SLASH = /\/(|\S*)$/u;

export function BlockInserterButton() {
  const editor = useEditor();
  const [open, setOpen] = createSignal(false);
  const insert = (b: BlockEntry) => {
    editor().exec(b.command);
    setOpen(false);
    editor().focus();
  };
  return (
    <div class="louise-block-add">
      <button class="louise-btn" type="button" onClick={() => setOpen(!open())}>
        <Icon name="plus" /> Block
      </button>
      <Show when={open()}>
        <div class="louise-block-add-menu" role="menu">
          <For each={BLOCKS}>
            {(b) => (
              <button
                class="louise-slash-item"
                type="button"
                role="menuitem"
                onClick={() => insert(b)}
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
  return (
    <AutocompleteRoot regex={SLASH}>
      <AutocompletePositioner>
        <AutocompletePopup class="louise-slash-menu">
          <For each={BLOCKS}>
            {(b) => (
              <AutocompleteItem
                class="louise-slash-item"
                value={[b.label, ...b.keywords].join(" ")}
                onSelect={() => editor().exec(b.command)}
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
