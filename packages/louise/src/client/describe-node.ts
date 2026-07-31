// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// `describeNode` — the seam where the catalog meets the chrome (ADR 0010).
//
// The chrome asks one question of the editor: "given this path, what can that
// node do?" This answers it, and it is the ONLY place that knows a section from a
// block from a field. Keeping it here — pure, DOM-free, and unit-tested without
// mounting anything — is what lets the chrome stay ignorant.
//
// It is also where ADR 0010 Phase B lands: a node's `source` (page draft / shared
// settings / external) is resolved here and expressed as `tone`, so adding the
// reference rings changes this function and nothing in the chrome.

import { isInlineField } from "../core/content/field-types.js";
import type {
  BlockCatalog,
  SectionCatalog,
  SectionField,
  SectionItem,
} from "../core/content/sections.js";
import type { NodeDescriptor, NodePath } from "./node.js";

/** Everything `describeNode` needs to answer. Passed per call rather than closed
 *  over, so the editor can hand it live store state without this module holding a
 *  reference to it. */
export interface DescribeContext {
  items: SectionItem[];
  catalog: SectionCatalog;
  blocks?: BlockCatalog;
  /**
   * The site-settings keys that may be marked on the page as shared values
   * (ADR 0010 Phase B) — `data-louise-node="settings.<key>"`. A marked key
   * missing from this map resolves to `null`, exactly like a stale section
   * marker: better unmarked than a wrench over something the editor can't
   * actually edit.
   */
  shared?: Record<string, { label?: string }>;
}

/** The path head that addresses site settings instead of the page's `sections`
 *  JSON. A settings path carries no index, so reorders never re-stamp it —
 *  which is what lets these markers live outside the sections host (Nav,
 *  Footer) where nothing would re-stamp them. */
export const SHARED_PATH_HEAD = "settings";

/** Whether a section/block def has anything worth opening an inspector for.
 *
 *  Checked rather than assumed so the wrench doesn't appear over a panel reading
 *  "Nothing to configure here yet" — which is what a freshly added Content
 *  section showed in live QA, since its only field is an inline heading. */
function hasInspectableContent(def: {
  fields: Record<string, { type: string; inline?: boolean }>;
  layouts?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}): boolean {
  if (def.layouts && Object.keys(def.layouts).length > 0) return true;
  if (def.settings && Object.keys(def.settings).length > 0) return true;
  return Object.entries(def.fields).some(
    ([, f]) => f.type === "array" || !isInlineField(f as SectionField),
  );
}

/**
 * What chrome a FIELD node gets — and, crucially, when it gets none.
 *
 * Under the catalog-decides marker model (ADR 0010 A2) the render marks
 * everything editable, so this is now reached by a heading as well as by a CTA.
 * A heading is edited by clicking its text; a wrench over it would open a panel
 * with one control that does what clicking already does. So an INLINE field
 * resolves to `null` — no chrome — and the hit-test walks outward to ring
 * whatever contains it.
 *
 * That `null` is the reason `nodeAt` had to learn to walk outward. Under A1 it
 * meant "clear", which was correct only while solely ring-worthy things were
 * marked; now it means "not this one, keep looking".
 *
 * A missing field also resolves to `null` — a stale marker left by a fragment
 * swap, or a field the catalog dropped — so it reads as unmarked rather than as a
 * wrench over something that no longer exists.
 */
function describeField(field: SectionField | undefined, key: string): NodeDescriptor | null {
  if (!field) return null;
  if (isInlineField(field)) return null;
  return { fields: true, tone: "value", label: field.label ?? key };
}

/** The `blocks` array of a section item, when it is one. */
function blocksOf(item: SectionItem | undefined): SectionItem[] | undefined {
  const b = item?.blocks;
  return Array.isArray(b) ? (b as SectionItem[]) : undefined;
}

/**
 * What to CALL the thing that goes inside a container, when there's one answer.
 *
 * Only meaningful for a container accepting exactly one block type; a section
 * that takes several has no singular name for its children, and guessing one
 * would misname whichever the editor picks. The chrome falls back to a neutral
 * "one" in that case.
 *
 * Mirrors the editor's own `allowedBlockTypes`: bounded by the section's
 * `blocks.allow` when declared, otherwise the whole catalog (ADR 0005 §4 —
 * `allow` omitted means "any block type"), with types the catalog doesn't know
 * dropped, since those can't be inserted at all.
 */
