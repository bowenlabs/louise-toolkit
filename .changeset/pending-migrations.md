---
"louise-toolkit": minor
---

You can now check that a D1 database is migrated as far as the deployed code expects, before a deploy and in the Health panel. Schema migrations are applied by hand, and a deploy that lands before its migration used to fail later as a missing column on whatever route touched it first.

- **`migrationStatus(d1, expected)`** (`louise-toolkit/db`) compares the migration files the code was built with against D1's `d1_migrations` ledger. It returns what's `pending` (the database is behind), `applied`, and `unknown` (a newer deploy migrated the shared database). It's read-only. `assertMigrationsApplied` throws the new `LouisePendingMigrationsError`, whose `files` names the pending migrations, and `compareMigrations` is the pure comparison.
- **`louise migrations-check <database> [--remote]`** is the deploy gate. It reads the ledger through `wrangler d1 execute` and exits 1 when the database hasn't applied a `.sql` file in `--dir` (default `migrations`).
- **The Health panel** names pending migrations and tells the owner to ask their developer. Pass `pendingMigrations` to `summarizeHealth`. It counts toward `healthIssueCount` and the Health card.

**What to do:** nothing is required. To use the gate, put `louise migrations-check DB --remote &&` in front of your deploy command. The account token must be able to read D1. To show pending migrations to owners, bundle your migration file names (for example with `import.meta.glob`) and pass `migrationStatus(...).pending` to `summarizeHealth` and to your summary reads.
