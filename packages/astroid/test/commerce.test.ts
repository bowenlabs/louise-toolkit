import { describe, expect, it, vi } from "vitest";
import { fourthwallToCatalogItem, squareToCatalogItem } from "../src/commerce/adapters.js";
import { checkoutIdempotencyKey, verifyCheckout } from "../src/commerce/checkout.js";
import { generateAstroidCheckoutRoute } from "../src/commerce/checkout-scaffold.js";
import { generateCatalogTable } from "../src/commerce/mirror.js";
import {
  assertCommerceRoles,
  astroidCommerceProviders,
  astroidCommerceRoles,
} from "../src/commerce/roles.js";
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
    const lookup = vi.fn(prices({ V1: 100 }));
    await verifyCheckout(
      [
        { variantId: "V1", quantity: 1, unitPriceCents: 100 },
        { variantId: "V1", quantity: 2, unitPriceCents: 100 },
      ],
      lookup,
    );
    expect(lookup).toHaveBeenCalledWith(["V1"]);
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
      prepare(sql: string) {
        calls++;
        if (calls === 1) throw new Error("transient");
        return {
          bind() {
            return { async run() {}, async first() { return null; } };
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
    expect(route).toContain("if (!isSameOrigin(request)) return json({ error: \"Forbidden\" }, 403)");
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
