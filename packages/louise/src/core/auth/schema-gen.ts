// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Auth-schema generator (issue #15) — "always generate, never hand-roll". Emits
// the D1 migration DDL for Better Auth's tables by introspecting the SAME plugin
// set the runtime factory uses (`getAuthTables`), so the committed schema can
// never drift from what `getLouiseAuth` expects. Louise owns the base plugin
// set (→ base tables); the site's `additionalFields`/`customers` add its columns.
//
// This uses Better Auth's programmatic `getAuthTables` (already a peer dep) with
// Better Auth's own type map, rather than `@better-auth/cli generate` — the CLI
// needs a native better-sqlite3 build, and we only need the field metadata.
//
// Isolation (issue #15, Option B — "same D1, namespaced"): pass a `tablePrefix`
// (e.g. `"auth_"`) to render a visible auth boundary in one database. The SAME
// prefix must be set on `LouiseAuthConfig.tablePrefix` so the runtime queries
// the prefixed tables. Prefix off → default table names (identical to today).

import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { getAuthTables } from "better-auth/db";
import { admin, magicLink, organization } from "better-auth/plugins";
import { LOUISE_USER_FIELDS } from "./fields.js";

type BetterAuthOptions = Parameters<typeof betterAuth>[0];
type AdditionalFields = NonNullable<NonNullable<BetterAuthOptions["user"]>["additionalFields"]>;

export interface AuthSchemaConfig {
  /** Enable customer email/password sign-in (widens the account/user schema).
   *  Mirror `LouiseAuthConfig.customers` being set. */
  customers?: boolean;
  /** Extra Better Auth user columns (e.g. `squareCustomerId`). MUST match the
   *  runtime `LouiseAuthConfig.additionalFields` so generated columns line up. */
  additionalFields?: AdditionalFields;
  /** Enable the organization plugin's tables (`organization`/`member`/
   *  `invitation`, plus `team`/`teamMember` when `teams` is set) and the
   *  `activeOrganizationId` session column. MUST mirror
   *  `LouiseAuthConfig.organizations` — only `teams` affects the schema, so
   *  runtime-only knobs (e.g. `allowUserToCreateOrganization`) are omitted. */
  organizations?: { teams?: boolean };
  /** Table-name prefix for a same-D1 auth boundary (Option B), e.g. `"auth_"`.
   *  Must equal `LouiseAuthConfig.tablePrefix` at runtime. Empty → default names. */
  tablePrefix?: string;
}

/**
 * The field-affecting Better Auth options for Louise's always-on plugin set
 * (magic-link, admin, passkey) plus the site's opt-in customer sign-in and extra
 * user fields. Runtime-only concerns (email sender, captcha secret, rpID) don't
 * change the schema, so they're omitted — the plugins are constructed with inert
 * options purely for introspection.
 */
export function authSchemaOptions(config: AuthSchemaConfig): BetterAuthOptions {
  return {
    ...(config.customers ? { emailAndPassword: { enabled: true } } : {}),
    // Louise's standard first/last name fields, ahead of the site's own extras —
    // mirrors auth.ts so the generated schema matches the runtime user table.
    user: { additionalFields: { ...LOUISE_USER_FIELDS, ...config.additionalFields } },
    plugins: [
      magicLink({ sendMagicLink: async () => {} }),
      admin(),
      passkey(),
      // No prefix/schema override here: `generateAuthSchemaSql` namespaces every
      // table (and FK target) at emit time, so introspecting the plain plugin is
      // enough — mirrors how the base tables are prefixed.
      ...(config.organizations
        ? [organization(config.organizations.teams ? { teams: { enabled: true } } : {})]
        : []),
    ],
  };
}

/** Map a Better Auth field descriptor to a SQLite column type (Better Auth's own
 *  type map: string/id/json/array → text, boolean/number → integer, date → date). */
function sqliteType(field: { type: unknown; bigint?: boolean }): string {
  const t = field.type;
  if (Array.isArray(t)) return "text";
  switch (t) {
    case "boolean":
      return "integer";
    case "number":
      return field.bigint ? "bigint" : "integer";
    case "date":
      return "date";
    default:
      return "text";
  }
}

/**
 * Generate the CREATE TABLE DDL for Better Auth's tables (user, session,
 * account, verification, passkey — plus any `additionalFields` columns),
 * optionally namespaced by `tablePrefix`. Foreign keys resolve to the prefixed
 * target table so a namespaced schema stays internally consistent. The output is
 * the SQL a site commits as its auth migration.
 */
export function generateAuthSchemaSql(config: AuthSchemaConfig = {}): string {
  const prefix = config.tablePrefix ?? "";
  // The prefix is interpolated straight into table names + FK targets in the
  // emitted DDL, so hold it to the same identifier shape the runtime SQL
  // guards enforce (mirrors editor `ident`) — a stray char can't become a
  // broken/injected CREATE TABLE.
  if (prefix && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(prefix)) {
    throw new Error(
      `Invalid tablePrefix ${JSON.stringify(prefix)} (must match /^[A-Za-z_][A-Za-z0-9_]*$/)`,
    );
  }
  const tables = getAuthTables(authSchemaOptions(config)) as Record<
    string,
    {
      modelName: string;
      fields: Record<
        string,
        {
          type: unknown;
          bigint?: boolean;
          fieldName?: string;
          required?: boolean;
          unique?: boolean;
          references?: { model: string; field: string; onDelete?: string };
        }
      >;
    }
  >;

  const named = (modelKey: string) => `${prefix}${tables[modelKey]?.modelName ?? modelKey}`;

  const stmts: string[] = [];
  for (const model of Object.values(tables)) {
    const cols = ['  "id" text primary key not null'];
    const fks: string[] = [];
    for (const [fieldName, field] of Object.entries(model.fields)) {
      const name = field.fieldName || fieldName;
      let col = `  "${name}" ${sqliteType(field)}`;
      if (field.required !== false) col += " not null";
      if (field.unique) col += " unique";
      cols.push(col);
      if (field.references) {
        const refTable = named(field.references.model);
        fks.push(
          `  foreign key ("${name}") references "${refTable}" ("${field.references.field}") on delete ${field.references.onDelete ?? "cascade"}`,
        );
      }
    }
    stmts.push(
      `CREATE TABLE \`${prefix}${model.modelName}\` (\n${[...cols, ...fks].join(",\n")}\n);`,
    );
  }

  const header = prefix
    ? `-- Better Auth tables (generated by louise — louise gen-auth-schema; namespaced "${prefix}")`
    : "-- Better Auth tables (generated by louise — louise gen-auth-schema)";
  return `${header}\n${stmts.join("\n\n")}\n`;
}
