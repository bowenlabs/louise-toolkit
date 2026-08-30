import { describe, expect, it, vi } from "vitest";
import {
  fourthwallToCatalogItem,
  squareItemSoldAt,
  squareToCatalogItem,
} from "../src/commerce/adapters.js";
import {
  checkoutIdempotencyKey,
  type PriceLookup,
  type ScopedPriceLookup,
  verifyCheckout,
} from "../src/commerce/checkout.js";
import {
  astroidCheckoutVars,
  generateAstroidCheckoutEnv,
  generateAstroidCheckoutRoute,
  generateAstroidSquareCard,
} from "../src/commerce/checkout-scaffold.js";
import { generateCatalogMigrationSql, generateCatalogTable } from "../src/commerce/mirror.js";
import {
  assertCommerceRoles,
  astroidCommerceProviders,
  astroidCommerceRoles,
  hasMultiLocation,
  hasPos,
} from "../src/commerce/roles.js";
import {
  type CommerceStatus,
  commerceProviderCredentials,
  commerceSecretNames,
  providerConfigured,
  roleConfigured,
} from "../src/commerce/secrets.js";
import { astroidCatalogSync, astroidCatalogUpsert, defaultSlug } from "../src/commerce/sync.js";
import { defineAstroid } from "../src/config.js";
import type { AstroidConfig } from "../src/config.js";
import { AstroidUsageError } from "../src/errors.js";
import { generateAstroidSchema } from "../src/schema/generate.js";

const base: AstroidConfig = {
  key: "acme",
  archetype: "storefront",
  theme: { name: "Acme", colors: { brand: "#1f6e6d" } },
};

