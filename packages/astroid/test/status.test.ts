import { describe, expect, it } from "vitest";
import {
  COMMERCE_PROVIDER_SECRETS,
  commerceSecretNames,
  resolveCommerceStatus,
} from "../src/commerce/secrets.js";
import { type AstroidConfig, defineAstroid } from "../src/config.js";
import { resolveMailer, resolveMailerStatus } from "../src/email/send.js";
import { generateAstroidSecretsEnv, generateAstroidWrangler } from "../src/project/generate.js";
import { generateAstroidEnvBindings } from "../src/queues/scaffold.js";
import { ASTROID_SECRET_PLACEHOLDER } from "../src/secrets.js";
import { astroidModuleStatus, astroidSecretNames, describeAstroidStatus } from "../src/status.js";

const base = (over: Partial<AstroidConfig> = {}): AstroidConfig =>
  defineAstroid({
    key: "acme",
    archetype: "storefront",
    theme: { name: "Acme", colors: { brand: "#123456" } },
    ...over,
  });

/** A scaffold's env: every declared secret present, all placeholder. */
const seeded = (names: string[]) =>
  Object.fromEntries(names.map((n) => [n, ASTROID_SECRET_PLACEHOLDER]));

describe("commerceSecretNames", () => {
  it("declares credentials + webhook secret per configured provider", () => {
    expect(commerceSecretNames({ provider: "square" })).toEqual([
      "SQUARE_ACCESS_TOKEN",
      "SQUARE_LOCATION_ID",
      "SQUARE_WEBHOOK_SECRET",
    ]);
  });

  it("covers both providers when roles are split across two", () => {
    const names = commerceSecretNames({ storefront: "fourthwall", invoicing: "stripe" });
    expect(names).toEqual([
      "FOURTHWALL_STOREFRONT_TOKEN",
      "FOURTHWALL_WEBHOOK_SECRET",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]);
  });

  it("does not ask for the same token twice when one provider fills both roles", () => {
    const names = commerceSecretNames({ storefront: "square", invoicing: "square" });
    expect(names).toEqual([
      "SQUARE_ACCESS_TOKEN",
      "SQUARE_LOCATION_ID",
      "SQUARE_WEBHOOK_SECRET",
    ]);
  });

  it("asks for nothing when the project sells nothing", () => {
    expect(commerceSecretNames(undefined)).toEqual([]);
  });
});

describe("resolveCommerceStatus", () => {
  it("reports a freshly scaffolded storefront as enabled but dormant", async () => {
    const commerce = { provider: "square" as const };
    const status = await resolveCommerceStatus(commerce, seeded(commerceSecretNames(commerce)));

    expect(status.enabled).toBe(true);
    expect(status.configured).toBe(false);
    // Every declared name is named back — this is the "why not" list.
    expect(status.missing).toEqual([
      "SQUARE_ACCESS_TOKEN",
      "SQUARE_LOCATION_ID",
      "SQUARE_WEBHOOK_SECRET",
    ]);
  });

  it("goes live only when credentials AND the webhook secret are real", async () => {
    const commerce = { provider: "square" as const };
    const status = await resolveCommerceStatus(commerce, {
      SQUARE_ACCESS_TOKEN: "sq0atp-real",
      SQUARE_LOCATION_ID: "L123",
      SQUARE_WEBHOOK_SECRET: "whsec-real",
    });
    expect(status.configured).toBe(true);
    expect(status.missing).toEqual([]);
    expect(status.providers[0].roles).toEqual(["storefront"]);
  });

  it("keeps a half-provisioned provider dormant rather than failing mid-checkout", async () => {
    // A token with no location id is Square's classic half-configured state:
    // catalog reads work, and then /v2/orders refuses. Dormant is the honest
    // reading.
    const status = await resolveCommerceStatus(
      { provider: "square" },
      {
        SQUARE_ACCESS_TOKEN: "sq0atp-real",
        SQUARE_LOCATION_ID: ASTROID_SECRET_PLACEHOLDER,
        SQUARE_WEBHOOK_SECRET: "whsec-real",
      },
    );
    expect(status.configured).toBe(false);
    expect(status.missing).toEqual(["SQUARE_LOCATION_ID"]);
    // The webhook half is independently live — it can verify events already.
    expect(status.providers[0].webhook.configured).toBe(true);
    expect(status.providers[0].credentials.configured).toBe(false);
  });

  it("tracks two providers independently", async () => {
    const status = await resolveCommerceStatus(
      { storefront: "fourthwall", invoicing: "stripe" },
      {
        FOURTHWALL_STOREFRONT_TOKEN: "fw-real",
        FOURTHWALL_WEBHOOK_SECRET: "fw-whsec",
        STRIPE_SECRET_KEY: ASTROID_SECRET_PLACEHOLDER,
        STRIPE_WEBHOOK_SECRET: ASTROID_SECRET_PLACEHOLDER,
      },
    );
    expect(status.configured).toBe(false);
    const fw = status.providers.find((p) => p.provider === "fourthwall");
    const stripe = status.providers.find((p) => p.provider === "stripe");
    expect(fw?.configured).toBe(true);
    expect(fw?.roles).toEqual(["storefront"]);
    expect(stripe?.configured).toBe(false);
    expect(stripe?.roles).toEqual(["invoicing"]);
  });

  it("distinguishes 'no commerce' from 'commerce dormant'", async () => {
    const status = await resolveCommerceStatus(undefined, {});
    expect(status.enabled).toBe(false);
    expect(status.configured).toBe(false);
    expect(status.providers).toEqual([]);
  });
});

