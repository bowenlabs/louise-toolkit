// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce — checking a stored cart against the live catalog,
// and repairing it.
//
// A cart outlives the catalog it was built from: a price changes, an item is
// retired, an add-on is deleted. Refusing the checkout is right — the server
// must never charge a number the customer didn't see — but refusing with only
// the FIRST problem is how a customer ends up in a loop: fix one line, retry,
// get refused over the next. So `cartIssues` reports every problem at once, with
// what the catalog says now, and `repairCart` applies all of them in one step.
//
// Both are pure. Fetching the live prices / stock / add-ons is the provider's
// job (e.g. `retrieveVariationPrices` + `retrieveLiveCatalogObjectIds` in
// `louise-toolkit/commerce/square`); wording the result for a customer is the
// site's. Nothing here assumes a currency, a quantity cap or a language.

/** A cart line as far as verification cares. Extra fields ride along untouched. */
export interface CartLine<M extends { id: string } = { id: string }> {
  variantId: string;
  quantity: number;
  /**
   * The unit price the customer was shown, in minor units — compared against
   * the live price as given. If modifiers are priced by the provider (Square
   * does), this is the BASE price and modifier prices are not compared.
   */
  unitPriceCents: number;
  /** Selected add-ons. Only their `id` is read; `name` etc. ride along. */
  modifiers?: M[];
}

export type CartIssue =
  /** The variant still sells, at a different price. `unitPriceCents` is now. */
  | { kind: "price-changed"; variantId: string; unitPriceCents: number; wasCents: number }
  /** The variant is gone from the catalog (or not sold where this order is placed). */
  | { kind: "unavailable"; variantId: string }
  /** The variant exists and is priced, but has no stock. */
  | { kind: "out-of-stock"; variantId: string }
  /** A selected add-on was deleted. The provider would reject the whole order. */
  | { kind: "modifier-unavailable"; modifierId: string };

export interface CatalogSnapshot {
  /** Live unit prices by variant id, minor units. A variant absent here is unavailable. */
  prices: ReadonlyMap<string, number>;
  /**
   * Variants that are priced but sold out. Checked BEFORE the price: a
   * sold-out variant usually still has one, and reading the price first would
   * let the charge through.
   */
  outOfStock?: ReadonlySet<string>;
  /**
   * Add-on ids that still exist. Omit to skip the add-on check entirely (for a
   * catalog without add-ons); pass an empty set to treat every add-on as gone.
   */
  liveModifierIds?: ReadonlySet<string>;
}

/**
 * Every way `lines` disagrees with the live catalog — not just the first — in
 * cart order, one issue per variant or add-on however many lines share it.
 * An empty array means the cart can be charged as shown.
 *
 * Validate the lines first (integer quantity ≥ 1, finite price): this compares
 * a well-formed cart against the catalog, it does not police input.
 */
export function cartIssues(lines: readonly CartLine[], catalog: CatalogSnapshot): CartIssue[] {
  const issues: CartIssue[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.variantId)) continue;
    seen.add(line.variantId);
    const live = catalog.prices.get(line.variantId);
    if (catalog.outOfStock?.has(line.variantId)) {
      issues.push({ kind: "out-of-stock", variantId: line.variantId });
    } else if (live === undefined) {
      issues.push({ kind: "unavailable", variantId: line.variantId });
    } else if (live !== line.unitPriceCents) {
      issues.push({
        kind: "price-changed",
        variantId: line.variantId,
        unitPriceCents: live,
        wasCents: line.unitPriceCents,
      });
    }
  }
  if (catalog.liveModifierIds) {
    const checked = new Set<string>();
    for (const line of lines) {
      for (const m of line.modifiers ?? []) {
        if (checked.has(m.id)) continue;
        checked.add(m.id);
        if (!catalog.liveModifierIds.has(m.id)) {
          issues.push({ kind: "modifier-unavailable", modifierId: m.id });
        }
      }
    }
  }
  return issues;
}