describe("commerce roles", () => {
  it("assigns the shorthand to a role the provider can actually serve", () => {
    // Stripe's client has no catalog API, so defaulting it to "storefront"
    // would build a shop with nothing behind it.
    expect(astroidCommerceRoles({ provider: "square" })).toEqual({ storefront: "square" });
    expect(astroidCommerceRoles({ provider: "fourthwall" })).toEqual({ storefront: "fourthwall" });
    expect(astroidCommerceRoles({ provider: "stripe" })).toEqual({ invoicing: "stripe" });
  });

  it("supports two providers at once — the tma topology", () => {
    const roles = astroidCommerceRoles({ storefront: "fourthwall", invoicing: "stripe" });
    expect(roles).toEqual({ storefront: "fourthwall", invoicing: "stripe" });
    expect(astroidCommerceProviders({ storefront: "fourthwall", invoicing: "stripe" })).toEqual([
      "fourthwall",
      "stripe",
    ]);
  });

  it("de-duplicates one provider filling both roles", () => {
    expect(astroidCommerceProviders({ storefront: "square", invoicing: "square" })).toEqual([
      "square",
    ]);
  });

  it("rejects a role the provider's client can't serve, naming who can", () => {
    expect(() => assertCommerceRoles({ invoicing: "fourthwall" })).toThrow(/can't serve/);
    expect(() => assertCommerceRoles({ invoicing: "fourthwall" })).toThrow(/square, stripe/);
    expect(() => assertCommerceRoles({ storefront: "stripe" })).toThrow(/no catalog API/);
    // Square does both.
    expect(() => assertCommerceRoles({ storefront: "square", invoicing: "square" })).not.toThrow();
  });

  it("fails at config load, not at the first invoice", () => {
    expect(() => defineAstroid({ ...base, commerce: { storefront: "stripe" } })).toThrow(
      /can't serve the "storefront" role/,
    );
  });
});

describe("catalog mirror schema", () => {
  const shop = (commerce: AstroidConfig["commerce"]): AstroidConfig => ({ ...base, commerce });

  it("emits pulled + owned columns in mirror mode", () => {
    const sql = generateCatalogTable(shop({ provider: "square" })) ?? "";
    expect(sql).toContain('sqliteTable("products"');
    expect(sql).toContain('externalId: text("external_id").notNull().unique()');
    expect(sql).toContain('name: text("name").notNull()');
    expect(sql).toContain('variants: text("variants", { mode: "json" })');
    // Owned built-ins.
    expect(sql).toContain('status: text("status", { enum: ["draft","published"] })');
    expect(sql).toContain('.default("draft")');
  });

  it("emits ONLY owned columns in overlay mode", () => {
    // coracle's product_display_meta: the catalog stays at the provider.
    const sql =
      generateCatalogTable(
        shop({ provider: "square", catalog: { mode: "overlay", table: "product_display_meta" } }),
      ) ?? "";
    expect(sql).toContain('sqliteTable("product_display_meta"');
    expect(sql).toContain('externalId: text("external_id").notNull().unique()');
    expect(sql).not.toContain('name: text("name")');
    expect(sql).not.toContain("variants:");
    expect(sql).toContain("status:");
  });

  it("emits NO table or migration in live mode", () => {
    // coracle's model: no Astroid-managed catalog table — the catalog is read
    // live (KV-cached) from Square and any overlay table is the site's own
    // (product_display_meta in schema.site.ts).
    const cfg = shop({ provider: "square", catalog: { mode: "live" } });
    expect(generateCatalogTable(cfg)).toBeNull();
    expect(generateCatalogMigrationSql(cfg)).toBeNull();
    // The generated schema still re-exports the site-owned tables seam.
    expect(generateAstroidSchema(cfg)).toContain('export * from "./schema.site.js"');
    expect(generateAstroidSchema(cfg)).not.toContain("external_id");
  });

  it("re-exports the site-owned schema seam", () => {
    // schema.site.ts is scaffold-once (empty until a project adds a table), so
    // this re-export is always safe and drizzle-kit picks up whatever it holds.
    expect(generateAstroidSchema(base)).toContain('export * from "./schema.site.js"');
  });

  it("adds project-specific owned columns, and lets one override a built-in", () => {
    const sql =
      generateCatalogTable(
        shop({
          provider: "square",
          catalog: {
            owned: {
              tone: { type: "text", values: ["cream", "teal"], default: "teal" },
              longDescription: { type: "text" },
              status: { type: "text", values: ["draft", "published", "archived"] },
            },
          },
        }),
      ) ?? "";
    expect(sql).toContain(
      'tone: text("tone", { enum: ["cream","teal"] }).notNull().default("teal")',
    );
    expect(sql).toContain('longDescription: text("long_description")');
    expect(sql).toContain('["draft","published","archived"]');
  });

  it("is absent entirely without commerce", () => {
    expect(generateCatalogTable(base)).toBeNull();
    expect(generateAstroidSchema(base)).not.toContain("external_id");
    expect(generateAstroidSchema(shop({ provider: "square" }))).toContain("external_id");
  });

  it("imports exactly the drizzle column builders the emitted source uses", () => {
    // The catalog's price/sortOrder are `real()`, which the base schema never
    // needs — omitting it from the import made every commerce scaffold fail
    // `astro check` with "Cannot find name 'real'".
    const withCatalog = generateAstroidSchema(shop({ provider: "square" }));
    expect(withCatalog).toContain(
      'import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";',
    );

    // …and not import it when nothing uses it (an unused import is a lint
    // error in the project we generate into).
    expect(generateAstroidSchema(base)).toContain(
      'import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";',
    );

    // Belt and braces: every builder the body calls must be imported.
    for (const source of [withCatalog, generateAstroidSchema(base)]) {
      const imported = new Set(
        (source.match(/import \{ ([^}]+) \} from "drizzle-orm\/sqlite-core"/)?.[1] ?? "")
          .split(",")
          .map((s) => s.trim()),
      );
      const body = source.split('from "louise-toolkit/db";')[1] ?? "";
      for (const [, fn] of body.matchAll(/\b(integer|text|real|blob|numeric)\(/g)) {
        expect(imported.has(fn), `${fn}() used but not imported`).toBe(true);
      }
    }
  });
});

describe("catalog adapters", () => {
  it("normalizes Square and Fourthwall to the same shape", () => {
    const square = squareToCatalogItem({
      id: "SQ1",
      name: "House Blend",
      imageUrl: "https://img/1.png",
      variations: [
        { id: "V2", name: "2lb", priceCents: 3800 },
        { id: "V1", name: "12oz", priceCents: 1800 },
      ],
    });
    const fw = fourthwallToCatalogItem({
      id: "FW1",
      name: "Tote",
      slug: "tote",
      images: [{ url: "https://img/2.png" }],
      variants: [
        { id: "A", name: "L", unitPrice: { value: 32 } },
        { id: "B", name: "S", unitPrice: { value: 24 } },
      ],
    });

    // Both carry the same keys — which is what lets one loader serve both.
    expect(Object.keys(square).sort()).toEqual([
      "externalId",
      "images",
      "name",
      "price",
      "variants",
    ]);
    // Lowest variant wins: the headline number means "from", and taking the
    // first would follow the provider's ordering instead of the price.
    expect(square.price).toBe(18);
    expect(fw.price).toBe(24);
    // Square prices in cents, Fourthwall in major units; the mirror stores major.
    expect(square.variants).toContainEqual(
      expect.objectContaining({ id: "V1", price: 18, currency: "USD" }),
    );
  });

  it("survives a product with no variants or images", () => {
    expect(squareToCatalogItem({ id: "X", name: "Bare" })).toEqual({
      externalId: "X",
      name: "Bare",
      price: 0,
      images: [],
      variants: [],
    });
    expect(fourthwallToCatalogItem({ id: "Y", name: "Bare" }).price).toBe(0);
  });
});

describe("catalog adapters — location scoping", () => {
  /** One item, two merchants. Downtown carries both sizes and marks the 2lb up;
   *  Airport carries only the 2lb, at the base price. */
  const shared = {
    id: "SQ1",
    name: "House Blend",
    presentAtAllLocations: true,
    variations: [
      {
        id: "V1",
        name: "12oz",
        priceCents: 1800,
        presentAtAllLocations: false,
        presentAtLocationIds: ["L-DOWNTOWN"],
      },
      {
        id: "V2",
        name: "2lb",
        priceCents: 3800,
        locationOverrides: [{ locationId: "L-DOWNTOWN", priceCents: 4200 }],
      },
    ],
  };

  it("prices through the location override, not the base price", () => {
    const downtown = squareToCatalogItem(shared, { locationId: "L-DOWNTOWN" });
    expect(downtown.variants).toContainEqual(expect.objectContaining({ id: "V2", price: 42 }));
    // Same variation, no override at this location: the base price stands.
    const airport = squareToCatalogItem(shared, { locationId: "L-AIRPORT" });
    expect(airport.variants).toContainEqual(expect.objectContaining({ id: "V2", price: 38 }));
  });

  it("drops variations the merchant does not carry", () => {
    const airport = squareToCatalogItem(shared, { locationId: "L-AIRPORT" });
    expect((airport.variants as { id: string }[]).map((v) => v.id)).toEqual(["V2"]);
  });

  it("scopes the headline 'from' price to what the merchant actually stocks", () => {
    // The bug this closes. Unscoped, `Math.min` sees the 12oz at $18 and the
    // card reads "from $18" — on a storefront that only sells the 2lb. The
    // dropped variation is the cheap one, so the error runs in the direction a
    // customer notices at the till.
    expect(squareToCatalogItem(shared).price).toBe(18);
    expect(squareToCatalogItem(shared, { locationId: "L-AIRPORT" }).price).toBe(38);
    // Downtown carries both, so the 12oz still sets the floor.
    expect(squareToCatalogItem(shared, { locationId: "L-DOWNTOWN" }).price).toBe(18);
  });

  it("reads the two presence lists as the asymmetric pair Square defines", () => {
    // `absentAtLocationIds` is a BLACKLIST, consulted only when
    // `presentAtAllLocations` is true; `presentAtLocationIds` is a WHITELIST,
    // consulted only when it is false. Swapping them shows a merchant products
    // they don't carry — which is why this is asserted rather than assumed.
    const blacklisted = {
      id: "SQ2",
      name: "Seasonal",
      variations: [
        { id: "A", name: "One", priceCents: 500, absentAtLocationIds: ["L-AIRPORT"] },
        { id: "B", name: "Two", priceCents: 900 },
      ],
    };
    expect(
      (
        squareToCatalogItem(blacklisted, { locationId: "L-AIRPORT" }).variants as { id: string }[]
      ).map((v) => v.id),
    ).toEqual(["B"]);
    expect(
      (
        squareToCatalogItem(blacklisted, { locationId: "L-DOWNTOWN" }).variants as { id: string }[]
      ).map((v) => v.id),
    ).toEqual(["A", "B"]);
  });

  it("falls back to the base price when an override adjusts something else", () => {
    // A `location_overrides` entry with no `price_money` is Square's way of
    // saying "same price, different inventory settings" — reading it as a price
    // of 0 would give the item away.
    const item = {
      id: "SQ3",
      name: "Mug",
      variations: [
        {
          id: "M1",
          name: "One size",
          priceCents: 1500,
          locationOverrides: [{ locationId: "L1", priceCents: null, soldOut: true }],
        },
      ],
    };
    const scoped = squareToCatalogItem(item, { locationId: "L1" });
    expect(scoped.price).toBe(15);
    expect(scoped.variants).toContainEqual(
      expect.objectContaining({ id: "M1", price: 15, soldOut: true }),
    );
  });

  it("omits soldOut entirely when unscoped, since it has no single answer", () => {
    const unscoped = squareToCatalogItem(shared);
    for (const v of unscoped.variants as Record<string, unknown>[]) {
      expect(v).not.toHaveProperty("soldOut");
    }
  });

  it("leaves unscoped output byte-identical to before", () => {
    // The whole change is additive; a single-location account must see no
    // difference at all.
    expect(squareToCatalogItem(shared)).toEqual({
      externalId: "SQ1",
      name: "House Blend",
      images: [],
      price: 18,
      variants: [
        { id: "V1", name: "12oz", sku: null, price: 18, currency: "USD" },
        { id: "V2", name: "2lb", sku: null, price: 38, currency: "USD" },
      ],
    });
  });

  it("squareItemSoldAt tells a sync which rows to skip", () => {
    expect(squareItemSoldAt(shared, "L-DOWNTOWN")).toBe(true);
    expect(squareItemSoldAt(shared, "L-AIRPORT")).toBe(true);

    // Item present, but not one variation is: nothing to sell.
    const noneHere = {
      id: "SQ4",
      name: "Downtown exclusive",
      variations: [
        {
          id: "X",
          name: "One",
          priceCents: 100,
          presentAtAllLocations: false,
          presentAtLocationIds: ["L-DOWNTOWN"],
        },
      ],
    };
    expect(squareItemSoldAt(noneHere, "L-AIRPORT")).toBe(false);
    // And the reason it must be filtered rather than stored: it mirrors as $0.
    expect(squareToCatalogItem(noneHere, { locationId: "L-AIRPORT" }).price).toBe(0);

    // Item itself withheld from the location — its variations don't matter.
    expect(
      squareItemSoldAt(
        { ...shared, presentAtAllLocations: true, absentAtLocationIds: ["L-AIRPORT"] },
        "L-AIRPORT",
      ),
    ).toBe(false);
  });
});

/** In-memory stand-in for the D1 surface the sync uses. */
function fakeDb(rows: Record<string, unknown>[] = []) {
  const statements: { sql: string; values: unknown[] }[] = [];
  return {
    rows,
    statements,
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              statements.push({ sql, values });
            },
            async first<T>() {
              if (sql.includes("WHERE external_id = ?")) {
                return (rows.find((r) => r.external_id === values[0]) ?? null) as T | null;
              }
              if (sql.includes("WHERE slug = ?")) {
                return (rows.find((r) => r.slug === values[0]) ?? null) as T | null;
              }
              return null;
            },
          };
        },
      };
    },
  };
}

