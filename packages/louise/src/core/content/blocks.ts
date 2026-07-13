// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

/**
 * Renderer registry for block/document content (issue #13) — adopts the
 * Portable Text + `@portabletext/react` pattern (idea, not code): a content
 * document is a serializable **array of typed blocks**, and rendering is a
 * lookup of `block.type → renderer`, not a hand-rolled `switch`. Adding a
 * new block type becomes "register a renderer" with no edit to a central
 * branch.
 *
 * Framework-agnostic on purpose: `TRenderer` is whatever a host wants a
 * block's renderer to be — a string-producing function (SSR/preview HTML),
 * an Astro component, a Solid component, etc. The registry only does lookup,
 * fallback, and introspection; it never assumes a rendering technology.
 */

/**
 * The minimal shape every block must have: a string discriminant under
 * `type`. (Portable Text uses `_type`; Louise content is TipTap-JSON-shaped
 * and already keyed on `type`, so the registry keys on `type` to stay
 * drop-in with stored content — the editor can stay TipTap.)
 */
export interface PortableBlockLike {
  type: string;
}

export interface BlockRegistry<TRenderer> {
  /** Register (or replace) the renderer for a block type. Chainable. */
  register(type: string, renderer: TRenderer): BlockRegistry<TRenderer>;
  /** Register several at once. Chainable. */
  registerMany(renderers: Record<string, TRenderer>): BlockRegistry<TRenderer>;
  /** The renderer registered for `type`, or `undefined`. */
  get(type: string): TRenderer | undefined;
  /** Whether a renderer is registered for `type`. */
  has(type: string): boolean;
  /** Every registered block type, in registration order. */
  types(): string[];
  /** Set the fallback used when a type has no registered renderer. Chainable. */
  setFallback(renderer: TRenderer): BlockRegistry<TRenderer>;
  /** The renderer for `type`, else the fallback, else `undefined`. */
  resolve(type: string): TRenderer | undefined;
}

/**
 * Create a block renderer registry. Seed it with an initial `type → renderer`
 * map and/or an `options.fallback` for unknown types.
 *
 * ```ts
 * const registry = createBlockRegistry<StringBlockRenderer>({
 *   divider: () => "<hr>",
 * });
 * registry.register("hero", (b) => `<h1>${b.heading}</h1>`);
 * renderBlocksToString(blocks, registry);
 * ```
 */
export function createBlockRegistry<TRenderer>(
  initial: Record<string, TRenderer> = {},
  options: { fallback?: TRenderer } = {},
): BlockRegistry<TRenderer> {
  const renderers = new Map<string, TRenderer>(Object.entries(initial));
  let fallback = options.fallback;

  const registry: BlockRegistry<TRenderer> = {
    register(type, renderer) {
      renderers.set(type, renderer);
      return registry;
    },
    registerMany(map) {
      for (const [type, renderer] of Object.entries(map)) {
        renderers.set(type, renderer);
      }
      return registry;
    },
    get(type) {
      return renderers.get(type);
    },
    has(type) {
      return renderers.has(type);
    },
    types() {
      return [...renderers.keys()];
    },
    setFallback(renderer) {
      fallback = renderer;
      return registry;
    },
    resolve(type) {
      return renderers.get(type) ?? fallback;
    },
  };
  return registry;
}

/**
 * A renderer that turns one block into an HTML string — the registry value
 * type for SSR/preview paths that build markup as strings (e.g. a Hono
 * preview route) rather than mounting components.
 */
export type StringBlockRenderer<TBlock extends PortableBlockLike = PortableBlockLike> = (
  block: TBlock,
) => string;

/**
 * Render an array of blocks to a single HTML string via a registry of
 * {@link StringBlockRenderer}s. Blocks whose type resolves to no renderer
 * (and no fallback) contribute the empty string — the same forgiving
 * behavior the old hand-rolled `switch` had for unknown types.
 */
export function renderBlocksToString<TBlock extends PortableBlockLike>(
  blocks: readonly TBlock[],
  registry: BlockRegistry<StringBlockRenderer<TBlock>>,
): string {
  return blocks
    .map((block) => {
      const renderer = registry.resolve(block.type);
      return renderer ? renderer(block) : "";
    })
    .join("");
}
