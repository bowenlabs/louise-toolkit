// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

/**
 * Visual editing / click-to-edit (issue #15) — adopts Sanity's
 * Presentation/visual-editing idea (pattern, not code): the rendered page
 * (in a preview context) tags editable regions with the source field they
 * came from, and an overlay turns those regions into click targets that tell
 * the editor which field to focus.
 *
 * This module ships the reusable, framework-agnostic primitives:
 * 1. **Encoding** — `editAttr({ collection, id, field })` produces a data
 *    attribute the server renderer spreads onto an element; `decodeEditRef`
 *    reads it back. Pure, testable.
 * 2. **Overlay** — `mountVisualEditing()` (browser-only; references `document`
 *    lazily, so importing it server-side is harmless) highlights tagged
 *    elements on hover and, on click, calls `onSelect` and `postMessage`s the
 *    ref to the parent window (the editor shell hosting the preview iframe).
 * 3. **Clipboard guard** — `mountStegaClipboardGuard()` strips the invisible
 *    stega payload from copied text so an editor never pastes zero-width chars
 *    into another app. Uses the dependency-free `stegaClean` (no `@vercel/stega`).
 *
 * The editor side listens for that message and navigates to
 * `/admin/<collection>/<id>` (and may focus `<field>`); that wiring is
 * consumer-side and not prescribed here.
 */

import { stegaClean } from "./stega-clean.js";

/** A reference from a rendered region back to the field that produced it. */
export interface EditRef {
  collection: string;
  id: number;
  field: string;
}

/** The data attribute editable regions are tagged with. */
export const EDIT_ATTR = "data-louise-edit";

/**
 * Per-item stable key on `array`/block items (#15, per-block tagging). The
 * editor's block builder stamps this on each block it creates so a click-to-
 * edit ref (`blocks.<_key>`) survives reordering — unlike a bare array index.
 * It rides along in the block's JSON (the `array` field is a verbatim JSON
 * column) and is never rendered as an input (the editor only renders declared
 * sub-fields).
 */
export const BLOCK_KEY = "_key";

/**
 * Generate a stable block key. Deliberately starts with a letter so a ref
 * segment `blocks.<key>` is always distinguishable from a legacy index path
 * (`blocks.<n>.<field>`) by whether the segment is numeric — see
 * {@link parseBlockFieldRef}'s consumers.
 */
