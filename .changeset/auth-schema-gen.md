---
"louisecms": minor
---

Add an auth-schema generator so sites regenerate their Better Auth migration
from config instead of hand-rolling DDL (#15). `louisecms/auth` now exports
`generateAuthSchemaSql` / `authSchemaOptions` (built on Better Auth's
programmatic `getAuthTables`, no native `@better-auth/cli` dependency), and the
package ships a `louise` CLI: `louise gen-auth-schema [--config <path>]
[--table-prefix <p>] [--out <file>]`. Supports a same-D1 auth namespace (Option
B): pass `tablePrefix` (e.g. `"auth_"`) to render prefixed tables + foreign
keys, and set the matching `LouiseAuthConfig.tablePrefix` so `getLouiseAuth`
queries them. Prefix omitted → default table names (unchanged behavior).
