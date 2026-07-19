// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// `<Collection>` — the typed list primitive (ADR 0003, item 3). It renders a list
// and hands each item to a render function that is FULLY TYPED, with no
// hand-written interface: the item type is inferred from `items`, so `item` in the
// slot carries whatever shape you passed.
//
//   <Collection items={artworks}>
//     {(art) => <WorkTile title={art.title} price={art.price} />}
//   </Collection>
//
// Why a Solid render-prop and not an `.astro` component: Astro slots can't type a
// per-item `{item}`, but a Solid children-as-function can — this is the only shape
// that delivers the ADR's "`{item}` in its slot is fully typed". Server-render it
// by using it inside a Solid island without a `client:*` directive: it emits
// static HTML and ships no JS. Add `client:load`/`client:visible` only if the list
// needs interactivity.
//
// On the item type + ADR 0003 §6 ("infers from the collection's Zod schema"):
// Louise's `CollectionConfig` is type-erased (`fields: Record<string,
// FieldConfig>`), so the item shape can't be recovered from the collection VALUE.
// Instead you type `items` from your data — per ADR 0001, a Zod-inferred query
// result — and it flows through to the slot. Same guarantee (a typed `item`),
// sourced from the data rather than the erased config.

import { For, type JSX } from "solid-js";

export interface CollectionProps<T> {
  /** The items to render, in order. The item type `T` is inferred from here. */
  items: readonly T[];
  /** Render one item — receives the fully-typed `item` and a reactive `index`. */
  children: (item: T, index: () => number) => JSX.Element;
  /** Rendered when `items` is empty. */
  fallback?: JSX.Element;
}

export function Collection<T>(props: CollectionProps<T>): JSX.Element {
  return (
    <For each={props.items} fallback={props.fallback}>
      {(item, index) => props.children(item, index)}
    </For>
  );
}