export function newBlockKey(): string {
  return `b${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Split a block field path into the array field name and the target block's
 * key (or legacy index). Handles both the per-block wrapper ref
 * (`blocks.<_key>`) and the per-field live-preview path (`blocks.<index>.
 * <field>`) — either way the first segment is the array, the second the
 * block. Returns null for a bare array ref (`blocks`) that names no specific
 * block. Shared by the editor (routing a click to a block) and the block
 * builder (focusing it) so the two can't drift.
 */
export function parseBlockFieldRef(field: string): { field: string; key: string } | null {
  const parts = field.split(".");
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  return { field: parts[0], key: parts[1] };
}

/** `postMessage` payload type for a click-to-edit selection. */
export const VISUAL_EDIT_MESSAGE = "louise:visual-edit";

export function encodeEditRef(ref: EditRef): string {
  return `${ref.collection}:${ref.id}:${ref.field}`;
}

/** Parse an {@link EditRef} string, or null if malformed. */
export function decodeEditRef(value: string): EditRef | null {
  const parts = value.split(":");
  if (parts.length !== 3) return null;
  const [collection, idRaw, field] = parts;
  const id = Number.parseInt(idRaw, 10);
  if (!collection || !field || !Number.isFinite(id)) return null;
  return { collection, id, field };
}

/**
 * Attribute object to spread onto a rendered element so the overlay can map
 * it back to its source field, e.g. `<h1 {...editAttr({collection:'pages',
 * id, field:'title'})}>`.
 */
export function editAttr(ref: EditRef): Record<string, string> {
  return { [EDIT_ATTR]: encodeEditRef(ref) };
}

export interface VisualEditingMessage {
  type: typeof VISUAL_EDIT_MESSAGE;
  ref: EditRef;
}

// ---------------------------------------------------------------------------
// Live preview (editor → preview): the reverse channel of click-to-edit. The
// editor posts the in-progress form values into the preview iframe so tagged
// text regions update as the client types. Structural edits (adding blocks)
// aren't reflected — those need a full re-render — but text edits feel live.
// ---------------------------------------------------------------------------

/** `postMessage` type carrying in-progress field values into the preview. */
export const PREVIEW_VALUES_MESSAGE = "louise:preview-values";

export interface PreviewValuesMessage {
  type: typeof PREVIEW_VALUES_MESSAGE;
  /** Which document the values belong to — must match the preview's. */
  collection: string;
  id: number;
  /** Field key → current value (only string values patch text regions). */
  values: Record<string, unknown>;
}

/**
 * Patch tagged regions' text from in-progress field values. For each string
 * value, updates every `[data-louise-edit="collection:id:field"]` element's
 * `textContent`. Pure (takes the root to search), so it's unit-testable
 * without a live preview window.
 */
export function applyPreviewValues(
  root: ParentNode,
  target: { collection: string; id: number },
  values: Record<string, unknown>,
): void {
  for (const [field, value] of Object.entries(values)) {
    if (typeof value !== "string") continue;
    const attr = encodeEditRef({
      collection: target.collection,
      id: target.id,
      field,
    });
    for (const el of root.querySelectorAll(`[${EDIT_ATTR}="${attr}"]`)) {
      el.textContent = value;
    }
  }
}

export interface PreviewSyncOptions {
  /** The document this preview renders — messages for others are ignored. */
  collection: string;
  id: number;
  /** Where to search for tagged regions. Default `document`. */
  root?: ParentNode;
  /** Only accept messages from this origin (the editor). Default: any. */
  allowedOrigin?: string;
}

/**
 * Mount the live-preview receiver on a preview page (browser-only). Listens
 * for {@link PreviewValuesMessage} from the editor window and patches tagged
 * text regions via {@link applyPreviewValues}. Returns a cleanup function.
 */
export function mountPreviewSync(options: PreviewSyncOptions): () => void {
  const root = options.root ?? document;
  const handler = (event: MessageEvent) => {
    if (options.allowedOrigin && event.origin !== options.allowedOrigin) return;
    const data = event.data as Partial<PreviewValuesMessage> | null;
    if (data?.type !== PREVIEW_VALUES_MESSAGE) return;
    if (data.collection !== options.collection || data.id !== options.id) {
      return;
    }
    if (data.values) {
      applyPreviewValues(root, { collection: options.collection, id: options.id }, data.values);
    }
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

export interface VisualEditingOptions {
  /** Called with the decoded ref when an editable region is clicked. */
  onSelect?: (ref: EditRef, element: Element) => void;
  /**
   * Origin to `postMessage` the selection to the parent window. Default
   * `"*"`. Set to the editor origin in production.
   */
  targetOrigin?: string;
  /** Outline color for the hover highlight. Default a teal accent. */
  highlightColor?: string;
  /**
   * Resolve a stega-encoded {@link EditRef} from a text run (pass `stegaDecode`
   * from `louise-toolkit/stega`). When provided, the overlay ALSO hit-tests text
   * nodes: prose tagged invisibly via stega becomes a click target with no
   * wrapper element — in addition to the `data-louise-edit` element targets.
   * Kept as an injected callback so this module stays free of the optional
   * `@vercel/stega` dependency.
   */
  resolveStega?: (text: string) => EditRef | null;
}

/** The text node directly under a viewport point, or null. Feature-detects the
 *  two caret APIs (`caretRangeFromPoint` — WebKit/Blink; `caretPositionFromPoint`
 *  — Firefox/spec). */
function textNodeFromPoint(x: number, y: number): Text | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null;
  };
  let node: Node | null = null;
  if (typeof doc.caretRangeFromPoint === "function") {
    node = doc.caretRangeFromPoint(x, y)?.startContainer ?? null;
  } else if (typeof doc.caretPositionFromPoint === "function") {
    node = doc.caretPositionFromPoint(x, y)?.offsetNode ?? null;
  }
  return node && node.nodeType === Node.TEXT_NODE ? (node as Text) : null;
}

/**
 * Mount the click-to-edit overlay. Browser-only — call from a preview page's
 * client script. Highlights `[data-louise-edit]` elements on hover and, on
 * click, calls `onSelect` and posts a {@link VisualEditingMessage} to the
 * parent window. With `resolveStega`, also hit-tests stega-tagged text runs
 * (highlighted via a floating box, since a text node has no outline). Returns a
 * cleanup function that removes the listeners.
 */
export function mountVisualEditing(options: VisualEditingOptions = {}): () => void {
  const { onSelect, targetOrigin = "*", highlightColor = "#56c6be", resolveStega } = options;

  const closest = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    const el = target.closest(`[${EDIT_ATTR}]`);
    return el instanceof HTMLElement ? el : null;
  };

  let previous: { el: HTMLElement; outline: string } | null = null;
  const clearHighlight = () => {
    if (previous) {
      previous.el.style.outline = previous.outline;
      previous = null;
    }
  };

  // Floating highlight for stega text hits (a text run can't carry an outline).
  let stegaBox: HTMLElement | null = null;
  const showStegaBox = (rect: DOMRect) => {
    if (!stegaBox) {
      stegaBox = document.createElement("div");
      stegaBox.style.cssText =
        "position:fixed;pointer-events:none;z-index:2147483646;border-radius:2px";
      document.body.appendChild(stegaBox);
    }
    stegaBox.style.outline = `2px solid ${highlightColor}`;
    stegaBox.style.outlineOffset = "2px";
    stegaBox.style.left = `${rect.left}px`;
    stegaBox.style.top = `${rect.top}px`;
    stegaBox.style.width = `${rect.width}px`;
    stegaBox.style.height = `${rect.height}px`;
    stegaBox.style.display = "block";
  };
  const hideStegaBox = () => {
    if (stegaBox) stegaBox.style.display = "none";
  };

  // A stega text hit at a viewport point: the decoded ref + the run's rect.
  const stegaHit = (x: number, y: number): { ref: EditRef; rect: DOMRect; node: Text } | null => {
    if (!resolveStega) return null;
    const node = textNodeFromPoint(x, y);
    if (!node?.textContent) return null;
    const ref = resolveStega(node.textContent);
    if (!ref) return null;
    const range = document.createRange();
    range.selectNodeContents(node);
    return { ref, rect: range.getBoundingClientRect(), node };
  };

  const onOver = (event: Event) => {
    const el = closest(event.target);
    if (el) {
      hideStegaBox();
      if (el === previous?.el) return;
      clearHighlight();
      previous = { el, outline: el.style.outline };
      el.style.outline = `2px solid ${highlightColor}`;
      el.style.outlineOffset = "2px";
      el.style.cursor = "pointer";
      return;
    }
    clearHighlight();
    const hit = stegaHit((event as MouseEvent).clientX, (event as MouseEvent).clientY);
    if (hit) showStegaBox(hit.rect);
    else hideStegaBox();
  };

  const onClick = (event: Event) => {
    const el = closest(event.target);
    if (el) {
      const ref = decodeEditRef(el.getAttribute(EDIT_ATTR) ?? "");
      if (!ref) return;
      event.preventDefault();
      event.stopPropagation();
      onSelect?.(ref, el);
      window.parent?.postMessage(
        { type: VISUAL_EDIT_MESSAGE, ref } satisfies VisualEditingMessage,
        targetOrigin,
      );
      return;
    }
    const hit = stegaHit((event as MouseEvent).clientX, (event as MouseEvent).clientY);
    if (!hit) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect?.(hit.ref, hit.node.parentElement ?? document.body);
    window.parent?.postMessage(
      { type: VISUAL_EDIT_MESSAGE, ref: hit.ref } satisfies VisualEditingMessage,
      targetOrigin,
    );
  };

  document.addEventListener("mouseover", onOver, true);
  document.addEventListener("click", onClick, true);

  return () => {
    clearHighlight();
    if (stegaBox) {
      stegaBox.remove();
      stegaBox = null;
    }
    document.removeEventListener("mouseover", onOver, true);
    document.removeEventListener("click", onClick, true);
  };
}

// ---------------------------------------------------------------------------
// Clipboard guard: in edit/preview mode, rendered text carries an invisible
// stega payload (its source pointer). If an editor selects that text and copies
// it, the zero-width characters ride along into whatever they paste it into.
// Strip them on the way out — the same footgun Sanity's visual editing guards.
// ---------------------------------------------------------------------------

/**
 * Strip stega payloads from a copied selection's `text`/`html`, and report
 * whether anything was removed — so {@link mountStegaClipboardGuard} only
 * overrides the clipboard when a payload was actually present (an ordinary copy
 * is left to the browser). Pure, so the decision is testable without a live
 * `Selection`/`ClipboardEvent`.
 */
export function cleanCopiedStega(
  text: string,
  html: string,
): { text: string; html: string; changed: boolean } {
  const cleanText = stegaClean(text);
  const cleanHtml = stegaClean(html);
  return {
    text: cleanText,
    html: cleanHtml,
    changed: cleanText !== text || cleanHtml !== html,
  };
}

/** Dataset flag marking the copy guard as installed on a document. */
const STEGA_GUARD_FLAG = "louiseStegaGuard";

/**
 * Mount the clipboard guard (browser-only). Installs a capturing `copy` listener
 * that rewrites the copied `text/plain` (+ `text/html`) through {@link stegaClean}
 * — but only when a stega payload is present, so a normal copy is untouched.
 *
 * Idempotent: installs a single listener per document (which survives Astro soft
 * navigation, since the document persists), so it's safe to call on every mount.
 * References `document` lazily, so importing it server-side is harmless. Returns
 * a cleanup function. The edit client mounts this automatically; call it yourself
 * only if you wire visual editing by hand.
 */
export function mountStegaClipboardGuard(target: Document = document): () => void {
  const root = target.documentElement;
  if (root.dataset[STEGA_GUARD_FLAG] === "1") return () => {};
  root.dataset[STEGA_GUARD_FLAG] = "1";

  const onCopy = (event: ClipboardEvent) => {
    const data = event.clipboardData;
    const selection = target.getSelection();
    if (!data || !selection || selection.isCollapsed) return;

    // Stega can hide in the markup too — clean the selection's HTML, not just its
    // plain text. Build that HTML from the selected range(s).
    const fragment = target.createElement("div");
    for (let i = 0; i < selection.rangeCount; i++) {
      fragment.appendChild(selection.getRangeAt(i).cloneContents());
    }
    const { text, html, changed } = cleanCopiedStega(selection.toString(), fragment.innerHTML);
    if (!changed) return; // no payload — let the browser copy natively

    event.preventDefault();
    data.setData("text/plain", text);
    if (html) data.setData("text/html", html);
  };

  target.addEventListener("copy", onCopy, true);
  return () => {
    delete root.dataset[STEGA_GUARD_FLAG];
    target.removeEventListener("copy", onCopy, true);
  };
}