describe("resolveMailerStatus", () => {
  const binding = { send: async () => ({ messageId: "m1" }) };

  it("needs both a binding and a real sender address", async () => {
    expect((await resolveMailerStatus({ EMAIL: binding, MAIL_FROM: "hi@acme.test" })).configured).toBe(
      true,
    );
  });

  it("names the binding when it is the missing half (the wrangler dev case)", async () => {
    const status = await resolveMailerStatus({ MAIL_FROM: "hi@acme.test" });
    expect(status.configured).toBe(false);
    expect(status.hasBinding).toBe(false);
    expect(status.missing).toEqual(["EMAIL"]);
  });

  it("treats a placeholder sender as unconfigured, not as an envelope", async () => {
    const status = await resolveMailerStatus({
      EMAIL: binding,
      MAIL_FROM: ASTROID_SECRET_PLACEHOLDER,
    });
    expect(status.configured).toBe(false);
    expect(status.missing).toEqual(["MAIL_FROM"]);
  });

  it("resolveMailer forces logOnly while dormant, and never a placeholder from", async () => {
    const mailer = await resolveMailer({ EMAIL: binding, MAIL_FROM: ASTROID_SECRET_PLACEHOLDER });
    expect(mailer.logOnly).toBe(true);
    expect(mailer.from).toBe("noreply@localhost");
    expect(mailer.from).not.toBe(ASTROID_SECRET_PLACEHOLDER);
  });

  it("resolveMailer sends for real once configured", async () => {
    const mailer = await resolveMailer({ EMAIL: binding, MAIL_FROM: "hi@acme.test" });
    expect(mailer.logOnly).toBe(false);
    expect(mailer.from).toBe("hi@acme.test");
  });
});

describe("astroidModuleStatus", () => {
  it("reports a fully unprovisioned storefront scaffold as dormant, module by module", async () => {
    const config = base({ commerce: { provider: "square" } });
    const env = seeded(astroidSecretNames(config).commerce ?? []);
    const reports = await astroidModuleStatus(config, env);

    const commerce = reports.find((r) => r.module === "commerce");
    const email = reports.find((r) => r.module === "email");
    expect(commerce?.configured).toBe(false);
    expect(email?.configured).toBe(false);

    const printed = describeAstroidStatus(reports);
    // The done-when: an unconfigured scaffold says so, and says what to set.
    expect(printed).toContain("commerce: dormant (simulated)");
    expect(printed).toContain("SQUARE_ACCESS_TOKEN");
    expect(printed).toContain("email: dormant (simulated)");
    // And it says where the magic link actually is, which is the thing a
    // developer is really looking for on a fresh clone.
    expect(printed).toContain("the magic link is in the log");
  });

  it("omits commerce entirely for a project that sells nothing", async () => {
    const reports = await astroidModuleStatus(base({ archetype: "marketing" }), {});
    expect(reports.map((r) => r.module)).toEqual(["email"]);
  });

  it("reports configured modules as configured", async () => {
    const config = base({ commerce: { provider: "stripe" } });
    const reports = await astroidModuleStatus(config, {
      EMAIL: { send: async () => ({ messageId: "m1" }) },
      MAIL_FROM: "hi@acme.test",
      STRIPE_SECRET_KEY: "sk_live_x",
      STRIPE_WEBHOOK_SECRET: "whsec_x",
    });
    expect(reports.every((r) => r.configured)).toBe(true);
    expect(describeAstroidStatus(reports)).toContain("commerce: configured");
  });
});

describe("scaffold seeding", () => {
  it("seeds every declared commerce secret with the sentinel", () => {
    const env = generateAstroidSecretsEnv(base({ commerce: { provider: "square" } }));
    for (const name of commerceSecretNames({ provider: "square" })) {
      expect(env).toContain(`${name}=${ASTROID_SECRET_PLACEHOLDER}`);
    }
    // And tells the developer where to get them.
    expect(env).toContain("developer.squareup.com");
  });

  it("emits nothing for a project with no credentialed module", () => {
    expect(generateAstroidSecretsEnv(base({ archetype: "marketing" }))).toBe("");
  });

  it("lists the secrets to provision in the generated wrangler.jsonc", () => {
    const wrangler = generateAstroidWrangler(base({ commerce: { provider: "stripe" } }));
    expect(wrangler).toContain("STRIPE_SECRET_KEY");
    expect(wrangler).toContain("wrangler secret put");
    // As a COMMENT — a committed file must never carry a secret's value, not
    // even the placeholder. (The prose mentions the sentinel by name, which is
    // fine; what must not appear is an assignment of one.)
    expect(wrangler).not.toContain(`"STRIPE_SECRET_KEY":`);
    expect(wrangler).not.toContain(`: "${ASTROID_SECRET_PLACEHOLDER}"`);
    expect(wrangler).not.toContain(`=${ASTROID_SECRET_PLACEHOLDER}`);
  });

  it("types every declared secret in the scaffolded env.d.ts block", () => {
    const bindings = generateAstroidEnvBindings(base({ commerce: { provider: "square" } }));
    for (const name of commerceSecretNames({ provider: "square" })) {
      expect(bindings).toContain(`${name}?: string;`);
    }
  });

  it("keeps the webhook secret name in one place across scaffold + gate", () => {
    // The regression this guards: queues/scaffold.ts used to carry its own copy
    // of the webhook binding name, so renaming one left the other pointing at a
    // binding that no longer exists.
    const bindings = generateAstroidEnvBindings(base({ commerce: { provider: "fourthwall" } }));
    expect(bindings).toContain(`${COMMERCE_PROVIDER_SECRETS.fourthwall.webhook}?: string;`);
    expect(commerceSecretNames({ provider: "fourthwall" })).toContain(
      COMMERCE_PROVIDER_SECRETS.fourthwall.webhook,
    );
  });
});
