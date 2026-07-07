import { describe, expect, it } from "vitest";
import { authSchemaOptions, generateAuthSchemaSql } from "../../src/core/auth/index.js";

describe("generateAuthSchemaSql", () => {
  it("emits the Better Auth base tables with default names", () => {
    const sql = generateAuthSchemaSql();
    for (const t of ["user", "session", "account", "verification", "passkey"]) {
      expect(sql).toContain(`CREATE TABLE \`${t}\``);
    }
  });

  it("pins Better Auth's type map + constraints (email not-null unique, FK to user)", () => {
    const sql = generateAuthSchemaSql();
    expect(sql).toContain('"email" text not null unique');
    expect(sql).toContain('foreign key ("userId") references "user" ("id") on delete cascade');
  });

  it("adds the site's additionalFields as nullable columns when optional", () => {
    const sql = generateAuthSchemaSql({
      additionalFields: { squareCustomerId: { type: "string", required: false } },
    });
    expect(sql).toContain('"squareCustomerId" text');
    // required:false → the column must NOT be NOT NULL.
    expect(sql).not.toMatch(/"squareCustomerId" text not null/);
  });

  it("namespaces every table and its foreign keys under tablePrefix (Option B)", () => {
    const sql = generateAuthSchemaSql({ tablePrefix: "auth_" });
    expect(sql).toContain("CREATE TABLE `auth_user`");
    expect(sql).toContain("CREATE TABLE `auth_session`");
    expect(sql).toContain('references "auth_user" ("id")');
    // No un-prefixed table definitions leak through.
    expect(sql).not.toMatch(/CREATE TABLE `user`/);
    expect(sql).toContain('namespaced "auth_"');
  });

  it("still generates with customer email/password enabled", () => {
    const sql = generateAuthSchemaSql({ customers: true });
    expect(sql).toContain("CREATE TABLE `account`");
    expect(sql).toContain("CREATE TABLE `user`");
  });
});

describe("authSchemaOptions", () => {
  it("uses Louise's always-on plugin set and threads additionalFields", () => {
    const opts = authSchemaOptions({
      additionalFields: { squareCustomerId: { type: "string", required: false } },
    });
    expect(opts.plugins).toHaveLength(3); // magic-link + admin + passkey
    expect(opts.user?.additionalFields).toHaveProperty("squareCustomerId");
    expect(opts.emailAndPassword).toBeUndefined();
  });

  it("enables emailAndPassword only when customers is set", () => {
    expect(authSchemaOptions({ customers: true }).emailAndPassword).toEqual({ enabled: true });
  });
});
