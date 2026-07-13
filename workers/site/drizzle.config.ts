import { defineConfig } from "drizzle-kit";

// Generates D1 (SQLite) migrations from src/schema.ts into ./migrations, which
// wrangler applies (`wrangler d1 migrations apply DB [--local]`). The schema is
// the ready-made louise/db tables.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
});