function childLabel(
  policy: { allow?: string[] } | undefined,
  blocks: BlockCatalog | undefined,
): string | undefined {
  if (!policy || !blocks) return undefined;
  const allowed = Object.keys(blocks).filter((t) => !policy.allow || policy.allow.includes(t));
  return allowed.length === 1 ? blocks[allowed[0]]?.label : undefined;
}

/**
 * Resolve a node path against the catalog and the current items.
 *
 * Returns `null` for any path that doesn't address something the editor knows —
 * a stale marker left by a fragment swap, a hand-written one, or a field the
 * catalog dropped. The chrome treats that as unmarked.
 *
 * Four shapes are recognised, and they are the same four the pre-0010 chrome
 * handled with three attributes and two parsers:
 *
 *   [i]                    a section
 *   [i, "blocks", j]       a block
 *   [i, key]               a section's field
 *   [i, "blocks", j, key]  a block's field
 */
export function describeNode(path: NodePath, ctx: DescribeContext): NodeDescriptor | null {
  const [i, ...rest] = path;

  // ["settings", key] — a SHARED value (ADR 0010 Phase B): site settings
  // rendered on this page, one value with many surfaces. Wrench-only, like any
  // value node, but toned `shared` because editing it changes every surface at
  // once — the editor's inspector, not this descriptor, carries that warning.
  if (i === SHARED_PATH_HEAD) {
    if (rest.length !== 1 || typeof rest[0] !== "string") return null;
    const def = ctx.shared?.[rest[0]];
    if (!def) return null;
    return { fields: true, tone: "shared", label: def.label ?? rest[0] };
  }

  if (typeof i !== "number") return null;
  const item = ctx.items[i];
  if (!item) return null;
  const sectionDef = ctx.catalog[String(item._type)];
  if (!sectionDef) return null;

  // [i] — a section. Ordered within the page, and a container when its def opts
  // into the block layer AND the editor was given a block catalog to seed from.
  //
  // Tone is f(source) (ADR 0010 Phase B): a def declaring `source: "external"`
  // rings yellow — the page still owns its position and layout (so `ordered`
  // and `fields` are untouched), but its content mirrors a system the site
  // doesn't own, and the inspector says so.
  if (rest.length === 0) {
    const canHoldBlocks = !!sectionDef.blocks && !!ctx.blocks;
    const childName = childLabel(sectionDef.blocks, ctx.blocks);
    return {
      ordered: { index: i, count: ctx.items.length },
      ...(canHoldBlocks
        ? {
            children: {
              count: blocksOf(item)?.length ?? 0,
              ...(childName ? { label: childName } : {}),
            },
          }
        : {}),
      fields: hasInspectableContent(sectionDef),
      tone: sectionDef.source === "external" ? "external" : "section",
      label: sectionDef.label,
    };
  }

  // [i, key] — one of the section's own fields.
  if (rest.length === 1 && typeof rest[0] === "string") {
    return describeField(sectionDef.fields[rest[0]], rest[0]);
  }

  if (rest[0] !== "blocks" || typeof rest[1] !== "number") return null;
  const blocks = blocksOf(item);
  const block = blocks?.[rest[1]];
  if (!blocks || !block) return null;
  const blockDef = ctx.blocks?.[String(block._type)];
  if (!blockDef) return null;

  // [i, "blocks", j] — a block. Ordered within its section. Blocks do not declare
  // a `blocks` policy of their own today, so none is a container yet — but the
  // shape below is what makes nesting a data question rather than a code change.
  if (rest.length === 2) {
    return {
      ordered: { index: rest[1], count: blocks.length },
      fields: hasInspectableContent(blockDef),
      tone: "block",
      label: blockDef.label,
    };
  }

  // [i, "blocks", j, key] — one of the block's fields.
  if (rest.length === 3 && typeof rest[2] === "string") {
    return describeField(blockDef.fields[rest[2]], rest[2]);
  }

  return null;
}