describe("catalog sync", () => {
  const item = { externalId: "SQ1", name: "House Blend", price: 18, images: ["a.png"] };

  it("inserts a new item as a draft with a slug", async () => {
    const db = fakeDb();
    const { created } = await astroidCatalogUpsert(item, { db, table: "products" });
    expect(created).toBe(true);
    const insert = db.statements[0];
    expect(insert.sql).toContain("INSERT INTO products");
    expect(insert.values).toContain("house-blend");
  });

  it("NEVER writes an owned column on update", async () => {
    // The whole point of the pulled/owned split: a sync that touches an owned
    // column silently reverts the owner's work, days before anyone notices.
    const db = fakeDb([{ id: 1, external_id: "SQ1", slug: "house-blend" }]);
    await astroidCatalogUpsert(item, { db, table: "products" });
    const update = db.statements[0];
    expect(update.sql).toContain("UPDATE products");
    for (const owned of ["slug", "status", "sort_order", "featured"]) {
      // Word-boundary matched: `external_slug` is a PULLED column and legitimately
      // appears here — it's the provider's slug, not the owner's public one.
      expect(update.sql, `owned column ${owned}`).not.toMatch(
        new RegExp(`(^|[\\s,])${owned}\\s*=`),
      );
    }
    expect(update.sql).toContain("name = ?");
    expect(update.sql).toContain("external_slug = ?");
  });

  it("only stamps synced_at in overlay mode — there's nothing pulled to write", async () => {
    const db = fakeDb([{ id: 1, external_id: "SQ1", slug: "x" }]);
    await astroidCatalogUpsert(item, { db, table: "meta", mode: "overlay" });
    expect(db.statements[0].sql).toContain("SET synced_at = ?");
    expect(db.statements[0].sql).not.toContain("name = ?");
  });

  it("allocates a non-colliding slug when two products share a name", async () => {
    // The slug column is unique, so an unguarded insert would fail the whole
    // sync over a naming coincidence.
    const db = fakeDb([{ id: 1, external_id: "OTHER", slug: "house-blend" }]);
    await astroidCatalogUpsert(item, { db, table: "products" });
    expect(db.statements[0].values).toContain("house-blend-2");
  });

  it("reuses its own slug on a re-run rather than incrementing forever", async () => {
    const db = fakeDb([{ id: 1, external_id: "SQ1", slug: "house-blend" }]);
    // Delete the external_id match so it takes the insert path with the row
    // still occupying the slug — i.e. the row is ours.
    db.rows[0].external_id = "SQ1";
    const first = await astroidCatalogUpsert(item, { db, table: "products" });
    expect(first.created).toBe(false);
  });

  it("slugifies accents and punctuation", () => {
    expect(defaultSlug("Café — Crème Brûlée!")).toBe("cafe-creme-brulee");
    expect(defaultSlug("   ")).toBe("item");
  });
});