/** Every add-on id across `lines`, de-duplicated — what to ask the provider about. */
export function cartModifierIds(lines: readonly CartLine[]): string[] {
  return [...new Set(lines.flatMap((l) => (l.modifiers ?? []).map((m) => m.id)))];
}

/** What {@link repairCart} did, as data — the site words it for its customers. */
export type CartChange<L extends CartLine> =
  | { kind: "repriced"; line: L; fromCents: number; toCents: number }
  | { kind: "removed"; line: L; reason: "unavailable" | "out-of-stock" }
  | { kind: "modifier-removed"; line: L; modifier: NonNullable<L["modifiers"]>[number] }
  /**
   * Removing an add-on made `line` identical to `into`, so they were combined.
   * `droppedQuantity` is how much the cap cut off (0 when nothing was lost).
   */
  | { kind: "merged"; line: L; into: L; droppedQuantity: number };

export interface RepairCartOptions<L extends CartLine> {
  /**
   * What makes two lines "the same thing" — merged after an add-on is
   * removed. Default: the variant plus its sorted add-on ids.
   */
  key?: (line: L) => string;
  /** Per-line quantity cap applied when merging. Default: none. */
  maxQuantity?: number;
}

const defaultKey = (line: CartLine) =>
  `${line.variantId}|${(line.modifiers ?? [])
    .map((m) => m.id)
    .sort()
    .join(",")}`;

/**
 * Apply `issues` to `lines`: reprice changed variants, remove unavailable and
 * sold-out ones, strip deleted add-ons — then fold together any lines that
 * became identical. Returns the new lines (inputs are not mutated) and every
 * change made, in order, for the site to tell the customer about.
 */
export function repairCart<L extends CartLine>(
  lines: readonly L[],
  issues: readonly CartIssue[],
  options: RepairCartOptions<L> = {},
): { lines: L[]; changes: CartChange<L>[] } {
  const key = options.key ?? defaultKey;
  const cap = options.maxQuantity ?? Number.POSITIVE_INFINITY;
  const repriced = new Map<string, number>();
  const removed = new Map<string, "unavailable" | "out-of-stock">();
  const goneModifiers = new Set<string>();
  for (const issue of issues) {
    if (issue.kind === "price-changed") repriced.set(issue.variantId, issue.unitPriceCents);
    else if (issue.kind === "modifier-unavailable") goneModifiers.add(issue.modifierId);
    else removed.set(issue.variantId, issue.kind);
  }

  const out: L[] = [];
  const changes: CartChange<L>[] = [];
  for (const original of lines) {
    const reason = removed.get(original.variantId);
    if (reason) {
      changes.push({ kind: "removed", line: original, reason });
      continue;
    }
    let line: L = original;
    const price = repriced.get(line.variantId);
    if (price !== undefined && price !== line.unitPriceCents) {
      changes.push({
        kind: "repriced",
        line: original,
        fromCents: line.unitPriceCents,
        toCents: price,
      });
      line = { ...line, unitPriceCents: price };
    }
    const mods = line.modifiers;
    if (mods?.some((m) => goneModifiers.has(m.id))) {
      for (const m of mods) {
        if (goneModifiers.has(m.id))
          changes.push({ kind: "modifier-removed", line: original, modifier: m });
      }
      line = { ...line, modifiers: mods.filter((m) => !goneModifiers.has(m.id)) };
    }
    const twinIndex = out.findIndex((o) => key(o) === key(line));
    if (twinIndex >= 0) {
      const twin = out[twinIndex] as L;
      const total = twin.quantity + line.quantity;
      const merged = { ...twin, quantity: Math.min(cap, total) };
      out[twinIndex] = merged;
      changes.push({
        kind: "merged",
        line: original,
        into: merged,
        droppedQuantity: total - merged.quantity,
      });
    } else {
      out.push(line);
    }
  }
  return { lines: out, changes };
}