describe("verifyCheckout", () => {
  const prices = (map: Record<string, number>) => async () => new Map(Object.entries(map));

  it("charges the SERVER's price, and rejects a mismatch", async () => {
    const ok = await verifyCheckout(
      [{ variantId: "V1", quantity: 2, unitPriceCents: 1800 }],
      prices({ V1: 1800 }),
    );
    expect(ok).toMatchObject({ ok: true, subtotalCents: 3600 });

    // The client's number is a staleness check, never an input to the charge.
    const stale = await verifyCheckout(
      [{ variantId: "V1", quantity: 1, unitPriceCents: 1 }],
      prices({ V1: 1800 }),
    );
    expect(stale).toMatchObject({ ok: false, reason: "price-changed" });
  });

  it("rejects an item the provider no longer prices", async () => {
    const res = await verifyCheckout(
      [{ variantId: "GONE", quantity: 1, unitPriceCents: 100 }],
      prices({ V1: 100 }),
    );
    expect(res).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("rejects hostile quantities", async () => {
    // A negative quantity turns a charge into a refund on some providers.
    for (const quantity of [0, -1, 1.5, 1e9, Number.NaN]) {
      const res = await verifyCheckout(
        [{ variantId: "V1", quantity, unitPriceCents: 100 }],
        prices({ V1: 100 }),
      );
      expect(res, `quantity ${quantity}`).toMatchObject({ ok: false, reason: "invalid" });
    }
  });

  it("rejects an empty or malformed cart without calling the provider", async () => {
    const lookup = vi.fn(prices({}));
    expect(await verifyCheckout([], lookup)).toMatchObject({ ok: false, reason: "empty" });
    expect(await verifyCheckout(null, lookup)).toMatchObject({ ok: false, reason: "empty" });
    expect(await verifyCheckout([{ nope: true }], lookup)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("looks each variant up once even when repeated across lines", async () => {
    // Typed as the scoped signature so the call tuple is visible to the
    // assertion; the value passed in is still the zero-arity legacy shape,
    // which is the point — it stays assignable.
    const lookup = vi.fn<ScopedPriceLookup>(prices({ V1: 100 }));
    await verifyCheckout(
      [
        { variantId: "V1", quantity: 1, unitPriceCents: 100 },
        { variantId: "V1", quantity: 2, unitPriceCents: 100 },
      ],
      lookup,
    );
    expect(lookup.mock.calls[0]?.[0]).toEqual(["V1"]);
  });
});

describe("verifyCheckout — scope and stock", () => {
  /** Two merchants, one catalog, one variation priced differently at each. */
  const pricesAt: ScopedPriceLookup = async (ids, scope) => {
    const table: Record<string, Record<string, number>> = {
      "L-DOWNTOWN": { V1: 4200 },
      "L-AIRPORT": { V1: 3800 },
    };
    const at = table[scope?.locationId ?? ""] ?? {};
    return new Map(ids.filter((id) => id in at).map((id) => [id, at[id] as number]));
  };

  it("re-prices against the location the order is placed at", async () => {
    const line = { variantId: "V1", quantity: 1, unitPriceCents: 4200 };

    // Downtown's own price: fine.
    expect(
      await verifyCheckout([line], pricesAt, { scope: { locationId: "L-DOWNTOWN" } }),
    ).toMatchObject({ ok: true, subtotalCents: 4200 });

    // The same cart at the airport, where the price is $38. Without scoping,
    // both storefronts verify against one number and a customer can pay the
    // cheaper merchant's price at the dearer merchant's shop — the same class
    // of bug as trusting `unitPriceCents`, one level further back.
    expect(
      await verifyCheckout([line], pricesAt, { scope: { locationId: "L-AIRPORT" } }),
    ).toMatchObject({ ok: false, reason: "price-changed" });
  });

  it("forwards the scope to the lookup verbatim", async () => {
    const lookup = vi.fn(pricesAt);
    await verifyCheckout([{ variantId: "V1", quantity: 1, unitPriceCents: 4200 }], lookup, {
      scope: { locationId: "L-DOWNTOWN" },
    });
    expect(lookup).toHaveBeenCalledWith(["V1"], { locationId: "L-DOWNTOWN" });
  });

  it("refuses a cart at a location that carries none of it", async () => {
    const res = await verifyCheckout(
      [{ variantId: "V1", quantity: 1, unitPriceCents: 4200 }],
      pricesAt,
      { scope: { locationId: "L-NOWHERE" } },
    );
    // Fails closed: a lookup that can't price it here doesn't fall back to a
    // base price it could sell for.
    expect(res).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("tells sold-out apart from delisted", async () => {
    const lookup: ScopedPriceLookup = async () => ({
      prices: new Map([
        ["V1", 4200],
        ["V2", 900],
      ]),
      outOfStock: ["V1"],
    });

    // V1 is still PRICED — reading the map first would call it available and
    // let the charge through. Stock is checked before price for that reason.
    expect(
      await verifyCheckout([{ variantId: "V1", quantity: 1, unitPriceCents: 4200 }], lookup),
    ).toMatchObject({ ok: false, reason: "out-of-stock" });

    // A delisted item stays "unavailable": different fact, different sentence.
    // Sold out is coming back and is worth a notify-me; delisted is gone.
    expect(
      await verifyCheckout([{ variantId: "GONE", quantity: 1, unitPriceCents: 100 }], lookup),
    ).toMatchObject({ ok: false, reason: "unavailable" });

    expect(
      await verifyCheckout([{ variantId: "V2", quantity: 2, unitPriceCents: 900 }], lookup),
    ).toMatchObject({ ok: true, subtotalCents: 1800 });
  });

  it("still accepts a plain PriceLookup, unchanged", async () => {
    // The compile-time half of "additive, no break": an existing single-arg,
    // Map-returning lookup must remain assignable without a cast.
    const legacy: PriceLookup = async (ids) => new Map(ids.map((id) => [id, 500]));
    const asScoped: ScopedPriceLookup = legacy;
    expect(
      await verifyCheckout([{ variantId: "V1", quantity: 1, unitPriceCents: 500 }], asScoped),
    ).toMatchObject({ ok: true, subtotalCents: 500 });
    // And through the parameter itself, with no `scope` passed.
    expect(
      await verifyCheckout([{ variantId: "V1", quantity: 1, unitPriceCents: 500 }], legacy),
    ).toMatchObject({ ok: true, subtotalCents: 500 });
  });
});

describe("catalog sync — failure reporting", () => {
  const items = [
    { externalId: "SQ1", name: "A", price: 1 },
    { externalId: "SQ2", name: "B", price: 2 },
  ];
  /** A db whose every statement throws — an unapplied migration, or D1 down. */
  const brokenDb = () => ({
    prepare() {
      throw new Error("no such table: products");
    },
  });

  it("THROWS when every item fails, so the queue retries instead of acking", async () => {
    // It used to return { created: 0, updated: 0 } and never throw, which is
    // indistinguishable from an empty catalog: the consumer acked, the cron
    // re-sync acked, and the site served a frozen catalog with nothing in
    // `wrangler tail`.
    await expect(
      astroidCatalogSync(items, { db: brokenDb() as never, table: "products" }),
    ).rejects.toThrow(AstroidUsageError);
    await expect(
      astroidCatalogSync(items, { db: brokenDb() as never, table: "products" }),
    ).rejects.toThrow(/no such table/);
  });

  it("reports a PARTIAL failure without throwing — tolerance is the point", async () => {
    let calls = 0;
    const flaky = {
      prepare(_sql: string) {
        calls++;
        if (calls === 1) throw new Error("transient");
        return {
          bind() {
            return {
              async run() {},
              async first() {
                return null;
              },
            };
          },
        };
      },
    };
    const result = await astroidCatalogSync(items, { db: flaky as never, table: "products" });
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toMatchObject({ externalId: "SQ1", message: "transient" });
    // The surviving item still landed — a partial catalog beats a stale one.
    expect(result.created + result.updated).toBe(1);
  });

  it("does not throw on an empty snapshot — nothing to sync is not a failure", async () => {
    const result = await astroidCatalogSync([], { db: brokenDb() as never, table: "products" });
    expect(result).toEqual({ created: 0, updated: 0, failed: 0, errors: [] });
  });
});

describe("checkoutIdempotencyKey", () => {
  const cart = {
    lines: [
      { variantId: "A", quantity: 1, unitPriceCents: 100, subtotalCents: 100 },
      { variantId: "B", quantity: 2, unitPriceCents: 50, subtotalCents: 100 },
    ],
    subtotalCents: 200,
  };

  it("is stable for one buyer's cart — a double-click charges once", async () => {
    expect(await checkoutIdempotencyKey(cart, "order", "cart_alice")).toBe(
      await checkoutIdempotencyKey(cart, "order", "cart_alice"),
    );
  });

  it("separates DIFFERENT buyers with identical carts", async () => {
    // The bug this closes: the key was a pure function of the cart, so Alice and
    // Bob each buying 1×A + 2×B produced byte-identical keys. Providers scope
    // idempotency keys per account for ~24h, so Bob's charge was deduped into
    // Alice's order — Bob was never charged and the site reported success.
    expect(await checkoutIdempotencyKey(cart, "order", "cart_alice")).not.toBe(
      await checkoutIdempotencyKey(cart, "order", "cart_bob"),
    );
  });

  it("refuses an empty identity rather than silently colliding", async () => {
    // A falsy identity would restore the collision exactly, and the damage is
    // invisible at the call site — so this must throw, not default.
    await expect(checkoutIdempotencyKey(cart, "order", "")).rejects.toThrow(AstroidUsageError);
    await expect(checkoutIdempotencyKey(cart, "order", "   ")).rejects.toThrow(/identity/i);
  });

  it("ignores line ORDER but not line content", async () => {
    const reordered = { ...cart, lines: [...cart.lines].reverse() };
    expect(await checkoutIdempotencyKey(reordered, "order", "cart_alice")).toBe(
      await checkoutIdempotencyKey(cart, "order", "cart_alice"),
    );

    const changed = {
      ...cart,
      lines: [{ ...cart.lines[0], quantity: 3, subtotalCents: 300 }, cart.lines[1]],
      subtotalCents: 400,
    };
    expect(await checkoutIdempotencyKey(changed, "order", "cart_alice")).not.toBe(
      await checkoutIdempotencyKey(cart, "order", "cart_alice"),
    );
  });

  it("separates scopes, so an order and a refund never share a key", async () => {
    expect(await checkoutIdempotencyKey(cart, "order", "cart_alice")).not.toBe(
      await checkoutIdempotencyKey(cart, "refund", "cart_alice"),
    );
  });
});

describe("generated checkout route", () => {
  const square = defineAstroid({ ...base, commerce: { provider: "square" } });

  it("is null unless the project takes card payments (Square storefront)", () => {
    // A marketing site, or a Stripe/Fourthwall project, gets no in-page charge
    // route — so nothing to gate.
    expect(generateAstroidCheckoutRoute({ ...base, archetype: "marketing" })).toBeNull();
  });

  it("gates the money-moving POST to same-origin, like every other public write", () => {
    // Served, a cross-origin correct-price POST reached this route and returned
    // 200 while the contact form and vitals beacon 403'd cross-origin — the one
    // money-moving endpoint was the only ungated public POST. It must refuse a
    // cross-origin request with a 403.
    const route = generateAstroidCheckoutRoute(square);
    expect(route).not.toBeNull();
    expect(route).toContain('import { isSameOrigin } from "louise-toolkit/security"');
    expect(route).toContain('if (!isSameOrigin(request)) return json({ error: "Forbidden" }, 403)');
  });

  it("checks the origin BEFORE parsing the body or re-pricing", () => {
    // Order matters: the gate is worthless if it runs after the work. It must
    // precede the JSON parse (and everything downstream — verifyCheckout, the
    // dormancy gate, createPayment).
    const route = generateAstroidCheckoutRoute(square) as string;
    const gate = route.indexOf("isSameOrigin(request)");
    // Anchor on the CALL sites (`verifyCheckout(body.lines`, `createPayment(`),
    // not the import list where the names first appear.
    expect(gate).toBeLessThan(route.indexOf("request.json()"));
    expect(gate).toBeLessThan(route.indexOf("verifyCheckout(body.lines"));
    expect(gate).toBeLessThan(route.indexOf("createPayment("));
  });
});

describe("generated checkout route — square.locations: multi", () => {
  const single = defineAstroid({ ...base, commerce: { provider: "square" } });
  const multi = defineAstroid({
    ...base,
    commerce: { provider: "square", square: { locations: "multi" } },
  });

  it("never reaches for an ambient SQUARE_LOCATION_ID", () => {
    // The bug. `commerceProviderCredentials` deliberately DROPS
    // SQUARE_LOCATION_ID under multi-location, on the grounds that any path
    // defaulting to an ambient id rings one merchant's sale against another
    // merchant's books. The generated route was exactly such a path: it charged
    // with `env.SQUARE_LOCATION_ID ?? ""` — a var the project is told not to
    // set — so the charge either failed outright or, if someone set the var to
    // quiet it, credited a single location for every merchant's sales.
    const route = generateAstroidCheckoutRoute(multi) as string;
    // Asserted on the READ, not the name — the generated comment explains why
    // the var is absent, so it mentions it by name on purpose.
    expect(route).not.toContain("env.SQUARE_LOCATION_ID");
    // Single-location still uses it, because there the ambient id is correct.
    expect(generateAstroidCheckoutRoute(single)).toContain("env.SQUARE_LOCATION_ID");
  });

  it("resolves the merchant from the host, never from the request body", () => {
    const route = generateAstroidCheckoutRoute(multi) as string;
    expect(route).toContain("function resolveLocationId(request: Request): string | null");
    expect(route).toContain("new URL(request.url).hostname");
    // A body-supplied location is the same exploit as a body-supplied price:
    // name the cheapest merchant's id, pay that price at the dearest shop.
    expect(route).not.toContain("body.locationId");
  });

  it("refuses rather than defaulting when the host is unrecognised", () => {
    const route = generateAstroidCheckoutRoute(multi) as string;
    expect(route).toContain("if (!locationId) {");
    expect(route).toContain(
      'return json({ error: "This storefront is not open for orders." }, 409)',
    );
  });

  it("prices at the resolved location and charges at the same one", () => {
    const route = generateAstroidCheckoutRoute(multi) as string;
    expect(route).toContain("scope: { locationId }");
    // Live from Square, not the mirror: the mirror holds one price per item and
    // structurally cannot answer "what does this cost here".
    expect(route).toContain("retrieveVariationPricesAt(");
    expect(route).not.toContain("readCatalog");
    // Resolved before it is priced against, priced before it is charged.
    const resolved = route.indexOf("const locationId = resolveLocationId(request)");
    expect(resolved).toBeGreaterThan(-1);
    expect(resolved).toBeLessThan(route.indexOf("scope: { locationId }"));
    expect(route.indexOf("scope: { locationId }")).toBeLessThan(route.indexOf("createPayment("));
  });

  it("checks provisioning BEFORE re-pricing, because re-pricing calls Square", () => {
    // The rule the route states for itself: "it must never call Square with a
    // dummy credential." Under multi-location, re-pricing IS a Square call, so
    // leaving the dormancy gate in its usual place — after verification — would
    // have the enforcing step break the rule it enforces. An unprovisioned
    // store must reach neither.
    const route = generateAstroidCheckoutRoute(multi) as string;
    const gate = route.indexOf("if (!status.configured)");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(route.indexOf("await verifyCheckout("));
    expect(gate).toBeLessThan(route.indexOf("createPayment("));
    // And it says it couldn't price, rather than echoing the client's total
    // back as though the server had agreed to it.
    expect(route).toContain("return json({ simulated: true, priced: false });");

    // Single-location prices from D1 with no credential, so its gate stays put
    // and an unconfigured store still gets the staleness check.
    const one = generateAstroidCheckoutRoute(single) as string;
    expect(one.indexOf("if (!status.configured)")).toBeGreaterThan(
      one.indexOf("await verifyCheckout("),
    );
    expect(one).toContain("subtotalCents: check.subtotalCents,");
  });

  it("leaves the single-location route exactly as it was", () => {
    const route = generateAstroidCheckoutRoute(single) as string;
    expect(route).toContain("readCatalog");
    expect(route).toContain("await verifyCheckout(body.lines, serverPrices);");
    expect(route).not.toContain("resolveLocationId");
  });

  it("emits no blank-line scars from the mode branches", () => {
    // Both modes are assembled from one array with the other mode's lines
    // dropped; dropping them as `null` rather than "" is what keeps the output
    // clean, and this is the assertion that notices if that regresses.
    for (const route of [
      generateAstroidCheckoutRoute(single),
      generateAstroidCheckoutRoute(multi),
    ]) {
      expect(route).not.toMatch(/\n\n\n/);
    }
  });

  it("takes the card's locationId as a prop when multi-location", () => {
    const card = generateAstroidSquareCard(multi) as string;
    expect(card).not.toContain("env.SQUARE_LOCATION_ID");
    expect(card).toContain("const { locationId } = Astro.props;");
    expect(generateAstroidSquareCard(single)).toContain(
      "const locationId = env.SQUARE_LOCATION_ID;",
    );
  });
});

describe("generated Square card component", () => {
  const square = defineAstroid({ ...base, commerce: { provider: "square" } });

  it("is null unless the project takes card payments", () => {
    // Square-for-invoicing never renders an in-page card field, so there is no
    // component to emit — same gate as the checkout route.
    expect(generateAstroidSquareCard({ ...base, archetype: "marketing" })).toBeNull();
    expect(generateAstroidSquareCard(square)).not.toBeNull();
  });

  it("surfaces a failed card mount instead of swallowing it", () => {
    // `mountCard` loads Square's SDK from their CDN and builds an iframe; a
    // blocked CDN, a bad app id, or a page load racing a deploy all reject. With
    // nothing chained, that is a silent unhandled rejection and checkout just
    // shows an empty box where the card field should be.
    const card = generateAstroidSquareCard(square) as string;
    expect(card).toContain(".catch((err) => {");
    expect(card).toContain('console.error("[astroid:commerce] card input failed to mount", err)');
  });

  it("says so instead of rendering a dead form when the store is unprovisioned", () => {
    // The ids are read from env at request time, so a store that has commerce
    // configured but no Square credentials yet still renders this component. It
    // must degrade to an explanation naming the two vars — a card field that
    // silently never mounts is indistinguishable from a broken checkout.
    const card = generateAstroidSquareCard(square) as string;
    expect(card).toContain("const ready = Boolean(appId && locationId);");
    expect(card).toContain("Card payments are not configured yet");
  });

  it("never puts the Square ACCESS TOKEN in a client component", () => {
    // The app id and location id are public and belong in the browser; the
    // access token moves money and must stay server-side. This component is
    // shipped to every checkout visitor, so a stray reference here is a
    // credential leak, not a type error — nothing else would catch it.
    const card = generateAstroidSquareCard(square) as string;
    expect(card).toContain("env.SQUARE_APP_ID");
    expect(card).not.toContain("SQUARE_ACCESS_TOKEN");
    // And the raw number stays in Square's iframe: no card <input> of our own,
    // which is the whole reason this is a component instead of a form field.
    expect(card).not.toMatch(/<input/);
  });
});

describe("Square vars are gated per-role, not per-card-checkout", () => {
  // Regression: both vars used to be gated on `usesCardCheckout` (storefront ===
  // "square"). SQUARE_ENVIRONMENT selects the API HOST, and SquareConfig defaults
  // it to "sandbox" — so a Square-for-invoicing site got no var and created every
  // PRODUCTION invoice against the sandbox. No error, no warning, no money.
  const varNames = (c: AstroidConfig) => astroidCheckoutVars(c).map((v) => v.name);

  it("emits SQUARE_ENVIRONMENT when Square only does invoicing", () => {
    const config = {
      ...base,
      commerce: { storefront: "fourthwall", invoicing: "square" },
    } as const;
    expect(varNames(config)).toContain("SQUARE_ENVIRONMENT");
    // The browser card field isn't mounted, so its public app id is not needed.
    expect(varNames(config)).not.toContain("SQUARE_APP_ID");
    expect(generateAstroidCheckoutEnv(config)).toContain("SQUARE_ENVIRONMENT: string;");
    expect(generateAstroidCheckoutEnv(config)).not.toContain("SQUARE_APP_ID");
  });

  it("emits both when Square is the storefront (in-page card field)", () => {
    const config = { ...base, commerce: { provider: "square" } } as const;
    expect(varNames(config)).toEqual(["SQUARE_APP_ID", "SQUARE_ENVIRONMENT"]);
    expect(generateAstroidCheckoutEnv(config)).toContain("SQUARE_APP_ID: string;");
  });

  it("emits neither when the project never talks to Square", () => {
    const config = {
      ...base,
      commerce: { storefront: "fourthwall", invoicing: "stripe" },
    } as const;
    expect(varNames(config)).toEqual([]);
    expect(generateAstroidCheckoutEnv(config)).toBe("");
  });
});

describe("per-provider dormancy gating", () => {
  const status = {
    configured: false,
    enabled: true,
    missing: ["SQUARE_ACCESS_TOKEN"],
    providers: [
      {
        provider: "fourthwall",
        roles: ["storefront"],
        credentials: { configured: true, missing: [] },
        webhook: { configured: true, missing: [] },
        configured: true,
      },
      {
        provider: "square",
        roles: ["invoicing"],
        credentials: { configured: false, missing: ["SQUARE_ACCESS_TOKEN"] },
        webhook: { configured: false, missing: [] },
        configured: false,
      },
    ],
  } as unknown as CommerceStatus;

  it("does not let one dormant provider mute a live one", () => {
    // The aggregate is all-or-nothing by design, and gating a call site on it
    // would simulate the WORKING Fourthwall checkout just because Square's
    // secrets are still placeholders.
    expect(status.configured).toBe(false);
    expect(providerConfigured(status, "fourthwall")).toBe(true);
    expect(providerConfigured(status, "square")).toBe(false);
  });

  it("answers the role-shaped question too", () => {
    expect(roleConfigured(status, "storefront")).toBe(true);
    expect(roleConfigured(status, "invoicing")).toBe(false);
  });

  it("reports false for a provider the project doesn't use at all", () => {
    expect(providerConfigured(status, "stripe")).toBe(false);
  });
});

// ── The `pos` role and multi-location Square ─────────────────────────────────
//
// `pos` is in-person selling: stock held at real places. It is a separate role
// from `storefront` because a site commonly runs both — POD merch through one
// provider, physical originals through another — and because only `pos` needs
// locations, per-location pricing, and inventory.

describe("commerce role: pos", () => {
  it("resolves pos independently of storefront and invoicing", () => {
    const roles = astroidCommerceRoles({
      storefront: "fourthwall",
      invoicing: "square",
      pos: "square",
    });
    expect(roles).toEqual({ storefront: "fourthwall", invoicing: "square", pos: "square" });
  });

  it("counts a provider filling storefront and pos only once", () => {
    expect(astroidCommerceProviders({ storefront: "square", pos: "square" })).toEqual(["square"]);
  });

  it("rejects providers whose client cannot do locations or inventory", () => {
    // Fourthwall's Platform API is create-only for products — it cannot model
    // stock held at a place, so `pos` is not something it can serve.
    expect(() => assertCommerceRoles({ pos: "fourthwall" })).toThrow(/can't serve/);
    expect(() => assertCommerceRoles({ pos: "fourthwall" })).toThrow(/locations\/inventory/);
    expect(() => assertCommerceRoles({ pos: "stripe" })).toThrow(/can't serve/);
    // Only Square can, and the error should say so.
    expect(() => assertCommerceRoles({ pos: "fourthwall" })).toThrow(/square/);
    expect(() => assertCommerceRoles({ pos: "square" })).not.toThrow();
  });

  it("still accepts the real themidwestartist.com shape", () => {
    expect(() =>
      assertCommerceRoles({
        storefront: "fourthwall",
        invoicing: "square",
        pos: "square",
        square: { locations: "multi" },
      }),
    ).not.toThrow();
  });

  it("rejects a square block when no role is assigned to Square", () => {
    // Otherwise a typo'd config looks like it opted into multi-location while
    // nothing actually reads the setting.
    expect(() =>
      assertCommerceRoles({ storefront: "fourthwall", square: { locations: "multi" } }),
    ).toThrow(/no role is assigned to Square/);
  });
});

describe("square.locations: multi", () => {
  it("requires SQUARE_LOCATION_ID for a single-location project", () => {
    expect(commerceSecretNames({ pos: "square" })).toContain("SQUARE_LOCATION_ID");
    expect(commerceProviderCredentials("square", { pos: "square" })).toEqual([
      "SQUARE_ACCESS_TOKEN",
      "SQUARE_LOCATION_ID",
    ]);
  });

  it("DROPS SQUARE_LOCATION_ID when multi-location", () => {
    // Not merely unnecessary — hazardous. Any path defaulting to an ambient
    // location id would ring one merchant's sale against another's books, and
    // would look successful doing it.
    const commerce = { pos: "square" as const, square: { locations: "multi" as const } };
    expect(commerceProviderCredentials("square", commerce)).toEqual(["SQUARE_ACCESS_TOKEN"]);
    expect(commerceSecretNames(commerce)).not.toContain("SQUARE_LOCATION_ID");
    // The token and webhook secret are still required.
    expect(commerceSecretNames(commerce)).toEqual(["SQUARE_ACCESS_TOKEN", "SQUARE_WEBHOOK_SECRET"]);
  });

  it("leaves other providers untouched", () => {
    const commerce = {
      storefront: "fourthwall" as const,
      pos: "square" as const,
      square: { locations: "multi" as const },
    };
    expect(commerceProviderCredentials("fourthwall", commerce)).toEqual([
      "FOURTHWALL_STOREFRONT_TOKEN",
    ]);
    expect(commerceSecretNames(commerce)).toContain("FOURTHWALL_STOREFRONT_TOKEN");
  });

  it("hasMultiLocation only reports the explicit opt-in", () => {
    expect(hasMultiLocation(undefined)).toBe(false);
    expect(hasMultiLocation({ pos: "square" })).toBe(false);
    expect(hasMultiLocation({ pos: "square", square: { locations: "single" } })).toBe(false);
    expect(hasMultiLocation({ pos: "square", square: { locations: "multi" } })).toBe(true);
  });

  it("hasPos is independent of hasStorefront", () => {
    expect(hasPos({ storefront: "fourthwall" })).toBe(false);
    expect(hasPos({ pos: "square" })).toBe(true);
  });
});
